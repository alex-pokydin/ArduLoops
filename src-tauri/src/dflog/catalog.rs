// Local log list, inspect, schema, query, and the compute entry.


const HEAD1: u8 = 0xA3;
const HEAD2: u8 = 0x95;
const FMT_TYPE: u8 = 128;

struct Fmt {
    length: usize,
    name: String,
    format: String,
    labels: Vec<String>,
}

pub fn logs_root() -> PathBuf {
    data_dir().join("logs")
}

pub fn list_logs() -> Value {
    let root = logs_root();
    let mut rows = Vec::new();
    let Ok(vehicles) = fs::read_dir(&root) else {
        return json!({ "source": "downloaded", "logs": rows });
    };
    for vehicle in vehicles.flatten() {
        let Ok(files) = fs::read_dir(vehicle.path()) else { continue };
        for file in files.flatten() {
            let path = file.path();
            if path.extension().and_then(|e| e.to_str()) != Some("bin") {
                continue;
            }
            let Ok(rel) = path.strip_prefix(&root) else { continue };
            let id = rel.to_string_lossy().replace('\\', "/");
            let meta = file.metadata().ok();
            let bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let saved_at = meta.as_ref().and_then(|m| m.modified().ok()).and_then(system_rfc3339);
            let flight_utc = fs::read(&path).ok().as_deref().and_then(first_flight_utc);
            rows.push(json!({
                "id": id,
                "bytes": bytes,
                "source": "downloaded",
                "onboard_id": onboard_id(&id),
                "saved_at": saved_at,
                "flight_utc": flight_utc,
            }));
            if let Some(obj) = rows.last_mut().and_then(|row| row.as_object_mut()) {
                merge_name_parts(obj, &id);
            }
        }
    }
    rows.sort_by(|a, b| {
        b["saved_at"].as_str().unwrap_or("").cmp(a["saved_at"].as_str().unwrap_or(""))
            .then(b["onboard_id"].as_u64().unwrap_or(0).cmp(&a["onboard_id"].as_u64().unwrap_or(0)))
    });
    json!({
        "source": "downloaded",
        "note": concat!(
            "These files are already on this computer. ",
            "The first row is the newest download. ",
            "A new id is {vehicle}/{sha256_16}_{YYYYMMDDHHMMSS}_{onboard_id}.bin. ",
            "sha256_16 is the hash of the file contents when the name carries it. ",
            "vehicle is the directory, the boot uid used when the file was stored. ",
            "A file loaded from this computer uses the boot uid written in that log. ",
            "A log with no boot uid is stored under imported. ",
            "The stamp is the flight time in UTC, or the vehicle log time when the file has no GPS time. ",
            "onboard_id is the number on the vehicle, and the hash is the file contents, so the same onboard number does not replace a different recording. ",
            "Older files may still be named {sha256_16}-{onboard_id}.bin, log-#####.bin, or any user-provided name. ",
            "A log-##### name has no sha256_16. ",
            "saved_at is when it was stored here. ",
            "flight_utc is the first GPS time in the file, or null. ",
            "This is not the on-board list; that is vehicle_logs.",
        ),
        "logs": rows,
    })
}

const IMPORT_LIMIT: usize = 512 * 1024 * 1024;

/// Store a DataFlash file the user picked. The same bytes keep the id they already have.
pub fn import_log(bytes: &[u8]) -> Result<Value, String> {
    if bytes.len() < 3 || bytes[0] != HEAD1 || bytes[1] != HEAD2 {
        return Err("This file is not a DataFlash log.".into());
    }
    if bytes.len() > IMPORT_LIMIT {
        return Err("This log is larger than 512 MB.".into());
    }
    let name = downloaded_log_name(0, bytes, 0);
    let hash = name.split('_').next().unwrap_or("");
    if let Some(id) = find_stored_hash(hash) {
        return Ok(json!({ "ok": true, "id": id }));
    }
    let vehicle = vehicle_dir(bytes);
    let dir = logs_root().join(&vehicle);
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let path = dir.join(&name);
    fs::write(&path, bytes).map_err(|err| err.to_string())?;
    Ok(json!({ "ok": true, "id": format!("{vehicle}/{name}") }))
}

/// Directory name for a file the user loaded. The boot uid is the one written
/// in the log, the same line the board sends at startup.
fn vehicle_dir(bytes: &[u8]) -> String {
    let formats = parse_formats(bytes);
    let mut uid = String::new();
    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        if !uid.is_empty() || fmt.name != "MSG" {
            return;
        }
        let Some(text) = field_str(fmt, values, "Message") else { return };
        if let Some(found) = system_uid(&text) {
            uid = found;
        }
    }, &mut incomplete);
    let key: String = uid.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if key.is_empty() { "imported".to_string() } else { key }
}

fn system_uid(message: &str) -> Option<String> {
    let mut words = message.split_whitespace();
    let name = words.next()?;
    if !name.contains('_') || name.len() > 64 {
        return None;
    }
    let uid: String = words
        .filter(|part| part.len() >= 4 && part.len() <= 16 && part.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .collect();
    if uid.is_empty() { None } else { Some(uid) }
}

fn find_stored_hash(hash: &str) -> Option<String> {
    if hash.len() != 16 {
        return None;
    }
    let root = logs_root();
    for vehicle in fs::read_dir(&root).ok()?.flatten() {
        for file in fs::read_dir(vehicle.path()).ok()?.flatten() {
            let name = file.file_name();
            let name = name.to_string_lossy();
            let mark = name.as_bytes().get(hash.len()).copied();
            if name.starts_with(hash) && (mark == Some(b'_') || mark == Some(b'-')) && name.ends_with(".bin") {
                let path = file.path();
                let rel = path.strip_prefix(&root).ok()?;
                return Some(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    None
}

/// Open the system file browser with this downloaded log selected.
pub fn reveal(id: &str) -> Result<(), String> {
    let path = resolve(id)?;
    reveal_path(&path).map_err(|err| err.to_string())
}

#[cfg(windows)]
fn reveal_path(path: &std::path::Path) -> std::io::Result<()> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .spawn()
        .map(|_| ())
}

#[cfg(not(windows))]
fn reveal_path(path: &std::path::Path) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(path);
    std::process::Command::new("xdg-open").arg(dir).spawn().map(|_| ())
}

pub fn resolve(id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.contains("..") || id.contains(':') || id.starts_with('/') || id.starts_with('\\') {
        return Err("log id is not in local storage".into());
    }
    let path = logs_root().join(id);
    if path.extension().and_then(|e| e.to_str()) != Some("bin") {
        return Err("log id is not in local storage".into());
    }
    let root = logs_root().canonicalize().map_err(|_| "log not found".to_string())?;
    let full = path.canonicalize().map_err(|_| "log not found".to_string())?;
    if !full.starts_with(&root) {
        return Err("log id is not in local storage".into());
    }
    Ok(full)
}

pub fn file_hash(id: &str) -> Option<String> {
    let bytes = read_id(id).ok()?;
    let mut hash = Sha256::new();
    hash.update(&bytes);
    Some(hex_prefix(&hash.finalize()))
}

pub fn inspect(id: &str) -> Value {
    let path = match resolve(id) {
        Ok(path) => path,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => return json!({ "ok": false, "error": error.to_string() }),
    };
    let formats = parse_formats(&bytes);
    let mut counts: BTreeMap<String, u64> = BTreeMap::new();
    let mut first_us: Option<u64> = None;
    let mut last_us: Option<u64> = None;
    let mut incomplete = false;
    walk(&bytes, &formats, |fmt, _body, values| {
        *counts.entry(fmt.name.clone()).or_insert(0) += 1;
        if let Some(us) = time_us(fmt, values) {
            first_us.get_or_insert(us);
            last_us = Some(us);
        }
    }, &mut incomplete);
    let logging = logging_of(&bytes);
    let mut hash = Sha256::new();
    hash.update(&bytes);
    let digest = hex_prefix(&hash.finalize());
    let names: Vec<_> = formats.values().map(|f| f.name.clone()).collect();
    let (modes, armed) = flight_intervals(&bytes);
    json!({
        "ok": true,
        "id": id,
        "bytes": bytes.len(),
        "sha256_16": digest,
        "messages": names.len(),
        "names": names,
        "counts": counts,
        "first_us": first_us,
        "last_us": last_us,
        "duration_s": match (first_us, last_us) {
            (Some(a), Some(b)) if b >= a => json!((b - a) as f64 / 1_000_000.0),
            _ => Value::Null,
        },
        "tail_incomplete": incomplete,
        "logging": logging,
        "modes": modes,
        "armed": armed,
        "limits": { "query_rows": 200, "fft_samples": 8192 },
        "note": concat!(
            "modes and armed are intervals. ",
            "Each item is state, start_us, end_us, start_s, and end_s. ",
            "state is the number stored in the log, not a flight-mode name. ",
            "An empty list means that message has no rows. ",
            "A later interval with the same state is a separate stretch. ",
            "start_us and end_us are the bounds of that stretch. ",
            "The flight in a mode is the overlap of that mode interval and an armed interval. ",
            "A later compute that passes wider bounds returns that wider interval, not this stretch. ",
            "A count of zero means that message was not written. ",
            "It does not say the vehicle cannot estimate that quantity, and it does not say another message's controller was off. ",
            "tail_incomplete true means the file ended inside a message. ",
            "logging carries its own note.",
        ),
    })
}

/// DSF over the whole file. Dp counts writes the backend rejected since this log started.
fn logging_of(bytes: &[u8]) -> Value {
    let formats = parse_formats(bytes);
    let mut rows = 0u64;
    let mut first = None;
    let mut last = None;
    let mut rose = true;
    let mut fmn_min = None;
    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        if fmt.name != "DSF" {
            return;
        }
        rows += 1;
        let Some(dp) = field_u64(fmt, values, "Dp") else { return };
        if last.is_some_and(|prev| dp < prev) {
            rose = false;
        }
        first.get_or_insert(dp);
        last = Some(dp);
        if let Some(fmn) = field_u64(fmt, values, "FMn") {
            fmn_min = Some(fmn_min.map_or(fmn, |have: u64| have.min(fmn)));
        }
    }, &mut incomplete);
    if rows == 0 {
        return json!({
            "message": "DSF",
            "rows": 0,
            "note": concat!(
                "DSF was not written. ",
                "Rejected writes are unknown. ",
                "That is not a count of zero.",
            ),
        });
    }
    let increase = if rose {
        match (first, last) {
            (Some(a), Some(b)) if b >= a => Value::from(b - a),
            _ => Value::Null,
        }
    } else {
        Value::Null
    };
    let mut note = String::from(concat!(
        "Dp is the number of writes the backend rejected, counted since this log started. ",
        "dp_first is that count on the first DSF row. ",
        "dp_last is that count on the last DSF row. ",
        "dp_increase is dp_last minus dp_first when the counter did not fall. ",
        "It does not name which message was rejected. ",
        "It does not say the storage failed. ",
        "An increase of zero does not mean every requested message is in the file. ",
        "FMn is the minimum free space in the write buffer during that DSF period, in bytes. ",
        "fmn_min is the smallest of those. ",
        "It does not name a full buffer, and it does not name a parameter. ",
        "These figures cover the whole file. ",
        "An interval of DSF is a log_compute on that message.",
    ));
    if !rose {
        note.push_str(" dp_increase is absent because the counter fell. The first and last counts are still dp_first and dp_last.");
    }
    json!({
        "message": "DSF",
        "rows": rows,
        "dp_first": first,
        "dp_last": last,
        "dp_increase": increase,
        "fmn_min": fmn_min,
        "note": note,
    })
}

fn flight_intervals(bytes: &[u8]) -> (Value, Value) {
    let formats = parse_formats(bytes);
    let mut modes: Vec<(u64, i64)> = Vec::new();
    let mut armed: Vec<(u64, i64)> = Vec::new();
    let mut last_us = None;
    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        let Some(us) = time_us(fmt, values) else { return };
        last_us = Some(us);
        let fields: &[&str] = if fmt.name == "MODE" { &["ModeNum", "Mode"] } else if fmt.name == "ARM" { &["ArmState"] } else { return };
        let Some(state) = fields.iter().find_map(|label| field_f64(fmt, values, label)).filter(|n| n.is_finite()) else { return };
        let state = state.round() as i64;
        let events = if fmt.name == "MODE" { &mut modes } else { &mut armed };
        if events.last().is_some_and(|(_, kept)| *kept == state) {
            return;
        }
        events.push((us, state));
    }, &mut incomplete);
    (phase_rows(&modes, last_us), phase_rows(&armed, last_us))
}

fn phase_rows(events: &[(u64, i64)], last_us: Option<u64>) -> Value {
    if events.is_empty() {
        return json!([]);
    }
    let end_default = last_us.unwrap_or(events[events.len() - 1].0);
    let rows: Vec<Value> = events.iter().enumerate().map(|(i, (start, state))| {
        let end = events.get(i + 1).map(|(us, _)| *us).unwrap_or(end_default.max(*start));
        json!({
            "state": state,
            "start_us": start,
            "end_us": end,
            "start_s": (*start as f64 / 1_000_000.0 * 100.0).round() / 100.0,
            "end_s": (end as f64 / 1_000_000.0 * 100.0).round() / 100.0,
        })
    }).collect();
    Value::Array(rows)
}

pub fn schema(id: &str, message: &str) -> Value {
    if let Some(error) = missing_message(message) {
        return error;
    }
    let bytes = match read_id(id) {
        Ok(bytes) => bytes,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let formats = parse_formats(&bytes);
    let Some(fmt) = formats.values().find(|f| f.name.eq_ignore_ascii_case(message)) else {
        return json!({ "ok": false, "error": "message is not in this log", "known": false });
    };
    let units = column_units(&bytes, message);
    let fields: Vec<_> = fmt.labels.iter().zip(fmt.format.chars()).map(|(label, kind)| {
        json!({
            "name": label,
            "format": kind.to_string(),
            "type": type_name(kind),
            "unit": units.get(label).cloned(),
        })
    }).collect();
    json!({
        "ok": true,
        "message": fmt.name,
        "length": fmt.length,
        "fields": fields,
        "note": concat!(
            "unit is the name this log recorded for that column. ",
            "Null means the log named no unit. ",
            "A unit that was not recorded is unknown.",
        ),
    })
}

fn round_logged(value: &Value) -> Value {
    if value.as_i64().is_some() || value.as_u64().is_some() {
        return value.clone();
    }
    let Some(number) = value.as_f64() else {
        return value.clone();
    };
    if !number.is_finite() {
        return Value::Null;
    }
    let text = format!("{number:.4}");
    let trimmed = match text.split_once('.') {
        Some((whole, frac)) => {
            let frac = frac.trim_end_matches('0');
            if frac.is_empty() { whole.to_string() } else { format!("{whole}.{frac}") }
        }
        None => text,
    };
    serde_json::from_str(&trimmed).unwrap_or(Value::Null)
}

pub fn query(id: &str, message: &str, start_us: Option<u64>, end_us: Option<u64>, cursor: u64, limit: u64) -> Value {
    if let Some(error) = missing_message(message) {
        return error;
    }
    let bytes = match read_id(id) {
        Ok(bytes) => bytes,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let formats = parse_formats(&bytes);
    let Some(wanted) = formats.values().find(|f| f.name.eq_ignore_ascii_case(message)).map(|f| f.name.clone()) else {
        return json!({ "ok": false, "error": "message is not in this log" });
    };
    let limit = limit.clamp(1, 500);
    let mut seen = 0u64;
    let mut rows = Vec::new();
    let mut incomplete = false;
    walk(&bytes, &formats, |fmt, _body, values| {
        if fmt.name != wanted {
            return;
        }
        if let Some(us) = time_us(fmt, values) {
            if start_us.is_some_and(|s| us < s) || end_us.is_some_and(|e| us > e) {
                return;
            }
        }
        if seen >= cursor && (seen - cursor) < limit {
            let mut row = serde_json::Map::new();
            for (label, value) in fmt.labels.iter().zip(values.iter()) {
                row.insert(label.clone(), round_logged(value));
            }
            rows.push(Value::Object(row));
        }
        seen += 1;
    }, &mut incomplete);
    let returned = rows.len() as u64;
    json!({
        "ok": true,
        "message": wanted,
        "matched": seen,
        "returned": returned,
        "cursor": cursor,
        "next_cursor": cursor + returned,
        "truncated": cursor + returned < seen,
        "tail_incomplete": incomplete,
        "rows": rows,
        "note": concat!(
            "truncated true means more rows remain. ",
            "next_cursor is where the next page starts. ",
            "tail_incomplete true means the file ended inside a message. ",
            "A float is rounded to 4 decimal places. In metres that is 0.1 mm. An integer is unchanged.",
        ),
    })
}

/// Values recorded in the file's PARM rows. The live set is `list_params`.
pub fn log_params(id: &str, names: &[String]) -> Value {
    if names.is_empty() {
        return json!({ "ok": false, "error": "names is required" });
    }
    if names.len() > 40 {
        return json!({ "ok": false, "error": "at most 40 names" });
    }
    let bytes = match read_id(id) {
        Ok(bytes) => bytes,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    parm_bytes(&bytes, names)
}

fn parm_bytes(bytes: &[u8], names: &[String]) -> Value {
    let formats = parse_formats(bytes);
    let Some(wanted) = formats.values().find(|fmt| fmt.name == "PARM").map(|fmt| fmt.name.clone()) else {
        return json!({ "ok": false, "error": "PARM is not in this log", "known": false });
    };
    struct Seen {
        first: f64,
        last: f64,
        count: u32,
    }
    let mut found: BTreeMap<String, Seen> = BTreeMap::new();
    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        if fmt.name != wanted {
            return;
        }
        let Some(name) = field_str(fmt, values, "Name") else { return };
        let Some(value) = field_f64(fmt, values, "Value").filter(|value| value.is_finite()) else { return };
        found.entry(name).and_modify(|seen| {
            seen.last = value;
            seen.count += 1;
        }).or_insert(Seen { first: value, last: value, count: 1 });
    }, &mut incomplete);
    let params: Vec<_> = names.iter().map(|name| match found.get(name) {
        Some(seen) => json!({
            "name": name,
            "known": true,
            "value": seen.last,
            "first": seen.first,
            "changed": seen.first != seen.last,
            "count": seen.count,
        }),
        None => json!({ "name": name, "known": false }),
    }).collect();
    json!({
        "ok": true,
        "source": "parm",
        "params": params,
        "tail_incomplete": incomplete,
        "note": concat!(
            "value is the last PARM row for that name in this file. ",
            "first is the first row. ",
            "changed true means they differ. ",
            "This is the value recorded in the log, not the live set from list_params or get_param. ",
            "known false means that name was not written into this file.",
        ),
    })
}

pub fn compute(id: &str, message: &str, field: &str, op: &str, start_us: Option<u64>, end_us: Option<u64>) -> Value {
    if let Some(error) = missing_message(message) {
        return error;
    }
    if field.trim().is_empty() {
        return json!({ "ok": false, "error": "field is required." });
    }
    if op.trim().is_empty() {
        return json!({ "ok": false, "error": "op is required: min, max, mean, rms, count, fft, track, or frf." });
    }
    if op.eq_ignore_ascii_case("frf") {
        let bytes = match read_id(id) {
            Ok(bytes) => bytes,
            Err(error) => return json!({ "ok": false, "error": error }),
        };
        return frf_bytes(&bytes, message, field, start_us, end_us);
    }
    if op.eq_ignore_ascii_case("track") {
        let bytes = match read_id(id) {
            Ok(bytes) => bytes,
            Err(error) => return json!({ "ok": false, "error": error }),
        };
        return track_bytes(&bytes, message, field, start_us, end_us);
    }
    if op.eq_ignore_ascii_case("fft") && gyro_spectrum_request(message, field) {
        let batch = gyro_batch_fft(id);
        if batch.get("ok").and_then(Value::as_bool) == Some(true) {
            return batch;
        }
    }
    let bytes = match read_id(id) {
        Ok(bytes) => bytes,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let formats = parse_formats(&bytes);
    let Some(wanted) = formats.values().find(|f| f.name.eq_ignore_ascii_case(message)).map(|f| f.name.clone()) else {
        return json!({ "ok": false, "error": "message is not in this log" });
    };
    let mut samples: Vec<(u64, f64)> = Vec::new();
    let mut missing_field = true;
    let mut incomplete = false;
    walk(&bytes, &formats, |fmt, _body, values| {
        if fmt.name != wanted {
            return;
        }
        let Some(idx) = fmt.labels.iter().position(|l| l == field) else { return };
        missing_field = false;
        let Some(us) = time_us(fmt, values) else { return };
        if start_us.is_some_and(|s| us < s) || end_us.is_some_and(|e| us > e) {
            return;
        }
        if let Some(n) = values.get(idx).and_then(Value::as_f64) {
            if n.is_finite() {
                samples.push((us, n));
            }
        }
    }, &mut incomplete);
    if missing_field {
        return json!({ "ok": false, "error": "field is not in this message" });
    }
    if samples.is_empty() {
        return json!({ "ok": true, "op": op, "count": 0, "note": "No finite samples in the requested interval." });
    }
    match op {
        "min" | "max" | "mean" | "rms" | "count" => {
            let mut out = stats(&samples, op, incomplete);
            let units = column_units(&bytes, &wanted);
            out["unit"] = units.get(field).cloned().map(Value::String).unwrap_or(Value::Null);
            out
        }
        "fft" => fft_peak(&samples, incomplete),
        _ => json!({ "ok": false, "error": "op must be min, max, mean, rms, count, fft, track, or frf" }),
    }
}

fn stats(samples: &[(u64, f64)], op: &str, incomplete: bool) -> Value {
    let n = samples.len() as f64;
    let min = samples.iter().map(|s| s.1).fold(f64::INFINITY, f64::min);
    let max = samples.iter().map(|s| s.1).fold(f64::NEG_INFINITY, f64::max);
    let sum: f64 = samples.iter().map(|s| s.1).sum();
    let mean = sum / n;
    let rms = (samples.iter().map(|s| s.1 * s.1).sum::<f64>() / n).sqrt();
    let value = match op {
        "min" => min,
        "max" => max,
        "mean" => mean,
        "rms" => rms,
        _ => n,
    };
    json!({
        "ok": true,
        "op": op,
        "count": samples.len(),
        "value": value,
        "min": min,
        "max": max,
        "mean": mean,
        "rms": rms,
        "tail_incomplete": incomplete,
        "note": concat!(
            "min and max are the two extremes of this series. ",
            "The amplitude is the larger of their absolute values, not whichever of min or max was requested. ",
            "unit is the name this log recorded for the column. ",
            "Null means the log named no unit. ",
            "A unit that was not recorded is unknown.",
        ),
    })
}

const CHART_AXES: usize = 2;
const CHART_LINES: usize = 8;

struct ChartLine {
    message: String,
    field: String,
    name: String,
    axis: usize,
    axis_label: String,
    samples: Vec<(f64, f64)>,
}

/// Time series for a user chart. x is TimeUS in seconds. Every finite sample in the interval is drawn.
pub fn chart(id: &str, spec: &Value) -> Value {
    if id.is_empty() {
        return json!({ "ok": false, "error": "file is required. file is an id from list_logs, or local.id from vehicle_logs." });
    }
    let bytes = match read_id(id) {
        Ok(bytes) => bytes,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    chart_bytes(&bytes, spec)
}

fn chart_bytes(bytes: &[u8], spec: &Value) -> Value {
    let mut lines = match chart_lines(spec) {
        Ok(lines) => lines,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let formats = parse_formats(bytes);
    let mut absent = Vec::new();
    for line in &mut lines {
        let Some(fmt) = formats.values().find(|fmt| fmt.name.eq_ignore_ascii_case(&line.message)) else {
            absent.push(format!("{} is not in this log", line.message));
            continue;
        };
        if !fmt.labels.iter().any(|label| label.eq_ignore_ascii_case(&line.field)) {
            absent.push(format!("{}.{} is not in this log", fmt.name, line.field));
        }
        line.message = fmt.name.clone();
    }
    let start_us = spec.get("start_us").and_then(|v| v.as_u64());
    let end_us = spec.get("end_us").and_then(|v| v.as_u64());
    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        let Some(us) = time_us(fmt, values) else { return };
        if start_us.is_some_and(|s| us < s) || end_us.is_some_and(|e| us > e) {
            return;
        }
        let t = (us as f64 / 1_000_000.0 * 1000.0).round() / 1000.0;
        for line in &mut lines {
            if !fmt.name.eq_ignore_ascii_case(&line.message) {
                continue;
            }
            let Some(y) = field_f64(fmt, values, &line.field).filter(|n| n.is_finite()) else { continue };
            line.samples.push((t, (y * 10_000.0).round() / 10_000.0));
        }
    }, &mut incomplete);
    let title = spec.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
    let mut axes_out = Vec::new();
    let mut drawn = 0usize;
    let axis_count = lines.iter().map(|line| line.axis).max().unwrap_or(0) + 1;
    for axis in 0..axis_count {
        let label = lines.iter().find(|line| line.axis == axis).map(|line| line.axis_label.clone()).unwrap_or_default();
        let mut series = Vec::new();
        for line in lines.iter().filter(|line| line.axis == axis) {
            if line.samples.is_empty() {
                continue;
            }
            let (x, y): (Vec<f64>, Vec<f64>) = line.samples.iter().copied().unzip();
            drawn += 1;
            series.push(json!({
                "name": line.name,
                "message": line.message,
                "field": line.field,
                "x": x,
                "y": y,
            }));
        }
        if !series.is_empty() {
            axes_out.push(json!({ "label": label, "lines": series }));
        }
    }
    if drawn == 0 {
        let why = if absent.is_empty() { "No samples in this interval.".to_string() } else { absent.join(". ") };
        return json!({ "ok": false, "error": why });
    }
    let mut note = String::from(concat!(
        "The chart is drawn under the reply. ",
        "x is TimeUS in seconds. ",
        "Each line is that field on that message. ",
        "points is how many samples are drawn. ",
        "That count is every finite sample of that field in the interval. ",
        "y_min and y_max are the smallest and largest value drawn on that line. ",
        "x_min and x_max are the earliest and latest time drawn, in seconds. ",
        "The samples themselves are not in this text. ",
    ));
    if !absent.is_empty() {
        note.push_str(&absent.join(". "));
        note.push_str(". A field that is not in the log is not drawn.");
    }
    let mut out = json!({
        "ok": true,
        "title": title,
        "chart": {
            "title": title,
            "x_label": "s",
            "axes": axes_out,
        },
        "note": note,
    });
    if let Some(slug) = chart_slug(spec) {
        out["slug"] = json!(slug);
        out["chart"]["slug"] = json!(slug);
    }
    out
}

fn chart_slug(spec: &Value) -> Option<String> {
    spec.get("slug").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn chart_lines(spec: &Value) -> Result<Vec<ChartLine>, String> {
    let Some(axes) = spec.get("axes").and_then(|v| v.as_array()) else {
        return Err("axes is required. Each axis has a label and lines.".into());
    };
    if axes.is_empty() {
        return Err("axes is required. Each axis has a label and lines.".into());
    }
    if axes.len() > CHART_AXES {
        return Err(format!("at most {CHART_AXES} axes"));
    }
    let mut lines = Vec::new();
    for (axis, item) in axes.iter().enumerate() {
        let label = item.get("label").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let Some(series) = item.get("lines").and_then(|v| v.as_array()) else {
            return Err("each axis needs lines. A line has message and field.".into());
        };
        if series.is_empty() {
            return Err("each axis needs lines. A line has message and field.".into());
        }
        for series in series {
            let message = series.get("message").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            let field = series.get("field").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            if message.is_empty() || field.is_empty() {
                return Err("a line needs message and field.".into());
            }
            let name = series.get("name").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{message}.{field}"));
            lines.push(ChartLine { message, field, name, axis, axis_label: label.clone(), samples: Vec::new() });
        }
    }
    if lines.len() > CHART_LINES {
        return Err(format!("at most {CHART_LINES} lines"));
    }
    Ok(lines)
}

