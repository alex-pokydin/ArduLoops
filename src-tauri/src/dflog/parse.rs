// DataFlash decode, names, and summaries.


fn read_id(id: &str) -> Result<Vec<u8>, String> {
    fs::read(resolve(id)?).map_err(|e| e.to_string())
}

fn parse_formats(bytes: &[u8]) -> BTreeMap<u8, Fmt> {
    let mut formats = BTreeMap::new();
    let mut i = 0;
    while i + 3 < bytes.len() {
        if bytes[i] != HEAD1 || bytes[i + 1] != HEAD2 {
            i += 1;
            continue;
        }
        if bytes[i + 2] != FMT_TYPE {
            i += 1;
            continue;
        }
        if let Some(fmt) = decode_fmt(&bytes[i..]) {
            let key = fmt_type_byte(&bytes[i..]);
            formats.insert(key, fmt);
            i += 89;
        } else {
            i += 1;
        }
    }
    formats
}

fn fmt_type_byte(bytes: &[u8]) -> u8 {
    bytes.get(3).copied().unwrap_or(0)
}

fn decode_fmt(bytes: &[u8]) -> Option<Fmt> {
    if bytes.len() < 89 || bytes[0] != HEAD1 || bytes[1] != HEAD2 || bytes[2] != FMT_TYPE {
        return None;
    }
    let length = bytes[4] as usize;
    if length < 3 || length > 255 {
        return None;
    }
    let name = cstr(&bytes[5..9]);
    let format = cstr(&bytes[9..25]);
    let labels = cstr(&bytes[25..89]);
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    let width: usize = format.chars().map(|c| field_size(c).unwrap_or(0)).sum();
    if width + 3 != length {
        return None;
    }
    let labels: Vec<String> = labels.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if labels.len() != format.chars().count() {
        return None;
    }
    Some(Fmt { length, name, format, labels })
}

fn walk(bytes: &[u8], formats: &BTreeMap<u8, Fmt>, mut on: impl FnMut(&Fmt, &[u8], &[Value]), incomplete: &mut bool) {
    let _ = walk_until(bytes, formats, |fmt, body, values| {
        on(fmt, body, values);
        false
    }, incomplete);
}

fn walk_until(bytes: &[u8], formats: &BTreeMap<u8, Fmt>, mut on: impl FnMut(&Fmt, &[u8], &[Value]) -> bool, incomplete: &mut bool) -> bool {
    let mut i = 0;
    while i + 3 <= bytes.len() {
        if bytes[i] != HEAD1 || bytes[i + 1] != HEAD2 {
            i += 1;
            continue;
        }
        let kind = bytes[i + 2];
        let Some(fmt) = formats.get(&kind) else {
            i += 1;
            continue;
        };
        if i + fmt.length > bytes.len() {
            *incomplete = true;
            break;
        }
        let body = &bytes[i + 3..i + fmt.length];
        let values = decode_body(&fmt.format, body);
        if on(fmt, body, &values) {
            return true;
        }
        i += fmt.length;
    }
    false
}

fn decode_body(format: &str, mut body: &[u8]) -> Vec<Value> {
    let mut out = Vec::new();
    for kind in format.chars() {
        let Some(size) = field_size(kind) else { break };
        if body.len() < size {
            break;
        }
        let (chunk, rest) = body.split_at(size);
        body = rest;
        out.push(decode_one(kind, chunk));
    }
    out
}

fn decode_one(kind: char, chunk: &[u8]) -> Value {
    match kind {
        'b' => json!(chunk[0] as i8),
        'B' | 'M' => json!(chunk[0]),
        'h' => json!(i16::from_le_bytes(chunk.try_into().unwrap_or([0, 0]))),
        'H' => json!(u16::from_le_bytes(chunk.try_into().unwrap_or([0, 0]))),
        'i' => json!(i32::from_le_bytes(chunk.try_into().unwrap_or([0; 4]))),
        'I' => json!(u32::from_le_bytes(chunk.try_into().unwrap_or([0; 4]))),
        'f' => json!(f32::from_le_bytes(chunk.try_into().unwrap_or([0; 4]))),
        'd' => json!(f64::from_le_bytes(chunk.try_into().unwrap_or([0; 8]))),
        'c' => json!(i16::from_le_bytes(chunk.try_into().unwrap_or([0, 0])) as f64 / 100.0),
        'C' => json!(u16::from_le_bytes(chunk.try_into().unwrap_or([0, 0])) as f64 / 100.0),
        'e' => json!(i32::from_le_bytes(chunk.try_into().unwrap_or([0; 4])) as f64 / 100.0),
        'E' => json!(u32::from_le_bytes(chunk.try_into().unwrap_or([0; 4])) as f64 / 100.0),
        'L' => json!(i32::from_le_bytes(chunk.try_into().unwrap_or([0; 4])) as f64 / 1e7),
        'q' => json!(i64::from_le_bytes(chunk.try_into().unwrap_or([0; 8]))),
        'Q' => json!(u64::from_le_bytes(chunk.try_into().unwrap_or([0; 8]))),
        'n' | 'N' | 'Z' => json!(cstr(chunk)),
        'a' => json!(chunk.chunks(2).map(|c| i16::from_le_bytes([c[0], c.get(1).copied().unwrap_or(0)])).collect::<Vec<_>>()),
        _ => Value::Null,
    }
}

fn time_us(fmt: &Fmt, values: &[Value]) -> Option<u64> {
    field_u64(fmt, values, "TimeUS")
}

fn field_u64(fmt: &Fmt, values: &[Value], label: &str) -> Option<u64> {
    let idx = fmt.labels.iter().position(|l| l == label)?;
    values.get(idx)?.as_u64().or_else(|| values.get(idx)?.as_f64().map(|n| n as u64)).or_else(|| values.get(idx)?.as_i64().map(|n| n as u64))
}

fn field_f64(fmt: &Fmt, values: &[Value], label: &str) -> Option<f64> {
    let idx = fmt.labels.iter().position(|l| l == label)?;
    values.get(idx)?.as_f64().or_else(|| values.get(idx)?.as_u64().map(|n| n as f64)).or_else(|| values.get(idx)?.as_i64().map(|n| n as f64))
}

/// Unit names recorded beside the message. An empty result means this file named none.
fn column_units(bytes: &[u8], message: &str) -> BTreeMap<String, String> {
    let formats = parse_formats(bytes);
    let Some((&type_id, fmt)) = formats.iter().find(|(_, fmt)| fmt.name.eq_ignore_ascii_case(message)) else {
        return BTreeMap::new();
    };
    let mut labels: BTreeMap<i64, String> = BTreeMap::new();
    let mut codes = String::new();
    let mut incomplete = false;
    walk(bytes, &formats, |row_fmt, _, values| {
        if row_fmt.name == "UNIT" {
            if let (Some(id), Some(label)) = (field_u64(row_fmt, values, "Id"), field_str(row_fmt, values, "Label")) {
                let name = label.trim();
                if !name.is_empty() && name != "UNKNOWN" && name != "-" {
                    labels.insert(id as i64, name.to_string());
                }
            }
        } else if row_fmt.name == "FMTU" && field_u64(row_fmt, values, "FmtType") == Some(u64::from(type_id)) {
            if let Some(ids) = field_str(row_fmt, values, "UnitIds") {
                codes = ids;
            }
        }
    }, &mut incomplete);
    let mut out = BTreeMap::new();
    for (index, label) in fmt.labels.iter().enumerate() {
        let Some(code) = codes.chars().nth(index) else { continue };
        let Some(name) = labels.get(&(code as i64)) else { continue };
        out.insert(label.clone(), name.clone());
    }
    out
}

fn field_str(fmt: &Fmt, values: &[Value], label: &str) -> Option<String> {
    let idx = fmt.labels.iter().position(|l| l == label)?;
    values.get(idx)?.as_str().map(|text| text.trim().to_string()).filter(|text| !text.is_empty())
}

fn axis_samples(fmt: &Fmt, values: &[Value], label: &str, mul: f64) -> Vec<f64> {
    let Some(idx) = fmt.labels.iter().position(|l| l == label) else { return Vec::new() };
    let Some(list) = values.get(idx).and_then(Value::as_array) else { return Vec::new() };
    list.iter()
        .filter_map(|value| value.as_f64().or_else(|| value.as_i64().map(|n| n as f64)))
        .map(|sample| sample / mul)
        .collect()
}

fn magnitude(samples: &[f64], n: usize) -> Vec<f64> {
    let mut re = vec![0.0; n];
    let mut im = vec![0.0; n];
    let mean = samples.iter().sum::<f64>() / samples.len() as f64;
    for (i, sample) in samples.iter().enumerate().take(n) {
        let w = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / samples.len() as f64).cos();
        re[i] = (sample - mean) * w;
    }
    fft(&mut re, &mut im, false);
    (0..n / 2).map(|i| (re[i] * re[i] + im[i] * im[i]).sqrt() / n as f64).collect()
}

fn missing_message(message: &str) -> Option<Value> {
    if !message.trim().is_empty() {
        return None;
    }
    Some(json!({
        "ok": false,
        "error": "message is required. message is the DataFlash message name."
    }))
}

/// A file already stored here with this onboard id and this exact size.
/// The id is the `file` for the local tools. The same onboard number with a
/// different size is a different recording and is not returned.
pub fn local_copy(onboard: u32, size: u64) -> Option<Value> {
    if size == 0 {
        return None;
    }
    let root = logs_root();
    let mut best: Option<(std::time::SystemTime, String, PathBuf)> = None;
    let vehicles = fs::read_dir(&root).ok()?;
    for vehicle in vehicles.flatten() {
        let files = match fs::read_dir(vehicle.path()) {
            Ok(files) => files,
            Err(_) => continue,
        };
        for file in files.flatten() {
            let path = file.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("bin") {
                continue;
            }
            let Ok(rel) = path.strip_prefix(&root) else { continue };
            let id = rel.to_string_lossy().replace('\\', "/");
            let meta = file.metadata().ok();
            let bytes = meta.as_ref().map(|item| item.len()).unwrap_or(0);
            if !is_stored_copy(&id, bytes, onboard, size) {
                continue;
            }
            let modified = meta.and_then(|item| item.modified().ok()).unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            if best.as_ref().map(|(time, _, _)| modified > *time).unwrap_or(true) {
                best = Some((modified, id, path));
            }
        }
    }
    best.map(|(_, id, path)| {
        let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("").to_string();
        let mut row = json!({
            "id": id,
            "name": name,
            "path": path.display().to_string(),
            "bytes": size,
        });
        if let Some(obj) = row.as_object_mut() {
            merge_name_parts(obj, &id);
        }
        row
    })
}

fn is_stored_copy(file_id: &str, file_bytes: u64, onboard: u32, size: u64) -> bool {
    size > 0 && file_bytes == size && onboard_id(file_id) == Some(onboard)
}

fn onboard_id(id: &str) -> Option<u32> {
    let name = id.rsplit(['/', '\\']).next().unwrap_or(id);
    let stem = name.strip_suffix(".bin")?;
    if let Some(num) = stem.strip_prefix("log-") {
        return num.parse().ok();
    }
    stem.rsplit(['_', '-']).next()?.parse().ok()
}

/// Hash, flight stamp, and vehicle directory carried by a stored log id.
pub fn stored_name_parts(id: &str) -> Value {
    let mut out = serde_json::Map::new();
    if let Some((dir, _)) = id.rsplit_once(['/', '\\']) {
        let vehicle = dir.rsplit(['/', '\\']).next().unwrap_or(dir);
        if !vehicle.is_empty() {
            out.insert("vehicle".into(), json!(vehicle));
        }
    }
    let name = id.rsplit(['/', '\\']).next().unwrap_or(id);
    let Some(stem) = name.strip_suffix(".bin") else {
        return Value::Object(out);
    };
    let pieces: Vec<&str> = stem.split('_').collect();
    if pieces.len() == 3 && is_hex16(pieces[0]) && is_stamp(pieces[1]) {
        out.insert("sha256_16".into(), json!(pieces[0]));
        out.insert("flight_stamp".into(), json!(pieces[1]));
        return Value::Object(out);
    }
    if let Some((hash, _)) = stem.split_once('-') {
        if is_hex16(hash) && !stem.starts_with("log-") {
            out.insert("sha256_16".into(), json!(hash));
        }
    }
    Value::Object(out)
}

pub fn relative_log_id(path: &str) -> Option<String> {
    let rel = std::path::Path::new(path).strip_prefix(logs_root()).ok()?;
    let id = rel.to_string_lossy().replace('\\', "/");
    (!id.is_empty()).then_some(id)
}

fn merge_name_parts(obj: &mut serde_json::Map<String, Value>, id: &str) {
    let Some(parts) = stored_name_parts(id).as_object().cloned() else { return };
    for (key, value) in parts {
        obj.entry(key).or_insert(value);
    }
}

fn is_hex16(text: &str) -> bool {
    text.len() == 16 && text.chars().all(|c| c.is_ascii_hexdigit())
}

fn is_stamp(text: &str) -> bool {
    text.len() == 14 && text.chars().all(|c| c.is_ascii_digit())
}

/// `{sha256_16}_{YYYYMMDDHHMMSS}_{onboard id}.bin`. The stamp is the flight
/// time. The same bytes keep the same name. A reused onboard number with
/// different bytes is a different file.
pub(crate) fn downloaded_log_name(onboard_id: u16, bytes: &[u8], time_utc: u32) -> String {
    let mut hash = Sha256::new();
    hash.update(bytes);
    let stamp = flight_stamp(bytes, time_utc);
    format!("{}_{stamp}_{onboard_id}.bin", hex_prefix(&hash.finalize()))
}

fn flight_stamp(bytes: &[u8], time_utc: u32) -> String {
    if let Some(stamp) = first_flight_utc(bytes).as_deref().and_then(compact_utc) {
        return stamp;
    }
    if time_utc > 0 {
        if let Some(stamp) = compact_utc(&unix_rfc3339(u64::from(time_utc))) {
            return stamp;
        }
    }
    system_rfc3339(std::time::SystemTime::now())
        .as_deref()
        .and_then(compact_utc)
        .unwrap_or_else(|| "00000000000000".to_string())
}

fn compact_utc(text: &str) -> Option<String> {
    let digits: String = text.chars().filter(|c| c.is_ascii_digit()).take(14).collect();
    if digits.len() == 14 { Some(digits) } else { None }
}

fn system_rfc3339(time: std::time::SystemTime) -> Option<String> {
    let secs = time.duration_since(std::time::SystemTime::UNIX_EPOCH).ok()?.as_secs();
    Some(unix_rfc3339(secs))
}

pub(crate) fn unix_rfc3339(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let tod = secs % 86_400;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    if m <= 2 {
        y += 1;
    }
    let hh = tod / 3600;
    let mm = (tod % 3600) / 60;
    let ss = tod % 60;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

fn gps_rfc3339(week: u64, gms: u64) -> Option<String> {
    if !(2000..4000).contains(&week) {
        return None;
    }
    let gps = 315_964_800u64.saturating_add(week.saturating_mul(604_800)).saturating_add(gms / 1000);
    Some(unix_rfc3339(gps.saturating_sub(18)))
}

#[derive(Debug, Clone, Default)]
pub struct LogSummary {
    pub firmware: String,
    pub frame: String,
    pub start_utc: String,
    pub duration_us: u64,
}

/// A TimeUS farther than this from the others is a misread, not a longer flight.
const MAX_SPAN_US: u64 = 7 * 24 * 3_600 * 1_000_000;

fn remember_time(first: &mut Option<u64>, last: &mut Option<u64>, us: u64) {
    let (Some(start), Some(end)) = (*first, *last) else {
        *first = Some(us);
        *last = Some(us);
        return;
    };
    if us < start && end.saturating_sub(us) <= MAX_SPAN_US {
        *first = Some(us);
    } else if us > end && us.saturating_sub(start) <= MAX_SPAN_US {
        *last = Some(us);
    }
}

/// Firmware, frame, first GPS time, and duration from a DataFlash log.
/// `tail` is the end of the file when `head` is only a prefix; pass an empty
/// tail when `head` is the whole log. TimeUS is since boot, so duration is the
/// span, not the absolute value. A sample more than seven days from that span
/// is left out.
pub fn summarize_log(head: &[u8], tail: &[u8]) -> LogSummary {
    let formats = parse_formats(head);
    let mut summary = LogSummary::default();
    let mut first_us: Option<u64> = None;
    let mut last_us: Option<u64> = None;
    let mut note = |fmt: &Fmt, values: &[Value]| {
        if summary.firmware.is_empty() && fmt.name == "MSG" {
            if let Some(text) = field_str(fmt, values, "Message") {
                if firmware_line(&text) {
                    summary.firmware = text;
                }
            }
        }
        if summary.frame.is_empty() && fmt.name == "MSG" {
            if let Some(text) = field_str(fmt, values, "Message") {
                if let Some(frame) = text.strip_prefix("Frame:") {
                    let frame = frame.trim();
                    if !frame.is_empty() {
                        summary.frame = frame.to_string();
                    }
                }
            }
        }
        if summary.start_utc.is_empty() && fmt.name == "GPS" {
            let week = field_u64(fmt, values, "GWk").unwrap_or(0);
            let gms = field_u64(fmt, values, "GMS").unwrap_or(0);
            if let Some(text) = gps_rfc3339(week, gms) {
                summary.start_utc = text;
            }
        }
        if let Some(us) = time_us(fmt, values) {
            remember_time(&mut first_us, &mut last_us, us);
        }
    };
    let mut incomplete = false;
    walk(head, &formats, |fmt, _, values| note(fmt, values), &mut incomplete);
    if !tail.is_empty() {
        let origin = first_us.unwrap_or(0);
        let mut tail_last: Option<u64> = None;
        walk(tail, &formats, |fmt, _, values| {
            if let Some(us) = time_us(fmt, values) {
                if us >= origin && us.saturating_sub(origin) <= MAX_SPAN_US {
                    tail_last = Some(tail_last.map_or(us, |have| have.max(us)));
                }
            }
        }, &mut incomplete);
        if let Some(end) = tail_last {
            last_us = Some(end);
        }
    }
    if let (Some(start), Some(end)) = (first_us, last_us) {
        if end > start {
            summary.duration_us = end - start;
        }
    }
    summary
}

/// A previously downloaded file is the same log only when its length matches.
/// Several files can share an onboard id; the newest size match is that recording.
pub fn local_onboard_summary(boot_uid: &str, id: u16, size: u32) -> Option<LogSummary> {
    let key: String = boot_uid.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if key.is_empty() || size == 0 {
        return None;
    }
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for file in fs::read_dir(logs_root().join(key)).ok()?.flatten() {
        let path = file.path();
        let name = path.file_name()?.to_string_lossy();
        if onboard_id(&name) != Some(u32::from(id)) {
            continue;
        }
        let meta = file.metadata().ok()?;
        if meta.len() != u64::from(size) {
            continue;
        }
        let modified = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let newer = best.as_ref().map(|(when, _)| modified > *when).unwrap_or(true);
        if newer {
            best = Some((modified, path));
        }
    }
    let bytes = fs::read(best?.1).ok()?;
    Some(summarize_log(&bytes, &[]))
}

fn firmware_line(text: &str) -> bool {
    ["ArduCopter", "ArduPlane", "ArduRover", "ArduSub", "AntennaTracker", "Blimp"]
        .iter()
        .any(|prefix| text.starts_with(prefix))
}

fn first_flight_utc(bytes: &[u8]) -> Option<String> {
    let formats = parse_formats(bytes);
    let mut found = None;
    let mut incomplete = false;
    walk_until(bytes, &formats, |fmt, _, values| {
        if fmt.name != "GPS" {
            return false;
        }
        let week = field_u64(fmt, values, "GWk").unwrap_or(0);
        let gms = field_u64(fmt, values, "GMS").unwrap_or(0);
        if let Some(text) = gps_rfc3339(week, gms) {
            found = Some(text);
            return true;
        }
        false
    }, &mut incomplete);
    found
}

fn field_size(kind: char) -> Option<usize> {
    Some(match kind {
        'b' | 'B' | 'M' => 1,
        'h' | 'H' | 'c' | 'C' => 2,
        'i' | 'I' | 'f' | 'e' | 'E' | 'L' | 'n' => 4,
        'd' | 'q' | 'Q' => 8,
        'N' => 16,
        'Z' | 'a' => 64,
        _ => return None,
    })
}

fn type_name(kind: char) -> &'static str {
    match kind {
        'b' => "int8",
        'B' => "uint8",
        'h' => "int16",
        'H' => "uint16",
        'i' => "int32",
        'I' => "uint32",
        'f' => "float",
        'd' => "double",
        'c' => "int16/100",
        'C' => "uint16/100",
        'e' => "int32/100",
        'E' => "uint32/100",
        'L' => "latlon/1e7",
        'M' => "mode",
        'q' => "int64",
        'Q' => "uint64",
        'n' => "char4",
        'N' => "char16",
        'Z' => "char64",
        'a' => "int16[32]",
        _ => "unknown",
    }
}

fn cstr(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).trim().to_string()
}

fn hex_prefix(bytes: &[u8]) -> String {
    bytes.iter().take(8).map(|b| format!("{b:02x}")).collect()
}
