// Parameter writes, firmware calls, and tool batches.


fn push_name(names: &mut Vec<String>, value: &Value) {
    if let Some(name) = value.as_str().map(str::trim).filter(|s| !s.is_empty()) {
        names.push(name.to_string());
    }
}

fn param_names(args: &Value) -> Vec<String> {
    let mut names = Vec::new();
    match args.get("names") {
        Some(Value::Array(list)) => {
            for item in list {
                push_name(&mut names, item);
            }
        }
        Some(value) => push_name(&mut names, value),
        None => {}
    }
    if names.is_empty() {
        if let Some(value) = args.get("name") {
            push_name(&mut names, value);
        }
    }
    names.truncate(40);
    names
}

struct ParamChange {
    name: String,
    value: f64,
    reason: String,
}

fn param_changes(args: &Value, require_reason: bool) -> Result<Vec<ParamChange>, String> {
    let shared = args["reason"].as_str().unwrap_or("").trim().to_string();
    if let Some(list) = args.get("changes").and_then(Value::as_array) {
        if list.is_empty() {
            return Err("changes is empty".into());
        }
        if list.len() > 16 {
            return Err("at most 16 changes".into());
        }
        let mut out = Vec::new();
        for item in list {
            let name = item["name"].as_str().unwrap_or("").trim().to_string();
            let Some(value) = item["value"].as_f64() else {
                return Err(format!("value is required for {name}"));
            };
            let own = item["reason"].as_str().unwrap_or("").trim();
            let reason = if own.is_empty() { shared.clone() } else { own.to_string() };
            if name.is_empty() || (require_reason && reason.is_empty()) {
                return Err("each change needs a name and a reason".into());
            }
            out.push(ParamChange { name, value, reason });
        }
        return Ok(out);
    }
    let name = args["name"].as_str().unwrap_or("").trim().to_string();
    let Some(value) = args["value"].as_f64() else {
        return Err("name and value are required".into());
    };
    if name.is_empty() || (require_reason && shared.is_empty()) {
        return Err("name, value, and reason are required".into());
    }
    Ok(vec![ParamChange { name, value, reason: shared }])
}

fn connect_url(args: &Value) -> Result<String, String> {
    if let Some(url) = args["url"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(url.to_string());
    }
    let kind = args["kind"].as_str().unwrap_or("").trim().to_ascii_lowercase();
    let host = args["host"].as_str().unwrap_or("").trim();
    let port = args["port"].as_u64().unwrap_or(0);
    let baud = args["baud"].as_u64().unwrap_or(115200).clamp(9600, 1_500_000);
    match kind.as_str() {
        "tcp" => {
            let host = if host.is_empty() { "127.0.0.1" } else { host };
            let port = if port == 0 { 5760 } else { port };
            if host.contains(':') {
                Ok(format!("tcpout:{host}"))
            } else {
                Ok(format!("tcpout:{host}:{port}"))
            }
        }
        "udp" => {
            if host.is_empty() {
                Ok(format!("udpin:0.0.0.0:{}", if port == 0 { 14550 } else { port }))
            } else if host.contains(':') {
                Ok(format!("udpout:{host}"))
            } else {
                Ok(format!("udpout:{host}:{}", if port == 0 { 14550 } else { port }))
            }
        }
        "serial" => {
            if host.is_empty() {
                return Err("serial needs the port name in host, such as COM11".into());
            }
            Ok(format!("serial:{host}:{baud}"))
        }
        _ => Err("pass url, or kind tcp, udp, or serial".into()),
    }
}

struct WizardSpec {
    name: &'static str,
    copter: bool,
    plane: bool,
}

const WIZARDS: &[WizardSpec] = &[
    WizardSpec { name: "accel", copter: true, plane: true },
    WizardSpec { name: "compass", copter: true, plane: true },
    WizardSpec { name: "compass_mot", copter: true, plane: false },
    WizardSpec { name: "motors", copter: true, plane: false },
    WizardSpec { name: "radio", copter: true, plane: true },
    WizardSpec { name: "modes", copter: true, plane: true },
    WizardSpec { name: "battery", copter: true, plane: true },
    WizardSpec { name: "failsafe", copter: true, plane: true },
    WizardSpec { name: "servos", copter: false, plane: true },
    WizardSpec { name: "airspeed", copter: false, plane: true },
];

fn wizard_spec(name: &str) -> Option<&'static WizardSpec> {
    WIZARDS.iter().find(|item| item.name == name)
}

fn wizard_name_ok(name: &str) -> bool {
    wizard_spec(name).is_some()
}

fn wizard_list() -> String {
    WIZARDS.iter().map(|item| item.name).collect::<Vec<_>>().join(", ")
}

fn wizard_vehicle(spec: &WizardSpec) -> &'static str {
    match (spec.copter, spec.plane) {
        (true, false) => "copter",
        (false, true) => "plane",
        _ => "both",
    }
}

fn wizard_frame_ok(name: &str, frame: &str) -> Result<&'static WizardSpec, String> {
    let Some(spec) = wizard_spec(name) else {
        return Err(format!("wizard must be {}.", wizard_list()));
    };
    let fits = match frame {
        "plane" => spec.plane,
        "copter" => spec.copter,
        _ => false,
    };
    if fits {
        return Ok(spec);
    }
    let need = match (spec.copter, spec.plane) {
        (true, true) => "a copter or a plane",
        (false, true) => "a plane",
        (true, false) => "a copter",
        (false, false) => "a vehicle",
    };
    if frame == "plane" || frame == "copter" {
        Err(format!("{name} is for {need}."))
    } else {
        Err(format!("{name} needs {need} heartbeat."))
    }
}

fn motor_wizard_frame(sample: &Sample) -> Result<(), &'static str> {
    let cls = sample.params.get("FRAME_CLASS").copied();
    let kind = sample.params.get("FRAME_TYPE").copied();
    let (Some(cls), Some(kind)) = (cls, kind) else {
        return Err("Frame parameters have not arrived.");
    };
    let pair = (cls.round() as i64, kind.round() as i64);
    if matches!(pair, (1, 1) | (1, 0) | (1, 18) | (2, 1) | (3, 1) | (5, 1)) {
        Ok(())
    } else {
        Err("This frame has no motor setup wizard.")
    }
}

fn wizard_line(args: &Value, key: &str, max: usize) -> Result<String, String> {
    let text = args[key].as_str().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err(format!("Pass {key} in the user's language."));
    }
    if text.chars().count() > max {
        return Err(format!("{key} is longer than {max} characters."));
    }
    Ok(text)
}

fn wizard_widget(args: &Value, sample: &Sample, c: &Connection, chat: &str) -> Value {
    let wizard = args["wizard"].as_str().unwrap_or("").trim();
    let spec = match wizard_frame_ok(wizard, &sample.frame) {
        Ok(spec) => spec,
        Err(error) => return json!({ "status": "failed", "error": error }),
    };
    let title = match wizard_line(args, "title", 80) {
        Ok(title) => title,
        Err(error) => return json!({ "status": "failed", "error": error }),
    };
    let description = match wizard_line(args, "description", 280) {
        Ok(description) => description,
        Err(error) => return json!({ "status": "failed", "error": error }),
    };
    if wizard == "motors" {
        if let Err(error) = motor_wizard_frame(sample) {
            return json!({ "status": "failed", "error": error, "wizard": "motors" });
        }
    }
    hold_change(
        c,
        chat,
        "wizard",
        wizard,
        None,
        0.0,
        &description,
        &json!({ "wizard": wizard, "title": title, "vehicle": wizard_vehicle(spec) }).to_string(),
    )
}

fn script_change_tool(name: &str, args: &Value, _c: &Connection, chat: &str) -> Value {
    let op = match name {
        "script_write" => "write",
        "script_delete" => "delete",
        "script_restart" => "restart",
        _ => return json!({ "ok": false, "error": "Unknown script action" }),
    };
    match propose_script(
        chat,
        op,
        args["name"].as_str().unwrap_or(""),
        args["body"].as_str().unwrap_or(""),
        args["reason"].as_str().unwrap_or(""),
    ) {
        Ok(value) => value,
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

fn set_param_tool(args: &Value, sample: &Sample, c: &Connection, chat: &str) -> Value {
    let changes = match param_changes(args, true) {
        Ok(changes) => changes,
        Err(error) => return json!({ "status": "failed", "error": error }),
    };
    let live = safe_on(c);
    let book = param_book(sample);
    let mut results = Vec::new();
    for change in changes {
        if let Some(reason) = crate::link::storage_wipe_reason(&change.name, change.value) {
            results.push(json!({"name": change.name, "status": "failed", "error": reason}));
            continue;
        }
        if !live {
            let old = book.values.get(&change.name).map(|seen| seen.value);
            results.push(hold_change(c, chat, "param", &change.name, old, change.value, &change.reason, ""));
            continue;
        }
        audit(c, &format!("param {}", change.name), "direct write", "requested", "agent (safe_mode)");
        results.push(send_param(&change.name, change.value));
    }
    if results.iter().any(|item| item.get("hold").and_then(|v| v.as_bool()) == Some(true)) {
        return json!({ "hold": true, "results": results });
    }
    rollup(results)
}

fn send_param(name: &str, value: f64) -> Value {
    let sent = bridge_post("/cmd", &json!({"op": "param", "name": name, "value": value}), 8);
    if action_failed(&sent) {
        return json!({"name": name, "status": "failed", "error": error_text(&sent)});
    }
    let read = bridge_get(&format!("/param?name={}&fresh=1", url_query(name)), 15);
    if action_failed(&read) {
        return json!({"name": name, "status": "failed", "error": error_text(&read)});
    }
    json!({"name": name, "status": "applied", "value": value, "result": read})
}

fn error_text(value: &Value) -> String {
    value.get("error").and_then(|v| v.as_str()).unwrap_or("The vehicle refused the change").to_string()
}

fn firmware_call(operation: &str, args: &Value) -> Value {
    match crate::firmware::call(operation, args) {
        Ok(value) => value,
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

fn build_progress_state(value: &Value) -> Option<&str> {
    value.get("progress").and_then(|progress| progress.get("state")).and_then(|state| state.as_str())
}

fn build_finished(state: &str) -> bool {
    matches!(state, "SUCCESS" | "FAILURE" | "ERROR" | "TIMED_OUT")
}

fn await_firmware_build(build_id: &str) -> Value {
    let deadline = now().saturating_add(20 * 60);
    let mut failures = 0u32;
    loop {
        if turn_halted() {
            return json!({ "ok": false, "stopped": true, "build_id": build_id, "error": "stopped" });
        }
        let status = firmware_call("build", &json!({ "action": "status", "build_id": build_id }));
        let state = build_progress_state(&status).unwrap_or("").to_string();
        let percent = status.pointer("/progress/percent").and_then(|value| value.as_i64());
        let label = match (state.is_empty(), percent) {
            (false, Some(percent)) => format!("{build_id} {state} {percent}%"),
            (false, None) => format!("{build_id} {state}"),
            _ => format!("{build_id} waiting"),
        };
        live_tool("firmware_build", &json!({ "action": label }));
        if status.get("ok").and_then(|value| value.as_bool()) == Some(false) && state.is_empty() {
            failures += 1;
            if failures >= 5 {
                return status;
            }
        } else {
            failures = 0;
            if build_finished(&state) {
                let mut done = status;
                if state != "SUCCESS" {
                    let logs = firmware_call("build", &json!({ "action": "logs", "build_id": build_id, "tail": 80 }));
                    if let Some(text) = logs.get("logs").and_then(|value| value.as_str()) {
                        let count = text.chars().count();
                        let tail: String = text.chars().skip(count.saturating_sub(6000)).collect();
                        if let Some(obj) = done.as_object_mut() {
                            obj.insert("logs".into(), json!(tail));
                        }
                    }
                }
                if let Some(obj) = done.as_object_mut() {
                    obj.insert("waited".into(), json!(true));
                }
                return done;
            }
        }
        if now() >= deadline {
            let mut status = status;
            if let Some(obj) = status.as_object_mut() {
                obj.insert("waited".into(), json!(true));
                obj.insert("note".into(), json!("The build was still running when the wait ended."));
            }
            return status;
        }
        for _ in 0..10 {
            if turn_halted() {
                return json!({ "ok": false, "stopped": true, "build_id": build_id, "error": "stopped" });
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    }
}

fn bridge_get(path: &str, timeout_s: u64) -> Value {
    match crate::cli::http_get_timeout(path, timeout_s) {
        Ok(text) => parse_bridge(&text),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

fn bridge_post(path: &str, body: &Value, timeout_s: u64) -> Value {
    match crate::cli::http_post_timeout(path, &body.to_string(), timeout_s) {
        Ok(text) => parse_bridge(&text),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

fn parse_bridge(text: &str) -> Value {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed == "ok" {
        return json!({ "ok": true });
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(value) if value.is_object() => value,
        Ok(value) => json!({ "result": value }),
        Err(_) => json!({ "ok": true, "text": trimmed }),
    }
}

fn url_query(text: &str) -> String {
    let mut out = String::new();
    for b in text.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

const RESULT_CAP: usize = 256_000;

fn kept_whole(name: &str) -> bool {
    matches!(name, "log_compute" | "log_query" | "log_schema" | "log_inspect" | "log_params" | "list_params" | "get_param")
}

fn fit_result(name: &str, result: Value) -> Value {
    if kept_whole(name) || result.get("chart").is_some() {
        return result;
    }
    let result = if result.is_object() {
        result
    } else {
        json!({ "result": result })
    };
    let text = result.to_string();
    if text.len() <= RESULT_CAP {
        return result;
    }
    json!({
        "truncated": true,
        "bytes": text.len(),
        "note": concat!(
            "Result was too large. ",
            "Ask for a narrower catalog resource, board, log field, or tail.",
        ),
        "preview": text.chars().take(8_000).collect::<String>(),
    })
}

fn is_hold(value: &Value) -> bool {
    value.get("hold").and_then(|v| v.as_bool()) == Some(true)
}

fn confirmation_pending(result: &Value) -> bool {
    is_hold(result) || result.get("results").and_then(|v| v.as_array()).is_some_and(|rows| rows.iter().any(is_hold))
}

fn hold_ids(result: &Value) -> Vec<String> {
    let mut ids = Vec::new();
    fn take(value: &Value, ids: &mut Vec<String>) {
        if is_hold(value) {
            if let Some(id) = value.get("id").and_then(|v| v.as_str()) {
                ids.push(id.to_string());
            }
        }
        if let Some(rows) = value.get("results").and_then(|v| v.as_array()) {
            for row in rows {
                take(row, ids);
            }
        }
    }
    take(result, &mut ids);
    ids
}

fn note_held(c: &Connection, chat: &str, tool: &str, ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    let body = json!({"tool": tool, "ids": ids}).to_string();
    c.execute(
        "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'held', ?2, ?3)",
        params![chat, body, now()],
    ).ok();
}

fn record_tool(c: &Connection, chat: &str, name: &str, args: &Value, result: &Value) {
    if confirmation_pending(result) {
        note_held(c, chat, name, &hold_ids(result));
        return;
    }
    note_tool(c, chat, name, args, result);
}

fn note_doc(c: &Connection, chat: &str, doc: &Value) {
    let url = doc["url"].as_str().unwrap_or("").trim();
    if url.is_empty() {
        return;
    }
    let body = json!({
        "title": doc["title"].as_str().unwrap_or("Document").trim(),
        "format": doc["format"].as_str().unwrap_or("").trim(),
        "url": url,
    }).to_string();
    c.execute(
        "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'doc', ?2, ?3)",
        params![chat, body, now()],
    ).ok();
}

fn save_assistant(c: &Connection, chat: &str, text: &str) {
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    c.execute(
        "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'assistant', ?2, ?3)",
        params![chat, text, now()],
    ).ok();
}

fn note_tool(c: &Connection, chat: &str, name: &str, args: &Value, result: &Value) {
    let mut output = result.clone();
    let mut line = json!({ "name": name, "input": args, "output": output }).to_string();
    if result.get("chart").is_none() && !kept_whole(name) && line.chars().count() > RESULT_CAP {
        output = match result.as_str() {
            Some(text) => {
                let preview: String = text.chars().take(8_000).collect();
                Value::String(format!("{preview}\n[truncated]\n"))
            }
            None => {
                let preview: String = result.to_string().chars().take(4_000).collect();
                json!({ "truncated": true, "preview": preview })
            }
        };
        line = json!({ "name": name, "input": args, "output": output }).to_string();
    }
    c.execute(
        "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'tool', ?2, ?3)",
        params![chat, line, now()],
    ).ok();
}

fn save_work(c: &Connection, chat: &str, ms: i64) {
    let body = json!({ "ms": ms.max(0) }).to_string();
    c.execute(
        "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'work', ?2, ?3)",
        params![chat, body, now()],
    ).ok();
}

fn call_key(name: &str, args: &Value) -> String {
    format!("{name}\n{args}")
}

fn fresh_calls(planned: &[(String, Value)], seen: &HashMap<String, Value>) -> u32 {
    planned.iter().filter(|(name, args)| !seen.contains_key(&call_key(name, args))).count() as u32
}

fn source_read(frame: &str, args: &Value) -> Value {
    let start = args["start_line"].as_i64().unwrap_or(1);
    let end = args["end_line"].as_i64();
    if let Some(glob) = args["glob"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        return crate::research::source_glob(frame, glob, start);
    }
    let mut paths: Vec<(String, i64, Option<i64>)> = Vec::new();
    if let Some(list) = args["paths"].as_array() {
        for item in list {
            if let Some(path) = item.as_str() {
                paths.push((path.to_string(), start, end));
            } else if let Some(path) = item.get("path").and_then(|v| v.as_str()) {
                let line = item.get("start_line").and_then(|v| v.as_i64()).unwrap_or(start);
                let line_end = item.get("end_line").and_then(|v| v.as_i64()).or(end);
                paths.push((path.to_string(), line, line_end));
            }
        }
    }
    if let Some(path) = args["path"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        paths.push((path.to_string(), start, end));
    }
    if paths.is_empty() {
        return json!({ "ok": false, "error": "pass path, paths, or a glob such as libraries/AP_Motors/*.cpp" });
    }
    if paths.len() == 1 && args.get("paths").is_none() {
        return crate::research::source(frame, &paths[0].0, paths[0].1, paths[0].2);
    }
    crate::research::source_many(frame, &paths)
}

fn runs_in_parallel(name: &str, args: &Value) -> bool {
    match name {
        "set_param" | "set_mode" | "arm" | "disarm" | "reboot" | "erase_vehicle_logs" | "connect"
        | "disconnect" | "vehicle_comment" | "download_vehicle_log" | "show_live"
        | "script_list" | "script_read" | "script_write" | "script_delete" | "script_restart" => false,
        "firmware_build" => !matches!(args["action"].as_str(), Some("submit") | Some("status") | Some("logs") | Some("download")),
        "firmware_flash" => !matches!(args["action"].as_str(), Some("start_bootloader") | Some("prepare")),
        _ => true,
    }
}

fn log_download_wait_s(size: u64, requested: Option<u64>) -> u64 {
    if let Some(seconds) = requested {
        return seconds.clamp(5, 3_600);
    }
    if size == 0 {
        return 180;
    }
    (size / 6_000).clamp(180, 3_600) + 90
}

fn insert_vehicle(obj: &mut serde_json::Map<String, Value>, sample: &Sample) {
    if !sample.boot_uid.is_empty() {
        obj.entry("boot_uid").or_insert(json!(sample.boot_uid));
    }
    if !sample.board_name.is_empty() {
        obj.entry("board").or_insert(json!(sample.board_name));
    }
    if !sample.frame.is_empty() {
        obj.entry("frame").or_insert(json!(sample.frame));
    }
}

fn onboard_log_size(id: u64) -> u64 {
    let list = bridge_get("/logs?refresh=0", 10);
    list["logs"]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["id"].as_u64() == Some(id)))
        .and_then(|row| row["size"].as_u64())
        .unwrap_or(0)
}

fn call_again(value: &Value) -> bool {
    value
        .get("error")
        .and_then(|v| v.as_str())
        .is_some_and(|text| text.contains("still in progress"))
}

fn polling_stopped(system: &str) -> String {
    if system.contains("Ukrainian") {
        "Ці виклики вже повернули результат у цьому ході. Поточний стан — у них, тож я їх не повторюю.".into()
    } else {
        "Those calls already returned in this turn. Their result is the current state, so I am not calling them again.".into()
    }
}

struct ToolBatch {
    results: Vec<Value>,
    waiting: bool,
    all_repeat: bool,
}

const CHARTS_PER_TURN: u32 = 5;

struct ChartBook {
    n: u32,
    slugs: HashSet<String>,
}

impl Default for ChartBook {
    fn default() -> Self {
        Self { n: 0, slugs: HashSet::new() }
    }
}

enum ChartSlot {
    Keep,
    Full,
    Remove { known: bool },
}

fn chart_slug_arg(args: &Value) -> Option<String> {
    args.get("slug").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn admit_chart(book: &mut ChartBook, args: &Value) -> Result<ChartSlot, String> {
    let slug = chart_slug_arg(args);
    let remove = args.get("remove").and_then(|v| v.as_bool()) == Some(true);
    if remove {
        let Some(slug) = slug else {
            return Err("slug is required to remove a chart.".into());
        };
        let known = book.slugs.remove(&slug);
        if known {
            book.n = book.n.saturating_sub(1);
        }
        return Ok(ChartSlot::Remove { known });
    }
    if let Some(slug) = slug {
        if book.slugs.contains(&slug) {
            return Ok(ChartSlot::Keep);
        }
        if book.n >= CHARTS_PER_TURN {
            return Ok(ChartSlot::Full);
        }
        book.slugs.insert(slug);
        book.n += 1;
        return Ok(ChartSlot::Keep);
    }
    if book.n >= CHARTS_PER_TURN {
        return Ok(ChartSlot::Full);
    }
    book.n += 1;
    Ok(ChartSlot::Keep)
}

fn stamp_live(name: &str, value: &mut Value, live_on: &mut bool) {
    if name != "show_live" || value.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return;
    }
    let replaced = *live_on;
    *live_on = true;
    let Some(obj) = value.as_object_mut() else { return };
    obj.insert("replaced".into(), json!(replaced));
    obj.insert(
        "note".into(),
        json!(if replaced {
            "This call replaces the previous live view. A name in missing is not a live field and not a parameter on this vehicle, and it is not drawn."
        } else {
            "This is the live view. A later show_live call replaces it. A name in missing is not a live field and not a parameter on this vehicle, and it is not drawn."
        }),
    );
}

fn run_batch(
    planned: &[(String, Value)],
    seen: &mut HashMap<String, Value>,
    sample: &Sample,
    c: &Connection,
    tx: &Sender<Cmd>,
    chat: &str,
    log_id: &str,
    charts: &mut ChartBook,
    live_on: &mut bool,
) -> ToolBatch {
    let repeat = json!({
        "ok": true,
        "repeat": true,
        "note": "This call already returned in this turn."
    });
    let mut results = vec![Value::Null; planned.len()];
    let mut fresh = Vec::new();
    let mut queued: HashMap<String, usize> = HashMap::new();
    let mut alias = Vec::new();
    for (i, (name, args)) in planned.iter().enumerate() {
        let key = call_key(name, args);
        if seen.get(&key).is_some_and(|prev| !call_again(prev)) {
            results[i] = repeat.clone();
        } else if let Some(&first) = queued.get(&key) {
            alias.push((i, first));
        } else if name == "show_chart" {
            match admit_chart(charts, args) {
                Ok(ChartSlot::Keep) => {
                    queued.insert(key, i);
                    fresh.push(i);
                }
                Ok(ChartSlot::Full) => {
                    let value = json!({ "ok": false, "error": "This turn already has 5 charts." });
                    seen.insert(key, value.clone());
                    record_tool(c, chat, name, args, &value);
                    results[i] = value;
                }
                Ok(ChartSlot::Remove { known }) => {
                    let slug = chart_slug_arg(args).unwrap_or_default();
                    let value = if known {
                        json!({
                            "ok": true,
                            "removed": true,
                            "slug": slug,
                            "note": "The chart with this slug is removed. It is not drawn.",
                        })
                    } else {
                        json!({
                            "ok": true,
                            "removed": false,
                            "slug": slug,
                            "note": "No chart in this turn has this slug.",
                        })
                    };
                    seen.insert(key, value.clone());
                    record_tool(c, chat, name, args, &value);
                    results[i] = value;
                }
                Err(error) => {
                    let value = json!({ "ok": false, "error": error });
                    seen.insert(key, value.clone());
                    record_tool(c, chat, name, args, &value);
                    results[i] = value;
                }
            }
        } else {
            queued.insert(key, i);
            fresh.push(i);
        }
    }
    let parallel = fresh.len() > 1 && fresh.iter().all(|&i| runs_in_parallel(&planned[i].0, &planned[i].1));
    if parallel {
        let label = fresh.iter().map(|&i| planned[i].0.as_str()).collect::<Vec<_>>().join(", ");
        live_tool(&label, &json!({ "n": fresh.len() }));
        let computed: Vec<(usize, Value)> = std::thread::scope(|scope| {
            let mut handles = Vec::new();
            for &i in &fresh {
                let name = planned[i].0.clone();
                let args = planned[i].1.clone();
                let sample = sample.clone();
                let tx = tx.clone();
                let chat = chat.to_string();
                let log_id = log_id.to_string();
                handles.push(scope.spawn(move || {
                    let value = match conn() {
                        Ok(conn) => fit_result(&name, run_tool(&name, &args, &sample, &conn, &tx, &chat, &log_id)),
                        Err(error) => json!({ "ok": false, "error": error }),
                    };
                    (i, value)
                }));
            }
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap_or_else(|_| (usize::MAX, json!({ "ok": false, "error": "tool thread failed" }))))
                .filter(|(i, _)| *i != usize::MAX)
                .collect()
        });
        for (i, value) in computed {
            seen.insert(call_key(&planned[i].0, &planned[i].1), value.clone());
            record_tool(c, chat, &planned[i].0, &planned[i].1, &value);
            results[i] = value;
        }
    } else {
        for &i in &fresh {
            let (name, args) = &planned[i];
            live_tool(name, args);
            let mut value = fit_result(name, run_tool(name, args, sample, c, tx, chat, log_id));
            stamp_live(name, &mut value, live_on);
            seen.insert(call_key(name, args), value.clone());
            record_tool(c, chat, name, args, &value);
            results[i] = value;
        }
    }
    for (i, _) in alias {
        results[i] = repeat.clone();
    }
    let waiting = results.iter().any(confirmation_pending);
    let all_repeat = !results.is_empty() && results.iter().all(|r| r.get("repeat").and_then(|v| v.as_bool()) == Some(true));
    ToolBatch { results, waiting, all_repeat }
}
