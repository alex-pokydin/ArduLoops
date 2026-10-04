//! Local HTTP so the UI, `npm run cli`, and `--mcp` share one MAVLink loop.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::link::{mode_custom, remember_brief, Cmd, LogBrief, Sample};
use std::time::{SystemTime, UNIX_EPOCH};

pub const HTTP_ADDR: &str = "127.0.0.1:8767";

const CORS: &str = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n";

pub fn serve(addr: &str, latest: Arc<Mutex<Sample>>, tx: Sender<Cmd>) {
    let listener = match TcpListener::bind(addr) {
        Ok(l) => l,
        Err(err) => {
            log::warn!("HTTP {addr}: {err}");
            return;
        }
    };
    log::info!("HTTP {addr}");
    println!("HTTP {addr}");
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                let latest = latest.clone();
                let tx = tx.clone();
                std::thread::spawn(move || {
                    let _ = handle(stream, latest, tx);
                });
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => {}
            Err(err) => {
                log::warn!("HTTP accept: {err}");
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

fn handle(stream: TcpStream, latest: Arc<Mutex<Sample>>, tx: Sender<Cmd>) -> std::io::Result<()> {
    stream.set_nodelay(true).ok();
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let raw_path = parts.next().unwrap_or("/").to_string();
    let mut headers = HashMap::new();
    loop {
        line.clear();
        reader.read_line(&mut line)?;
        if line.is_empty() || line == "\n" || line == "\r\n" {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    if method == "OPTIONS" {
        let mut socket = reader.into_inner();
        socket.write_all(format!("HTTP/1.1 204 No Content\r\n{CORS}\r\n").as_bytes())?;
        return Ok(());
    }

    let (path, query) = split_query(&raw_path);

    if path == "/tlog" && (method == "GET" || method == "POST") {
        return tlog_reply(reader, &method, &headers);
    }

    if path.starts_with("/ai") {
        let len = headers.get("content-length").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0).min(65_536);
        let mut raw = vec![0u8; len];
        if len > 0 {
            reader.read_exact(&mut raw)?;
        }
        let body: serde_json::Value = if raw.is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_slice(&raw).unwrap_or(serde_json::json!({}))
        };
        let sample = latest.lock().map(|g| g.clone()).unwrap_or_else(|_| Sample::empty());
        let mut socket = reader.into_inner();
        // A panic inside the model call used to close this socket with no status line.
        // The WebView then reports the key check as "Failed to fetch".
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::agent::route(&method, &path, &query, &body, &sample, &tx)
        }));
        return match outcome {
            Ok(Ok(value)) => {
                let bytes = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
                reply(&mut socket, 200, "application/json", &bytes)
            }
            Ok(Err((code, message))) => {
                let bytes = serde_json::to_vec(&serde_json::json!({"ok": false, "message": message})).unwrap_or_default();
                reply(&mut socket, code, "application/json", &bytes)
            }
            Err(_) => {
                let bytes = br#"{"ok":false,"message":"The model request failed."}"#;
                reply(&mut socket, 500, "application/json", bytes)
            }
        };
    }

    if method == "GET" && (path == "/stream" || path.starts_with("/stream")) {
        return sse(reader.into_inner(), latest);
    }

    if method == "POST" && path == "/motor-test" {
        let seq = query.get("seq").and_then(|s| s.parse::<u8>().ok()).unwrap_or(0);
        let percent = query.get("percent").and_then(|s| s.parse::<f32>().ok()).unwrap_or(0.0);
        let seconds = query.get("seconds").and_then(|s| s.parse::<f32>().ok()).unwrap_or(2.0);
        let mut socket = reader.into_inner();
        if !(1..=12).contains(&seq) || !(1.0..=25.0).contains(&percent) || !(1.0..=3.0).contains(&seconds) {
            return reply(&mut socket, 400, "application/json", br#"{"message":"Motor test rejected. Check the vehicle message."}"#);
        }
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        if tx.send(Cmd::MotorTest { seq, percent, seconds, reply: result_tx }).is_err() {
            return reply(&mut socket, 503, "application/json", br#"{"message":"Could not send calibration command"}"#);
        }
        let message = result_rx.recv_timeout(Duration::from_secs(10))
            .unwrap_or_else(|_| "Motor test timed out".into());
        let ok = message == "Motor test started";
        return reply(&mut socket, if ok { 200 } else { 409 }, "application/json",
            &serde_json::to_vec(&serde_json::json!({"ok":ok,"message":message}))?);
    }

    if method == "POST" && path == "/calibrate" {
        let kind = query.get("kind").cloned().unwrap_or_default();
        let mut socket = reader.into_inner();
        if kind != "level" && kind != "gyro" && kind != "baro" && kind != "accel" {
            return reply(&mut socket, 400, "application/json", br#"{"message":"Unsupported calibration"}"#);
        }
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        if tx.send(Cmd::Calibrate { kind, reply: result_tx }).is_err() {
            return reply(&mut socket, 503, "application/json", br#"{"message":"Could not send calibration command"}"#);
        }
        let message = result_rx.recv_timeout(Duration::from_secs(40))
            .unwrap_or_else(|_| "Calibration timed out; check vehicle messages before retrying".into());
        let ok = message == "Calibration completed";
        return reply(&mut socket, if ok {200} else {409}, "application/json",
            &serde_json::to_vec(&serde_json::json!({"ok":ok,"message":message}))?);
    }

    if method == "POST" && path == "/accel-cal" {
        let action = query.get("action").cloned().unwrap_or_default();
        let mut socket = reader.into_inner();
        if action != "start" && action != "pose" {
            return reply(&mut socket, 400, "application/json", br#"{"message":"Unsupported calibration"}"#);
        }
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        if tx.send(Cmd::AccelCalCmd { action: action.clone(), reply: result_tx }).is_err() {
            return reply(&mut socket, 503, "application/json", br#"{"message":"Could not send calibration command"}"#);
        }
        let wait = if action == "start" { 50 } else { 8 };
        let message = result_rx.recv_timeout(Duration::from_secs(wait))
            .unwrap_or_else(|_| "Calibration timed out; check vehicle messages before retrying".into());
        let ok = message == "Accelerometer calibration started" || message == "Face accepted";
        return reply(&mut socket, if ok { 200 } else { 409 }, "application/json",
            &serde_json::to_vec(&serde_json::json!({"ok":ok,"message":message}))?);
    }

    if method == "POST" && path == "/compass-mot" {
        let action = query.get("action").cloned().unwrap_or_default();
        let mut socket = reader.into_inner();
        if action != "start" && action != "finish" {
            return reply(&mut socket, 400, "application/json", br#"{"message":"Unsupported calibration"}"#);
        }
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        if tx.send(Cmd::CompassMot { action, reply: result_tx }).is_err() {
            return reply(&mut socket, 503, "application/json", br#"{"message":"Could not send calibration command"}"#);
        }
        let message = result_rx.recv_timeout(Duration::from_secs(12))
            .unwrap_or_else(|_| "Calibration timed out; check vehicle messages before retrying".into());
        let ok = message == "CompassMot started" || message == "CompassMot finish sent";
        return reply(&mut socket, if ok { 200 } else { 409 }, "application/json",
            &serde_json::to_vec(&serde_json::json!({"ok":ok,"message":message}))?);
    }

    if method == "POST" && path == "/compass-cal" {
        let action = query.get("action").cloned().unwrap_or_default();
        let mut socket = reader.into_inner();
        if action != "start" && action != "cancel" && action != "accept" {
            return reply(&mut socket, 400, "application/json", br#"{"message":"Unsupported calibration"}"#);
        }
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        if tx.send(Cmd::MagCal { action, reply: result_tx }).is_err() {
            return reply(&mut socket, 503, "application/json", br#"{"message":"Could not send compass calibration"}"#);
        }
        let message = result_rx.recv_timeout(Duration::from_secs(12))
            .unwrap_or_else(|_| "Compass calibration timed out".into());
        let ok = message == "Compass calibration started"
            || message == "Compass calibration cancelled"
            || message == "Compass calibration accepted";
        return reply(&mut socket, if ok { 200 } else { 409 }, "application/json",
            &serde_json::to_vec(&serde_json::json!({"ok":ok,"message":message}))?);
    }

    if method == "POST" && path == "/cmd" {
        let len = headers
            .get("content-length")
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0)
            .min(32_768);
        let mut body = vec![0u8; len];
        if len > 0 {
            reader.read_exact(&mut body)?;
        }
        if let Ok(Cmd::Mode { mode }) = serde_json::from_slice::<Cmd>(&body) {
            return set_mode_reply(reader.into_inner(), &latest, &tx, &mode);
        }
        if let Ok(Cmd::Param { ref name, value }) = serde_json::from_slice::<Cmd>(&body) {
            if let Some(reason) = crate::link::storage_wipe_reason(name, value) {
                let mut socket = reader.into_inner();
                return reply(
                    &mut socket,
                    409,
                    "application/json",
                    &serde_json::to_vec(&serde_json::json!({ "error": reason }))?,
                );
            }
        }
        let status = match serde_json::from_slice::<Cmd>(&body) {
            Ok(cmd) => {
                let _ = tx.send(cmd);
                "HTTP/1.1 204 No Content"
            }
            Err(_) => "HTTP/1.1 400 Bad Request",
        };
        let mut socket = reader.into_inner();
        socket.write_all(format!("{status}\r\n{CORS}Connection: close\r\n\r\n").as_bytes())?;
        return Ok(());
    }

    if method == "POST" && path == "/logs/cancel" {
        tx.send(Cmd::LogCancel)
            .map_err(|_| std::io::Error::other("link stopped"))?;
        let mut socket = reader.into_inner();
        return reply(&mut socket, 204, "text/plain", b"");
    }
    if method == "POST" && path == "/logs/import" {
        let len = headers
            .get("content-length")
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0);
        if len == 0 || len > 512 * 1024 * 1024 {
            let mut socket = reader.into_inner();
            return reply(
                &mut socket,
                400,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({ "error": if len == 0 { "The file is empty." } else { "This log is larger than 512 MB." } }))?,
            );
        }
        let mut body = vec![0u8; len];
        reader.read_exact(&mut body)?;
        let mut socket = reader.into_inner();
        return match crate::dflog::import_log(&body) {
            Ok(value) => reply(&mut socket, 200, "application/json", &serde_json::to_vec(&value)?),
            Err(error) => reply(
                &mut socket,
                400,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({ "error": error }))?,
            ),
        };
    }
    if method == "POST" && path == "/firmware-library/import" {
        let vehicle = query.get("vehicle").map(String::as_str).unwrap_or("");
        let len = headers
            .get("content-length")
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0);
        if len == 0 || len > 16 * 1024 * 1024 {
            let mut socket = reader.into_inner();
            return reply(
                &mut socket,
                400,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({
                    "error": if len == 0 { "The file is empty." } else { "This firmware file is larger than 16 MB." }
                }))?,
            );
        }
        let mut body = vec![0u8; len];
        reader.read_exact(&mut body)?;
        let mut socket = reader.into_inner();
        return match crate::firmware::import_local(&body, vehicle) {
            Ok(value) => reply(&mut socket, 200, "application/json", &serde_json::to_vec(&value)?),
            Err(error) => reply(
                &mut socket,
                400,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({ "error": error }))?,
            ),
        };
    }
    if method == "POST" && path == "/logs/reveal" {
        let len = headers
            .get("content-length")
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0)
            .min(4_096);
        let mut body = vec![0u8; len];
        if len > 0 {
            reader.read_exact(&mut body)?;
        }
        let id = serde_json::from_slice::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value.get("id").and_then(serde_json::Value::as_str).map(str::to_string))
            .unwrap_or_default();
        let mut socket = reader.into_inner();
        return match crate::dflog::reveal(&id) {
            Ok(()) => reply(&mut socket, 204, "text/plain", b""),
            Err(error) => reply(
                &mut socket,
                404,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({ "error": error }))?,
            ),
        };
    }
    if method == "POST" && path == "/logs/erase" {
        let len = headers
            .get("content-length")
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0)
            .min(32_768);
        let mut body = vec![0u8; len];
        if len > 0 {
            reader.read_exact(&mut body)?;
        }
        let confirmed = serde_json::from_slice::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value.get("confirm").and_then(serde_json::Value::as_bool))
            .unwrap_or(false);
        let mut socket = reader.into_inner();
        return erase_logs_reply(&mut socket, &latest, &tx, confirmed);
    }

    if method == "POST" && path == "/firmware/flash" {
        let len = headers
            .get("content-length")
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0)
            .min(32_768);
        let mut body = vec![0u8; len];
        if len > 0 {
            reader.read_exact(&mut body)?;
        }
        let args: serde_json::Value = match serde_json::from_slice::<serde_json::Value>(&body) {
            Ok(value) if value.is_object() => value,
            _ => {
                let mut socket = reader.into_inner();
                return reply(
                    &mut socket,
                    400,
                    "application/json",
                    br#"{\"error\":\"Invalid firmware request\"}"#,
                );
            }
        };
        let mut socket = reader.into_inner();
        return flash_reply(&mut socket, &latest, &tx, &args);
    }

    if method == "POST" && path == "/firmware-library/comment" {
        let len = headers
            .get("content-length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0)
            .min(32_768);
        let mut body = vec![0u8; len];
        if len > 0 {
            reader.read_exact(&mut body)?;
        }
        let args: serde_json::Value = match serde_json::from_slice::<serde_json::Value>(&body) {
            Ok(value) if value.is_object() => value,
            _ => {
                let mut socket = reader.into_inner();
                return reply(
                    &mut socket,
                    400,
                    "application/json",
                    br#"{\"error\":\"Invalid catalog comment\"}"#,
                );
            }
        };
        let comment = args
            .get("comment")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let result = match args
            .get("controller_key")
            .and_then(serde_json::Value::as_str)
        {
            Some(key) => crate::db::set_controller_comment(key, comment),
            None => match args.get("artifact_id").and_then(serde_json::Value::as_str) {
                Some(id) => crate::db::set_firmware_comment(id, comment),
                None => Err("controller_key or artifact_id is required".into()),
            },
        };
        let mut socket = reader.into_inner();
        return match result {
            Ok(value) => reply(
                &mut socket,
                200,
                "application/json",
                &serde_json::to_vec(&value)?,
            ),
            Err(error) => reply(
                &mut socket,
                400,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({"error": error}))?,
            ),
        };
    }

    if method == "POST" && path == "/params/restore" {
        let len = headers
            .get("content-length")
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0);
        if len == 0 || len > 1024 * 1024 {
            let mut socket = reader.into_inner();
            return reply(
                &mut socket,
                400,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({
                    "error": if len == 0 { "The file is empty." } else { "This parameter file is larger than 1 MB." }
                }))?,
            );
        }
        let mut body = vec![0u8; len];
        reader.read_exact(&mut body)?;
        let mut socket = reader.into_inner();
        let text = match String::from_utf8(body) {
            Ok(text) => text,
            Err(_) => {
                return reply(
                    &mut socket,
                    400,
                    "application/json",
                    &serde_json::to_vec(&serde_json::json!({"error": "This file is not a parameter backup"}))?,
                );
            }
        };
        let values = match crate::link::parse_param_file(&text) {
            Ok(values) => values,
            Err(error) => {
                return reply(
                    &mut socket,
                    400,
                    "application/json",
                    &serde_json::to_vec(&serde_json::json!({"error": error}))?,
                );
            }
        };
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        if tx
            .send(crate::link::Cmd::ParamsRestore {
                values,
                reply: result_tx,
            })
            .is_err()
        {
            return reply(
                &mut socket,
                503,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({"error": "Could not restore parameters"}))?,
            );
        }
        return match result_rx.recv_timeout(Duration::from_secs(20 * 60)) {
            Ok(Ok(report)) => reply(
                &mut socket,
                200,
                "application/json",
                &serde_json::to_vec(&report)?,
            ),
            Ok(Err(error)) => reply(
                &mut socket,
                409,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({"error": error}))?,
            ),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => reply(
                &mut socket,
                503,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({"error": "Restore timed out"}))?,
            ),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => reply(
                &mut socket,
                503,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({"error": "Could not restore parameters"}))?,
            ),
        };
    }

    let mut socket = reader.into_inner();
    if method == "GET" && (path == "/" || path == "/health") {
        reply(&mut socket, 200, "text/plain", b"ArduLoops\n")?;
        return Ok(());
    }
    if method == "GET" && path == "/mcp.json" {
        reply(&mut socket, 200, "application/json", &mcp_cursor_config())?;
        return Ok(());
    }
    if method == "GET" && path == "/ports" {
        let json = serde_json::to_vec(&crate::ports::list()).unwrap_or_else(|_| b"[]".to_vec());
        reply(&mut socket, 200, "application/json", &json)?;
        return Ok(());
    }
    if method == "GET" && path == "/state" {
        let json = {
            let g = latest
                .lock()
                .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "lock"))?;
            serde_json::to_vec(&state_view(&g)).unwrap_or_else(|_| b"{}".to_vec())
        };
        reply(&mut socket, 200, "application/json", &json)?;
        return Ok(());
    }
    if method == "GET" && path == "/logs" {
        let refresh = query
            .get("refresh")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(true);
        return logs_reply(&mut socket, &latest, &tx, refresh);
    }
    if method == "GET" && path == "/logs/brief" {
        let Some(id) = query.get("id").and_then(|value| value.parse::<u16>().ok()) else {
            return reply(
                &mut socket,
                400,
                "application/json",
                br#"{"error":"id is required"}"#,
            );
        };
        return log_brief_reply(&mut socket, &latest, &tx, id);
    }
    if method == "GET" && path == "/logs/download" {
        let Some(id) = query.get("id").and_then(|value| value.parse::<u16>().ok()) else {
            return reply(
                &mut socket,
                400,
                "application/json",
                br#"{\"error\":\"id is required\"}"#,
            );
        };
        let timeout_s = query
            .get("timeout_s")
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(120)
            .clamp(5, 3_600);
        return download_log_reply(&mut socket, &latest, &tx, id, timeout_s);
    }
    if method == "GET" && path == "/diagnostics" {
        let g = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
        let body = serde_json::json!({"state": state_view(&g), "telemetry": g.telemetry,
            "events": g.events, "params": param_download(&g)});
        reply(
            &mut socket,
            200,
            "application/json",
            &serde_json::to_vec(&body)?,
        )?;
        return Ok(());
    }
    if method == "GET" && path == "/firmware-library" {
        let g = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
        match crate::db::library(&g) {
            Ok(body) => reply(
                &mut socket,
                200,
                "application/json",
                &serde_json::to_vec(&body)?,
            )?,
            Err(error) => reply(
                &mut socket,
                500,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({"error": error}))?,
            )?,
        }
        return Ok(());
    }
    if method == "GET" && path == "/param-meta" {
        let kind = query.get("vehicle").map(String::as_str).unwrap_or("copter");
        let body = crate::research::param_index(kind);
        reply(&mut socket, 200, "application/json", &body)?;
        return Ok(());
    }
    if method == "GET" && path == "/param" {
        let name = query.get("name").cloned().unwrap_or_default();
        if name.is_empty() {
            reply(&mut socket, 400, "application/json", br#"{"error":"name"}"#)?;
            return Ok(());
        }
        let fresh = query
            .get("fresh")
            .map(|s| s == "1" || s.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if !fresh {
            if let Some(json) = param_json(&latest, &name) {
                reply(&mut socket, 200, "application/json", &json)?;
                return Ok(());
            }
        }
        let started = now();
        for _ in 0..3 {
            let _ = tx.send(Cmd::ParamRead { name: name.clone() });
            for _ in 0..20 {
                std::thread::sleep(Duration::from_millis(50));
                let g = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
                if g.param_received.get(&name).is_some_and(|t| *t >= started) {
                    let body = serde_json::json!({"name": name, "value": g.params.get(&name),
                        "found": true, "received_at": g.param_received.get(&name), "source": "vehicle"});
                    reply(
                        &mut socket,
                        200,
                        "application/json",
                        &serde_json::to_vec(&body)?,
                    )?;
                    return Ok(());
                }
            }
        }
        let body = serde_json::json!({ "name": name, "found": false, "reason": "no_response", "attempts": 3 });
        reply(
            &mut socket,
            404,
            "application/json",
            &serde_json::to_vec(&body).unwrap_or_default(),
        )?;
        return Ok(());
    }
    if method == "GET" && path == "/params" {
        let glob = query.get("glob").cloned().unwrap_or_else(|| "*".into());
        let json = {
            let g = latest
                .lock()
                .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "lock"))?;
            let mut out = serde_json::Map::new();
            for (k, v) in &g.params {
                if glob_match(&glob, k) {
                    out.insert(k.clone(), serde_json::json!(v));
                }
            }
            serde_json::to_vec(&out).unwrap_or_else(|_| b"{}".to_vec())
        };
        reply(&mut socket, 200, "application/json", &json)?;
        return Ok(());
    }
    if method == "GET" && path == "/statustext" {
        let n = query
            .get("n")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(10)
            .clamp(1, 256);
        let json = {
            let g = latest
                .lock()
                .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "lock"))?;
            let slice: Vec<&String> = g.texts.iter().take(n).collect();
            serde_json::to_vec(&slice).unwrap_or_else(|_| b"[]".to_vec())
        };
        reply(&mut socket, 200, "application/json", &json)?;
        return Ok(());
    }

    socket.write_all(format!("HTTP/1.1 404 Not Found\r\n{CORS}\r\n").as_bytes())?;
    Ok(())
}

fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

fn mode_outcome(s: &Sample, mode: &str, started: f64) -> Option<serde_json::Value> {
    if s.ok && s.mode == mode && s.heartbeat_at >= started {
        return Some(serde_json::json!({"ok": true, "mode": mode, "confirmed_by": "HEARTBEAT"}));
    }
    for event in &s.events {
        if event["message"] == "COMMAND_ACK"
            && event["received_at"].as_f64().unwrap_or(0.0) >= started
            && event["data"]["command"] == "MAV_CMD_DO_SET_MODE"
        {
            let result = event["data"]["result"].as_str().unwrap_or("");
            if result != "MAV_RESULT_ACCEPTED" && result != "MAV_RESULT_IN_PROGRESS" {
                return Some(serde_json::json!({"ok": false, "requested_mode": mode,
                    "actual_mode": s.mode, "ack": event, "texts": s.texts}));
            }
        }
    }
    None
}

fn set_mode_reply(
    mut socket: TcpStream,
    latest: &Mutex<Sample>,
    tx: &Sender<Cmd>,
    mode: &str,
) -> std::io::Result<()> {
    let mode = mode.trim().to_ascii_uppercase();
    let started = now();
    {
        let g = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
        if !g.ok || started - g.heartbeat_at > 3.0 || mode_custom(&g.frame, &mode).is_none() {
            let body = serde_json::json!({"ok": false, "error": "No fresh vehicle heartbeat or unsupported mode", "mode": mode});
            return reply(
                &mut socket,
                400,
                "application/json",
                &serde_json::to_vec(&body)?,
            );
        }
    }
    tx.send(Cmd::Mode { mode: mode.clone() })
        .map_err(|_| std::io::Error::other("link stopped"))?;
    for _ in 0..80 {
        std::thread::sleep(Duration::from_millis(50));
        let g = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
        if let Some(body) = mode_outcome(&g, &mode, started) {
            let code = if body["ok"] == true { 200 } else { 409 };
            return reply(
                &mut socket,
                code,
                "application/json",
                &serde_json::to_vec(&body)?,
            );
        }
    }
    let g = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
    let body = serde_json::json!({"ok": false, "error": "Mode not confirmed before timeout",
        "requested_mode": mode, "actual_mode": g.mode, "texts": g.texts});
    reply(
        &mut socket,
        409,
        "application/json",
        &serde_json::to_vec(&body)?,
    )
}

fn bootloader_allowed(s: &Sample, at: f64) -> bool {
    s.ok && !s.armed && at - s.heartbeat_at <= 3.0
}

fn logs_allowed(s: &Sample, at: f64) -> bool {
    bootloader_allowed(s, at)
}

fn logs_reply(
    socket: &mut TcpStream,
    latest: &Mutex<Sample>,
    tx: &Sender<Cmd>,
    refresh: bool,
) -> std::io::Result<()> {
    let started = now();
    {
        let sample = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
        if !logs_allowed(&sample, started) {
            return reply(
                socket,
                409,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({
                    "error": "A fresh disarmed vehicle heartbeat is required before accessing DataFlash logs"
                }))?,
            );
        }
    }
    if refresh {
        tx.send(Cmd::LogList)
            .map_err(|_| std::io::Error::other("link stopped"))?;
    }
    for _ in 0..160 {
        std::thread::sleep(Duration::from_millis(50));
        let sample = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
        let ready = sample
            .log_list_expected
            .is_some_and(|expected| expected == 0 || sample.logs.len() >= expected as usize);
        if ready && (!refresh || sample.log_list_at >= started) {
            let body = serde_json::json!({
                "logs": sample.logs,
                "count": sample.log_list_expected.unwrap_or(0),
                "updated_at": sample.log_list_at,
            });
            drop(sample);
            let _ = tx.send(Cmd::LogEnd);
            return reply(socket, 200, "application/json", &serde_json::to_vec(&body)?);
        }
    }
    let _ = tx.send(Cmd::LogEnd);
    reply(
        socket,
        409,
        "application/json",
        &serde_json::to_vec(&serde_json::json!({
            "error": "The vehicle did not return a complete DataFlash log list before timeout"
        }))?,
    )
}

fn log_brief_reply(
    socket: &mut TcpStream,
    latest: &Mutex<Sample>,
    tx: &Sender<Cmd>,
    id: u16,
) -> std::io::Result<()> {
    let started = now();
    let (boot_uid, size, time_utc) = {
        let sample = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
        if !logs_allowed(&sample, started) {
            return reply(
                socket,
                409,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({
                    "error": "A fresh disarmed vehicle heartbeat is required before accessing DataFlash logs"
                }))?,
            );
        }
        if sample.log_download.as_ref().is_some_and(|item| !item.complete) {
            return reply(
                socket,
                409,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({
                    "error": "A log download is already running"
                }))?,
            );
        }
        let Some(entry) = sample.logs.iter().find(|log| log.id == id).cloned() else {
            return reply(
                socket,
                404,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({
                    "error": "Unknown log ID; refresh the log list first", "id": id
                }))?,
            );
        };
        if let Some(brief) = sample
            .log_briefs
            .iter()
            .find(|brief| brief.id == id && brief.size == entry.size && brief.error.is_empty())
        {
            let body = serde_json::to_vec(brief)?;
            return reply(socket, 200, "application/json", &body);
        }
        (sample.boot_uid.clone(), entry.size, entry.time_utc)
    };
    if let Some(summary) = crate::dflog::local_onboard_summary(&boot_uid, id, size) {
        let brief = LogBrief {
            id,
            size,
            firmware: summary.firmware,
            frame: summary.frame,
            start_utc: if summary.start_utc.is_empty() && time_utc > 0 {
                crate::dflog::unix_rfc3339(u64::from(time_utc))
            } else {
                summary.start_utc
            },
            duration_us: summary.duration_us,
            error: String::new(),
            updated_at: started,
        };
        if let Ok(mut sample) = latest.lock() {
            remember_brief(&mut sample, brief.clone());
        }
        return reply(socket, 200, "application/json", &serde_json::to_vec(&brief)?);
    }
    tx.send(Cmd::LogPeek { id, size })
        .map_err(|_| std::io::Error::other("link stopped"))?;
    for _ in 0..800 {
        std::thread::sleep(Duration::from_millis(50));
        let sample = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
        if let Some(brief) = sample.log_briefs.iter().find(|brief| {
            brief.id == id && brief.size == size && brief.updated_at >= started
        }) {
            let body = serde_json::to_vec(brief)?;
            return reply(socket, 200, "application/json", &body);
        }
    }
    reply(
        socket,
        409,
        "application/json",
        &serde_json::to_vec(&serde_json::json!({
            "error": "Could not read the log header", "id": id
        }))?,
    )
}

fn download_log_reply(
    socket: &mut TcpStream,
    latest: &Mutex<Sample>,
    tx: &Sender<Cmd>,
    id: u16,
    timeout_s: u64,
) -> std::io::Result<()> {
    let started = now();
    {
        let sample = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
        if !logs_allowed(&sample, started) {
            return reply(
                socket,
                409,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({
                    "error": "A fresh disarmed vehicle heartbeat is required before downloading a DataFlash log"
                }))?,
            );
        }
        if !sample.logs.iter().any(|log| log.id == id) {
            return reply(
                socket,
                404,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({
                    "error": "Unknown log ID; request ardupilot_list_logs first", "id": id
                }))?,
            );
        }
    }
    tx.send(Cmd::LogDownload { id })
        .map_err(|_| std::io::Error::other("link stopped"))?;
    for _ in 0..timeout_s.saturating_mul(20) {
        if crate::agent::turn_stop_requested() {
            let _ = tx.send(Cmd::LogCancel);
            return reply(
                socket,
                200,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({
                    "ok": false, "id": id, "complete": false, "error": "stopped"
                }))?,
            );
        }
        std::thread::sleep(Duration::from_millis(50));
        let sample = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
        let Some(report) = sample.log_download.as_ref() else {
            continue;
        };
        if report.id != id || report.updated_at < started || !report.complete {
            continue;
        }
        let body = serde_json::to_vec(report)?;
        let code = if report.error.is_empty() { 200 } else { 409 };
        return reply(socket, code, "application/json", &body);
    }
    let report = latest.lock().ok().and_then(|sample| sample.log_download.clone());
    let body = match report.filter(|report| report.id == id) {
        Some(report) => serde_json::to_vec(&report)?,
        None => serde_json::to_vec(&serde_json::json!({ "id": id, "complete": false }))?,
    };
    reply(socket, 200, "application/json", &body)
}

fn erase_logs_reply(
    socket: &mut TcpStream,
    latest: &Mutex<Sample>,
    tx: &Sender<Cmd>,
    confirmed: bool,
) -> std::io::Result<()> {
    if !confirmed {
        return reply(
            socket,
            400,
            "application/json",
            &serde_json::to_vec(&serde_json::json!({
                "error": "Erasing DataFlash logs is permanent; send confirm: true to continue"
            }))?,
        );
    }
    let at = now();
    let sample = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
    if !logs_allowed(&sample, at) {
        return reply(
            socket,
            409,
            "application/json",
            &serde_json::to_vec(&serde_json::json!({
                "error": "A fresh disarmed vehicle heartbeat is required before erasing DataFlash logs"
            }))?,
        );
    }
    drop(sample);
    tx.send(Cmd::LogErase)
        .map_err(|_| std::io::Error::other("link stopped"))?;
    reply(
        socket,
        200,
        "application/json",
        &serde_json::to_vec(&serde_json::json!({
            "ok": true,
            "message": "DataFlash erase requested. Refresh the log list to verify it completed."
        }))?,
    )
}

fn flash_reply(
    socket: &mut TcpStream,
    latest: &Mutex<Sample>,
    tx: &Sender<Cmd>,
    args: &serde_json::Value,
) -> std::io::Result<()> {
    let action = args
        .get("action")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    if action == "prepare" {
        request_missing_params(latest, tx)?;
    }
    if action != "start_bootloader" {
        return match crate::firmware::call("flash", args) {
            Ok(value) => reply(
                socket,
                200,
                "application/json",
                &serde_json::to_vec(&value)?,
            ),
            Err(error) => reply(
                socket,
                400,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({"error": error}))?,
            ),
        };
    }
    let at = now();
    {
        let sample = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
        if !bootloader_allowed(&sample, at) {
            let body = serde_json::json!({"error": "A fresh disarmed vehicle heartbeat is required before entering bootloader"});
            return reply(socket, 409, "application/json", &serde_json::to_vec(&body)?);
        }
    }
    let mut start = args.clone();
    start["action"] = serde_json::json!("start");
    let worker = match crate::firmware::call("flash", &start) {
        Ok(value) => value,
        Err(error) => {
            return reply(
                socket,
                400,
                "application/json",
                &serde_json::to_vec(&serde_json::json!({"error": error}))?,
            )
        }
    };
    tx.send(Cmd::RebootBootloader)
        .map_err(|_| std::io::Error::other("link stopped"))?;
    let body = serde_json::json!({
        "state": "bootloader_requested",
        "worker": worker,
        "next_step": "The uploader is waiting on the selected USB port. The vehicle was asked to reboot into the ArduPilot serial bootloader; read status for verification."
    });
    reply(socket, 200, "application/json", &serde_json::to_vec(&body)?)
}

fn param_download(sample: &Sample) -> serde_json::Value {
    let missing = (0..sample.param_count).filter(|index| !sample.param_indices.contains(index)).count();
    serde_json::json!({
        "cached": sample.params.len(),
        "expected": sample.param_count,
        "received_indices": sample.param_indices.len(),
        "complete": sample.param_count > 0 && missing == 0,
        "missing": missing,
        "note": "`missing` is how many parameter slots have not arrived. A slot number is not a parameter name. `complete` is whether every slot is in.",
    })
}

fn request_missing_params(latest: &Mutex<Sample>, tx: &Sender<Cmd>) -> std::io::Result<()> {
    // A full PARAM_REQUEST_LIST can take several seconds and can lose a few
    // packets. Wait for the initial download, then request only its gaps.
    let mut requested_list = false;
    for _ in 0..40 {
        let missing = {
            let sample = latest.lock().map_err(|_| std::io::Error::other("lock"))?;
            if sample.param_count == 0 {
                return Ok(());
            }
            (0..sample.param_count)
                .filter(|index| !sample.param_indices.contains(index))
                .collect::<Vec<_>>()
        };
        if missing.is_empty() {
            return Ok(());
        }
        if missing.len() > 64 && !requested_list {
            tx.send(Cmd::ParamsList)
                .map_err(|_| std::io::Error::other("link stopped"))?;
            requested_list = true;
        } else if missing.len() <= 64 {
            for index in missing {
                tx.send(Cmd::ParamReadIndex {
                    index: index as i16,
                })
                .map_err(|_| std::io::Error::other("link stopped"))?;
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Ok(())
}

fn tlog_reply(
    mut reader: BufReader<TcpStream>,
    method: &str,
    headers: &HashMap<String, String>,
) -> std::io::Result<()> {
    if method == "GET" {
        let bytes = serde_json::to_vec(&crate::tlog::status()).unwrap_or_else(|_| b"{}".to_vec());
        return reply(&mut reader.into_inner(), 200, "application/json", &bytes);
    }
    let len = headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0)
        .min(8_192);
    let mut raw = vec![0u8; len];
    if len > 0 {
        reader.read_exact(&mut raw)?;
    }
    let body: serde_json::Value = serde_json::from_slice(&raw).unwrap_or(serde_json::json!({}));
    let enabled = body.get("enabled").and_then(serde_json::Value::as_bool).unwrap_or(false);
    let path = body.get("path").and_then(serde_json::Value::as_str).unwrap_or("");
    let mut socket = reader.into_inner();
    match crate::tlog::set(enabled, path) {
        Ok(value) => reply(&mut socket, 200, "application/json", &serde_json::to_vec(&value)?),
        Err(error) => reply(
            &mut socket,
            400,
            "application/json",
            &serde_json::to_vec(&serde_json::json!({ "error": error }))?,
        ),
    }
}

fn reply(socket: &mut TcpStream, code: u16, ctype: &str, body: &[u8]) -> std::io::Result<()> {
    let reason = match code {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        409 => "Conflict",
        500 => "Error",
        503 => "Unavailable",
        _ => "OK",
    };
    socket.write_all(
        format!(
            "HTTP/1.1 {code} {reason}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\n{CORS}Connection: close\r\n\r\n",
            body.len()
        )
        .as_bytes(),
    )?;
    socket.write_all(body)?;
    Ok(())
}

fn mcp_cursor_config() -> Vec<u8> {
    let mut command = std::env::current_exe()
        .ok()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "arduloops.exe".into());
    if let Some(rest) = command.strip_prefix(r"\\?\") {
        command = rest.to_string();
    }
    serde_json::to_vec_pretty(&serde_json::json!({
        "mcpServers": {
            "arduloops": {
                "command": command,
                "args": ["--mcp"]
            }
        }
    }))
    .unwrap_or_else(|_| b"{}".to_vec())
}

fn param_json(latest: &Mutex<Sample>, name: &str) -> Option<Vec<u8>> {
    let g = latest.lock().ok()?;
    let val = g.params.get(name)?;
    Some(
        serde_json::to_vec(&serde_json::json!({
            "name": name,
            "value": val,
            "found": true
        }))
        .ok()?,
    )
}

fn state_view(s: &Sample) -> serde_json::Value {
    serde_json::json!({
        "ok": s.ok,
        "heartbeat_at": s.heartbeat_at,
        "telemetry": s.telemetry,
        "detail": s.detail,
        "mode": s.mode,
        "armed": s.armed,
        "frame": s.frame,
        "roll": s.roll,
        "pitch": s.pitch,
        "yaw": s.yaw,
        "rate": s.rate,
        "pitch_rate": s.pitch_rate,
        "yaw_rate": s.yaw_rate,
        "alt": s.alt,
        "alt_tar": s.alt_tar,
        "climb": s.climb,
        "climb_des": s.climb_des,
        "thr_cmd": s.thr_cmd,
        "att_hz": s.att_hz,
        "gain_p": s.gain_p,
        "gain_i": s.gain_i,
        "gain_d": s.gain_d,
        "logs": s.logs,
        "log_list_expected": s.log_list_expected,
        "log_list_at": s.log_list_at,
        "log_download": s.log_download,
    })
}

fn split_query(raw: &str) -> (String, HashMap<String, String>) {
    let (path, q) = raw.split_once('?').unwrap_or((raw, ""));
    let mut query = HashMap::new();
    for pair in q.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        query.insert(url_decode(k), url_decode(v));
    }
    (path.to_string(), query)
}

fn url_decode(s: &str) -> String {
    let mut out = String::new();
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => {
                out.push(' ');
                i += 1;
            }
            b'%' if i + 2 < b.len() => {
                let hex = String::from_utf8_lossy(&b[i + 1..i + 3]);
                if let Ok(v) = u8::from_str_radix(&hex, 16) {
                    out.push(v as char);
                    i += 3;
                } else {
                    out.push('%');
                    i += 1;
                }
            }
            c => {
                out.push(c as char);
                i += 1;
            }
        }
    }
    out
}

pub fn glob_match(pat: &str, name: &str) -> bool {
    let pat = pat.trim();
    if pat.is_empty() || pat == "*" {
        return true;
    }
    let name_u = name.to_ascii_uppercase();
    let pat_u = pat.to_ascii_uppercase();
    let parts: Vec<&str> = pat_u.split('*').collect();
    if parts.len() == 1 {
        return name_u == pat_u;
    }
    let mut rest = name_u.as_str();
    if !parts[0].is_empty() {
        if !rest.starts_with(parts[0]) {
            return false;
        }
        rest = &rest[parts[0].len()..];
    }
    for (i, p) in parts.iter().enumerate().skip(1) {
        if p.is_empty() {
            continue;
        }
        if i == parts.len() - 1 {
            return rest.ends_with(p);
        }
        if let Some(idx) = rest.find(p) {
            rest = &rest[idx + p.len()..];
        } else {
            return false;
        }
    }
    true
}

fn sse(mut socket: TcpStream, latest: Arc<Mutex<Sample>>) -> std::io::Result<()> {
    socket.set_write_timeout(Some(Duration::from_secs(5))).ok();
    socket.write_all(
        format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n{CORS}\r\n")
            .as_bytes(),
    )?;
    loop {
        let json = {
            let g = latest
                .lock()
                .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "lock"))?;
            serde_json::to_string(&*g).unwrap_or_else(|_| "{}".into())
        };
        if socket
            .write_all(format!("data: {json}\n\n").as_bytes())
            .is_err()
        {
            break;
        }
        let _ = socket.flush();
        std::thread::sleep(Duration::from_millis(40));
    }
    Ok(())
}

#[cfg(test)]
mod diagnostics_tests {
    use super::*;

    #[test]
    fn mode_requires_fresh_heartbeat_and_reports_rejection() {
        let mut s = Sample::empty();
        s.ok = true;
        s.mode = "FLOWHOLD".into();
        s.heartbeat_at = 9.0;
        assert!(mode_outcome(&s, "FLOWHOLD", 10.0).is_none());
        s.heartbeat_at = 11.0;
        assert_eq!(mode_outcome(&s, "FLOWHOLD", 10.0).unwrap()["ok"], true);
        s.mode = "STABILIZE".into();
        s.events.push(
            serde_json::json!({"message": "COMMAND_ACK", "received_at": 11.0,
            "data": {"command": "MAV_CMD_DO_SET_MODE", "result": "MAV_RESULT_FAILED"}}),
        );
        assert_eq!(mode_outcome(&s, "FLOWHOLD", 10.0).unwrap()["ok"], false);
        assert!(mode_outcome(&s, "FLOWHOLD", 12.0).is_none());
    }

    #[test]
    fn a_param_download_counts_gaps_without_listing_them() {
        let mut sample = Sample::empty();
        sample.param_count = 5;
        sample.param_indices.insert(0);
        sample.param_indices.insert(2);
        let body = param_download(&sample);
        assert_eq!(body["missing"], serde_json::json!(3));
        assert_eq!(body["complete"], serde_json::json!(false));
        assert!(body.get("missing_indices").is_none(), "{body}");
        sample.param_indices.extend([1u16, 3, 4]);
        let full = param_download(&sample);
        assert_eq!(full["missing"], serde_json::json!(0));
        assert_eq!(full["complete"], serde_json::json!(true));
    }

    #[test]
    fn bootloader_requires_fresh_disarmed_vehicle() {
        let mut s = Sample::empty();
        s.ok = true;
        s.heartbeat_at = 10.0;
        assert!(bootloader_allowed(&s, 12.0));
        s.armed = true;
        assert!(!bootloader_allowed(&s, 12.0));
        s.armed = false;
        assert!(!bootloader_allowed(&s, 14.0));
    }
}
