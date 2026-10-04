// Waiting for connect, reboot, or disconnect.

fn now_f64() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn link_fresh(state: &Value, now: f64) -> bool {
    state["ok"].as_bool() == Some(true) && now - state["heartbeat_at"].as_f64().unwrap_or(0.0) < 3.0
}

fn same_link(current: &str, requested: &str) -> bool {
    let current = current.trim();
    let requested = requested.trim();
    !current.is_empty() && current.eq_ignore_ascii_case(requested)
}

fn connect_already_up(state: &Value, url: &str, now: f64) -> bool {
    link_fresh(state, now) && same_link(state["detail"].as_str().unwrap_or(""), url)
}

fn link_snapshot(state: &Value) -> Value {
    json!({
        "linked": link_fresh(state, now_f64()),
        "detail": state["detail"].clone(),
        "frame": state["frame"].clone(),
        "mode": state["mode"].clone(),
        "armed": state["armed"].clone(),
    })
}

fn proposal_status(c: &Connection, id: &str) -> String {
    c.query_row("SELECT status FROM ai_proposal WHERE id=?1", [id], |row| row.get(0)).unwrap_or_default()
}

fn open_wait(c: &Connection, chat: &str, kind: &str, title: &str, payload: &str) -> String {
    let id = Uuid::new_v4().to_string();
    c.execute(
        "INSERT INTO ai_proposal (id, chat_id, status, param, old_value, new_value, reason, created_at, kind, payload) VALUES (?1,?2,'waiting',?3,NULL,0,'',?4,?5,?6)",
        params![id, chat, title, now(), kind, payload],
    ).ok();
    id
}

fn set_wait_status(c: &Connection, id: &str, status: &str, error: Option<&str>) -> bool {
    let changed = if let Some(error) = error {
        let payload: String = c.query_row("SELECT payload FROM ai_proposal WHERE id=?1", [id], |row| row.get(0)).unwrap_or_default();
        let stored = merge_payload(&payload, "error", json!(error));
        c.execute(
            "UPDATE ai_proposal SET status=?1, payload=?2 WHERE id=?3 AND status='waiting'",
            params![status, stored, id],
        ).unwrap_or(0)
    } else {
        c.execute(
            "UPDATE ai_proposal SET status=?1 WHERE id=?2 AND status='waiting'",
            params![status, id],
        ).unwrap_or(0)
    };
    changed > 0
}

fn send_link(kind: &str, payload: &str) -> Value {
    match kind {
        "connect" => bridge_post("/cmd", &json!({"op": "connect", "url": payload}), 8),
        "disconnect" => bridge_post("/cmd", &json!({"op": "disconnect"}), 8),
        "reboot" => bridge_post("/cmd", &json!({"op": "reboot"}), 8),
        _ => json!({ "ok": false, "error": "Unknown link action" }),
    }
}

/// Blocks until the link matches the action, the user rejects the wait, or the wait times out.
fn await_link(c: &Connection, id: &str, kind: &str, payload: &str) -> Value {
    let _ = c.execute("UPDATE ai_proposal SET status='waiting' WHERE id=?1 AND status='pending'", params![id]);
    live_tool(kind, &json!({ "action": "waiting" }));
    if kind == "connect" && payload.is_empty() {
        set_wait_status(c, id, "failed", Some("url is required"));
        return json!({ "status": "failed", "action": kind, "error": "url is required" });
    }
    let before = bridge_get("/state", 3);
    let before_detail = before["detail"].as_str().unwrap_or("").to_string();
    if kind == "reboot" && !link_fresh(&before, now_f64()) {
        set_wait_status(c, id, "failed", Some("Disconnected"));
        return json!({ "status": "failed", "action": kind, "error": "Disconnected", "linked": false });
    }
    if kind == "disconnect" && before["ok"].as_bool() != Some(true) {
        set_wait_status(c, id, "applied", None);
        return json!({ "status": "applied", "action": kind, "linked": false, "detail": before_detail });
    }
    if kind == "connect" && connect_already_up(&before, payload, now_f64()) {
        return finish_connect(c, id, true);
    }
    let sent = send_link(kind, payload);
    if action_failed(&sent) {
        let error = sent.get("error").and_then(|v| v.as_str()).unwrap_or("The link command was not accepted");
        if !set_wait_status(c, id, "failed", Some(error)) {
            return json!({ "status": "rejected_by_user", "action": kind });
        }
        return json!({ "status": "failed", "action": kind, "error": error });
    }
    let limit_s = match kind {
        "disconnect" => 10.0,
        "connect" => 25.0,
        _ => 60.0,
    };
    let deadline = now_f64() + limit_s;
    let mut saw_drop = false;
    loop {
        if turn_halted() {
            set_wait_status(c, id, "failed", Some("stopped"));
            return json!({ "status": "failed", "action": kind, "error": "stopped" });
        }
        if proposal_status(c, id) != "waiting" {
            if kind == "connect" {
                let _ = send_link("disconnect", "");
            }
            let state = bridge_get("/state", 3);
            return json!({ "status": "rejected_by_user", "action": kind, "linked": link_fresh(&state, now_f64()), "sent": true });
        }
        let state = bridge_get("/state", 3);
        let fresh = link_fresh(&state, now_f64());
        let linked = state["ok"].as_bool() == Some(true);
        let detail = state["detail"].as_str().unwrap_or("");
        if !fresh || !linked {
            saw_drop = true;
        }
        let phase = if kind == "reboot" && saw_drop { "waiting for the link" } else if kind == "reboot" { "waiting for the link to drop" } else { "waiting" };
        live_tool(kind, &json!({ "action": phase }));
        let done = match kind {
            "disconnect" => !linked,
            "connect" => fresh && (saw_drop || (detail != before_detail && !detail.is_empty())),
            "reboot" => saw_drop && fresh,
            _ => false,
        };
        if done {
            if kind == "connect" {
                return finish_connect(c, id, false);
            }
            if !set_wait_status(c, id, "applied", None) {
                return json!({ "status": "rejected_by_user", "action": kind, "linked": fresh });
            }
            return json!({ "status": "applied", "action": kind, "linked": fresh, "detail": state["detail"] });
        }
        if now_f64() >= deadline {
            let error = match kind {
                "connect" => "The link did not come up",
                "reboot" if !saw_drop => "The link did not drop",
                "reboot" => "The link did not return",
                _ => "The link did not drop",
            };
            if !set_wait_status(c, id, "failed", Some(error)) {
                return json!({ "status": "rejected_by_user", "action": kind, "linked": fresh });
            }
            return json!({ "status": "failed", "action": kind, "error": error, "linked": fresh });
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
}

fn finish_connect(c: &Connection, id: &str, already: bool) -> Value {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
    loop {
        if turn_halted() {
            set_wait_status(c, id, "failed", Some("stopped"));
            return json!({ "status": "failed", "action": "connect", "error": "stopped" });
        }
        if proposal_status(c, id) != "waiting" {
            if !already {
                let _ = send_link("disconnect", "");
            }
            let state = bridge_get("/state", 3);
            return json!({ "status": "rejected_by_user", "action": "connect", "sent": !already, "link": link_snapshot(&state) });
        }
        if std::time::Instant::now() >= deadline {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    let state = bridge_get("/state", 3);
    let snap = link_snapshot(&state);
    remember_link(c, id, &snap, already);
    if !set_wait_status(c, id, "applied", None) {
        if !already {
            let _ = send_link("disconnect", "");
        }
        return json!({ "status": "rejected_by_user", "action": "connect", "sent": !already, "link": snap });
    }
    let mut body = json!({
        "status": "applied",
        "action": "connect",
        "already_linked": already,
        "linked": snap["linked"].clone(),
        "detail": snap["detail"].clone(),
        "frame": snap["frame"].clone(),
        "mode": snap["mode"].clone(),
        "armed": snap["armed"].clone(),
    });
    body["note"] = json!(if already {
        concat!(
            "The link was already up. ",
            "It was not opened again. ",
            "`linked: true` means a fresh heartbeat.",
        )
    } else {
        "`linked: true` means a fresh heartbeat."
    });
    body
}

fn remember_link(c: &Connection, id: &str, snap: &Value, already: bool) {
    let payload: String = c.query_row("SELECT payload FROM ai_proposal WHERE id=?1", [id], |row| row.get(0)).unwrap_or_default();
    let mut stored = merge_payload(&payload, "linked", snap["linked"].clone());
    for key in ["detail", "frame", "mode", "armed"] {
        stored = merge_payload(&stored, key, snap[key].clone());
    }
    stored = merge_payload(&stored, "already_linked", json!(already));
    if already {
        stored = merge_payload(&stored, "note", json!(concat!(
            "The link was already up. ",
            "It was not opened again. ",
            "`linked: true` means a fresh heartbeat.",
        )));
    }
    c.execute("UPDATE ai_proposal SET payload=?1 WHERE id=?2", params![stored, id]).ok();
}

fn already_up_result(state: &Value) -> Value {
    let snap = link_snapshot(state);
    json!({
        "status": "applied",
        "action": "connect",
        "already_linked": true,
        "linked": snap["linked"].clone(),
        "detail": snap["detail"].clone(),
        "frame": snap["frame"].clone(),
        "mode": snap["mode"].clone(),
        "armed": snap["armed"].clone(),
        "note": concat!(
            "The link was already up. ",
            "It was not opened again. ",
            "`linked: true` means a fresh heartbeat.",
        ),
    })
}

fn run_link_wait(c: &Connection, chat: &str, kind: &str, title: &str, payload: &str) -> Value {
    let id = open_wait(c, chat, kind, title, payload);
    await_link(c, &id, kind, payload)
}
