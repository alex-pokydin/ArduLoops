//! One-shot CLI against a running ArduLoops bridge (same MAVLink as the UI).
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use crate::http::HTTP_ADDR;
use crate::link::DEFAULT_URL;

pub fn run(args: &[String]) -> i32 {
    if args.first().map(String::as_str) == Some("mcp") {
        eprintln!("MCP is node 5.1/live/web/mcp.mjs (points at this HTTP API).");
        eprintln!("CLI: arduloops-bridge state | param get NAME | param set NAME VAL | ...");
        return 2;
    }
    match dispatch(args) {
        Ok(body) => {
            print!("{body}");
            if !body.ends_with('\n') {
                println!();
            }
            0
        }
        Err(err) => {
            eprintln!("{err}");
            1
        }
    }
}

fn dispatch(args: &[String]) -> Result<String, String> {
    if args.is_empty() || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
        return Ok(help().into());
    }
    match args[0].as_str() {
        "state" => http_get("/state"),
        "statustext" => {
            let n = args.get(1).map(|s| s.as_str()).unwrap_or("10");
            http_get(&format!("/statustext?n={n}"))
        }
        "param" => match args.get(1).map(String::as_str) {
            Some("get") => {
                let name = args.get(2).ok_or("param get NAME")?;
                http_get(&format!("/param?name={name}"))
            }
            Some("set") => {
                let name = args.get(2).ok_or("param set NAME VALUE")?;
                let value: f64 = args
                    .get(3)
                    .ok_or("param set NAME VALUE")?
                    .parse()
                    .map_err(|_| "value")?;
                http_post(
                    "/cmd",
                    &serde_json::json!({ "op": "param", "name": name, "value": value }).to_string(),
                )?;
                http_get(&format!("/param?name={name}&fresh=1"))
            }
            Some("list") => {
                let glob = args.get(2).map(|s| s.as_str()).unwrap_or("*");
                http_get(&format!("/params?glob={glob}"))
            }
            _ => Err("param get|set|list".into()),
        },
        "mode" => {
            let mode = args.get(1).ok_or("mode NAME")?;
            http_post(
                "/cmd",
                &serde_json::json!({ "op": "mode", "mode": mode }).to_string(),
            )
        }
        "arm" => http_post("/cmd", r#"{"op":"arm","on":true}"#),
        "disarm" => http_post("/cmd", r#"{"op":"arm","on":false}"#),
        "reboot" => http_post("/cmd", r#"{"op":"reboot"}"#),
        "connect" => {
            let url = args.get(1).map(|s| s.as_str()).unwrap_or(DEFAULT_URL);
            http_post(
                "/cmd",
                &serde_json::json!({ "op": "connect", "url": url }).to_string(),
            )
        }
        "disconnect" => http_post("/cmd", r#"{"op":"disconnect"}"#),
        "health" => http_get("/health"),
        other => Err(format!("unknown command: {other}\n{}", help())),
    }
}

fn help() -> &'static str {
    "ArduLoops CLI — talks to a running bridge (npm run dev), not a second MAVLink.\n\
     \n\
     arduloops-bridge state\n\
     arduloops-bridge statustext [N]\n\
     arduloops-bridge param get NAME\n\
     arduloops-bridge param set NAME VALUE\n\
     arduloops-bridge param list [GLOB]     e.g. ATC_RAT_*\n\
     arduloops-bridge mode STABILIZE\n\
     arduloops-bridge arm | disarm\n\
     arduloops-bridge reboot\n\
     arduloops-bridge connect [tcpout:127.0.0.1:5763]\n\
     arduloops-bridge health\n\
     \n\
     From 5.1/live/web: npm run cli -- state\n\
     Cursor MCP: node mcp.mjs (same HTTP, needs npm run dev)\n"
}

fn http_get(path: &str) -> Result<String, String> {
    request("GET", path, None)
}

fn http_post(path: &str, body: &str) -> Result<String, String> {
    request("POST", path, Some(body))
}

fn request(method: &str, path: &str, body: Option<&str>) -> Result<String, String> {
    let mut stream = TcpStream::connect(HTTP_ADDR).map_err(|_| {
        format!("no bridge at http://{HTTP_ADDR} — start ArduLoops (npm run dev)")
    })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .ok();
    let extra = if let Some(b) = body {
        format!(
            "Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{b}",
            b.len()
        )
    } else {
        "\r\n".into()
    };
    let req = format!("{method} {path} HTTP/1.1\r\nHost: {HTTP_ADDR}\r\nConnection: close\r\n{extra}");
    stream
        .write_all(req.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut buf = String::new();
    stream.read_to_string(&mut buf).map_err(|e| e.to_string())?;
    let (_head, rest) = buf.split_once("\r\n\r\n").unwrap_or(("", &buf));
    let body = rest.trim_end().to_string();
    if body.is_empty() {
        Ok("ok\n".into())
    } else {
        Ok(body)
    }
}
