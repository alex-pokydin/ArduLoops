//! MCP stdio server. Cursor launches `arduloops.exe --mcp`; this process
//! talks to the running app on HTTP 127.0.0.1:8767 (same MAVLink as the UI).
use std::io::{self, BufRead, Write};

use serde_json::{json, Value};

use crate::cli;
use crate::http::HTTP_ADDR;
use crate::link::DEFAULT_URL;

const PROTOCOL: &str = "2024-11-05";

pub fn run() -> i32 {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    loop {
        match read_message(&mut input) {
            Ok(None) => return 0,
            Ok(Some(msg)) => handle(msg),
            Err(_) => return 1,
        }
    }
}

fn read_message(input: &mut impl BufRead) -> io::Result<Option<Value>> {
    let mut line = String::new();
    loop {
        line.clear();
        let n = input.read_line(&mut line)?;
        if n == 0 {
            return Ok(None);
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.to_ascii_lowercase().starts_with("content-length:") {
            let len: usize = trimmed
                .split(':')
                .nth(1)
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0);
            loop {
                line.clear();
                input.read_line(&mut line)?;
                if line.trim().is_empty() {
                    break;
                }
            }
            let mut buf = vec![0u8; len];
            input.read_exact(&mut buf)?;
            return Ok(serde_json::from_slice(&buf).ok());
        }
        return Ok(serde_json::from_str(trimmed).ok());
    }
}

fn send(msg: &Value) {
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "{msg}");
    let _ = out.flush();
}

fn handle(msg: Value) {
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    match method {
        "initialize" => {
            let ver = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(PROTOCOL);
            reply(
                id,
                json!({
                    "protocolVersion": ver,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "arduloops", "version": "1.3.0" },
                    "instructions": format!(
                        "Same MAVLink as the ArduLoops window. Start the app first (HTTP {HTTP_ADDR})."
                    )
                }),
            );
        }
        "notifications/initialized" | "notifications/cancelled" => {}
        "ping" => reply(id, json!({})),
        "tools/list" => reply(id, json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            match call_tool(name, &args) {
                Ok(obj) => tool_result(id, &obj, false),
                Err(err) => tool_result(id, &json!({ "error": err }), true),
            }
        }
        _ if id.is_some() => {
            send(&json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": "Method not found" }
            }));
        }
        _ => {}
    }
}

fn reply(id: Option<Value>, result: Value) {
    if id.is_none() {
        return;
    }
    send(&json!({ "jsonrpc": "2.0", "id": id, "result": result }));
}

fn tool_result(id: Option<Value>, obj: &Value, is_error: bool) {
    let text = serde_json::to_string_pretty(obj).unwrap_or_else(|_| obj.to_string());
    reply(
        id,
        json!({
            "content": [{ "type": "text", "text": text }],
            "isError": is_error
        }),
    );
}

fn tools() -> Value {
    let mut list = json!([
        {
            "name": "ardupilot_connect",
            "description": concat!(
                "Point ArduLoops at a MAVLink URL. ",
                "Default tcpout:127.0.0.1:5763.",
            ),
            "inputSchema": {
                "type": "object",
                "properties": { "conn_str": { "type": "string" } }
            }
        },
        {
            "name": "ardupilot_vehicle_state",
            "description": "Mode, armed, attitude, altitude from the live ArduLoops link.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "ardupilot_get_param",
            "description": "Read one parameter by exact name, e.g. ATC_RAT_RLL_P.",
            "inputSchema": {
                "type": "object",
                "properties": { "name": { "type": "string" } },
                "required": ["name"]
            }
        },
        {
            "name": "ardupilot_set_param",
            "description": "Set one parameter (float32).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "value": { "type": "number" }
                },
                "required": ["name", "value"]
            }
        },
        {
            "name": "ardupilot_list_params",
            "description": "List cached parameters, optional glob e.g. ATC_RAT_*.",
            "inputSchema": {
                "type": "object",
                "properties": { "glob": { "type": ["string", "null"] } }
            }
        },
        {
            "name": "ardupilot_set_mode",
            "description": "Set flight mode by name, e.g. STABILIZE, ALT_HOLD.",
            "inputSchema": {
                "type": "object",
                "properties": { "mode": { "type": "string" } },
                "required": ["mode"]
            }
        },
        {
            "name": "ardupilot_arm",
            "description": concat!(
                "ARM. ",
                "Requires ArduLoops to be linked.",
            ),
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "ardupilot_disarm",
            "description": "DISARM.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "ardupilot_diagnostics",
            "description": concat!(
                "Firmware, optical flow quality/rates, sensor health, timestamped STATUSTEXT and command ACKs, parameter download completeness. ",
                "Read-only refresh optionally requests telemetry streams.",
            ),
            "inputSchema": {"type": "object", "properties": {"refresh": {"type": "boolean"}}}
        },
        {
            "name": "ardupilot_list_logs",
            "description": concat!(
                "List on-board ArduPilot DataFlash logs with ID, UTC timestamp and size. ",
                "This read-only transfer requires a fresh disarmed vehicle heartbeat.",
            ),
            "inputSchema": {"type": "object", "properties": {"refresh": {"type": "boolean"}}}
        },
        {
            "name": "ardupilot_download_log",
            "description": concat!(
                "Download one on-board DataFlash log by log_id to ArduLoops local storage. ",
                "Returns the saved .bin path and transfer metadata; it never embeds log bytes in MCP. ",
                "Requires a fresh disarmed vehicle heartbeat.",
            ),
            "inputSchema": {"type": "object", "properties": {"log_id": {"type": "integer", "minimum": 1}, "timeout_s": {"type": "integer", "minimum": 5, "maximum": 180}}, "required": ["log_id"]}
        },
        {
            "name": "ardupilot_erase_logs",
            "description": concat!(
                "Permanently erase every on-board DataFlash log. ",
                "Requires a fresh disarmed vehicle heartbeat and explicit confirm: true. ",
                "Download the needed logs first.",
            ),
            "inputSchema": {"type": "object", "properties": {"confirm": {"type": "boolean"}}, "required": ["confirm"]}
        },
        {
            "name": "ardupilot_firmware_library",
            "description": concat!(
                "Read the local SQLite firmware library. ",
                "Each artifact includes its stable artifact ID for flashing, build ID, version, git revision, selected feature IDs, image size, description, build timestamps, user comment and compatibility with the connected controller. ",
                "The controller includes board name, persistent local identity and user comment when available.",
            ),
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "ardupilot_set_controller_comment",
            "description": concat!(
                "Create, replace or clear the local user comment for a known controller. ",
                "Read the controller key from ardupilot_firmware_library.",
            ),
            "inputSchema": {"type": "object", "properties": {"controller_key": {"type": "string"}, "comment": {"type": "string", "maxLength": 2000}}, "required": ["controller_key", "comment"]}
        },
        {
            "name": "ardupilot_set_firmware_comment",
            "description": concat!(
                "Create, replace or clear the local user comment for a firmware artifact. ",
                "Read the artifact ID from ardupilot_firmware_library.",
            ),
            "inputSchema": {"type": "object", "properties": {"artifact_id": {"type": "string"}, "comment": {"type": "string", "maxLength": 2000}}, "required": ["artifact_id", "comment"]}
        },
        {
            "name": "ardupilot_recent_statustext",
            "description": "Recent STATUSTEXT, newest first.",
            "inputSchema": {
                "type": "object",
                "properties": { "n": { "type": "integer" } }
            }
        }
    ]);
    list.as_array_mut()
        .unwrap()
        .extend(crate::firmware::tools());
    list
}

fn call_tool(name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "ardupilot_firmware_catalog" => crate::firmware::call("catalog", args),
        "ardupilot_firmware_build" => crate::firmware::call("build", args),
        "ardupilot_firmware_flash"
            if args.get("action").and_then(Value::as_str) == Some("start_bootloader") =>
        {
            parse_body(cli::http_post("/firmware/flash", &args.to_string())?)
        }
        "ardupilot_firmware_flash" => crate::firmware::call("flash", args),
        "ardupilot_connect" => {
            let url = args
                .get("conn_str")
                .and_then(Value::as_str)
                .unwrap_or(DEFAULT_URL);
            cli::http_post("/cmd", &json!({ "op": "connect", "url": url }).to_string())?;
            Ok(json!({ "ok": true, "url": url }))
        }
        "ardupilot_vehicle_state" => parse_body(cli::http_get("/state")?),
        "ardupilot_get_param" => {
            let pname = args.get("name").and_then(Value::as_str).ok_or("name")?;
            parse_body(cli::http_get(&format!(
                "/param?name={}",
                urlencoding(pname)
            ))?)
        }
        "ardupilot_set_param" => {
            let pname = args.get("name").and_then(Value::as_str).ok_or("name")?;
            let value = args.get("value").and_then(Value::as_f64).ok_or("value")?;
            cli::http_post(
                "/cmd",
                &json!({ "op": "param", "name": pname, "value": value }).to_string(),
            )?;
            parse_body(cli::http_get(&format!(
                "/param?name={}&fresh=1",
                urlencoding(pname)
            ))?)
        }
        "ardupilot_list_params" => {
            let glob = args.get("glob").and_then(Value::as_str).unwrap_or("*");
            parse_body(cli::http_get(&format!(
                "/params?glob={}",
                urlencoding(glob)
            ))?)
        }
        "ardupilot_set_mode" => {
            let mode = args.get("mode").and_then(Value::as_str).ok_or("mode")?;
            let result = parse_body(cli::http_post(
                "/cmd",
                &json!({ "op": "mode", "mode": mode }).to_string(),
            )?)?;
            if result.get("ok") == Some(&Value::Bool(false)) {
                return Err(result.to_string());
            }
            Ok(result)
        }
        "ardupilot_arm" => {
            cli::http_post("/cmd", r#"{"op":"arm","on":true}"#)?;
            Ok(json!({ "ok": true }))
        }
        "ardupilot_disarm" => {
            cli::http_post("/cmd", r#"{"op":"arm","on":false}"#)?;
            Ok(json!({ "ok": true }))
        }
        "ardupilot_diagnostics" => {
            if args
                .get("refresh")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                cli::http_post("/cmd", r#"{"op":"diagnostics"}"#)?;
            }
            parse_body(cli::http_get("/diagnostics")?)
        }
        "ardupilot_list_logs" => {
            let refresh = args.get("refresh").and_then(Value::as_bool).unwrap_or(true);
            parse_body(cli::http_get(&format!(
                "/logs?refresh={}",
                if refresh { 1 } else { 0 }
            ))?)
        }
        "ardupilot_download_log" => {
            let id = args.get("log_id").and_then(Value::as_u64).ok_or("log_id")?;
            let timeout = args
                .get("timeout_s")
                .and_then(Value::as_u64)
                .unwrap_or(120)
                .clamp(5, 3_600);
            parse_body(cli::http_get(&format!(
                "/logs/download?id={id}&timeout_s={timeout}"
            ))?)
        }
        "ardupilot_erase_logs" => {
            if args.get("confirm").and_then(Value::as_bool) != Some(true) {
                return Err("Erasing DataFlash logs is permanent; pass confirm: true".into());
            }
            parse_body(cli::http_post("/logs/erase", r#"{"confirm":true}"#)?)
        }
        "ardupilot_firmware_library" => parse_body(cli::http_get("/firmware-library")?),
        "ardupilot_set_controller_comment" => {
            let key = args
                .get("controller_key")
                .and_then(Value::as_str)
                .ok_or("controller_key")?;
            let comment = args
                .get("comment")
                .and_then(Value::as_str)
                .ok_or("comment")?;
            parse_body(cli::http_post(
                "/firmware-library/comment",
                &json!({"controller_key": key, "comment": comment}).to_string(),
            )?)
        }
        "ardupilot_set_firmware_comment" => {
            let id = args
                .get("artifact_id")
                .and_then(Value::as_str)
                .ok_or("artifact_id")?;
            let comment = args
                .get("comment")
                .and_then(Value::as_str)
                .ok_or("comment")?;
            parse_body(cli::http_post(
                "/firmware-library/comment",
                &json!({"artifact_id": id, "comment": comment}).to_string(),
            )?)
        }
        "ardupilot_recent_statustext" => {
            let n = args.get("n").and_then(Value::as_u64).unwrap_or(10);
            parse_body(cli::http_get(&format!("/statustext?n={n}"))?)
        }
        _ => Err(format!("unknown tool {name}")),
    }
}

fn parse_body(body: String) -> Result<Value, String> {
    let t = body.trim();
    if t.is_empty() || t == "ok" {
        return Ok(json!({ "ok": true }));
    }
    serde_json::from_str(t).or_else(|_| Ok(json!({ "raw": t })))
}

fn urlencoding(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
