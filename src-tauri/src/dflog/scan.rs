// Per-file scan for the Logs table: header, armed time, flags, and the parameter set
// used for changes against the previous log. Cached in .facts.json (scan) and
// .params/{hash}.json, both rebuilt from the file when it changes.

/// One writer at a time for .facts.json: the list and the scan both rewrite it.
static FACTS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Bump when the scan's shape or rules change, so cached scans are read again.
const SCAN_VERSION: u64 = 1;

/// LogErrorSubsystem in libraries/AP_Logger/AP_Logger.h.
fn err_subsystem(code: u64) -> &'static str {
    match code {
        1 => "Main",
        2 => "Radio",
        3 => "Compass",
        5 => "Radio failsafe",
        6 => "Battery failsafe",
        7 => "GPS failsafe",
        8 => "GCS failsafe",
        9 => "Fence",
        10 => "Flight mode",
        11 => "GPS",
        12 => "Crash check",
        13 => "Flip",
        15 => "Parachute",
        16 => "EKF check",
        17 => "EKF failsafe",
        18 => "Baro",
        19 => "CPU",
        20 => "ADSB failsafe",
        21 => "Terrain",
        22 => "Navigation",
        23 => "Terrain failsafe",
        24 => "EKF primary changed",
        25 => "Thrust loss",
        26 => "Sensor failsafe",
        27 => "Leak failsafe",
        28 => "Pilot input",
        29 => "Vibration failsafe",
        30 => "Internal error",
        31 => "Dead reckoning failsafe",
        _ => "Error",
    }
}

fn err_kind(subsystem: u64) -> &'static str {
    match subsystem {
        12 => "crash",
        6 => "batt",
        5 | 7 | 8 | 9 | 17 | 20 | 23 | 26 | 27 | 29 | 31 => "fs",
        _ => "err",
    }
}

struct FlagTally {
    count: u64,
    first_s: f64,
    texts: Vec<String>,
}

/// Header, armed time, flights, flags and the parameter set of one log.
fn scan_bytes(bytes: &[u8]) -> (Value, BTreeMap<String, f64>) {
    let summary = summarize_log(bytes, &[]);
    let formats = parse_formats(bytes);
    let mut first_us: Option<u64> = None;
    let mut arm_events: Vec<(u64, bool)> = Vec::new();
    let mut has_arm = false;
    let mut has_ev = false;
    let mut flags: BTreeMap<&'static str, FlagTally> = BTreeMap::new();
    let mut clip_first: BTreeMap<String, f64> = BTreeMap::new();
    let mut clip_last: BTreeMap<String, f64> = BTreeMap::new();
    let mut params: BTreeMap<String, f64> = BTreeMap::new();
    let mut last_us = None;
    let mut incomplete = false;
    walk(bytes, &formats, |fmt, _, values| {
        let us = time_us(fmt, values);
        if let Some(us) = us {
            first_us.get_or_insert(us);
            last_us = Some(us);
        }
        let at = |us: Option<u64>| match (us, first_us) {
            (Some(us), Some(origin)) if us >= origin => ((us - origin) as f64 / 1_000_000.0 * 10.0).round() / 10.0,
            _ => 0.0,
        };
        match fmt.name.as_str() {
            "ARM" => {
                has_arm = true;
                if let (Some(us), Some(state)) = (us, field_f64(fmt, values, "ArmState")) {
                    arm_events.push((us, state.round() as i64 == 1));
                }
            }
            "EV" if !has_arm => {
                if let (Some(us), Some(id)) = (us, field_u64(fmt, values, "Id")) {
                    if id == 10 || id == 11 {
                        has_ev = true;
                        arm_events.push((us, id == 10));
                    }
                }
            }
            "ERR" => {
                let subsystem = field_u64(fmt, values, "Subsys").unwrap_or(0);
                let code = field_u64(fmt, values, "ECode").unwrap_or(0);
                if code == 0 {
                    return;
                }
                let kind = err_kind(subsystem);
                let when = at(us);
                let entry = flags.entry(kind).or_insert(FlagTally { count: 0, first_s: when, texts: Vec::new() });
                entry.count += 1;
                let text = format!("{} ({code})", err_subsystem(subsystem));
                if !entry.texts.contains(&text) && entry.texts.len() < 6 {
                    entry.texts.push(text);
                }
            }
            "VIBE" => {
                let instance = field_u64(fmt, values, "IMU").map(|n| n.to_string()).unwrap_or_default();
                for label in ["Clip", "Clip0", "Clip1", "Clip2"] {
                    if let Some(value) = field_f64(fmt, values, label) {
                        let key = format!("{instance}{label}");
                        clip_first.entry(key.clone()).or_insert(value);
                        clip_last.insert(key, value);
                    }
                }
            }
            "PARM" => {
                if let (Some(name), Some(value)) = (field_str(fmt, values, "Name"), field_f64(fmt, values, "Value")) {
                    if value.is_finite() {
                        params.insert(name, value);
                    }
                }
            }
            _ => {}
        }
    }, &mut incomplete);

    let clip_rise: f64 = clip_last.iter().map(|(key, last)| (last - clip_first.get(key).copied().unwrap_or(*last)).max(0.0)).sum();
    if clip_rise > 0.0 {
        flags.insert("clip", FlagTally { count: 0, first_s: 0.0, texts: vec![format!("Vibration clipping rose by {}", clip_rise.round())] });
    }

    // Armed intervals: from an arming event to the next disarm, or to the end of the file.
    let mut armed_us = 0u64;
    let mut flights = 0u64;
    let mut since: Option<u64> = None;
    for (us, armed) in &arm_events {
        match (*armed, since) {
            (true, None) => {
                since = Some(*us);
                flights += 1;
            }
            (false, Some(start)) => {
                armed_us += us.saturating_sub(start);
                since = None;
            }
            _ => {}
        }
    }
    if let (Some(start), Some(end)) = (since, last_us) {
        armed_us += end.saturating_sub(start);
    }
    // No ARM and no arming EV in a log that has those formats means it never armed.
    let knows_arming = has_arm || has_ev || formats.values().any(|fmt| fmt.name == "ARM");

    let order = ["crash", "err", "fs", "batt", "clip"];
    let flag_rows: Vec<Value> = order
        .iter()
        .filter_map(|kind| flags.get(kind).map(|tally| json!({
            "kind": kind,
            "count": tally.count,
            "at_s": tally.first_s,
            "text": tally.texts.join(" · "),
        })))
        .collect();

    let value = json!({
        "version": SCAN_VERSION,
        "firmware": summary.firmware,
        "frame": summary.frame,
        "start_utc": summary.start_utc,
        "duration_us": summary.duration_us,
        "armed_s": if knows_arming { json!((armed_us as f64 / 1_000_000.0).round()) } else { Value::Null },
        "flights": if knows_arming { json!(flights) } else { Value::Null },
        "flags": flag_rows,
        "params": params.len(),
        "tail_incomplete": incomplete,
    });
    (value, params)
}

fn params_dir() -> PathBuf {
    logs_root().join(".params")
}

fn stored_params(hash: &str) -> Option<BTreeMap<String, f64>> {
    let raw = fs::read(params_dir().join(format!("{hash}.json"))).ok()?;
    serde_json::from_slice(&raw).ok()
}

/// The content key of a stored log: the hash in its name, or the hash of its bytes.
fn content_hash(id: &str, fact: &Value) -> Option<String> {
    let name = id.rsplit(['/', '\\']).next().unwrap_or(id);
    let head = name.get(..16).unwrap_or("");
    let mark = name.as_bytes().get(16).copied();
    if is_hex16(head) && (mark == Some(b'_') || mark == Some(b'-')) {
        return Some(head.to_ascii_lowercase());
    }
    if let Some(hash) = fact["hash"].as_str() {
        return Some(hash.to_string());
    }
    file_hash(id)
}

/// Scans one stored log and caches the result. Returns the scan.
pub fn scan_log(id: &str) -> Value {
    let path = match resolve(id) {
        Ok(path) => path,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => return json!({ "ok": false, "error": error.to_string() }),
    };
    let (scan, params) = scan_bytes(&bytes);
    let mut digest = Sha256::new();
    digest.update(&bytes);
    let hash = hex_prefix(&digest.finalize());
    let _ = fs::create_dir_all(params_dir());
    let _ = fs::write(params_dir().join(format!("{hash}.json")), serde_json::to_vec(&params).unwrap_or_default());
    let meta = fs::metadata(&path).ok();
    let mtime = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    {
        let _guard = FACTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut facts = read_facts();
        let entry = facts.entry(id.to_string()).or_insert_with(|| json!({}));
        if let Some(obj) = entry.as_object_mut() {
            obj.insert("bytes".into(), json!(bytes.len()));
            obj.insert("mtime".into(), json!(mtime));
            obj.insert("hash".into(), json!(hash));
            obj.insert("scan".into(), scan.clone());
        }
        let _ = fs::write(facts_path(), Value::Object(facts).to_string());
    }
    json!({ "ok": true, "id": id, "hash": hash, "scan": scan })
}

fn param_changes(before: &BTreeMap<String, f64>, after: &BTreeMap<String, f64>) -> Vec<Value> {
    after
        .iter()
        .filter(|(name, _)| !boot_written(name))
        .filter_map(|(name, value)| {
            let old = before.get(name)?;
            let same = (old - value).abs() <= 1e-6 * old.abs().max(value.abs()).max(1.0);
            (!same).then(|| json!({ "name": name, "from": old, "to": value }))
        })
        .collect()
}

/// Parameters the firmware writes itself at boot or in flight (ground pressure, calibration
/// temperatures, counters). A change in them is not a change the user made.
fn boot_written(name: &str) -> bool {
    name.starts_with("STAT_")
        || name.ends_with("_GND_PRESS")
        || name.ends_with("_GND_TEMP")
        || name.contains("CALTEMP")
        || matches!(name, "GND_ABS_PRESS" | "GND_TEMP" | "SYS_NUM_RESETS")
}

fn firmware_version(firmware: &str) -> String {
    firmware.split_whitespace().nth(1).unwrap_or(firmware).trim_start_matches('V').to_string()
}

/// The stored logs for the Logs table: list_logs rows plus scan, hash, star, note,
/// and changes against the previous log from the same board.
pub fn local_logs() -> Value {
    let listed = {
        let _guard = FACTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        list_logs()
    };
    let facts = read_facts();
    let notes = crate::db::log_notes().unwrap_or_default();
    let mut rows: Vec<Value> = listed["logs"].as_array().cloned().unwrap_or_default();
    let mut hashed = false;
    for row in rows.iter_mut() {
        let id = row["id"].as_str().unwrap_or("").to_string();
        let fact = facts.get(&id).cloned().unwrap_or(Value::Null);
        let hash = content_hash(&id, &fact);
        if hash.is_some() && fact["hash"].is_null() && !is_hex16(id.rsplit('/').next().unwrap_or("").get(..16).unwrap_or("")) {
            hashed = true;
        }
        let scan = fact.get("scan").filter(|s| s["version"].as_u64() == Some(SCAN_VERSION)).cloned().unwrap_or(Value::Null);
        let (star, note, updated) = hash.as_ref().and_then(|h| notes.get(h)).cloned().unwrap_or((false, String::new(), 0));
        if let Some(obj) = row.as_object_mut() {
            obj.insert("hash".into(), json!(hash));
            obj.insert("vehicle".into(), json!(id.split('/').next().unwrap_or("")));
            obj.insert("scan".into(), scan);
            obj.insert("star".into(), json!(star));
            obj.insert("note".into(), json!(note));
            obj.insert("note_at".into(), json!(updated));
        }
    }
    if hashed {
        // Remember hashes worked out from file bytes, so the next list does not read the files again.
        let _guard = FACTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut fresh = read_facts();
        for row in &rows {
            if let (Some(id), Some(hash)) = (row["id"].as_str(), row["hash"].as_str()) {
                if let Some(obj) = fresh.get_mut(id).and_then(Value::as_object_mut) {
                    obj.entry("hash").or_insert(json!(hash));
                }
            }
        }
        let _ = fs::write(facts_path(), Value::Object(fresh).to_string());
    }

    // Changes: each scanned log against the scanned log before it from the same board.
    // Order by the flight stamp in the name, then the time it was saved.
    let order_key = |row: &Value| -> (String, String, String) {
        let stamp = row["flight_stamp"].as_str().unwrap_or("").to_string();
        let flight = row["flight_utc"].as_str().unwrap_or("").to_string();
        let saved = row["saved_at"].as_str().unwrap_or("").to_string();
        (stamp, flight, saved)
    };
    let mut by_vehicle: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, row) in rows.iter().enumerate() {
        if row["scan"].is_object() {
            by_vehicle.entry(row["vehicle"].as_str().unwrap_or("").to_string()).or_default().push(i);
        }
    }
    let mut changes: Vec<(usize, Value)> = Vec::new();
    for (vehicle, mut list) in by_vehicle {
        if vehicle == "imported" {
            continue;
        }
        list.sort_by_key(|i| order_key(&rows[*i]));
        for pair in list.windows(2) {
            let (prev, cur) = (&rows[pair[0]], &rows[pair[1]]);
            let (Some(ph), Some(ch)) = (prev["hash"].as_str(), cur["hash"].as_str()) else { continue };
            if ph == ch {
                continue;
            }
            let params = match (stored_params(ph), stored_params(ch)) {
                (Some(before), Some(after)) => param_changes(&before, &after),
                _ => Vec::new(),
            };
            let fw_before = firmware_version(prev["scan"]["firmware"].as_str().unwrap_or(""));
            let fw_after = firmware_version(cur["scan"]["firmware"].as_str().unwrap_or(""));
            let firmware = if !fw_before.is_empty() && !fw_after.is_empty() && fw_before != fw_after {
                json!({ "from": fw_before, "to": fw_after })
            } else {
                Value::Null
            };
            changes.push((pair[1], json!({
                "since": prev["id"],
                "since_onboard": prev["onboard_id"],
                "count": params.len(),
                "params": params.into_iter().take(60).collect::<Vec<_>>(),
                "firmware": firmware,
            })));
        }
    }
    for (i, change) in changes {
        if let Some(obj) = rows[i].as_object_mut() {
            obj.insert("changes".into(), change);
        }
    }
    json!({ "logs": rows })
}

/// Moves stored logs to the Recycle Bin (a .trash folder where there is none).
pub fn delete_logs(ids: &[String]) -> Value {
    let mut removed = Vec::new();
    let mut failed = Vec::new();
    let mut paths = Vec::new();
    for id in ids {
        match resolve(id) {
            Ok(path) => paths.push((id.clone(), path)),
            Err(error) => failed.push(json!({ "id": id, "error": error })),
        }
    }
    for (id, path) in paths {
        match to_trash(&path) {
            Ok(()) => removed.push(id),
            Err(error) => failed.push(json!({ "id": id, "error": error })),
        }
    }
    if !removed.is_empty() {
        let _guard = FACTS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut facts = read_facts();
        for id in &removed {
            facts.remove(id);
        }
        let _ = fs::write(facts_path(), Value::Object(facts).to_string());
    }
    json!({ "ok": failed.is_empty(), "removed": removed, "failed": failed })
}

#[cfg(windows)]
fn to_trash(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{SHFileOperationW, FO_DELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, SHFILEOPSTRUCTW};
    // The shell does not take a \\?\ path (resolve canonicalizes to one), and pFrom is a
    // list of paths ended by an empty one: two NULs at the end.
    let text = path.as_os_str().to_string_lossy();
    let plain = std::ffi::OsStr::new(text.strip_prefix(r"\\?\").unwrap_or(&text));
    let mut from: Vec<u16> = plain.encode_wide().collect();
    from.push(0);
    from.push(0);
    let mut op = SHFILEOPSTRUCTW {
        hwnd: std::ptr::null_mut(),
        wFunc: FO_DELETE,
        pFrom: from.as_ptr(),
        pTo: std::ptr::null(),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT) as u16,
        fAnyOperationsAborted: 0,
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: std::ptr::null(),
    };
    let code = unsafe { SHFileOperationW(&mut op) };
    if code != 0 || op.fAnyOperationsAborted != 0 {
        return Err(format!("Could not move the file to the Recycle Bin ({code})"));
    }
    Ok(())
}

#[cfg(not(windows))]
fn to_trash(path: &std::path::Path) -> Result<(), String> {
    let trash = logs_root().join(".trash");
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let name = path.file_name().ok_or("no file name")?;
    fs::rename(path, trash.join(name)).map_err(|e| e.to_string())
}

/// The number the log had on the vehicle, from its stored name.
pub fn onboard_number(id: &str) -> Option<u32> {
    onboard_id(id)
}

/// list_logs plus the account's logs that are only in the cloud, as `cloud:{hash}`.
/// Reading one of those through a log tool downloads it first (see resolve).
pub fn list_logs_with_cloud() -> Value {
    let mut listed = list_logs();
    let local: std::collections::HashSet<String> = listed["logs"]
        .as_array()
        .map(|rows| rows.iter().filter_map(|row| row["id"].as_str().map(|id| id.rsplit('/').next().unwrap_or(id).get(..16).unwrap_or("").to_string())).collect())
        .unwrap_or_default();
    let extra: Vec<Value> = crate::cloud::cached_logs()
        .into_iter()
        .filter(|row| row["stored"].as_bool() == Some(true))
        .filter_map(|row| {
            let hash = row["hash"].as_str()?.to_string();
            if local.contains(&hash) {
                return None;
            }
            Some(json!({
                "id": format!("cloud:{hash}"),
                "bytes": row["bytes"],
                "source": "cloud",
                "onboard_id": row["onboard_id"],
                "saved_at": row["uploaded_at"],
                "flight_utc": Value::Null,
                "board": Value::Null,
                "vehicle": row["board"],
                "original_name": row["name"],
            }))
        })
        .collect();
    if !extra.is_empty() {
        if let Some(rows) = listed["logs"].as_array_mut() {
            rows.extend(extra);
        }
        if let Some(note) = listed["note"].as_str() {
            listed["note"] = json!(format!("{note} A row whose id starts with cloud: is only in the account's cloud storage; the first tool that reads it downloads it to this computer, which takes a moment."));
        }
    }
    listed
}
