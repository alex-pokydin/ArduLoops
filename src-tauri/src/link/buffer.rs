// The last minute of live numbers. A key is the MAVLink field that arrived,
// `MESSAGE.field`. The scope plots keep their own sample fields.

const LIVE_SPAN: f64 = 60.0;
const LIVE_CAP: usize = 5_000;
const POINT_CAP: usize = 24;

struct Point {
    t: f64,
    v: HashMap<String, f32>,
}

struct LiveBuf {
    points: Vec<Point>,
}

static BUF: Mutex<LiveBuf> = Mutex::new(LiveBuf { points: Vec::new() });

fn with_buf<R>(f: impl FnOnce(&mut LiveBuf) -> R) -> R {
    let mut guard = BUF.lock().unwrap_or_else(|err| err.into_inner());
    f(&mut guard)
}

fn note_live(sample: &mut Sample) {
    let v = live_numbers(sample);
    with_buf(|buf| buf.push_values(v, wall_time()));
}

fn absorb_message(nums: &mut HashMap<String, f64>, msg: &MavMessage) {
    let Ok(value) = serde_json::to_value(msg) else { return };
    let Some(obj) = value.as_object() else { return };
    let Some(message) = obj.get("type").and_then(|v| v.as_str()) else { return };
    if message.starts_with("PARAM_") || message.starts_with("LOG_") || message == "FILE_TRANSFER_PROTOCOL" {
        return;
    }
    if message == "NAMED_VALUE_FLOAT" || message == "NAMED_VALUE_INT" {
        if let Some((name, n)) = named_script_value(obj) {
            nums.insert(format!("{message}.{name}"), n);
        }
        return;
    }
    let axis = obj.get("axis").and_then(|v| v.as_str()).and_then(|s| s.rsplit('_').next());
    for (key, item) in obj {
        if key == "type" || key == "axis" {
            continue;
        }
        let Some(n) = item.as_f64() else { continue };
        if !n.is_finite() {
            continue;
        }
        nums.insert(format!("{message}.{key}"), n);
        if let Some(axis) = axis {
            nums.insert(format!("{message}.{axis}.{key}"), n);
        }
    }
}

fn live_numbers(sample: &Sample) -> HashMap<String, f32> {
    sample.live_nums.iter().filter(|(_, n)| n.is_finite()).map(|(key, n)| (key.clone(), *n as f32)).collect()
}

fn live_name(raw: &str) -> bool {
    let parts: Vec<&str> = raw.split('.').collect();
    (parts.len() == 2 || parts.len() == 3)
        && parts.iter().all(|part| {
            !part.is_empty() && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        })
        && parts[0].bytes().next().is_some_and(|b| b.is_ascii_uppercase())
}

pub fn live_meta(raw: &str) -> Option<(String, String, String)> {
    let raw = raw.trim();
    if !live_name(raw) {
        return None;
    }
    let label = named_label(raw).unwrap_or_else(|| raw.to_string());
    Some((raw.to_string(), label, String::new()))
}

fn named_script_value(obj: &serde_json::Map<String, serde_json::Value>) -> Option<(String, f64)> {
    let n = obj.get("value")?.as_f64()?;
    if !n.is_finite() {
        return None;
    }
    let name = script_name(obj.get("name")?)?;
    Some((name, n))
}

fn script_name(item: &serde_json::Value) -> Option<String> {
    let raw = if let Some(text) = item.as_str() {
        text.as_bytes().to_vec()
    } else {
        let rows = item.as_array()?;
        rows.iter().filter_map(|v| v.as_u64().and_then(|n| u8::try_from(n).ok())).collect()
    };
    let end = raw.iter().position(|b| *b == 0).unwrap_or(raw.len());
    let bytes = &raw[..end];
    if bytes.is_empty() || bytes.len() > 10 {
        return None;
    }
    if !bytes.iter().all(|b| b.is_ascii_alphanumeric() || *b == b'_') {
        return None;
    }
    String::from_utf8(bytes.to_vec()).ok()
}

fn field_entry(id: &str, unit: &str) -> serde_json::Value {
    let mut row = serde_json::Map::new();
    if let Some(label) = named_label(id) {
        if label != id {
            row.insert("l".into(), serde_json::Value::String(label));
        }
    }
    if !unit.is_empty() {
        row.insert("u".into(), serde_json::Value::String(unit.to_string()));
    }
    serde_json::Value::Object(row)
}

fn named_label(raw: &str) -> Option<String> {
    let (msg, name) = raw.split_once('.')?;
    if msg != "NAMED_VALUE_FLOAT" && msg != "NAMED_VALUE_INT" {
        return None;
    }
    if name.is_empty() || name.contains('.') {
        return None;
    }
    Some(name.to_string())
}

pub fn live_catalog() -> serde_json::Value {
    with_buf(|buf| buf.catalog())
}

pub fn query_live(names: &[String], seconds: f64) -> serde_json::Value {
    with_buf(|buf| buf.query(names, seconds))
}

fn round_to(v: f64, places: f64) -> f64 {
    (v * places).round() / places
}

impl LiveBuf {
    fn push_values(&mut self, v: HashMap<String, f32>, t: f64) {
        self.trim(t);
        if let Some(last) = self.points.last_mut() {
            if t >= last.t && t - last.t < 0.02 {
                last.t = t;
                last.v = v;
                return;
            }
        }
        self.points.push(Point { t, v });
        if self.points.len() > LIVE_CAP {
            let drop_n = self.points.len() - LIVE_CAP;
            self.points.drain(0..drop_n);
        }
    }

    #[cfg(test)]
    fn push_at(&mut self, sample: &Sample, t: f64) {
        let v = live_numbers(sample);
        self.push_values(v, t);
    }

    fn trim(&mut self, now: f64) {
        let cut = now - LIVE_SPAN;
        let keep = self.points.iter().position(|p| p.t >= cut).unwrap_or(self.points.len());
        if keep > 0 {
            self.points.drain(0..keep);
        }
    }

    fn query(&mut self, names: &[String], seconds: f64) -> serde_json::Value {
        let now = wall_time();
        self.trim(now);
        let seconds = seconds.clamp(1.0, LIVE_SPAN);
        let start = now - seconds;
        let window: Vec<&Point> = self.points.iter().filter(|p| p.t >= start && p.t <= now).collect();
        let t0 = window.first().map(|p| p.t).unwrap_or(now);
        let mut lines = Vec::new();
        let mut absent = Vec::new();
        let mut missing = Vec::new();
        let mut seen = HashSet::new();
        for raw in names {
            let raw = raw.trim();
            if raw.is_empty() {
                missing.push("(not a name)".to_string());
                continue;
            }
            let Some((id, label, unit)) = live_meta(raw) else {
                missing.push(raw.to_string());
                continue;
            };
            if !seen.insert(id.clone()) {
                continue;
            }
            let series: Vec<(f64, f64)> = window
                .iter()
                .filter_map(|p| p.v.get(&id).map(|y| (p.t, f64::from(*y))))
                .collect();
            if series.is_empty() {
                absent.push(serde_json::json!({ "id": id, "label": label }));
                continue;
            }
            let n = series.len();
            let latest = series[n - 1].1;
            let min = series.iter().map(|(_, y)| *y).fold(f64::INFINITY, f64::min);
            let max = series.iter().map(|(_, y)| *y).fold(f64::NEG_INFINITY, f64::max);
            let mean = series.iter().map(|(_, y)| *y).sum::<f64>() / n as f64;
            let drawn = downsample(&series, POINT_CAP);
            let points: Vec<serde_json::Value> = drawn
                .iter()
                .map(|(t, y)| serde_json::json!({ "t": round_to(t - t0, 1000.0), "y": round_to(*y, 10000.0) }))
                .collect();
            lines.push(serde_json::json!({
                "id": id,
                "label": label,
                "unit": unit,
                "n": n,
                "latest": round_to(latest, 10000.0),
                "min": round_to(min, 10000.0),
                "max": round_to(max, 10000.0),
                "mean": round_to(mean, 10000.0),
                "points": points,
            }));
        }
        serde_json::json!({
            "ok": true,
            "seconds": seconds,
            "samples": window.len(),
            "lines": lines,
            "absent": absent,
            "missing": missing,
            "note": "An empty unit is unknown. It was not in the message. absent is a known live field with no sample in the window. missing is not a live field. points are not every sample.",
        })
    }

    fn catalog(&mut self) -> serde_json::Value {
        let now = wall_time();
        self.trim(now);
        let start = now - LIVE_SPAN;
        let mut ids = std::collections::BTreeSet::new();
        for point in &self.points {
            if point.t >= start && point.t <= now {
                ids.extend(point.v.keys().cloned());
            }
        }
        let mut fields = serde_json::Map::new();
        for id in ids {
            fields.insert(id.clone(), field_entry(&id, ""));
        }
        serde_json::json!({
            "ok": true,
            "fields": fields,
            "note": "The key is the id, MESSAGE.field. l is a shorter label and is omitted when it matches the id. u is the unit and is omitted when empty. An empty unit is unknown. It was not in the message. A field that has not arrived is not listed.",
        })
    }
}

fn downsample(pts: &[(f64, f64)], cap: usize) -> Vec<(f64, f64)> {
    if pts.len() <= cap || cap < 2 {
        return pts.to_vec();
    }
    let mut out = Vec::with_capacity(cap);
    for i in 0..cap {
        let idx = i * (pts.len() - 1) / (cap - 1);
        out.push(pts[idx]);
    }
    out
}

#[cfg(test)]
fn with_live_cleared<R>(f: impl FnOnce(&mut LiveBuf) -> R) -> R {
    with_buf(|buf| {
        buf.points.clear();
        let out = f(buf);
        buf.points.clear();
        out
    })
}
