// Tool dispatch and the log jobs.


struct SeenParam {
    value: f64,
    live: bool,
}

struct ParamBook {
    linked: bool,
    saved_at: Option<i64>,
    frame: String,
    board_name: String,
    values: HashMap<String, SeenParam>,
}

fn remember_live(sample: &Sample) {
    if sample.params.is_empty() {
        return;
    }
    static LAST: AtomicI64 = AtomicI64::new(0);
    let at = now();
    if at.saturating_sub(LAST.load(Ordering::Relaxed)) < 30 {
        return;
    }
    let full = sample.param_count > 0 && sample.param_indices.len() >= sample.param_count as usize;
    if crate::db::remember_params(&sample.frame, &sample.board_name, &sample.boot_uid, &sample.params, full).is_ok() {
        LAST.store(at, Ordering::Relaxed);
    }
}

fn param_book(sample: &Sample) -> ParamBook {
    remember_live(sample);
    let cached = if sample.ok || !sample.boot_uid.is_empty() || !sample.board_name.is_empty() || !sample.frame.is_empty() {
        crate::db::params_for(&sample.frame, &sample.board_name, &sample.boot_uid).ok().flatten()
    } else {
        crate::db::latest_params().ok().flatten()
    };
    let mut values = HashMap::new();
    let mut saved_at = None;
    let mut frame = String::new();
    let mut board_name = String::new();
    if let Some(cache) = cached {
        saved_at = Some(cache.saved_at);
        frame = cache.frame;
        board_name = cache.board_name;
        for (name, value) in cache.params {
            values.insert(name, SeenParam { value, live: false });
        }
    }
    for (name, value) in &sample.params {
        values.insert(name.clone(), SeenParam { value: *value, live: true });
    }
    if !sample.frame.is_empty() {
        frame = sample.frame.clone();
    }
    if !sample.board_name.is_empty() {
        board_name = sample.board_name.clone();
    }
    ParamBook { linked: sample.ok, saved_at, frame, board_name, values }
}

fn param_rows(book: &ParamBook, names: &[String]) -> Value {
    let params: Vec<_> = names.iter().map(|pname| match book.values.get(pname) {
        Some(seen) => json!({
            "name": pname,
            "value": seen.value,
            "known": true,
            "source": if seen.live { "live" } else { "cached" },
        }),
        None => json!({ "name": pname, "known": false, "note": "This spelling is not in the live link or the saved set." }),
    }).collect();
    json!({
        "linked": book.linked,
        "saved_at": book.saved_at,
        "frame": book.frame,
        "board": book.board_name,
        "params": params,
        "note": "`known: false` means that spelling is not on this vehicle. `source: live` is the link. `source: cached` is the last saved set.",
    })
}

fn run_tool(
    name: &str,
    args: &Value,
    sample: &Sample,
    c: &Connection,
    _tx: &Sender<Cmd>,
    chat: &str,
    log_id: &str,
) -> Value {
    let file = args["file"].as_str().filter(|s| !s.is_empty()).unwrap_or(log_id);
    match name {
        "vehicle_state" => {
            let book = param_book(sample);
            let (controller_key, vehicle_comment) = crate::db::controller_note(sample);
            json!({
                "linked": sample.ok,
                "detail": sample.detail,
                "frame": if sample.frame.is_empty() { book.frame } else { sample.frame.clone() },
                "board": book.board_name,
                "mode": sample.mode,
                "armed": sample.armed,
                "roll_deg": sample.roll,
                "pitch_deg": sample.pitch,
                "yaw_deg": sample.yaw,
                "alt_m": sample.alt,
                "climb_mps": sample.climb,
                "throttle_pct": sample.thr_out,
                "attitude_hz": sample.att_hz,
                "params_received": sample.params.len(),
                "params_expected": sample.param_count,
                "params_complete": sample.param_count > 0 && sample.param_indices.len() >= sample.param_count as usize,
                "params_saved": book.values.len(),
                "params_saved_at": book.saved_at,
                "controller_key": controller_key,
                "vehicle_comment": vehicle_comment,
                "note": "`linked: false` means a change cannot be sent. `detail` is the url while the link is up. `vehicle_comment` is the local note on this vehicle. Empty means none is stored. `controller_key` is the id for the `vehicle_comment` tool.",
            })
        }
        "get_param" => {
            let names = param_names(args);
            if names.is_empty() {
                return json!({ "ok": false, "error": "names is required" });
            }
            param_rows(&param_book(sample), &names)
        }
        "list_params" => {
            let book = param_book(sample);
            let glob = args["glob"].as_str().map(str::trim).filter(|s| !s.is_empty());
            let prefix = args["prefix"].as_str().unwrap_or("").trim().to_ascii_uppercase();
            let mut rows: Vec<_> = book.values.iter()
                .filter(|(k, _)| match glob {
                    Some(pattern) => crate::http::glob_match(pattern, k),
                    None => k.to_ascii_uppercase().starts_with(&prefix),
                })
                .map(|(k, seen)| json!({ "name": k, "value": seen.value, "source": if seen.live { "live" } else { "cached" } }))
                .collect();
            rows.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
            let total = rows.len();
            let truncated = total > 2_000;
            rows.truncate(2_000);
            json!({
                "linked": book.linked,
                "saved_at": book.saved_at,
                "frame": book.frame,
                "board": book.board_name,
                "prefix": prefix,
                "glob": glob.unwrap_or(""),
                "count": total,
                "truncated": truncated,
                "params": rows,
                "note": "`source: live` is the link. `source: cached` is the last saved set.",
            })
        }
        "recent_status" => {
            let n = args["limit"].as_u64().or_else(|| args["n"].as_u64()).unwrap_or(10).clamp(1, 64) as usize;
            json!({ "limit": n, "lines": sample.texts.iter().take(n).cloned().collect::<Vec<_>>() })
        }
        "propose_param" | "set_param" => set_param_tool(args, sample, c, chat),
        "list_logs" => crate::dflog::list_logs(),
        "log_inspect" => log_inspect_tool(args, file),
        "log_params" => log_params_tool(args, file),
        "log_schema" => log_schema_tool(args, file),
        "log_query" => log_query_tool(args, file),
        "log_compute" => log_compute_tool(args, file),
        "show_chart" => crate::dflog::chart(file, args),
        "show_live" => show_live(args, sample),
        "live_fields" => live_fields(args),
        "live_buffer" => live_buffer(args),
        "param_doc" => {
            let names = param_names(args);
            if names.is_empty() {
                json!("<metadata>\nok: false\nerror: Pass names: one exact parameter name, or a list of them, at most 40.\n</metadata>\n")
            } else {
                let blocks: Vec<String> = names.iter().map(|name| {
                    crate::research::param_doc(&sample.frame, name).as_str().unwrap_or("").to_string()
                }).collect();
                let mut text = format!("<metadata>\nok: true\ncount: {}\n</metadata>\n", blocks.len());
                for block in blocks {
                    text.push_str(&block);
                }
                json!(text)
            }
        },
        "ardupilot_doc" => crate::research::wiki(
            &sample.frame,
            args["query"].as_str().unwrap_or(""),
            args.get("offset").and_then(|v| v.as_u64()).map(|n| n as usize),
        ),
        "web_search" => crate::research::web_search(args["query"].as_str().unwrap_or("")),
        "web_fetch" => crate::research::web_fetch(args["url"].as_str().unwrap_or("")),
        "firmware_source_read" => source_read(&sample.frame, args),
        "firmware_catalog" => firmware_call("catalog", args),
        "firmware_build" => match args["action"].as_str() {
            Some("submit") => {
                audit(c, "firmware build", "submit custom firmware plan", "requested", "agent");
                let submitted = firmware_call("build", args);
                let build_id = submitted["build_id"].as_str().unwrap_or("").to_string();
                if build_id.is_empty() || submitted.get("ok").and_then(|v| v.as_bool()) == Some(false) {
                    submitted
                } else {
                    json!({ "build_id": build_id, "submitted": submitted, "build": await_firmware_build(&build_id) })
                }
            }
            Some("status") => {
                let build_id = args["build_id"].as_str().unwrap_or("").to_string();
                if build_id.is_empty() {
                    json!({ "ok": false, "error": "build_id is required" })
                } else {
                    await_firmware_build(&build_id)
                }
            }
            Some("logs") => {
                let build_id = args["build_id"].as_str().unwrap_or("").to_string();
                if build_id.is_empty() {
                    json!({ "ok": false, "error": "build_id is required" })
                } else {
                    let status = firmware_call("build", &json!({ "action": "status", "build_id": build_id }));
                    let state = build_progress_state(&status).unwrap_or("");
                    if !state.is_empty() && !build_finished(state) {
                        let _ = await_firmware_build(&build_id);
                    }
                    firmware_call("build", args)
                }
            }
            _ => firmware_call("build", args),
        }
        "firmware_library" => bridge_get("/firmware-library", 15),
        "vehicle_comment" => {
            let comment = args.get("comment").and_then(|v| v.as_str()).unwrap_or("").trim();
            if comment.chars().count() > 2_000 {
                return json!({ "ok": false, "error": "Comment must contain at most 2000 characters" });
            }
            let key = args.get("controller_key").and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty());
            let Some(key) = key else {
                return json!({ "ok": false, "error": "controller_key is required" });
            };
            let payload = json!({ "controller_key": key, "comment": comment }).to_string();
            hold_change(c, chat, "comment", "Vehicle comment", None, 0.0, "", &payload)
        }
        "firmware_flash" => {
            let action = args["action"].as_str().unwrap_or("");
            if action == "start_bootloader" && !safe_on(c) {
                return hold_change(c, chat, "flash", "Flash firmware", None, 0.0, "", &args.to_string());
            }
            if action == "start_bootloader" {
                audit(c, "firmware flash", "start bootloader", "requested", "agent (safe_mode)");
            }
            bridge_post("/firmware/flash", args, 60)
        }
        "vehicle_logs" => {
            let refresh = args["refresh"].as_bool().unwrap_or(true);
            let mut value = bridge_get(&format!("/logs?refresh={}", if refresh { 1 } else { 0 }), 20);
            if let Some(logs) = value.get_mut("logs").and_then(|v| v.as_array_mut()) {
                for log in logs.iter_mut() {
                    if let Some(obj) = log.as_object_mut() {
                        obj.insert("source".into(), json!("onboard"));
                        let onboard = obj.get("id").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        let size = obj.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
                        if let Some(local) = crate::dflog::local_copy(onboard, size) {
                            obj.insert("local".into(), local);
                        }
                    }
                }
            }
            if let Some(obj) = value.as_object_mut() {
                obj.entry("source").or_insert(json!("onboard"));
                insert_vehicle(obj, sample);
                obj.insert("note".into(), json!(concat!(
                    "`time_utc: 0` means the vehicle sent no clock time. ",
                    "`source` is `onboard`. ",
                    "`boot_uid`, `board`, and `frame` are the linked vehicle. ",
                    "`local`, when present, is a file already on this computer with this onboard id and this exact size. ",
                    "`local.id` is the file for the local tools. ",
                    "`local.sha256_16` is the hash of those bytes when the file name carries it. ",
                    "`local.vehicle` is the directory, and `local.flight_stamp` is the time in the file name. ",
                    "A different size is a different recording and has no `local`. ",
                    "`sha256_16` is absent until the bytes are stored.",
                )));
            }
            value
        }
        "download_vehicle_log" => {
            let id = args["log_id"].as_u64().unwrap_or(0);
            let size = onboard_log_size(id);
            let force = args["force_download"].as_bool() == Some(true);
            if !force {
                if let Some(local) = crate::dflog::local_copy(id as u32, size) {
                    let mut row = json!({
                        "ok": true,
                        "already": true,
                        "id": local["id"],
                        "file": local["id"],
                        "name": local["name"],
                        "path": local["path"],
                        "bytes": local["bytes"],
                        "note": concat!(
                            "This recording is already on this computer. ",
                            "file is the id for the local tools. ",
                            "sha256_16 is the hash of those bytes when the name carries it. ",
                            "Nothing was transferred. ",
                            "force_download transfers it again, and only when the user asked to download this recording again.",
                        ),
                    });
                    if let Some(obj) = row.as_object_mut() {
                        for key in ["sha256_16", "vehicle", "flight_stamp"] {
                            if let Some(value) = local.get(key).filter(|v| !v.is_null()) {
                                obj.insert(key.to_string(), value.clone());
                            }
                        }
                        insert_vehicle(obj, sample);
                    }
                    return row;
                }
            }
            let timeout = log_download_wait_s(size, args["timeout_s"].as_u64());
            let mut saved = bridge_get(&format!("/logs/download?id={id}&timeout_s={timeout}"), timeout + 15);
            if let Some(obj) = saved.as_object_mut() {
                insert_vehicle(obj, sample);
                if let Some(path) = obj.get("path").and_then(|v| v.as_str()).map(str::to_string) {
                    if let Some(file) = crate::dflog::relative_log_id(&path) {
                        obj.insert("file".into(), json!(file));
                        if let Some(parts) = crate::dflog::stored_name_parts(&file).as_object().cloned() {
                            for (key, value) in parts {
                                obj.entry(key).or_insert(value);
                            }
                        }
                        let reading = "file is the id for the local tools. sha256_16 is the hash of the file contents when the name carries it. vehicle is the directory. flight_stamp is the time in that name.";
                        let note = match obj.get("note").and_then(|v| v.as_str()) {
                            Some(have) => format!("{have} {reading}"),
                            None => reading.to_string(),
                        };
                        obj.insert("note".into(), json!(note));
                    }
                }
            }
            saved
        }
        "erase_vehicle_logs" => {
            if args["confirm"].as_bool() != Some(true) {
                return json!({ "ok": false, "error": "Erasing DataFlash logs is permanent; pass confirm true" });
            }
            if !safe_on(c) {
                return hold_change(c, chat, "erase_logs", "Erase on-board logs", None, 0.0, "", "");
            }
            audit(c, "erase logs", "confirm true", "requested", "agent (safe_mode)");
            bridge_post("/logs/erase", &json!({"confirm": true}), 15)
        }
        "diagnostics" => {
            if args["refresh"].as_bool().unwrap_or(false) {
                bridge_post("/cmd", &json!({"op": "diagnostics"}), 8);
            }
            bridge_get("/diagnostics", 15)
        }
        "connect" => match connect_url(args) {
            Ok(url) => {
                let state = bridge_get("/state", 3);
                if connect_already_up(&state, &url, now_f64()) {
                    return already_up_result(&state);
                }
                if !safe_on(c) {
                    return hold_change(c, chat, "connect", "Connect", None, 0.0, "", &url);
                }
                audit(c, "connect", &url, "requested", "agent (safe_mode)");
                run_link_wait(c, chat, "connect", "Connect", &url)
            }
            Err(error) => json!({ "ok": false, "error": error }),
        },
        "set_mode" => {
            let mode = args["mode"].as_str().unwrap_or("").trim();
            if mode.is_empty() {
                return json!({ "ok": false, "error": "mode is required" });
            }
            if !safe_on(c) {
                return hold_change(c, chat, "mode", mode, None, 0.0, "", "");
            }
            audit(c, &format!("mode {mode}"), "assistant mode", "requested", "agent (safe_mode)");
            bridge_post("/cmd", &json!({"op": "mode", "mode": mode}), 15)
        }
        "arm" => {
            if !safe_on(c) {
                return hold_change(c, chat, "arm", "Arm", None, 0.0, "", "");
            }
            audit(c, "arm", "assistant arm", "requested", "agent (safe_mode)");
            bridge_post("/cmd", &json!({"op": "arm", "on": true}), 8)
        }
        "disarm" => {
            if !safe_on(c) {
                return hold_change(c, chat, "disarm", "Disarm", None, 0.0, "", "");
            }
            audit(c, "disarm", "assistant disarm", "requested", "agent (safe_mode)");
            bridge_post("/cmd", &json!({"op": "arm", "on": false}), 8)
        }
        "reboot" => {
            if !safe_on(c) {
                return hold_change(c, chat, "reboot", "Reboot", None, 0.0, "", "");
            }
            audit(c, "reboot", "assistant reboot", "requested", "agent (safe_mode)");
            run_link_wait(c, chat, "reboot", "Reboot", "")
        }
        "disconnect" => {
            if !safe_on(c) {
                return hold_change(c, chat, "disconnect", "Disconnect", None, 0.0, "", "");
            }
            audit(c, "disconnect", "assistant disconnect", "requested", "agent (safe_mode)");
            run_link_wait(c, chat, "disconnect", "Disconnect", "")
        },
        "script_list" => bridge_get("/scripts", 15),
        "script_read" => {
            let name = args["name"].as_str().unwrap_or("").trim();
            if name.is_empty() {
                return json!({ "ok": false, "error": "name is required" });
            }
            bridge_get(&format!("/scripts/file?name={}", url_query(name)), 20)
        }
        "script_write" | "script_delete" | "script_restart" => script_change_tool(name, args, c, chat),
        "wizard_widget" => wizard_widget(args, sample, c, chat),
        "health" => bridge_get("/health", 8),
        _ => json!({ "error": "unknown tool" }),
    }
}

fn arg_strings(args: &Value, plural: &str, single: &str, limit: usize) -> Vec<String> {
    let mut names = Vec::new();
    if let Some(list) = args.get(plural).and_then(Value::as_array) {
        for item in list {
            if let Some(name) = item.as_str().map(str::trim).filter(|s| !s.is_empty()) {
                names.push(name.to_string());
            }
        }
    }
    if names.is_empty() {
        if let Some(name) = args[single].as_str().map(str::trim).filter(|s| !s.is_empty()) {
            names.push(name.to_string());
        }
    }
    names.truncate(limit);
    names
}

fn log_inspect_tool(args: &Value, file: &str) -> Value {
    let files = arg_strings(args, "files", "file", 4);
    let files = if files.is_empty() && !file.is_empty() { vec![file.to_string()] } else { files };
    if files.is_empty() {
        return json!({ "ok": false, "error": "file is required. file is an id from list_logs, or local.id from vehicle_logs." });
    }
    if files.len() == 1 {
        return crate::dflog::inspect(&files[0]);
    }
    let logs: Vec<Value> = files.iter().map(|id| crate::dflog::inspect(id)).collect();
    json!({ "ok": true, "count": logs.len(), "logs": logs })
}

fn log_params_tool(args: &Value, file: &str) -> Value {
    if file.is_empty() {
        return json!({ "ok": false, "error": "file is required. file is an id from list_logs, or local.id from vehicle_logs." });
    }
    let names = arg_strings(args, "names", "name", 40);
    crate::dflog::log_params(file, &names)
}

fn with_log_hash(file: &str, mut value: Value) -> Value {
    let Some(hash) = crate::dflog::file_hash(file) else { return value };
    if let Some(obj) = value.as_object_mut() {
        obj.entry("sha256_16").or_insert(json!(hash));
    }
    value
}

fn log_schema_tool(args: &Value, file: &str) -> Value {
    if file.is_empty() {
        return json!({ "ok": false, "error": "file is required. Use an id from list_logs." });
    }
    let messages = arg_strings(args, "messages", "message", 12);
    if messages.is_empty() {
        return crate::dflog::schema(file, "");
    }
    if messages.len() == 1 {
        return with_log_hash(file, crate::dflog::schema(file, &messages[0]));
    }
    let schemas: Vec<Value> = messages.iter().map(|message| crate::dflog::schema(file, message)).collect();
    with_log_hash(file, json!({ "ok": true, "file": file, "count": schemas.len(), "schemas": schemas }))
}

fn log_query_tool(args: &Value, file: &str) -> Value {
    if file.is_empty() {
        return json!({ "ok": false, "error": "file is required. Use an id from list_logs." });
    }
    if let Some(list) = args.get("queries").and_then(Value::as_array) {
        if list.is_empty() {
            return json!({ "ok": false, "error": "queries is empty. Each item needs message." });
        }
        if list.len() > 16 {
            return json!({ "ok": false, "error": "at most 16 queries in one call." });
        }
        let results: Vec<Value> = list.iter().map(|item| {
            crate::dflog::query(
                file,
                item["message"].as_str().unwrap_or(""),
                item["start_us"].as_u64(),
                item["end_us"].as_u64(),
                item["cursor"].as_u64().unwrap_or(0),
                item["limit"].as_u64().unwrap_or(50),
            )
        }).collect();
        return with_log_hash(file, json!({ "ok": true, "file": file, "count": results.len(), "results": results }));
    }
    with_log_hash(file, crate::dflog::query(
        file,
        args["message"].as_str().unwrap_or(""),
        args["start_us"].as_u64(),
        args["end_us"].as_u64(),
        args["cursor"].as_u64().unwrap_or(0),
        args["limit"].as_u64().unwrap_or(50),
    ))
}

fn note_interval(obj: &mut serde_json::Map<String, Value>) {
    if obj.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return;
    }
    let Some(note) = obj.get("note").and_then(|v| v.as_str()) else { return };
    if note.contains("does not describe one of those stretches") {
        return;
    }
    let note = format!("{note} Every number is the interval of this job. Time outside start_us and end_us is not in the number. An interval that contains more than one mode stretch does not describe one of those stretches.");
    obj.insert("note".into(), json!(note));
}

fn log_compute_tool(args: &Value, file: &str) -> Value {
    if file.is_empty() {
        return json!({ "ok": false, "error": "file is required. file is an id from list_logs, or local.id from vehicle_logs." });
    }
    if let Some(list) = args.get("jobs").and_then(Value::as_array) {
        if list.is_empty() {
            return json!({ "ok": false, "error": "jobs is empty. Each item needs message, field, and op." });
        }
        if list.len() > 16 {
            return json!({ "ok": false, "error": "at most 16 jobs in one call." });
        }
        let batch = list.len() > 1;
        let mut seen_ops = HashSet::new();
        let results: Vec<Value> = list.iter().map(|item| {
            let message = item["message"].as_str().unwrap_or("");
            let field = item["field"].as_str().unwrap_or("");
            let op = item["op"].as_str().unwrap_or("");
            let mut value = crate::dflog::compute(
                file,
                message,
                field,
                op,
                item["start_us"].as_u64().or_else(|| args["start_us"].as_u64()),
                item["end_us"].as_u64().or_else(|| args["end_us"].as_u64()),
            );
            if let Some(obj) = value.as_object_mut() {
                obj.insert("message".into(), json!(message));
                obj.insert("field".into(), json!(field));
                note_interval(obj);
                if batch && !seen_ops.insert(op.to_ascii_lowercase()) {
                    obj.remove("note");
                }
            }
            value
        }).collect();
        return with_log_hash(file, json!({ "ok": true, "file": file, "count": results.len(), "results": results }));
    }
    let mut value = crate::dflog::compute(
        file,
        args["message"].as_str().unwrap_or(""),
        args["field"].as_str().unwrap_or(""),
        args["op"].as_str().unwrap_or(""),
        args["start_us"].as_u64(),
        args["end_us"].as_u64(),
    );
    if let Some(obj) = value.as_object_mut() {
        note_interval(obj);
    }
    with_log_hash(file, value)
}

const LIVE_CHARTS: usize = 5;
const LIVE_LINES: usize = 8;

fn live_fields(_args: &Value) -> Value {
    crate::link::live_catalog()
}

fn live_buffer(args: &Value) -> Value {
    let names = match args.get("lines").and_then(|v| v.as_array()) {
        Some(rows) => rows.iter().filter_map(|v| v.as_str().map(str::to_string)).collect::<Vec<_>>(),
        None => args.get("line").and_then(|v| v.as_str()).map(|s| vec![s.to_string()]).unwrap_or_default(),
    };
    if names.is_empty() {
        return json!({ "ok": false, "error": "Pass lines, at most 8 live field ids." });
    }
    if names.len() > LIVE_LINES {
        return json!({ "ok": false, "error": "At most 8 lines." });
    }
    let seconds = args.get("seconds").and_then(|v| v.as_f64()).unwrap_or(8.0);
    crate::link::query_live(&names, seconds)
}

fn show_live(args: &Value, sample: &Sample) -> Value {
    let Some(charts) = args.get("charts").and_then(|v| v.as_array()) else {
        return json!({ "ok": false, "error": "Pass charts. At most 5. Each chart has a title and lines." });
    };
    if charts.is_empty() {
        return json!({ "ok": false, "error": "Pass charts. At most 5. Each chart has a title and lines." });
    }
    if charts.len() > LIVE_CHARTS {
        return json!({ "ok": false, "error": "At most 5 charts." });
    }
    let book = param_book(sample);
    let mut drawn = Vec::new();
    let mut missing = Vec::new();
    for chart in charts {
        let Some(lines) = chart.get("lines").and_then(|v| v.as_array()) else {
            return json!({ "ok": false, "error": "Each chart needs lines." });
        };
        if lines.is_empty() {
            return json!({ "ok": false, "error": "Each chart needs lines." });
        }
        if lines.len() > LIVE_LINES {
            return json!({ "ok": false, "error": "At most 8 lines on one chart." });
        }
        let title = chart.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
        let mut kept = Vec::new();
        let mut seen = HashSet::new();
        for line in lines {
            let Some(raw) = line.as_str().map(str::trim).filter(|s| !s.is_empty()) else {
                missing.push("(not a name)".to_string());
                continue;
            };
            let Some(hit) = resolve_live_line(raw, &book) else {
                missing.push(raw.to_string());
                continue;
            };
            if !seen.insert(hit.0.to_string()) {
                continue;
            }
            kept.push(json!({ "id": hit.0, "label": hit.1, "kind": hit.2 }));
        }
        if kept.is_empty() {
            continue;
        }
        let title = if title.is_empty() {
            kept.iter().filter_map(|row| row["label"].as_str()).collect::<Vec<_>>().join(", ")
        } else {
            title.chars().take(80).collect()
        };
        drawn.push(json!({ "title": title, "lines": kept }));
    }
    if drawn.is_empty() {
        return json!({
            "ok": false,
            "error": "None of the lines can be drawn.",
            "missing": missing,
        });
    }
    json!({ "ok": true, "charts": drawn, "missing": missing })
}

fn resolve_live_line<'a>(raw: &str, book: &'a ParamBook) -> Option<(String, String, &'static str)> {
    if let Some((id, label, _)) = crate::link::live_meta(raw) {
        return Some((id, label, "live"));
    }
    let name = raw.strip_prefix("p:").unwrap_or(raw).trim();
    let hit = book.values.keys().find(|key| key.eq_ignore_ascii_case(name))?;
    Some((format!("p:{hit}"), hit.clone(), "param"))
}
