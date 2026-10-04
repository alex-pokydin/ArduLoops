//! Small SQLite catalog shared by the firmware tools, the assistant, and the local UI.
//! The parameter cache is the last set received from a vehicle, not a live link.
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::link::Sample;

static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// The Tauri runtime supplies the platform-owned app-data directory on desktop
/// and Android. The headless bridge retains the environment-based fallback.
#[cfg(feature = "desktop")]
pub fn set_app_data_dir(path: PathBuf) {
    let _ = APP_DATA_DIR.set(path);
}

pub fn record_firmware(manifest: &Value) -> Result<(), String> {
    let conn = open()?;
    store_firmware(&conn, manifest)
}

fn store_firmware(conn: &Connection, manifest: &Value) -> Result<(), String> {
    let request = manifest
        .get("request")
        .ok_or("Firmware manifest has no request")?;
    let artifact_id = manifest["artifact_id"]
        .as_str()
        .ok_or("Firmware manifest has no artifact ID")?;
    let built_at = manifest_build_time(manifest);
    conn.execute(
        "INSERT INTO firmware_artifacts (artifact_id, build_id, vehicle_id, board_name, board_id, version_id, git_identity, image_size, description, file_path, features_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
         ON CONFLICT(artifact_id) DO UPDATE SET build_id=excluded.build_id, vehicle_id=excluded.vehicle_id,
           board_name=excluded.board_name, board_id=excluded.board_id, version_id=excluded.version_id,
           git_identity=excluded.git_identity, image_size=excluded.image_size, description=excluded.description,
           file_path=excluded.file_path, features_json=excluded.features_json,
           created_at=excluded.created_at, updated_at=excluded.updated_at",
        params![
            artifact_id,
            manifest["build_id"].as_str(),
            request["vehicle_id"].as_str(),
            request["board_id"].as_str(),
            manifest["board_id"].as_i64(),
            request["version_id"].as_str(),
            manifest["git_identity"].as_str(),
            manifest["image_size"].as_i64(),
            manifest["description"].as_str(),
            manifest["path"].as_str(),
            serde_json::to_string(&request["selected_features"]).map_err(|e| e.to_string())?,
            built_at,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Return the build-service timestamp.  Older local manifests did not retain
/// it, so recover it from the accompanying response before falling back to the
/// import time.
fn manifest_build_time(manifest: &Value) -> i64 {
    manifest["built_at"]
        .as_f64()
        .map(|value| value as i64)
        .or_else(|| {
            let image = manifest["path"].as_str()?;
            let status = fs::read(PathBuf::from(image).parent()?.join("build.json")).ok()?;
            serde_json::from_slice::<Value>(&status).ok()?["time_created"]
                .as_f64()
                .map(|value| value as i64)
        })
        .unwrap_or_else(now)
}

fn same_source(vehicle_git: &str, artifact_git: &str) -> bool {
    let vehicle: String = vehicle_git
        .chars()
        .filter(|c| *c != '\0' && !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    vehicle.len() >= 7 && artifact_git.to_ascii_lowercase().contains(&vehicle)
}

fn mark_flashed(conn: &Connection, identity: &Value, artifact_id: &str, vehicle_id: &str) -> Result<(), String> {
    let board_id = identity["board_id"].as_i64().unwrap_or(0);
    let system_id = identity["system_id"].as_i64().unwrap_or(1);
    let component_id = identity["component_id"].as_i64().unwrap_or(1);
    let uid = identity
        .pointer("/version/uid")
        .and_then(Value::as_u64)
        .filter(|id| *id != 0)
        .map(|id| format!("{id:016x}"));
    let key = uid.clone().unwrap_or_else(|| format!("{vehicle_id}:{board_id}:{system_id}:{component_id}"));
    let at = now();
    let by_uid = if let Some(uid) = &uid {
        conn.execute(
            "UPDATE controllers SET flashed_artifact_id=?1, last_seen=?2 WHERE uid=?3",
            params![artifact_id, at, uid],
        )
        .map_err(|e| e.to_string())?
    } else {
        0
    };
    let by_key = conn
        .execute(
            "UPDATE controllers SET flashed_artifact_id=?1, last_seen=?2 WHERE controller_key=?3",
            params![artifact_id, at, key],
        )
        .map_err(|e| e.to_string())?;
    if by_uid == 0 && by_key == 0 {
        conn.execute(
            "INSERT INTO controllers (controller_key, board_id, vehicle_id, system_id, component_id, uid, flashed_artifact_id, first_seen, last_seen)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![key, board_id, vehicle_id, system_id, component_id, uid, artifact_id, at],
        )
        .map_err(|e| e.to_string())?;
    }
    let matches: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM controllers WHERE board_id=?1 AND vehicle_id=?2",
            params![board_id, vehicle_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if matches == 1 {
        conn.execute(
            "UPDATE controllers SET flashed_artifact_id=?1 WHERE board_id=?2 AND vehicle_id=?3",
            params![artifact_id, board_id, vehicle_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn note_flashed(identity: &Value, artifact_id: &str, vehicle_id: &str) -> Result<(), String> {
    let conn = open()?;
    mark_flashed(&conn, identity, artifact_id, vehicle_id)
}

pub fn library(sample: &Sample) -> Result<Value, String> {
    let conn = open()?;
    let connected = connected_board(sample, &conn);
    let controller = connected
        .as_ref()
        .map(|identity| upsert_controller(&conn, identity))
        .transpose()?;
    let flashed_id: Option<String> = connected.as_ref().and_then(|board| {
        conn.query_row(
            "SELECT flashed_artifact_id FROM controllers WHERE controller_key=?1",
            [&board.key],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    });
    let live_git = connected.as_ref().and_then(|board| board.git_identity.clone());
    let mut statement = conn.prepare(
        "SELECT artifact_id, build_id, vehicle_id, board_name, board_id, version_id, git_identity, image_size, description, file_path, features_json, created_at, updated_at, comment
         FROM firmware_artifacts ORDER BY updated_at DESC"
    ).map_err(|e| e.to_string())?;
    let mut rows = statement.query([]).map_err(|e| e.to_string())?;
    let mut artifacts = Vec::new();
    let mut running_image = None;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let board_id: i64 = row.get(4).map_err(|e| e.to_string())?;
        let vehicle: String = row.get(2).map_err(|e| e.to_string())?;
        let board_name: Option<String> = row.get(3).map_err(|e| e.to_string())?;
        let compatible = connected.as_ref().is_some_and(|board| {
            board.vehicle == vehicle
                && (board.board_id == board_id || board.board_name.as_ref() == board_name.as_ref())
        });
        let artifact_id = row.get::<_, String>(0).map_err(|e| e.to_string())?;
        let build_id = row.get::<_, Option<String>>(1).map_err(|e| e.to_string())?;
        let version_id = row.get::<_, Option<String>>(5).map_err(|e| e.to_string())?;
        let git_identity = row.get::<_, Option<String>>(6).map_err(|e| e.to_string())?;
        let features: Value = serde_json::from_str(&row.get::<_, String>(10).map_err(|e| e.to_string())?).unwrap_or_else(|_| json!([]));
        let hash_matches = live_git.as_deref().zip(git_identity.as_deref()).is_some_and(|(live, stored)| same_source(live, stored));
        let running = flashed_id.as_deref() == Some(artifact_id.as_str()) && hash_matches;
        let image_size = row.get::<_, Option<i64>>(7).map_err(|e| e.to_string())?;
        let description = row.get::<_, Option<String>>(8).map_err(|e| e.to_string())?;
        let file_path = row.get::<_, Option<String>>(9).map_err(|e| e.to_string())?;
        let created_at = row.get::<_, i64>(11).map_err(|e| e.to_string())?;
        let updated_at = row.get::<_, i64>(12).map_err(|e| e.to_string())?;
        let comment = row.get::<_, String>(13).map_err(|e| e.to_string())?;
        if running {
            running_image = Some(json!({
                "artifact_id": artifact_id,
                "build_id": build_id,
                "vehicle_id": vehicle,
                "board_id": board_id,
                "version_id": version_id,
                "git_identity": git_identity,
                "features": features.clone(),
            }));
        }
        artifacts.push(json!({
            "artifact_id": artifact_id,
            "build_id": build_id,
            "vehicle_id": vehicle,
            "board_name": board_name,
            "board_id": board_id,
            "version_id": version_id,
            "git_identity": git_identity,
            "image_size": image_size,
            "description": description,
            "file_path": file_path,
            "features": features,
            "created_at": created_at,
            "updated_at": updated_at,
            "comment": comment,
            "build": {"id": build_id, "version_id": version_id, "git_identity": git_identity,
                "features": features.clone(), "image_size": image_size, "description": description,
                "created_at": created_at, "updated_at": updated_at, "comment": comment},
            "compatible": compatible,
            "running": running,
        }));
    }
    Ok(json!({"database": database_path(), "controller": controller, "running": running_image, "artifacts": artifacts}))
}

pub fn controller_note(sample: &Sample) -> (Option<String>, String) {
    let Ok(conn) = open() else {
        return (None, String::new());
    };
    let Some(board) = connected_board(sample, &conn) else {
        return (None, String::new());
    };
    let comment = conn
        .query_row(
            "SELECT comment FROM controllers WHERE controller_key=?1",
            [&board.key],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_default();
    (Some(board.key), comment)
}

pub fn set_controller_comment(key: &str, comment: &str) -> Result<Value, String> {
    let conn = open()?;
    let comment = user_comment(comment)?;
    let changed = conn
        .execute(
            "UPDATE controllers SET comment=?1 WHERE controller_key=?2",
            params![comment, key],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Controller is not in the local catalog".into());
    }
    Ok(json!({"key": key, "comment": comment}))
}

pub fn set_firmware_comment(artifact_id: &str, comment: &str) -> Result<Value, String> {
    let conn = open()?;
    let comment = user_comment(comment)?;
    let changed = conn
        .execute(
            "UPDATE firmware_artifacts SET comment=?1 WHERE artifact_id=?2",
            params![comment, artifact_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Firmware artifact is not in the local catalog".into());
    }
    Ok(json!({"artifact_id": artifact_id, "comment": comment}))
}

fn user_comment(value: &str) -> Result<String, String> {
    let comment = value.trim();
    if comment.chars().count() > 2_000 {
        return Err("Comment must contain at most 2000 characters".into());
    }
    Ok(comment.into())
}

#[derive(Clone)]
struct Controller {
    key: String,
    board_id: i64,
    vehicle: String,
    system_id: i64,
    component_id: i64,
    vendor_id: Option<i64>,
    product_id: Option<i64>,
    uid: Option<String>,
    flight_version: Option<i64>,
    git_identity: Option<String>,
    board_name: Option<String>,
}

fn connected_board(sample: &Sample, conn: &Connection) -> Option<Controller> {
    if !sample.ok {
        return None;
    }
    let version = sample.telemetry.get("AUTOPILOT_VERSION");
    let data = version.and_then(|value| value.get("data"));
    let board_line = sample
        .events
        .iter()
        .filter_map(|event| event.get("data")?.get("text")?.as_str())
        .find(|text| {
            text.split_whitespace()
                .next()
                .is_some_and(|name| name.contains('_') && name.len() <= 64)
        });
    let board_name = (!sample.board_name.is_empty())
        .then(|| sample.board_name.clone())
        .or_else(|| board_line.map(|text| text.split_whitespace().next().unwrap_or("").to_owned()));
    let boot_uid = (!sample.boot_uid.is_empty())
        .then(|| sample.boot_uid.clone())
        .or_else(|| {
            board_line.and_then(|text| {
                let uid = text
                    .split_whitespace()
                    .skip(1)
                    .filter(|part| {
                        part.len() >= 4
                            && part.len() <= 16
                            && part.bytes().all(|byte| byte.is_ascii_hexdigit())
                    })
                    .collect::<String>();
                (uid.len() >= 8).then_some(uid)
            })
        });
    let board_id = data.and_then(|value| value.get("board_version")).and_then(Value::as_u64)
        .map(|value| (value >> 16) as i64)
        .filter(|value| *value > 0)
        .or_else(|| board_name.as_ref().and_then(|name| conn.query_row(
            "SELECT board_id FROM firmware_artifacts WHERE board_name=?1 ORDER BY updated_at DESC LIMIT 1", [name], |row| row.get(0)).ok()))?;
    let uid = data
        .and_then(|value| value.get("uid"))
        .and_then(Value::as_u64)
        .filter(|id| *id != 0)
        .map(|id| format!("{id:016x}"))
        .or(boot_uid);
    let system_id = version
        .and_then(|value| value.get("system_id"))
        .and_then(Value::as_i64)
        .unwrap_or(1);
    let component_id = version
        .and_then(|value| value.get("component_id"))
        .and_then(Value::as_i64)
        .unwrap_or(1);
    let vendor_id = data
        .and_then(|value| value.get("vendor_id"))
        .and_then(Value::as_i64);
    let product_id = data
        .and_then(|value| value.get("product_id"))
        .and_then(Value::as_i64);
    let git_identity = data
        .and_then(|value| value.get("flight_custom_version"))
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(Value::as_u64)
                .map(|byte| byte as u8 as char)
                .collect::<String>()
        })
        .filter(|text| !text.trim_matches('\0').is_empty());
    let key = uid
        .clone()
        .unwrap_or_else(|| format!("{}:{board_id}:{system_id}:{component_id}", sample.frame));
    Some(Controller {
        key,
        board_id,
        vehicle: sample.frame.clone(),
        system_id,
        component_id,
        vendor_id,
        product_id,
        uid,
        flight_version: data
            .and_then(|value| value.get("flight_sw_version"))
            .and_then(Value::as_i64),
        git_identity,
        board_name,
    })
}

fn upsert_controller(conn: &Connection, controller: &Controller) -> Result<Value, String> {
    let at = now();
    conn.execute(
        "INSERT INTO controllers (controller_key, board_id, vehicle_id, system_id, component_id, vendor_id, product_id, uid, flight_version, git_identity, first_seen, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
         ON CONFLICT(controller_key) DO UPDATE SET board_id=excluded.board_id, vehicle_id=excluded.vehicle_id,
         system_id=excluded.system_id, component_id=excluded.component_id, vendor_id=excluded.vendor_id,
         product_id=excluded.product_id, uid=excluded.uid, flight_version=excluded.flight_version,
         git_identity=excluded.git_identity, last_seen=excluded.last_seen",
        params![controller.key, controller.board_id, controller.vehicle, controller.system_id, controller.component_id,
            controller.vendor_id, controller.product_id, controller.uid, controller.flight_version, controller.git_identity, at],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO controller_seen (controller_key, seen_at) VALUES (?1, ?2)",
        params![controller.key, at],
    )
    .map_err(|e| e.to_string())?;
    let comment: String = conn
        .query_row(
            "SELECT comment FROM controllers WHERE controller_key=?1",
            [&controller.key],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(
        json!({"key": controller.key, "board_id": controller.board_id, "vehicle_id": controller.vehicle,
        "system_id": controller.system_id, "component_id": controller.component_id, "vendor_id": controller.vendor_id,
        "product_id": controller.product_id, "uid": controller.uid, "flight_version": controller.flight_version, "board_name": controller.board_name,
        "git_identity": controller.git_identity, "last_seen": at, "comment": comment}),
    )
}

pub fn database_path() -> String {
    data_dir().join("catalog.sqlite3").display().to_string()
}

fn open() -> Result<Connection, String> {
    let path = data_dir().join("catalog.sqlite3");
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    crate::migrate::apply(&conn)?;
    import_existing_artifacts(&conn);
    Ok(conn)
}

fn import_existing_artifacts(conn: &Connection) {
    let root = data_dir().join("firmware").join("artifacts");
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let manifest = entry.path().join("manifest.json");
        let Ok(bytes) = fs::read(&manifest) else {
            continue;
        };
        let Ok(value) = serde_json::from_slice(&bytes) else {
            continue;
        };
        let _ = store_firmware(conn, &value);
    }
}

pub(crate) fn data_dir() -> PathBuf {
    if let Some(path) = APP_DATA_DIR.get() {
        let _ = fs::create_dir_all(path);
        return path.clone();
    }
    let root = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir())
    } else if let Some(value) = std::env::var_os("XDG_DATA_HOME") {
        PathBuf::from(value)
    } else {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join(".local/share")
    };
    let path = root.join("ArduLoops");
    let _ = fs::create_dir_all(&path);
    path
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub struct ParamCache {
    pub frame: String,
    pub board_name: String,
    pub boot_uid: String,
    pub saved_at: i64,
    pub params: HashMap<String, f64>,
}

pub(crate) fn vehicle_cache_key(frame: &str, board_name: &str, boot_uid: &str) -> String {
    if !boot_uid.is_empty() {
        return boot_uid.to_string();
    }
    if !board_name.is_empty() {
        return format!("board:{board_name}");
    }
    if !frame.is_empty() {
        return format!("frame:{frame}");
    }
    "last".into()
}

/// Stores the parameters received from a vehicle. A complete download replaces that vehicle's rows.
pub fn remember_params(
    frame: &str,
    board_name: &str,
    boot_uid: &str,
    params: &HashMap<String, f64>,
    replace_all: bool,
) -> Result<(), String> {
    if params.is_empty() {
        return Ok(());
    }
    let conn = open()?;
    let key = vehicle_cache_key(frame, board_name, boot_uid);
    let at = now();
    if replace_all {
        conn.execute("DELETE FROM param_cache WHERE vehicle_key=?1", [&key])
            .map_err(|e| e.to_string())?;
    }
    let mut insert = conn
        .prepare(
            "INSERT INTO param_cache (vehicle_key, name, value, saved_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(vehicle_key, name) DO UPDATE SET value=excluded.value, saved_at=excluded.saved_at",
        )
        .map_err(|e| e.to_string())?;
    for (name, value) in params {
        insert.execute(params![key, name, value, at]).map_err(|e| e.to_string())?;
    }
    drop(insert);
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM param_cache WHERE vehicle_key=?1", [&key], |row| row.get(0))
        .unwrap_or(params.len() as i64);
    conn.execute(
        "INSERT INTO param_cache_meta (vehicle_key, frame, board_name, boot_uid, saved_at, count) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(vehicle_key) DO UPDATE SET frame=excluded.frame, board_name=excluded.board_name, boot_uid=excluded.boot_uid, saved_at=excluded.saved_at, count=excluded.count",
        params![key, frame, board_name, boot_uid, at, count],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// One parameter changed after the full set was saved.
pub fn remember_param(frame: &str, board_name: &str, boot_uid: &str, name: &str, value: f64) -> Result<(), String> {
    if name.is_empty() {
        return Ok(());
    }
    let mut one = HashMap::new();
    one.insert(name.to_string(), value);
    remember_params(frame, board_name, boot_uid, &one, false)
}

/// Saved parameters for this vehicle identity. Empty when that vehicle has never been cached.
pub fn params_for(frame: &str, board_name: &str, boot_uid: &str) -> Result<Option<ParamCache>, String> {
    load_cache_key(&vehicle_cache_key(frame, board_name, boot_uid))
}

/// The newest saved parameter set. Used when no vehicle is linked.
pub fn latest_params() -> Result<Option<ParamCache>, String> {
    let conn = open()?;
    let key: String = match conn.query_row(
        "SELECT vehicle_key FROM param_cache_meta ORDER BY saved_at DESC LIMIT 1",
        [],
        |row| row.get(0),
    ) {
        Ok(key) => key,
        Err(_) => return Ok(None),
    };
    load_cache_key(&key)
}

fn load_cache_key(key: &str) -> Result<Option<ParamCache>, String> {
    let conn = open()?;
    let meta = conn.query_row(
        "SELECT frame, board_name, boot_uid, saved_at FROM param_cache_meta WHERE vehicle_key=?1",
        [key],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?)),
    );
    let Ok((frame, board_name, boot_uid, saved_at)) = meta else {
        return Ok(None);
    };
    let mut params = HashMap::new();
    let mut stmt = conn
        .prepare("SELECT name, value FROM param_cache WHERE vehicle_key=?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([key], |row| Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows.flatten() {
        params.insert(row.0, row.1);
    }
    if params.is_empty() {
        return Ok(None);
    }
    Ok(Some(ParamCache { frame, board_name, boot_uid, saved_at, params }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifies_numeric_board_and_short_git() {
        let mut s = Sample::empty();
        s.ok = true;
        s.frame = "copter".into();
        s.telemetry.insert("AUTOPILOT_VERSION".into(), json!({"system_id":1,"component_id":1,"data":{
            "board_version": 1081_u64 << 16, "flight_custom_version":[100,98,101,101,55,57,50,49]}}));
        let conn = Connection::open_in_memory().unwrap();
        let c = connected_board(&s, &conn).unwrap();
        assert_eq!(c.board_id, 1081);
        assert_eq!(c.git_identity.as_deref(), Some("dbee7921"));
    }

    #[test]
    fn uses_boot_message_identifier_when_mavlink_uid_is_zero() {
        let mut s = Sample::empty();
        s.ok = true;
        s.frame = "copter".into();
        s.events
            .push(json!({"data":{"text":"JHEM_JHEF405 002F0035 4D535012 20303932"}}));
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE firmware_artifacts (board_name TEXT, board_id INTEGER, updated_at INTEGER);") .unwrap();
        conn.execute(
            "INSERT INTO firmware_artifacts VALUES ('JHEM_JHEF405', 1081, 1)",
            [],
        )
        .unwrap();
        let c = connected_board(&s, &conn).unwrap();
        assert_eq!(c.board_id, 1081);
        assert_eq!(c.uid.as_deref(), Some("002F00354D53501220303932"));
    }

    #[test]
    fn source_hash_matches_the_build_hash() {
        assert!(same_source("dbe79216", "dbe792162d06cab66c3475fd5556bf7a120f119e"));
        assert!(same_source("dbe79216", "ArduCopter V4.6.3 (dbe79216)"));
        assert!(!same_source("dbe79216", "aaaaaaaa"));
        assert!(!same_source("", "dbe79216"));
    }

    #[test]
    fn recorded_flash_follows_the_controller_uid() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE controllers (
                controller_key TEXT PRIMARY KEY, board_id INTEGER NOT NULL, vehicle_id TEXT NOT NULL,
                system_id INTEGER NOT NULL, component_id INTEGER NOT NULL, uid TEXT,
                flashed_artifact_id TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL)",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO controllers VALUES ('abc', 1081, 'copter', 1, 1, '0000000000000001', NULL, 1, 1)",
            [],
        )
        .unwrap();
        mark_flashed(
            &conn,
            &json!({"board_id":1081,"system_id":1,"component_id":1,"version":{"uid":1}}),
            "artifact-a",
            "copter",
        )
        .unwrap();
        let stored: String = conn
            .query_row("SELECT flashed_artifact_id FROM controllers WHERE controller_key='abc'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored, "artifact-a");
    }

    #[test]
    fn user_comment_is_trimmed_and_limited() {
        assert_eq!(user_comment("  Field test  ").unwrap(), "Field test");
        assert!(user_comment(&"a".repeat(2_001)).is_err());
    }
}
