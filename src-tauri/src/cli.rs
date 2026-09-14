//! HTTP client for `--mcp`. Humans use `npm run cli` against the same port.
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use crate::http::HTTP_ADDR;
use crate::mcp;

pub fn run(args: &[String]) -> i32 {
    if crate::wants_mcp(args) {
        return mcp::run();
    }
    eprintln!(
        "ArduLoops CLI is npm run cli (HTTP {HTTP_ADDR}, same MAVLink as the UI).\n\
         MCP: start the app, then arduloops.exe --mcp\n\
         Headless for the browser: npm run dev"
    );
    2
}

pub(crate) fn http_get(path: &str) -> Result<String, String> {
    request("GET", path, None)
}

pub(crate) fn http_post(path: &str, body: &str) -> Result<String, String> {
    request("POST", path, Some(body))
}

fn request(method: &str, path: &str, body: Option<&str>) -> Result<String, String> {
    let mut stream = TcpStream::connect(HTTP_ADDR).map_err(|_| {
        format!("no ArduLoops at http://{HTTP_ADDR} — start the app first")
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
