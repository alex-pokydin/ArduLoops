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

struct MavCmdSpec {
    command_id: u16,
    title: String,
    param7: f32,
    reason: String,
    payload: Value,
}

fn mav_cmd_name(id: u16) -> &'static str {
    match id {
        16 => "Waypoint",
        17 => "Loiter",
        18 => "Loiter turns",
        19 => "Loiter time",
        20 => "Return to launch",
        21 => "Land",
        22 => "Takeoff",
        82 => "Spline waypoint",
        176 => "Set mode",
        177 => "Jump",
        178 => "Change speed",
        179 => "Set home",
        181 => "Set relay",
        182 => "Repeat relay",
        183 => "Set servo",
        184 => "Repeat servo",
        192 => "Reposition",
        195 => "Set ROI",
        203 => "Camera control",
        205 => "Mount control",
        207 => "Fence enable",
        208 => "Parachute",
        209 => "Motor test",
        210 => "Inverted flight",
        211 => "Gripper",
        212 => "Autotune enable",
        214 => "Camera trigger distance",
        241 => "Preflight calibration",
        246 => "Reboot/shutdown",
        400 => "Arm/disarm",
        511 => "Set message interval",
        512 => "Request message",
        3000 => "VTOL transition",
        _ => "COMMAND_LONG",
    }
}

fn resolve_mav_cmd(name: &str) -> Option<(u16, &'static str)> {
    if let Ok(id) = name.trim().parse::<u16>() {
        return Some((id, mav_cmd_name(id)));
    }
    let norm = name.trim().to_ascii_uppercase();
    let clean = norm
        .strip_prefix("MAV_CMD_")
        .or_else(|| norm.strip_prefix("CMD_"))
        .unwrap_or(&norm);

    match clean {
        "NAV_TAKEOFF" | "TAKEOFF" => Some((22, "Takeoff")),
        "NAV_LAND" | "LAND" => Some((21, "Land")),
        "NAV_RETURN_TO_LAUNCH" | "RTL" | "RETURN_TO_LAUNCH" => Some((20, "Return to launch")),
        "NAV_LOITER_UNLIM" | "LOITER_UNLIM" | "LOITER" => Some((17, "Loiter")),
        "NAV_LOITER_TURNS" => Some((18, "Loiter turns")),
        "NAV_LOITER_TIME" => Some((19, "Loiter time")),
        "NAV_WAYPOINT" | "WAYPOINT" => Some((16, "Waypoint")),
        "NAV_SPLINE_WAYPOINT" => Some((82, "Spline waypoint")),
        "DO_SET_MODE" | "SET_MODE" => Some((176, "Set mode")),
        "DO_JUMP" => Some((177, "Jump")),
        "DO_CHANGE_SPEED" | "CHANGE_SPEED" => Some((178, "Change speed")),
        "DO_SET_HOME" | "SET_HOME" => Some((179, "Set home")),
        "DO_SET_RELAY" => Some((181, "Set relay")),
        "DO_REPEAT_RELAY" => Some((182, "Repeat relay")),
        "DO_SET_SERVO" | "SET_SERVO" => Some((183, "Set servo")),
        "DO_REPEAT_SERVO" => Some((184, "Repeat servo")),
        "DO_REPOSITION" | "REPOSITION" => Some((192, "Reposition")),
        "DO_SET_ROI" => Some((195, "Set ROI")),
        "DO_DIGICAM_CONTROL" => Some((203, "Camera control")),
        "DO_MOUNT_CONTROL" => Some((205, "Mount control")),
        "DO_SET_CAM_TRIGG_DIST" => Some((214, "Camera trigger distance")),
        "DO_FENCE_ENABLE" => Some((207, "Fence enable")),
        "DO_PARACHUTE" => Some((208, "Parachute")),
        "DO_MOTOR_TEST" => Some((209, "Motor test")),
        "DO_INVERTED_FLIGHT" => Some((210, "Inverted flight")),
        "DO_GRIPPER" => Some((211, "Gripper")),
        "DO_AUTOTUNE_ENABLE" | "AUTOTUNE_ENABLE" => Some((212, "Autotune enable")),
        "DO_VTOL_TRANSITION" | "VTOL_TRANSITION" => Some((3000, "VTOL transition")),
        "COMPONENT_ARM_DISARM" | "ARM_DISARM" => Some((400, "Arm/disarm")),
        "PREFLIGHT_CALIBRATION" => Some((241, "Preflight calibration")),
        "PREFLIGHT_REBOOT_SHUTDOWN" => Some((246, "Reboot/shutdown")),
        "SET_MESSAGE_INTERVAL" => Some((511, "Set message interval")),
        "REQUEST_MESSAGE" => Some((512, "Request message")),
        _ => None,
    }
}

fn parse_mav_cmd_spec(val: &Value) -> Result<MavCmdSpec, String> {
    let cmd_str = match val.get("command") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => return Err("command must be a string name or integer ID".into()),
    };
    let (cmd_id, default_label) = resolve_mav_cmd(&cmd_str)
        .ok_or_else(|| format!("Unknown MAVLink command: {cmd_str}"))?;

    let p = val.get("params").unwrap_or(val);
    let mut p1 = p.get("param1").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    let mut p2 = p.get("param2").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    let p3 = p.get("param3").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    let mut p4 = p.get("param4").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    let mut p5 = p.get("param5").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    let mut p6 = p.get("param6").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    let mut p7 = p.get("param7").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;

    if cmd_id == 22 {
        if let Some(alt) = p.get("alt_m").or_else(|| p.get("alt")).or_else(|| p.get("altitude")).and_then(|v| v.as_f64()) {
            p7 = alt as f32;
        }
        if let Some(pitch) = p.get("pitch").and_then(|v| v.as_f64()) {
            p1 = pitch as f32;
        }
    } else if cmd_id == 178 {
        if let Some(spd) = p.get("speed_mps").or_else(|| p.get("speed")).and_then(|v| v.as_f64()) {
            p2 = spd as f32;
        }
    } else if cmd_id == 183 {
        if let Some(srv) = p.get("servo").and_then(|v| v.as_f64()) {
            p1 = srv as f32;
        }
        if let Some(pwm) = p.get("pwm").and_then(|v| v.as_f64()) {
            p2 = pwm as f32;
        }
    } else if cmd_id == 181 {
        if let Some(r) = p.get("relay").and_then(|v| v.as_f64()) {
            p1 = r as f32;
        }
        if let Some(on) = p.get("on").and_then(|v| v.as_bool()) {
            p2 = if on { 1.0 } else { 0.0 };
        }
    } else if cmd_id == 192 {
        if let Some(spd) = p.get("speed_mps").and_then(|v| v.as_f64()) {
            p2 = spd as f32;
        }
        if let Some(yaw) = p.get("yaw_deg").and_then(|v| v.as_f64()) {
            p4 = yaw as f32;
        }
        if let Some(lat) = p.get("lat").and_then(|v| v.as_f64()) {
            p5 = lat as f32;
        }
        if let Some(lon) = p.get("lon").and_then(|v| v.as_f64()) {
            p6 = lon as f32;
        }
        if let Some(alt) = p.get("alt_m").or_else(|| p.get("alt")).and_then(|v| v.as_f64()) {
            p7 = alt as f32;
        }
    }

    if cmd_id == 245 && (p1.round() as i32) == 2 {
        return Err("Refused: clearing storage is not allowed".into());
    }

    let title = if cmd_id == 22 && p7 > 0.0 {
        format!("Takeoff ({p7} m)")
    } else if cmd_id == 183 {
        format!("Set servo {p1} = {p2}")
    } else if cmd_id == 178 && p2 > 0.0 {
        format!("Change speed ({p2} m/s)")
    } else if cmd_id == 176 {
        format!("Set mode (custom={p2})")
    } else {
        default_label.to_string()
    };

    let reason = val.get("reason").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();

    let payload = json!({
        "op": "command_long",
        "command": cmd_id,
        "param1": p1,
        "param2": p2,
        "param3": p3,
        "param4": p4,
        "param5": p5,
        "param6": p6,
        "param7": p7,
    });

    Ok(MavCmdSpec {
        command_id: cmd_id,
        title,
        param7: p7,
        reason,
        payload,
    })
}

fn mav_command_tool(args: &Value, sample: &Sample, c: &Connection, chat: &str) -> Value {
    let safe = safe_on_for(c, sample);
    let actor = if sample.is_simulator() { "agent (sitl)" } else { "agent (safe_mode)" };
    let raw_cmds = if let Some(arr) = args["commands"].as_array() {
        arr.clone()
    } else if args.get("command").is_some() {
        vec![args.clone()]
    } else {
        return json!({ "ok": false, "error": "commands is required" });
    };
    if raw_cmds.is_empty() {
        return json!({ "ok": false, "error": "commands array is empty" });
    }

    let mut parsed = Vec::new();
    for raw in &raw_cmds {
        match parse_mav_cmd_spec(raw) {
            Ok(spec) => parsed.push(spec),
            Err(err) => return json!({ "ok": false, "error": err }),
        }
    }

    let mut results = Vec::new();
    for spec in parsed {
        if !safe {
            results.push(hold_change(
                c,
                chat,
                "mav_cmd",
                &spec.title,
                None,
                spec.param7 as f64,
                &spec.reason,
                &spec.payload.to_string(),
            ));
            continue;
        }

        audit(c, &format!("mav_cmd {}", spec.title), &spec.reason, "requested", actor);
        let res = bridge_post("/cmd", &spec.payload, 15);
        if action_failed(&res) {
            results.push(json!({
                "command": spec.title,
                "status": "failed",
                "error": error_text(&res)
            }));
            break;
        } else {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let cur = bridge_get("/sample", 2);
            let mut res_item = json!({
                "command": spec.title,
                "status": "applied",
                "id": spec.command_id
            });
            if let Some(arr) = cur.get("texts").and_then(Value::as_array) {
                let texts: Vec<&str> = arr.iter().filter_map(Value::as_str).take(3).collect();
                if !texts.is_empty() {
                    res_item["status_text"] = json!(texts);
                }
            }
            record_applied_change(
                c,
                chat,
                "mav_cmd",
                &spec.title,
                None,
                spec.param7 as f64,
                &spec.reason,
                &spec.payload.to_string(),
            );
            results.push(res_item);
        }
    }

    if results.iter().any(|item| item.get("hold").and_then(|v| v.as_bool()) == Some(true)) {
        return json!({ "hold": true, "results": results });
    }
    if results.len() == 1 {
        return results.pop().unwrap_or(json!({ "status": "applied" }));
    }
    json!({ "status": "applied", "results": results })
}

fn wait_tool(args: &Value, c: &Connection, chat: &str) -> Value {
    let seconds = args["seconds"]
        .as_f64()
        .or_else(|| args["seconds"].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(5.0)
        .clamp(0.5, 60.0);
    let reason = args["reason"].as_str().unwrap_or("").trim();
    let target_alt = args["target_alt_m"].as_f64();
    let target_mode = args["target_mode"].as_str().map(|s| s.trim().to_ascii_uppercase());

    let mut title_parts = Vec::new();
    if let Some(ref mode) = target_mode {
        title_parts.push(format!("mode {mode}"));
    }
    if let Some(alt) = target_alt {
        title_parts.push(format!("alt {alt}m"));
    }
    let card_title = if !title_parts.is_empty() {
        format!("Wait (target {} · max {:.0}s)", title_parts.join(", "), seconds)
    } else {
        format!("Wait {:.1}s", seconds)
    };

    let prop_id = if !chat.is_empty() {
        let id = Uuid::new_v4().to_string();
        let payload = json!({
            "seconds": seconds,
            "target_alt_m": target_alt,
            "target_mode": target_mode,
            "reason": reason,
        });
        c.execute(
            "INSERT INTO ai_proposal (id, chat_id, status, param, old_value, new_value, reason, created_at, kind, payload) VALUES (?1,?2,'waiting',?3,NULL,?4,?5,?6,'wait',?7)",
            params![id, chat, &card_title, seconds, reason, now(), payload.to_string()],
        ).ok();
        Some(id)
    } else {
        None
    };

    let start = std::time::Instant::now();
    let duration = std::time::Duration::from_secs_f64(seconds);
    let step = std::time::Duration::from_millis(250);

    let mut condition_met = false;
    let mut cancelled = false;
    let mut last_sample = bridge_get("/sample", 5);

    while start.elapsed() < duration {
        let sleep_time = step.min(duration.saturating_sub(start.elapsed()));
        std::thread::sleep(sleep_time);

        if let Some(ref id) = prop_id {
            let is_rejected: bool = c.query_row(
                "SELECT status FROM ai_proposal WHERE id=?1",
                [id],
                |r| r.get::<_, String>(0),
            ).map(|st| st == "rejected_by_user").unwrap_or(false);
            if is_rejected {
                cancelled = true;
                break;
            }
        }

        last_sample = bridge_get("/sample", 3);

        if let Some(ref want_mode) = target_mode {
            if let Some(cur_mode) = last_sample.get("mode").and_then(Value::as_str) {
                if cur_mode.eq_ignore_ascii_case(want_mode) {
                    condition_met = true;
                    break;
                }
            }
        }

        if let Some(want_alt) = target_alt {
            if let Some(alt) = last_sample.get("alt").and_then(Value::as_f64) {
                if (alt - want_alt).abs() <= 1.0 || (want_alt > 0.0 && alt >= want_alt) {
                    condition_met = true;
                    break;
                }
            }
        }
    }

    let elapsed = (start.elapsed().as_secs_f64() * 10.0).round() / 10.0;

    if let Some(ref id) = prop_id {
        if cancelled {
            let cancel_title = format!("Wait cancelled ({elapsed}s)");
            c.execute(
                "UPDATE ai_proposal SET status='cancelled', param=?1, new_value=?2 WHERE id=?3",
                params![cancel_title, elapsed, id],
            ).ok();
        } else {
            let done_title = if condition_met {
                format!("Condition reached in {elapsed}s")
            } else {
                format!("Waited {elapsed}s")
            };
            c.execute(
                "UPDATE ai_proposal SET status='completed', param=?1, new_value=?2 WHERE id=?3",
                params![done_title, elapsed, id],
            ).ok();
        }
    }

    let mut out = serde_json::Map::new();
    out.insert("ok".into(), json!(!cancelled));
    if cancelled {
        out.insert("cancelled".into(), json!(true));
    }
    out.insert("waited_s".into(), json!(elapsed));
    if !reason.is_empty() {
        out.insert("reason".into(), json!(reason));
    }
    if target_alt.is_some() || target_mode.is_some() {
        out.insert("condition_met".into(), json!(condition_met));
    }

    if let Some(obj) = last_sample.as_object() {
        out.insert("vehicle".into(), json!({
            "linked": obj.get("linked").unwrap_or(&Value::Bool(false)),
            "armed": obj.get("armed").unwrap_or(&Value::Bool(false)),
            "mode": obj.get("mode").unwrap_or(&Value::Null),
            "alt_m": obj.get("alt").unwrap_or(&Value::Null),
            "groundspeed_mps": obj.get("groundspeed").unwrap_or(&Value::Null),
            "climb_mps": obj.get("climb").unwrap_or(&Value::Null),
            "heading_deg": obj.get("heading").unwrap_or(&Value::Null),
            "status_text": obj.get("texts").and_then(Value::as_array).map(|arr| {
                arr.iter().filter_map(Value::as_str).take(3).collect::<Vec<_>>()
            }).unwrap_or_default(),
        }));
    }

    Value::Object(out)
}

fn rc_stick_tool(args: &Value, sample: &Sample, c: &Connection, chat: &str) -> Value {
    let safe = safe_on_for(c, sample);
    let actor = if sample.is_simulator() { "agent (sitl)" } else { "agent (safe_mode)" };

    let preset = args.get("preset").and_then(Value::as_str).unwrap_or("").trim().to_ascii_lowercase();
    let is_release = preset == "release" || args.get("release").and_then(Value::as_bool).unwrap_or(false);
    let reason = args.get("reason").and_then(Value::as_str).unwrap_or("").trim();

    if is_release {
        let label = "Release sticks";
        if !safe {
            return hold_change(c, chat, "stick", label, None, 0.0, reason, "{\"op\":\"release\"}");
        }
        audit(c, "rc_stick release", reason, "requested", actor);
        let res = bridge_post("/cmd", &json!({"op": "release"}), 8);
        if !action_failed(&res) {
            record_applied_change(c, chat, "stick", label, None, 0.0, reason, "{\"op\":\"release\"}");
        }
        return json!({ "ok": true, "status": "applied", "released": true });
    }

    let parse_pwm = |val: Option<&Value>, def: i32| -> i32 {
        match val {
            Some(Value::Number(n)) => {
                let v = n.as_f64().unwrap_or(def as f64);
                if v >= 800.0 && v <= 2200.0 {
                    v.round() as i32
                } else if v >= -1.0 && v <= 1.0 {
                    (1500.0 + v * 500.0).round() as i32
                } else {
                    def
                }
            }
            Some(Value::String(s)) => {
                let s = s.trim().to_ascii_lowercase();
                match s.as_str() {
                    "neutral" | "center" | "hover" | "mid" => 1500,
                    "zero" | "min" | "down" | "bottom" | "idle" => 1000,
                    "max" | "up" | "top" => 2000,
                    "climb" => 1650,
                    "descend" => 1350,
                    _ => s.parse::<f64>().map(|v| {
                        if v >= 800.0 && v <= 2200.0 {
                            v.round() as i32
                        } else if v >= -1.0 && v <= 1.0 {
                            (1500.0 + v * 500.0).round() as i32
                        } else {
                            def
                        }
                    }).unwrap_or(def)
                }
            }
            _ => def,
        }
    };

    let (mut roll, mut pitch, mut yaw, mut thr) = if preset == "zero_throttle" {
        (1500, 1500, 1500, 1000)
    } else {
        (1500, 1500, 1500, 1500)
    };

    if let Some(v) = args.get("roll") { roll = parse_pwm(Some(v), roll); }
    if let Some(v) = args.get("pitch") { pitch = parse_pwm(Some(v), pitch); }
    if let Some(v) = args.get("yaw") { yaw = parse_pwm(Some(v), yaw); }
    if let Some(v) = args.get("thr").or_else(|| args.get("throttle")) { thr = parse_pwm(Some(v), thr); }

    let summary = if thr == 1500 && roll == 1500 && pitch == 1500 && yaw == 1500 {
        "Sticks neutral (thr=1500)".to_string()
    } else if thr == 1000 && roll == 1500 && pitch == 1500 && yaw == 1500 {
        "Sticks throttle zero (thr=1000)".to_string()
    } else {
        format!("Sticks (R:{roll} P:{pitch} Y:{yaw} T:{thr})")
    };

    let payload = json!({
        "op": "stick",
        "roll": roll,
        "pitch": pitch,
        "yaw": yaw,
        "thr": thr,
    });

    if !safe {
        return hold_change(c, chat, "stick", &summary, None, thr as f64, reason, &payload.to_string());
    }

    audit(c, &format!("rc_stick {summary}"), reason, "requested", actor);
    let res = bridge_post("/cmd", &payload, 8);
    if action_failed(&res) {
        return json!({ "ok": false, "error": error_text(&res) });
    }

    record_applied_change(c, chat, "stick", &summary, None, thr as f64, reason, &payload.to_string());

    json!({
        "ok": true,
        "status": "applied",
        "roll": roll,
        "pitch": pitch,
        "yaw": yaw,
        "thr": thr,
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
                "status_text": sample.texts.iter().take(5).cloned().collect::<Vec<_>>(),
                "params_received": sample.params.len(),
                "params_expected": sample.param_count,
                "params_complete": sample.param_count > 0 && sample.param_indices.len() >= sample.param_count as usize,
                "params_saved": book.values.len(),
                "params_saved_at": book.saved_at,
                "controller_key": controller_key,
                "vehicle_comment": vehicle_comment,
                "sitl": sample.is_simulator(),
                "note": "`linked: false` means a change cannot be sent. `detail` is the url while the link is up. `vehicle_comment` is the local note on this vehicle. Empty means none is stored. `controller_key` is the id for the `vehicle_comment` tool. `sitl` is true when this link is a simulator. A null `controller_key` is not that signal.",
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
        "suggest_next" => suggestions(args),
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
        "log_magfit" => log_magfit_tool(args, file),
        "log_filter_review" => log_filter_review_tool(args, file),
        "log_audit" => log_audit_tool(file),
        "log_motor_balance" => log_motor_balance_tool(args, file),
        "log_pid_review" => log_pid_review_tool(args, file),
        "show_chart" => crate::dflog::chart(file, args),
        "show_spectrum" => crate::dflog::gyro_picture(file, "spectrum", args),
        "show_spectrogram" => crate::dflog::gyro_picture(file, "spectrogram", args),
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
            if action == "start_bootloader" && !safe_on_for(c, sample) {
                return hold_change(c, chat, "flash", "Flash firmware", None, 0.0, "", &args.to_string());
            }
            if action == "start_bootloader" {
                let actor = if sample.is_simulator() { "agent (sitl)" } else { "agent (safe_mode)" };
                audit(c, "firmware flash", "start bootloader", "requested", actor);
            }
            let res = bridge_post("/firmware/flash", args, 60);
            if action == "start_bootloader" && !action_failed(&res) {
                record_applied_change(c, chat, "flash", "Flash firmware", None, 0.0, "", &args.to_string());
            }
            res
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
            if !safe_on_for(c, sample) {
                return hold_change(c, chat, "erase_logs", "Erase on-board logs", None, 0.0, "", "");
            }
            let actor = if sample.is_simulator() { "agent (sitl)" } else { "agent (safe_mode)" };
            audit(c, "erase logs", "confirm true", "requested", actor);
            let res = bridge_post("/logs/erase", &json!({"confirm": true}), 15);
            if !action_failed(&res) {
                record_applied_change(c, chat, "erase_logs", "Erase on-board logs", None, 0.0, "", "");
            }
            res
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
                if !safe_on_for(c, sample) {
                    return hold_change(c, chat, "connect", "Connect", None, 0.0, "", &url);
                }
                let actor = if sample.is_simulator() { "agent (sitl)" } else { "agent (safe_mode)" };
                audit(c, "connect", &url, "requested", actor);
                let res = run_link_wait(c, chat, "connect", "Connect", &url);
                if res.get("status").and_then(|v| v.as_str()) == Some("applied") {
                    record_applied_change(c, chat, "connect", "Connect", None, 0.0, "", &url);
                }
                res
            }
            Err(error) => json!({ "ok": false, "error": error }),
        },
        "set_mode" => {
            let mode = args["mode"].as_str().unwrap_or("").trim();
            if mode.is_empty() {
                return json!({ "ok": false, "error": "mode is required" });
            }
            if !safe_on_for(c, sample) {
                return hold_change(c, chat, "mode", mode, None, 0.0, "", "");
            }
            let actor = if sample.is_simulator() { "agent (sitl)" } else { "agent (safe_mode)" };
            audit(c, &format!("mode {mode}"), "assistant mode", "requested", actor);
            let res = bridge_post("/cmd", &json!({"op": "mode", "mode": mode}), 15);
            if !action_failed(&res) {
                record_applied_change(c, chat, "mode", mode, None, 0.0, "", "");
            }
            res
        }
        "arm" => {
            if !safe_on_for(c, sample) {
                return hold_change(c, chat, "arm", "Arm", None, 0.0, "", "");
            }
            let actor = if sample.is_simulator() { "agent (sitl)" } else { "agent (safe_mode)" };
            audit(c, "arm", "assistant arm", "requested", actor);
            let res = bridge_post("/cmd", &json!({"op": "arm", "on": true}), 8);
            if action_failed(&res) {
                return json!({ "ok": false, "error": error_text(&res) });
            }
            let start = std::time::Instant::now();
            let mut armed = false;
            let mut latest_texts = Vec::new();
            while start.elapsed() < std::time::Duration::from_millis(1800) {
                std::thread::sleep(std::time::Duration::from_millis(150));
                let cur = bridge_get("/sample", 2);
                if let Some(arr) = cur.get("texts").and_then(Value::as_array) {
                    latest_texts = arr.iter().filter_map(Value::as_str).take(5).map(String::from).collect();
                }
                if cur.get("armed").and_then(Value::as_bool) == Some(true) {
                    armed = true;
                    break;
                }
            }
            if armed {
                record_applied_change(c, chat, "arm", "Arm", None, 0.0, "", "");
                json!({
                    "ok": true,
                    "armed": true,
                    "status": "applied",
                    "status_text": latest_texts,
                })
            } else {
                json!({
                    "ok": false,
                    "armed": false,
                    "status": "failed",
                    "error": "Autopilot rejected arming. Vehicle is still disarmed.",
                    "status_text": latest_texts,
                    "tip": "Check pre-arm warnings in status_text. If throttle is too high, set rc_stick(preset: \"zero_throttle\") before arming.",
                })
            }
        }
        "disarm" => {
            if !safe_on_for(c, sample) {
                return hold_change(c, chat, "disarm", "Disarm", None, 0.0, "", "");
            }
            let actor = if sample.is_simulator() { "agent (sitl)" } else { "agent (safe_mode)" };
            audit(c, "disarm", "assistant disarm", "requested", actor);
            let res = bridge_post("/cmd", &json!({"op": "arm", "on": false}), 8);
            if action_failed(&res) {
                return json!({ "ok": false, "error": error_text(&res) });
            }
            let start = std::time::Instant::now();
            let mut disarmed = false;
            let mut latest_texts = Vec::new();
            while start.elapsed() < std::time::Duration::from_millis(1800) {
                std::thread::sleep(std::time::Duration::from_millis(150));
                let cur = bridge_get("/sample", 2);
                if let Some(arr) = cur.get("texts").and_then(Value::as_array) {
                    latest_texts = arr.iter().filter_map(Value::as_str).take(5).map(String::from).collect();
                }
                if cur.get("armed").and_then(Value::as_bool) == Some(false) {
                    disarmed = true;
                    break;
                }
            }
            if disarmed {
                record_applied_change(c, chat, "disarm", "Disarm", None, 0.0, "", "");
                json!({
                    "ok": true,
                    "armed": false,
                    "status": "applied",
                    "status_text": latest_texts,
                })
            } else {
                json!({
                    "ok": false,
                    "armed": true,
                    "status": "failed",
                    "error": "Autopilot rejected disarming.",
                    "status_text": latest_texts,
                })
            }
        }
        "reboot" => {
            if !safe_on_for(c, sample) {
                return hold_change(c, chat, "reboot", "Reboot", None, 0.0, "", "");
            }
            let actor = if sample.is_simulator() { "agent (sitl)" } else { "agent (safe_mode)" };
            audit(c, "reboot", "assistant reboot", "requested", actor);
            let res = run_link_wait(c, chat, "reboot", "Reboot", "");
            if res.get("status").and_then(|v| v.as_str()) == Some("applied") {
                record_applied_change(c, chat, "reboot", "Reboot", None, 0.0, "", "");
            }
            res
        }
        "disconnect" => {
            if !safe_on_for(c, sample) {
                return hold_change(c, chat, "disconnect", "Disconnect", None, 0.0, "", "");
            }
            let actor = if sample.is_simulator() { "agent (sitl)" } else { "agent (safe_mode)" };
            audit(c, "disconnect", "assistant disconnect", "requested", actor);
            let res = run_link_wait(c, chat, "disconnect", "Disconnect", "");
            if res.get("status").and_then(|v| v.as_str()) == Some("applied") {
                record_applied_change(c, chat, "disconnect", "Disconnect", None, 0.0, "", "");
            }
            res
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
        "mav_command" => mav_command_tool(args, sample, c, chat),
        "wait" => wait_tool(args, c, chat),
        "rc_stick" => rc_stick_tool(args, sample, c, chat),
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

fn log_magfit_tool(args: &Value, file: &str) -> Value {
    if file.is_empty() {
        return json!({ "ok": false, "error": "file is required. file is an id from list_logs, or local.id from vehicle_logs." });
    }
    let compass = args.get("compass").and_then(|v| v.as_u64().map(|n| n as usize));
    let fit_type = args.get("fit_type").and_then(|v| v.as_str());
    let motor_comp = args.get("motor_comp").and_then(|v| v.as_str());
    let check_orientation = args.get("check_orientation").and_then(|v| v.as_bool());
    let start_us = args.get("start_us").and_then(|v| v.as_u64());
    let end_us = args.get("end_us").and_then(|v| v.as_u64());
    let lat = args.get("lat").and_then(|v| v.as_f64())
        .or_else(|| args.get("latitude").and_then(|v| v.as_f64()));
    let lon = args.get("lon").and_then(|v| v.as_f64())
        .or_else(|| args.get("longitude").and_then(|v| v.as_f64()))
        .or_else(|| args.get("lng").and_then(|v| v.as_f64()));

    let val = crate::dflog::magfit(
        file,
        compass,
        fit_type,
        motor_comp,
        check_orientation,
        start_us,
        end_us,
        lat,
        lon,
    );
    with_log_hash(file, val)
}

fn log_filter_review_tool(args: &Value, file: &str) -> Value {
    if file.is_empty() {
        return json!({ "ok": false, "error": "file is required. file is an id from list_logs, or local.id from vehicle_logs." });
    }
    let axis = args.get("axis").and_then(|v| v.as_str());
    let start_us = args.get("start_us").and_then(|v| v.as_u64());
    let end_us = args.get("end_us").and_then(|v| v.as_u64());
    let val = crate::dflog::filter_review(file, axis, start_us, end_us);
    with_log_hash(file, val)
}

fn log_audit_tool(file: &str) -> Value {
    if file.is_empty() {
        return json!({ "ok": false, "error": "file is required. file is an id from list_logs, or local.id from vehicle_logs." });
    }
    let val = crate::dflog::audit(file);
    with_log_hash(file, val)
}

fn log_motor_balance_tool(args: &Value, file: &str) -> Value {
    if file.is_empty() {
        return json!({ "ok": false, "error": "file is required. file is an id from list_logs, or local.id from vehicle_logs." });
    }
    let start_us = args.get("start_us").and_then(|v| v.as_u64());
    let end_us = args.get("end_us").and_then(|v| v.as_u64());
    let val = crate::dflog::motor_balance(file, start_us, end_us);
    with_log_hash(file, val)
}

fn log_pid_review_tool(args: &Value, file: &str) -> Value {
    if file.is_empty() {
        return json!({ "ok": false, "error": "file is required. file is an id from list_logs, or local.id from vehicle_logs." });
    }
    let axis = args.get("axis").and_then(|v| v.as_str());
    let start_us = args.get("start_us").and_then(|v| v.as_u64());
    let end_us = args.get("end_us").and_then(|v| v.as_u64());
    let val = crate::dflog::pid_review(file, axis, start_us, end_us);
    with_log_hash(file, val)
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

/// Buttons under the reply: the first four complete items, of either kind.
fn suggestions(args: &Value) -> Value {
    let complete: Vec<&Value> = args["items"].as_array().into_iter().flatten()
        .filter(|item| matches!(item["kind"].as_str(), Some("ask" | "offer")))
        .filter(|item| ["label", "prompt"].iter().all(|key| item[*key].as_str().is_some_and(|text| !text.trim().is_empty())))
        .take(4)
        .collect();
    let pick = |kind: &str| -> Vec<Value> {
        complete.iter().filter(|item| item["kind"].as_str() == Some(kind)).filter_map(|item| {
            let label = item["label"].as_str().map(str::trim).filter(|text| !text.is_empty())?;
            let prompt = item["prompt"].as_str().map(str::trim).filter(|text| !text.is_empty())?;
            Some(json!({
                "label": label.chars().take(60).collect::<String>(),
                "prompt": prompt.chars().take(2_000).collect::<String>(),
            }))
        }).collect()
    };
    let ask = pick("ask");
    let offer = pick("offer");
    if ask.is_empty() && offer.is_empty() {
        return json!({ "ok": false, "error": "items needs an ask or offer item with label and prompt" });
    }
    json!({ "ok": true, "ask": ask, "offer": offer, "note": "The buttons are under the reply. Nothing was sent." })
}
