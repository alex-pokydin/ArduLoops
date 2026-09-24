//! Local HTTP so the UI, `npm run cli`, and `--mcp` share one MAVLink loop.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::link::{Cmd, Sample};

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

    if method == "GET" && (path == "/stream" || path.starts_with("/stream")) {
        return sse(reader.into_inner(), latest);
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

    let mut socket = reader.into_inner();
    if method == "GET" && (path == "/" || path == "/health") {
        reply(
            &mut socket,
            200,
            "text/plain",
            b"ArduLoops\n",
        )?;
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
            let g = latest.lock().map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::Other, "lock")
            })?;
            serde_json::to_vec(&state_view(&g)).unwrap_or_else(|_| b"{}".to_vec())
        };
        reply(&mut socket, 200, "application/json", &json)?;
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
        } else if let Ok(mut g) = latest.lock() {
            g.params.remove(&name);
        }
        let _ = tx.send(Cmd::ParamRead { name: name.clone() });
        for _ in 0..25 {
            std::thread::sleep(Duration::from_millis(40));
            if let Some(json) = param_json(&latest, &name) {
                reply(&mut socket, 200, "application/json", &json)?;
                return Ok(());
            }
        }
        let body = serde_json::json!({ "name": name, "found": false });
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
            let g = latest.lock().map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::Other, "lock")
            })?;
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
            .clamp(1, 24);
        let json = {
            let g = latest.lock().map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::Other, "lock")
            })?;
            let slice: Vec<&String> = g.texts.iter().take(n).collect();
            serde_json::to_vec(&slice).unwrap_or_else(|_| b"[]".to_vec())
        };
        reply(&mut socket, 200, "application/json", &json)?;
        return Ok(());
    }

    socket.write_all(format!("HTTP/1.1 404 Not Found\r\n{CORS}\r\n").as_bytes())?;
    Ok(())
}

fn reply(socket: &mut TcpStream, code: u16, ctype: &str, body: &[u8]) -> std::io::Result<()> {
    let reason = match code {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
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
            let g = latest.lock().map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::Other, "lock")
            })?;
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
