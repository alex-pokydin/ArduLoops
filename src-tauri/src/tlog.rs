//! Mission Planner `.tlog`: each record is 8 big-endian microseconds since the Unix epoch, then one MAVLink frame.
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use mavlink::ardupilotmega::MavMessage;
use mavlink::{write_versioned_msg, MavConnection, MavHeader, MavlinkVersion};
use serde_json::{json, Value};

struct Cfg {
    enabled: bool,
    path: String,
}

struct Rec {
    loaded: bool,
    cfg: Cfg,
    session: bool,
    file: Option<BufWriter<File>>,
    file_path: String,
    last_flush: Option<Instant>,
    error: String,
}

static REC: Mutex<Rec> = Mutex::new(Rec {
    loaded: false,
    cfg: Cfg { enabled: false, path: String::new() },
    session: false,
    file: None,
    file_path: String::new(),
    last_flush: None,
    error: String::new(),
});

static TEST_ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);

fn config_file() -> PathBuf {
    root_dir().join("tlog.json")
}

fn root_dir() -> PathBuf {
    TEST_ROOT.lock().unwrap().clone().unwrap_or_else(crate::db::data_dir)
}

fn default_dir() -> PathBuf {
    root_dir().join("tlogs")
}

fn folder(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        default_dir()
    } else {
        PathBuf::from(trimmed)
    }
}

fn load_cfg() -> Cfg {
    let Ok(bytes) = fs::read(config_file()) else {
        return Cfg { enabled: false, path: String::new() };
    };
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return Cfg { enabled: false, path: String::new() };
    };
    Cfg {
        enabled: value.get("enabled").and_then(Value::as_bool).unwrap_or(false),
        path: value.get("path").and_then(Value::as_str).unwrap_or("").to_string(),
    }
}

fn store_cfg(cfg: &Cfg) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&json!({ "enabled": cfg.enabled, "path": cfg.path }))
        .map_err(|err| err.to_string())?;
    fs::write(config_file(), bytes).map_err(|_| "Could not save the telemetry log settings.".to_string())
}

fn with_rec<T>(f: impl FnOnce(&mut Rec) -> T) -> T {
    let mut rec = REC.lock().unwrap();
    if !rec.loaded {
        rec.cfg = load_cfg();
        rec.loaded = true;
    }
    f(&mut rec)
}

fn publish(file: &mut BufWriter<File>) {
    let _ = file.flush();
    // File::flush does nothing on Windows. Without this, dir keeps showing 0 until the handle closes.
    let _ = file.get_ref().sync_data();
}

fn close_file(rec: &mut Rec) {
    if let Some(mut file) = rec.file.take() {
        publish(&mut file);
    }
    rec.file_path.clear();
}

fn open_file(rec: &mut Rec) -> Result<(), String> {
    close_file(rec);
    let dir = folder(&rec.cfg.path);
    fs::create_dir_all(&dir).map_err(|_| "Could not create the telemetry log folder.".to_string())?;
    if dir.exists() && !dir.is_dir() {
        return Err("The telemetry log path is not a folder.".into());
    }
    let name = fresh_name(&dir);
    let path = dir.join(&name);
    let file = File::create(&path).map_err(|_| "Could not create the telemetry log folder.".to_string())?;
    rec.file = Some(BufWriter::with_capacity(8 * 1024, file));
    rec.file_path = path.display().to_string();
    rec.last_flush = None;
    rec.error.clear();
    Ok(())
}

fn fresh_name(dir: &Path) -> String {
    let stamp = utc_stamp();
    let mut name = format!("{stamp}.tlog");
    let mut n = 2u32;
    while dir.join(&name).exists() {
        name = format!("{stamp}-{n}.tlog");
        n += 1;
    }
    name
}

fn utc_stamp() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    let tod = secs % 86_400;
    format!("{y:04}-{m:02}-{d:02} {:02}-{:02}-{:02}", tod / 3600, (tod % 3600) / 60, tod % 60)
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

pub fn status() -> Value {
    with_rec(|rec| {
        json!({
            "enabled": rec.cfg.enabled,
            "path": rec.cfg.path,
            "dir": folder(&rec.cfg.path).display().to_string(),
            "file": rec.file_path,
            "error": rec.error,
        })
    })
}

pub fn set(enabled: bool, path: &str) -> Result<Value, String> {
    let path = path.trim();
    if path.chars().any(|c| c == '\0') {
        return Err("The telemetry log path is not a folder.".into());
    }
    let dir = folder(path);
    if dir.exists() && !dir.is_dir() {
        return Err("The telemetry log path is not a folder.".into());
    }
    if enabled {
        fs::create_dir_all(&dir).map_err(|_| "Could not create the telemetry log folder.".to_string())?;
    }
    with_rec(|rec| -> Result<(), String> {
        let changed = rec.cfg.path != path;
        rec.cfg.enabled = enabled;
        rec.cfg.path = path.to_string();
        store_cfg(&rec.cfg)?;
        if !enabled || changed {
            close_file(rec);
        }
        rec.error.clear();
        Ok(())
    })?;
    Ok(status())
}

/// Start a new file for this link when recording is on.
pub fn begin() {
    let _ = with_rec(|rec| {
        rec.session = true;
        close_file(rec);
        if rec.cfg.enabled {
            if let Err(err) = open_file(rec) {
                rec.error = err;
            }
        }
    });
}

pub fn end() {
    with_rec(|rec| {
        rec.session = false;
        close_file(rec);
    });
}

pub fn note(version: MavlinkVersion, header: &MavHeader, msg: &MavMessage) {
    let mut frame = Vec::new();
    if write_versioned_msg(&mut frame, version, *header, msg).is_err() {
        return;
    }
    with_rec(|rec| {
        if !rec.session || !rec.cfg.enabled {
            if rec.file.is_some() {
                close_file(rec);
            }
            return;
        }
        if rec.file.is_none() && open_file(rec).is_err() {
            return;
        }
        let due = rec.last_flush.map(|t| t.elapsed() >= Duration::from_secs(1)).unwrap_or(true);
        let wrote = if let Some(file) = rec.file.as_mut() {
            let us = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_micros() as u64)
                .unwrap_or(0);
            let _ = file.write_all(&us.to_be_bytes());
            let _ = file.write_all(&frame);
            if due {
                publish(file);
            }
            true
        } else {
            false
        };
        if wrote && due {
            rec.last_flush = Some(Instant::now());
        }
    });
}

pub struct LoggedConn {
    inner: Box<dyn MavConnection<MavMessage> + Send + Sync>,
}

impl LoggedConn {
    pub fn new(inner: Box<dyn MavConnection<MavMessage> + Send + Sync>) -> Self {
        Self { inner }
    }
}

impl MavConnection<MavMessage> for LoggedConn {
    fn recv(&self) -> Result<(MavHeader, MavMessage), mavlink::error::MessageReadError> {
        let got = self.inner.recv()?;
        note(self.inner.get_protocol_version(), &got.0, &got.1);
        Ok(got)
    }

    fn send(
        &self,
        header: &MavHeader,
        data: &MavMessage,
    ) -> Result<usize, mavlink::error::MessageWriteError> {
        let n = self.inner.send(header, data)?;
        note(self.inner.get_protocol_version(), header, data);
        Ok(n)
    }

    fn set_protocol_version(&mut self, version: MavlinkVersion) {
        self.inner.set_protocol_version(version);
    }

    fn get_protocol_version(&self) -> MavlinkVersion {
        self.inner.get_protocol_version()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::ardupilotmega::{
        MavAutopilot, MavModeFlag, MavState, MavType, HEARTBEAT_DATA,
    };
    use std::io::Read;

    #[test]
    fn a_tlog_record_is_a_big_endian_time_then_a_mavlink_frame() {
        let tmp = std::env::temp_dir().join(format!("arduloops-tlog-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        *TEST_ROOT.lock().unwrap() = Some(tmp.clone());
        with_rec(|rec| {
            rec.loaded = false;
        });
        set(true, "").unwrap();
        begin();
        let msg = MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            custom_mode: 0,
            mavtype: MavType::MAV_TYPE_QUADROTOR,
            autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
            base_mode: MavModeFlag::empty(),
            system_status: MavState::MAV_STATE_STANDBY,
            mavlink_version: 3,
        });
        let before = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_micros() as u64;
        note(MavlinkVersion::V2, &MavHeader::default(), &msg);
        let file = fs::read_dir(tmp.join("tlogs")).unwrap().next().unwrap().unwrap();
        assert!(fs::metadata(file.path()).unwrap().len() > 0);
        end();
        let file = fs::read_dir(tmp.join("tlogs")).unwrap().next().unwrap().unwrap();
        assert!(file.file_name().to_string_lossy().ends_with(".tlog"));
        let mut bytes = Vec::new();
        File::open(file.path()).unwrap().read_to_end(&mut bytes).unwrap();
        assert!(bytes.len() > 10);
        assert_eq!(bytes[8], 0xFD);
        let us = u64::from_be_bytes(bytes[0..8].try_into().unwrap());
        let after = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_micros() as u64;
        assert!(us >= before && us <= after);
        set(false, "").unwrap();
        note(MavlinkVersion::V2, &MavHeader::default(), &msg);
        let left = fs::read_dir(tmp.join("tlogs")).unwrap().count();
        assert_eq!(left, 1);
        *TEST_ROOT.lock().unwrap() = None;
        with_rec(|rec| {
            rec.loaded = false;
            rec.cfg = Cfg { enabled: false, path: String::new() };
        });
        let _ = fs::remove_dir_all(&tmp);
    }
}
