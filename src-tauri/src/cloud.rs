//! Log sync with the signed-in account (arduloops-api `/v1/logs/*`).
//! Stars and notes always sync. Files upload as the user chooses, gzip-compressed,
//! straight to storage through a signed URL; the API checks the plan's storage first.

use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::db::data_dir;
use crate::dflog::{logs_root, resolve};

/// The transfer in progress, for the progress line on its row.
static PROGRESS: Mutex<Option<Value>> = Mutex::new(None);
/// One transfer at a time; the table queues the rest.
static TRANSFER: Mutex<()> = Mutex::new(());

fn settings_path() -> PathBuf {
    data_dir().join("cloud.json")
}

fn cache_path() -> PathBuf {
    data_dir().join("cloud-cache.json")
}

/// off | starred | all. Off until the user turns it on.
pub fn mode() -> String {
    fs::read(settings_path())
        .ok()
        .and_then(|raw| serde_json::from_slice::<Value>(&raw).ok())
        .and_then(|v| v["mode"].as_str().map(str::to_string))
        .filter(|m| m == "starred" || m == "all")
        .unwrap_or_else(|| "off".into())
}

pub fn set_mode(mode: &str) -> Result<Value, String> {
    let mode = match mode {
        "starred" | "all" | "off" => mode,
        _ => return Err("mode is off, starred or all".into()),
    };
    fs::write(settings_path(), json!({ "mode": mode }).to_string()).map_err(|e| e.to_string())?;
    Ok(json!({ "mode": mode }))
}

fn cached() -> Value {
    fs::read(cache_path())
        .ok()
        .and_then(|raw| serde_json::from_slice::<Value>(&raw).ok())
        .unwrap_or_else(|| json!({ "logs": [] }))
}

/// The account's logs as last listed: hash → row. Used for cloud-only rows and the assistant.
pub fn cached_logs() -> Vec<Value> {
    cached()["logs"].as_array().cloned().unwrap_or_default()
}

/// The account's logs, usage and the sync mode. Notes newer in the cloud are applied here.
pub fn state() -> Value {
    if !crate::agent::signed_in() {
        return json!({ "signed_in": false, "mode": mode(), "logs": [] });
    }
    match crate::agent::cloud_post("/v1/logs/list", &json!({})) {
        Ok(list) => {
            let logs = list["logs"].as_array().cloned().unwrap_or_default();
            for row in &logs {
                let (Some(hash), Some(at)) = (row["hash"].as_str(), row["meta"]["updated_at"].as_i64()) else { continue };
                let _ = crate::db::merge_log_note(hash, row["meta"]["star"].as_bool().unwrap_or(false), row["meta"]["note"].as_str().unwrap_or(""), at);
            }
            push_newer_notes(&logs);
            let _ = fs::write(cache_path(), list.to_string());
            json!({
                "signed_in": true,
                "mode": mode(),
                "used": list["used"],
                "limit": list["limit"],
                "plan": list["plan"],
                "logs": logs,
            })
        }
        Err(error) => {
            let mut last = cached();
            if let Some(obj) = last.as_object_mut() {
                obj.insert("signed_in".into(), json!(true));
                obj.insert("mode".into(), json!(mode()));
                obj.insert("error".into(), json!(error));
            }
            last
        }
    }
}

/// Sends a star or note change to the account. Without a session it stays local.
pub fn push_note(hash: &str, star: bool, note: &str, updated_at: i64, board: &str, onboard_id: Option<i64>, bytes: i64) {
    if !crate::agent::signed_in() {
        return;
    }
    let body = json!({
        "hash": hash, "star": star, "note": note, "updated_at": updated_at,
        "board": board, "onboard_id": onboard_id, "bytes": bytes,
    });
    std::thread::spawn(move || {
        if let Err(error) = crate::agent::cloud_post("/v1/logs/meta", &body) {
            log::warn!("log note sync: {error}");
        }
    });
}

/// Sends the stars and notes made here that the account does not have yet, or has older:
/// those written before signing in, or while offline.
fn push_newer_notes(cloud: &[Value]) {
    let theirs: std::collections::HashMap<&str, i64> = cloud
        .iter()
        .filter_map(|row| Some((row["hash"].as_str()?, row["meta"]["updated_at"].as_i64().unwrap_or(0))))
        .collect();
    let mine = crate::db::log_notes_full().unwrap_or_default();
    let newer: Vec<Value> = mine
        .into_iter()
        .filter(|row| {
            let at = row["updated_at"].as_i64().unwrap_or(0);
            let worth = row["star"].as_bool() == Some(true) || !row["note"].as_str().unwrap_or("").is_empty();
            match row["hash"].as_str().and_then(|h| theirs.get(h)) {
                Some(cloud_at) => at > *cloud_at,
                None => worth,
            }
        })
        .collect();
    if newer.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        for row in newer {
            if let Err(error) = crate::agent::cloud_post("/v1/logs/meta", &row) {
                log::warn!("log note sync: {error}");
                return;
            }
        }
    });
}

pub fn progress() -> Value {
    PROGRESS.lock().ok().and_then(|p| p.clone()).unwrap_or(Value::Null)
}

fn set_progress(value: Option<Value>) {
    if let Ok(mut slot) = PROGRESS.lock() {
        *slot = value;
    }
}

fn sha16(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    digest.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
}

/// Uploads one stored log. The API refuses it when the plan's storage would be exceeded.
pub fn upload(id: &str) -> Result<Value, String> {
    if !crate::agent::signed_in() {
        return Err("Sign in required.".into());
    }
    let _one = TRANSFER.try_lock().map_err(|_| "A cloud transfer is already running".to_string())?;
    let path = resolve(id)?;
    let raw = fs::read(&path).map_err(|e| e.to_string())?;
    let hash = sha16(&raw);
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(&raw).map_err(|e| e.to_string())?;
    let packed = gz.finish().map_err(|e| e.to_string())?;
    let name = id.rsplit('/').next().unwrap_or(id).to_string();
    let board = id.split('/').next().unwrap_or("").to_string();
    let onboard = crate::dflog::onboard_number(id);
    let ticket = crate::agent::cloud_post("/v1/logs/upload", &json!({
        "hash": hash, "name": name, "board": board, "onboard_id": onboard,
        "bytes": raw.len(), "stored_bytes": packed.len(),
    }))?;
    if ticket["exists"].as_bool() == Some(true) {
        return Ok(json!({ "ok": true, "hash": hash, "exists": true }));
    }
    let url = ticket["url"].as_str().ok_or("The account did not return an upload address")?.to_string();
    let total = packed.len() as u64;
    set_progress(Some(json!({ "op": "upload", "hash": hash, "id": id, "sent": 0, "total": total })));
    let (h, i) = (hash.clone(), id.to_string());
    let result = crate::agent::cloud_put(&url, packed, "application/gzip", move |sent, total| {
        set_progress(Some(json!({ "op": "upload", "hash": h, "id": i, "sent": sent, "total": total })));
    });
    set_progress(None);
    result?;
    let done = crate::agent::cloud_post("/v1/logs/commit", &json!({ "hash": hash }))?;
    Ok(json!({ "ok": true, "hash": hash, "used": done["used"], "limit": done["limit"] }))
}

/// Downloads a log that is only in the cloud and stores it as it was named. Returns the local id.
pub fn download(hash: &str) -> Result<String, String> {
    if hash.len() != 16 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("hash must be 16 hex characters".into());
    }
    if let Some(id) = local_id(hash) {
        return Ok(id);
    }
    let _one = TRANSFER.lock().map_err(|_| "cloud transfer lock".to_string())?;
    let ticket = crate::agent::cloud_post("/v1/logs/download", &json!({ "hash": hash }))?;
    let url = ticket["url"].as_str().ok_or("The account did not return a download address")?;
    set_progress(Some(json!({ "op": "download", "hash": hash, "sent": 0, "total": ticket["stored_bytes"] })));
    let packed = crate::agent::cloud_get(url);
    set_progress(None);
    let packed = packed?;
    let mut raw = Vec::new();
    flate2::read::GzDecoder::new(&packed[..]).read_to_end(&mut raw).map_err(|e| e.to_string())?;
    if sha16(&raw) != hash {
        return Err("The downloaded log does not match its hash".into());
    }
    let name = ticket["name"].as_str().filter(|n| safe_name(n)).map(str::to_string).unwrap_or_else(|| format!("{hash}_cloud.bin"));
    let board = ticket["board"].as_str().filter(|b| safe_name(b)).unwrap_or("imported");
    let dir = logs_root().join(board);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(&name), &raw).map_err(|e| e.to_string())?;
    Ok(format!("{board}/{name}"))
}

/// Removes the cloud copy. The copy here, the star and the note stay.
pub fn remove(hash: &str) -> Result<Value, String> {
    crate::agent::cloud_post("/v1/logs/remove", &json!({ "hash": hash }))
}

fn safe_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 200 && !name.contains("..") && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}

/// The stored log with these contents, if there is one here.
fn local_id(hash: &str) -> Option<String> {
    let listed = crate::dflog::local_logs();
    listed["logs"].as_array()?.iter().find(|row| row["hash"].as_str() == Some(hash)).and_then(|row| row["id"].as_str().map(str::to_string))
}
