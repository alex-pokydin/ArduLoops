// Share: an anonymised copy of stored logs in one .zip. The originals are not changed.
// Fields are rewritten in place, so the copy is still a valid DataFlash log of the same size.

/// GPS week of 1 Jan 2000 (week 1042, day 6). A shifted log starts in that week.
const SHARE_WEEK: u64 = 1042;

#[derive(Default)]
struct ShareOptions {
    location: bool,
    date: bool,
    board: bool,
    messages: bool,
}

fn field_offset(format: &str, index: usize) -> Option<(usize, char)> {
    let mut at = 0;
    for (i, kind) in format.chars().enumerate() {
        let size = field_size(kind)?;
        if i == index {
            return Some((at, kind));
        }
        at += size;
    }
    None
}

fn read_degrees(body: &[u8], at: usize, kind: char) -> Option<f64> {
    Some(match kind {
        'L' | 'i' => i32::from_le_bytes(body.get(at..at + 4)?.try_into().ok()?) as f64 / 1e7,
        'f' => f32::from_le_bytes(body.get(at..at + 4)?.try_into().ok()?) as f64,
        'd' => f64::from_le_bytes(body.get(at..at + 8)?.try_into().ok()?),
        _ => return None,
    })
}

fn write_degrees(body: &mut [u8], at: usize, kind: char, value: f64) {
    match kind {
        'L' | 'i' => {
            if let Some(slot) = body.get_mut(at..at + 4) {
                slot.copy_from_slice(&((value * 1e7).round() as i32).to_le_bytes());
            }
        }
        'f' => {
            if let Some(slot) = body.get_mut(at..at + 4) {
                slot.copy_from_slice(&(value as f32).to_le_bytes());
            }
        }
        'd' => {
            if let Some(slot) = body.get_mut(at..at + 8) {
                slot.copy_from_slice(&value.to_le_bytes());
            }
        }
        _ => {}
    }
}

/// Record starts and their format type, in file order.
fn record_spans(bytes: &[u8], formats: &BTreeMap<u8, Fmt>) -> Vec<(usize, u8)> {
    let mut spans = Vec::new();
    let mut i = 0;
    while i + 3 <= bytes.len() {
        if bytes[i] != HEAD1 || bytes[i + 1] != HEAD2 {
            i += 1;
            continue;
        }
        let Some(fmt) = formats.get(&bytes[i + 2]) else {
            i += 1;
            continue;
        };
        if i + fmt.length > bytes.len() {
            break;
        }
        spans.push((i, bytes[i + 2]));
        i += fmt.length;
    }
    spans
}

/// Hex words of the board serial: a startup line carries it as two or more groups of 8 or more hex digits.
fn serial_words(bytes: &[u8], formats: &BTreeMap<u8, Fmt>) -> Vec<String> {
    let mut words = Vec::new();
    let mut incomplete = false;
    walk(bytes, formats, |fmt, _, values| {
        if fmt.name != "MSG" {
            return;
        }
        let Some(text) = field_str(fmt, values, "Message") else { return };
        let hex: Vec<&str> = text
            .split_whitespace()
            .filter(|w| w.len() >= 8 && w.len() <= 24 && w.bytes().all(|b| b.is_ascii_hexdigit()) && w.bytes().any(|b| b.is_ascii_digit()))
            .collect();
        if hex.len() >= 2 {
            for word in hex {
                if !words.iter().any(|have: &String| have == word) {
                    words.push(word.to_string());
                }
            }
        }
    }, &mut incomplete);
    words
}

fn anonymise(bytes: &mut [u8], opts: &ShareOptions) {
    let formats = parse_formats(bytes);
    // Home: the first non-zero GPS position, else the EKF origin, else any position.
    let mut home: Option<(f64, f64)> = None;
    let mut first_week: Option<u64> = None;
    for name in ["GPS", "ORGN", "POS"] {
        if home.is_some() {
            break;
        }
        find_record(bytes, &formats, name, |fmt, values| {
            let (Some(lat), Some(lng)) = (field_f64(fmt, values, "Lat"), field_f64(fmt, values, "Lng")) else { return false };
            if lat == 0.0 && lng == 0.0 {
                return false;
            }
            home = Some((lat, lng));
            true
        });
    }
    find_record(bytes, &formats, "GPS", |fmt, values| {
        let week = field_u64(fmt, values, "GWk").unwrap_or(0);
        if week > 0 {
            first_week = Some(week);
            return true;
        }
        false
    });
    let serial = if opts.board { serial_words(bytes, &formats) } else { Vec::new() };
    let spans = record_spans(bytes, &formats);
    for (start, kind) in spans {
        let Some(fmt) = formats.get(&kind) else { continue };
        let body = &mut bytes[start + 3..start + fmt.length];
        let label = |name: &str| fmt.labels.iter().position(|l| l == name);
        if opts.location {
            if let (Some((home_lat, home_lng)), Some(lat_i), Some(lng_i)) = (home, label("Lat"), label("Lng").or_else(|| label("Lon"))) {
                if let (Some((lat_at, lat_kind)), Some((lng_at, lng_kind))) = (field_offset(&fmt.format, lat_i), field_offset(&fmt.format, lng_i)) {
                    if let (Some(lat), Some(lng)) = (read_degrees(body, lat_at, lat_kind), read_degrees(body, lng_at, lng_kind)) {
                        if lat != 0.0 || lng != 0.0 {
                            // Metres east and north of home, laid out again at 0° N 0° E, so distances stay.
                            let east = (lng - home_lng) * home_lat.to_radians().cos();
                            write_degrees(body, lat_at, lat_kind, lat - home_lat);
                            write_degrees(body, lng_at, lng_kind, east);
                        }
                    }
                }
            }
        }
        if opts.date {
            if let (Some(first), Some(i)) = (first_week, label("GWk")) {
                if let Some((at, 'H')) = field_offset(&fmt.format, i) {
                    let week = u16::from_le_bytes([body[at], body[at + 1]]) as u64;
                    if week > 0 {
                        let shifted = (week + SHARE_WEEK).saturating_sub(first).min(u16::MAX as u64) as u16;
                        body[at..at + 2].copy_from_slice(&shifted.to_le_bytes());
                    }
                }
            }
        }
        if fmt.name == "MSG" && (opts.board || opts.messages) {
            let Some(i) = label("Message") else { continue };
            let Some((at, kind)) = field_offset(&fmt.format, i) else { continue };
            let Some(size) = field_size(kind) else { continue };
            let slot = &mut body[at..at + size];
            let text = cstr(slot);
            let keep = firmware_line(&text) || text.starts_with("Frame:") || text.starts_with("ChibiOS");
            if opts.messages && !keep {
                slot.fill(0);
                continue;
            }
            if opts.board {
                let mut changed = text.clone();
                for word in &serial {
                    changed = changed.replace(word.as_str(), &"0".repeat(word.len()));
                }
                if changed != text {
                    let raw = changed.as_bytes();
                    slot.fill(0);
                    slot[..raw.len().min(size)].copy_from_slice(&raw[..raw.len().min(size)]);
                }
            }
        }
    }
}

fn downloads_dir() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    match home.map(|h| h.join("Downloads")) {
        Some(dir) if dir.is_dir() => dir,
        _ => data_dir().join("shared"),
    }
}

/// Writes an anonymised copy of each log into one .zip in Downloads.
pub fn share_logs(ids: &[String], opts: &Value) -> Result<Value, String> {
    use std::io::Write;
    if ids.is_empty() {
        return Err("Pick at least one log".into());
    }
    let options = ShareOptions {
        location: opts["location"].as_bool().unwrap_or(true),
        date: opts["date"].as_bool().unwrap_or(true),
        board: opts["board"].as_bool().unwrap_or(true),
        messages: opts["messages"].as_bool().unwrap_or(false),
    };
    let with_note = opts["note"].as_bool().unwrap_or(false);
    let notes = if with_note { crate::db::log_notes().unwrap_or_default() } else { Default::default() };
    let dir = downloads_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = unix_rfc3339(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));
    let compact: String = stamp.chars().filter(|c| c.is_ascii_digit()).take(14).collect();
    let mut path = dir.join(format!("ArduLoops-share-{compact}.zip"));
    let mut n = 1;
    while path.exists() {
        n += 1;
        path = dir.join(format!("ArduLoops-share-{compact}-{n}.zip"));
    }
    let file = fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let zopts = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut names: Vec<String> = Vec::new();
    for (index, id) in ids.iter().enumerate() {
        let mut bytes = read_id(id)?;
        let original_hash = {
            let mut digest = Sha256::new();
            digest.update(&bytes);
            hex_prefix(&digest.finalize())
        };
        anonymise(&mut bytes, &options);
        let base = match onboard_id(id) {
            Some(onboard) => format!("log-{onboard}"),
            None => format!("log-{}", index + 1),
        };
        let mut name = base.clone();
        let mut k = 1;
        while names.contains(&name) {
            k += 1;
            name = format!("{base}-{k}");
        }
        names.push(name.clone());
        zip.start_file(format!("{name}.bin"), zopts).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
        if let Some((_, note, _)) = notes.get(&original_hash).filter(|(_, note, _)| !note.is_empty()) {
            zip.start_file(format!("{name}.txt"), zopts).map_err(|e| e.to_string())?;
            zip.write_all(note.as_bytes()).map_err(|e| e.to_string())?;
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "path": path.display().to_string(), "files": names.len() }))
}

/// Open the folder holding a shared copy, with the file selected.
pub fn reveal_shared(path: &str) -> Result<(), String> {
    let path = PathBuf::from(path);
    let allowed = path.starts_with(downloads_dir()) || path.starts_with(data_dir().join("shared"));
    if !allowed || !path.is_file() {
        return Err("not a shared copy".into());
    }
    reveal_path(&path).map_err(|e| e.to_string())
}
