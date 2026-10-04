// Proposals, steer notes, and safe mode.


fn decide(c: &Connection, body: &Value, sample: &Sample, tx: &Sender<Cmd>) -> Result<Value, (u16, String)> {
    let id = body["id"].as_str().unwrap_or("");
    let decision = body["decision"].as_str().unwrap_or("");
    let row: Result<(String, String, String, Option<f64>, f64, String, String, String), _> = c.query_row(
        "SELECT chat_id, status, param, old_value, new_value, reason, kind, payload FROM ai_proposal WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
    );
    let (chat, status, param, old, value, reason, kind, payload) = row.map_err(|_| (404, "Proposal not found".into()))?;
    if status == "waiting" {
        if decision == "reject" {
            c.execute("UPDATE ai_proposal SET status='rejected_by_user' WHERE id=?1 AND status='waiting'", [id]).ok();
            return Ok(json!({ "ok": true, "status": "rejected_by_user" }));
        }
        return Err((409, "This action is already running".into()));
    }
    if status != "pending" {
        return Err((409, "Proposal is no longer pending".into()));
    }
    let lang = body["lang"].as_str().unwrap_or("en");
    let log_id = body["log"].as_str().unwrap_or("").trim();
    let batch = batch_token(body);
    if decision == "reject" {
        if kind == "wizard" {
            let stored = merge_payload(&payload, "result", json!({ "outcome": "cancelled", "measures": {} }));
            c.execute("UPDATE ai_proposal SET status='cancelled', payload=?1 WHERE id=?2", params![stored, id]).ok();
            audit_detail(c, &format!("wizard {param}"), &reason, "cancelled", "agent", &stored);
            return finish_and_continue(c, body, sample, tx, &chat, lang, log_id, "cancelled");
        }
        c.execute("UPDATE ai_proposal SET status='rejected_by_user' WHERE id=?1", [id]).ok();
        audit_detail(c, &format!("{kind} {param}"), &reason, "rejected_by_user", "agent", &decision_detail(&kind, old, value, &batch, &payload));
        return finish_and_continue(c, body, sample, tx, &chat, lang, log_id, "rejected_by_user");
    }
    if decision != "approve" {
        return Err((400, "Use approve or reject".into()));
    }
    if kind == "comment" {
        let mut args: Value = serde_json::from_str(&payload).unwrap_or_else(|_| json!({}));
        if let Some(edited) = body.get("comment").and_then(|v| v.as_str()) {
            args["comment"] = json!(edited.trim());
        }
        let comment = args.get("comment").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        if comment.chars().count() > 2_000 {
            return Err((400, "Comment must contain at most 2000 characters".into()));
        }
        args["comment"] = json!(comment);
        let result = bridge_post("/firmware-library/comment", &args, 15);
        if action_failed(&result) {
            let error = result.get("error").and_then(|v| v.as_str()).unwrap_or("Could not save comment");
            mark_failed(c, id, &args.to_string(), error);
            audit_detail(c, &format!("{kind} {param}"), &reason, "failed", "agent", &args.to_string());
            return finish_and_continue(c, body, sample, tx, &chat, lang, log_id, "failed");
        }
        let stored = merge_payload(&args.to_string(), "result", result);
        c.execute("UPDATE ai_proposal SET status='applied', payload=?1 WHERE id=?2", params![stored, id]).ok();
        audit_detail(c, &format!("{kind} {param}"), &reason, "applied", "agent", &stored);
        return finish_and_continue(c, body, sample, tx, &chat, lang, log_id, "applied");
    }
    if matches!(kind.as_str(), "connect" | "disconnect" | "reboot") {
        if kind != "connect" && !sample.ok {
            mark_failed(c, id, &payload, "Disconnected");
            audit_detail(c, &format!("{kind} {param}"), &reason, "failed", "agent", &decision_detail(&kind, old, value, &batch, &payload));
            return finish_and_continue(c, body, sample, tx, &chat, lang, log_id, "failed");
        }
        let outcome = await_link(c, id, &kind, &payload);
        let link_status = outcome["status"].as_str().unwrap_or("failed");
        audit_detail(c, &format!("{kind} {param}"), &reason, link_status, "agent", &outcome.to_string());
        return finish_and_continue(c, body, sample, tx, &chat, lang, log_id, link_status);
    }
    if !sample.ok {
        mark_failed(c, id, &payload, "Disconnected");
        audit_detail(c, &format!("{kind} {param}"), &reason, "failed", "agent", &decision_detail(&kind, old, value, &batch, &payload));
        return finish_and_continue(c, body, sample, tx, &chat, lang, log_id, "failed");
    }
    let sent = if kind == "param" || kind.is_empty() {
        send_param(&param, value)
    } else {
        match run_saved(&kind, &param, value, &payload, tx) {
            Ok(()) => json!({"status": "applied", "name": param}),
            Err(error) => json!({"status": "failed", "error": error}),
        }
    };
    if sent.get("status").and_then(|v| v.as_str()) == Some("failed") {
        let error = sent.get("error").and_then(|v| v.as_str()).unwrap_or("The vehicle refused the change");
        mark_failed(c, id, &payload, error);
        audit_detail(c, &format!("{kind} {param}"), &reason, "failed", "agent", &decision_detail(&kind, old, value, &batch, &payload));
        return finish_and_continue(c, body, sample, tx, &chat, lang, log_id, "failed");
    }
    let stored = merge_payload(&payload, "result", sent.get("result").cloned().unwrap_or(Value::Null));
    c.execute("UPDATE ai_proposal SET status='applied', payload=?1 WHERE id=?2", params![stored, id]).ok();
    audit_detail(c, &format!("{kind} {param}"), &reason, "applied", "agent", &decision_detail(&kind, old, value, &batch, &format!("{{\"old\":{old:?},\"requested\":{value}}}")));
    finish_and_continue(c, body, sample, tx, &chat, lang, log_id, "applied")
}

fn finish_and_continue(
    c: &Connection,
    body: &Value,
    sample: &Sample,
    tx: &Sender<Cmd>,
    chat: &str,
    lang: &str,
    log_id: &str,
    status: &str,
) -> Result<Value, (u16, String)> {
    if let Some(id) = body["id"].as_str() {
        fold_identical_pending(c, id, status);
    }
    if finish_holds(c, chat) {
        return complete_turn(c, body, sample, tx, chat, lang, log_id);
    }
    Ok(json!({"ok": true, "status": status}))
}

fn latest_message_id(c: &Connection, chat: &str) -> i64 {
    c.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM ai_message WHERE chat_id=?1",
        [chat],
        |row| row.get(0),
    ).unwrap_or(0)
}

fn claim_steers_through(c: &Connection, chat: &str, up_to: i64) {
    c.execute(
        "UPDATE ai_message SET role='user' WHERE chat_id=?1 AND role='steer' AND id<=?2",
        params![chat, up_to],
    ).ok();
}

fn drain_steers(c: &Connection, chat: &str, after: &mut i64) -> Option<String> {
    let mut ids = Vec::new();
    let mut bodies = Vec::new();
    {
        let mut st = c.prepare(
            "SELECT id, body FROM ai_message WHERE chat_id=?1 AND role='steer' AND id>?2 ORDER BY id",
        ).ok()?;
        let mut rows = st.query(params![chat, *after]).ok()?;
        while let Ok(Some(row)) = rows.next() {
            let id: i64 = row.get(0).unwrap_or(0);
            let body: String = row.get(1).unwrap_or_default();
            if id > *after {
                *after = id;
            }
            ids.push(id);
            let body = body.trim();
            if !body.is_empty() {
                bodies.push(body.to_string());
            }
        }
    }
    if bodies.is_empty() {
        return None;
    }
    for id in ids {
        c.execute(
            "UPDATE ai_message SET role='user' WHERE chat_id=?1 AND id=?2 AND role='steer'",
            params![chat, id],
        ).ok();
    }
    Some(bodies.join("\n"))
}

fn append_steer(messages: &mut Vec<genai::chat::ChatMessage>, text: &str) {
    let line = format!("steer: {text}");
    if let Some(last) = messages.last_mut() {
        if last.role == genai::chat::ChatRole::User && last.content.tool_calls().is_empty() {
            let prev = last.content.texts().join("\n");
            if !prev.is_empty() {
                last.content = genai::chat::MessageContent::from_text(format!("{prev}\n{line}"));
                return;
            }
        }
    }
    messages.push(genai::chat::ChatMessage::user(line));
}

fn pending_count(c: &Connection, chat: &str) -> i64 {
    c.query_row(
        "SELECT COUNT(*) FROM ai_proposal WHERE chat_id=?1 AND status='pending'",
        [chat],
        |row| row.get(0),
    ).unwrap_or(0)
}

fn mark_failed(c: &Connection, id: &str, payload: &str, error: &str) {
    let stored = merge_payload(payload, "error", json!(error));
    c.execute("UPDATE ai_proposal SET status='failed', payload=?1 WHERE id=?2", params![stored, id]).ok();
}

fn merge_payload(payload: &str, key: &str, value: Value) -> String {
    let mut obj = serde_json::from_str::<Value>(payload).unwrap_or(Value::Null);
    if !obj.is_object() {
        obj = if payload.is_empty() { json!({}) } else { json!({"saved": payload}) };
    }
    obj[key] = value;
    obj.to_string()
}

fn finish_holds(c: &Connection, chat: &str) -> bool {
    if pending_count(c, chat) > 0 {
        return false;
    }
    let mut held = Vec::new();
    if let Ok(mut st) = c.prepare("SELECT id, body FROM ai_message WHERE chat_id=?1 AND role='held' ORDER BY id") {
        let _ = st.query_map([chat], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))).map(|iter| {
            for item in iter.flatten() {
                held.push(item);
            }
        });
    }
    if held.is_empty() {
        return false;
    }
    for (id, body) in held {
        let parsed: Value = serde_json::from_str(&body).unwrap_or_else(|_| json!({}));
        let tool = parsed["tool"].as_str().unwrap_or("tool").to_string();
        let ids = parsed["ids"].as_array().cloned().unwrap_or_default();
        let mut items = Vec::new();
        for pid in ids {
            let Some(pid) = pid.as_str() else { continue };
            let row: Result<(String, String, Option<f64>, f64, String), _> = c.query_row(
                "SELECT status, param, old_value, new_value, payload FROM ai_proposal WHERE id=?1",
                [pid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            );
            if let Ok((status, name, old, value, payload)) = row {
                items.push(outcome_item(&status, &name, old, value, &payload));
            }
        }
        if !items.is_empty() {
            note_tool(c, chat, &tool, &json!({}), &rollup(items));
        }
        c.execute("DELETE FROM ai_message WHERE id=?1", [id]).ok();
    }
    true
}

fn attach_result(item: &mut Value, extra: &Value) {
    if let Some(value) = extra.get("result").filter(|value| !value.is_null()) {
        item["result"] = value.clone();
    }
}

fn outcome_item(status: &str, name: &str, old: Option<f64>, value: f64, payload: &str) -> Value {
    let extra: Value = serde_json::from_str(payload).unwrap_or_else(|_| json!({}));
    match status {
        "applied" => {
            let mut item = json!({"status": "applied", "name": name, "old": old, "new": value});
            for key in ["result", "linked", "detail", "frame", "mode", "armed", "already_linked", "note"] {
                if let Some(value) = extra.get(key).filter(|value| !value.is_null()) {
                    item[key] = value.clone();
                }
            }
            item
        }
        "completed" | "cancelled" => {
            let mut item = json!({"status": status, "name": name, "wizard": name});
            attach_result(&mut item, &extra);
            item
        }
        "rejected_by_user" => {
            let mut item = json!({"status": "rejected_by_user", "name": name, "old": old, "new": value});
            attach_result(&mut item, &extra);
            item
        }
        _ => {
            let error = extra.get("error").and_then(|v| v.as_str()).unwrap_or("The change was not sent");
            let mut item = json!({"status": "failed", "name": name, "error": error});
            attach_result(&mut item, &extra);
            item
        }
    }
}

fn settle_wizard(c: &Connection, body: &Value, sample: &Sample, tx: &Sender<Cmd>) -> Result<Value, (u16, String)> {
    let id = body["id"].as_str().unwrap_or("");
    let outcome = body["outcome"].as_str().unwrap_or("");
    if !matches!(outcome, "completed" | "cancelled" | "failed") {
        return Err((400, "outcome must be completed, cancelled, or failed".into()));
    }
    let row: Result<(String, String, String, String, String), _> = c.query_row(
        "SELECT chat_id, status, kind, param, payload FROM ai_proposal WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    );
    let (chat, status, kind, param, payload) = row.map_err(|_| (404, "Proposal not found".into()))?;
    if kind != "wizard" {
        return Err((409, "Not a wizard card".into()));
    }
    if status != "pending" {
        return Err((409, "Proposal is no longer pending".into()));
    }
    let mut report = body.get("report").cloned().unwrap_or_else(|| json!({}));
    if !report.is_object() {
        report = json!({});
    }
    report["outcome"] = json!(outcome);
    let mut stored = merge_payload(&payload, "result", report);
    let saved = if outcome == "failed" {
        let error = body["error"].as_str().unwrap_or("The wizard failed");
        stored = merge_payload(&stored, "error", json!(error));
        "failed"
    } else {
        outcome
    };
    c.execute("UPDATE ai_proposal SET status=?1, payload=?2 WHERE id=?3", params![saved, stored, id]).ok();
    audit_detail(c, &format!("wizard {param}"), "", saved, "ui", &stored);
    let lang = body["lang"].as_str().unwrap_or("en");
    let log_id = body["log"].as_str().unwrap_or("").trim();
    finish_and_continue(c, body, sample, tx, &chat, lang, log_id, saved)
}

fn item_status(item: &Value) -> &str {
    item.get("status").and_then(|v| v.as_str()).unwrap_or("failed")
}

fn rollup(items: Vec<Value>) -> Value {
    if items.is_empty() {
        return json!({"status": "failed", "error": "No changes"});
    }
    let first = item_status(&items[0]);
    let uniform = items.iter().all(|item| item_status(item) == first);
    if uniform && first == "failed" {
        let error = items.iter().filter_map(|item| item.get("error").and_then(|v| v.as_str())).collect::<Vec<_>>().join("; ");
        return json!({"status": "failed", "error": error, "results": items});
    }
    if uniform {
        return json!({"status": first, "results": items});
    }
    if items.iter().any(|item| item_status(item) == "failed") {
        let error = items.iter().filter_map(|item| item.get("error").and_then(|v| v.as_str())).collect::<Vec<_>>().join("; ");
        return json!({"status": "failed", "error": error, "results": items});
    }
    json!({"results": items})
}

fn batch_token(body: &Value) -> String {
    let raw = body["batch"].as_str().unwrap_or("").trim();
    if raw.is_empty() || raw.len() > 64 || !raw.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        String::new()
    } else {
        raw.to_string()
    }
}

fn round_param(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

fn same_param(left: f64, right: f64) -> bool {
    round_param(left) == round_param(right)
}

fn change_detail(old: Option<f64>, value: f64, batch: &str) -> String {
    let mut detail = json!({ "old": old.map(round_param), "requested": round_param(value) });
    if !batch.is_empty() {
        detail["batch"] = json!(batch);
    }
    detail.to_string()
}

fn decision_detail(kind: &str, old: Option<f64>, value: f64, batch: &str, fallback: &str) -> String {
    if kind == "param" || kind.is_empty() {
        change_detail(old, value, batch)
    } else {
        fallback.to_string()
    }
}

fn audit(c: &Connection, action: &str, reason: &str, result: &str, source: &str) {
    audit_detail(c, action, reason, result, source, "");
}

fn audit_detail(c: &Connection, action: &str, reason: &str, result: &str, source: &str, detail: &str) {
    let _ = c.execute(
        "INSERT INTO ai_audit (at, action, reason, result, source, detail) VALUES (?1,?2,?3,?4,?5,?6)",
        params![now(), action, reason, result, source, detail],
    );
}

enum UiNote {
    Param { name: String, from: Option<f64>, value: f64 },
    Mode { from: String, mode: String },
    Arm { on: bool },
}

fn ui_notes(body: &Value) -> Result<Vec<(String, String, String)>, (u16, String)> {
    let list = body.get("changes").and_then(Value::as_array).ok_or((400, "changes is required".to_string()))?;
    if list.is_empty() {
        return Ok(Vec::new());
    }
    if list.len() > 16 {
        return Err((400, "at most 16 changes".into()));
    }
    let mut parsed = Vec::new();
    for item in list {
        match item["kind"].as_str().unwrap_or("") {
            "param" => {
                let name = item["name"].as_str().unwrap_or("").trim();
                if name.is_empty() || name.len() > 32 || !name.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
                    return Err((400, "parameter name is not valid".into()));
                }
                let Some(value) = item["value"].as_f64().filter(|value| value.is_finite()) else {
                    return Err((400, "value is required".into()));
                };
                let from = item["from"].as_f64().filter(|value| value.is_finite());
                parsed.push(UiNote::Param { name: name.to_string(), from, value });
            }
            "mode" => {
                let from = item["from"].as_str().unwrap_or("").trim();
                let mode = item["mode"].as_str().unwrap_or("").trim();
                if mode.is_empty() || mode.len() > 16 || !mode.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
                    return Err((400, "mode is not valid".into()));
                }
                if !from.is_empty() && (from.len() > 16 || !from.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '?')) {
                    return Err((400, "mode is not valid".into()));
                }
                parsed.push(UiNote::Mode { from: from.to_string(), mode: mode.to_string() });
            }
            "arm" => {
                let Some(on) = item["on"].as_bool() else {
                    return Err((400, "on is required".into()));
                };
                parsed.push(UiNote::Arm { on });
            }
            _ => return Err((400, "kind is not valid".into())),
        }
    }
    let params = parsed.iter().filter(|item| match item {
        UiNote::Param { from: Some(from), value, .. } => !same_param(*from, *value),
        UiNote::Param { from: None, .. } => true,
        _ => false,
    }).count();
    let batch = if params > 1 { Uuid::new_v4().to_string() } else { String::new() };
    let mut out = Vec::new();
    for item in parsed {
        match item {
            UiNote::Param { from: Some(from), value, .. } if same_param(from, value) => {}
            UiNote::Param { name, from, value } => {
                out.push((format!("param {name}"), String::new(), change_detail(from, value, &batch)));
            }
            UiNote::Mode { from, mode } if from == mode => {}
            UiNote::Mode { from, mode } => {
                let reason = if from.is_empty() || from == "?" { mode.clone() } else { format!("{from} → {mode}") };
                out.push(("mode".to_string(), reason, String::new()));
            }
            UiNote::Arm { on } => {
                out.push((if on { "arm" } else { "disarm" }.to_string(), if on { "armed" } else { "disarmed" }.to_string(), String::new()));
            }
        }
    }
    Ok(out)
}

fn note_ui(c: &Connection, body: &Value) -> Result<Value, (u16, String)> {
    let notes = ui_notes(body)?;
    for (action, reason, detail) in &notes {
        audit_detail(c, action, reason, "applied", "ui", detail);
    }
    Ok(json!({ "ok": true, "count": notes.len() }))
}

fn revert_audit(c: &Connection, body: &Value, sample: &Sample) -> Result<Value, (u16, String)> {
    let list = body.get("changes").and_then(Value::as_array).ok_or((400, "changes is required".to_string()))?;
    if list.is_empty() {
        return Err((400, "changes is empty".into()));
    }
    if list.len() > 16 {
        return Err((400, "at most 16 changes".into()));
    }
    if !sample.ok {
        return Err((409, "Disconnected".into()));
    }
    let mut changes = Vec::new();
    for item in list {
        let name = item["name"].as_str().unwrap_or("").trim();
        if name.is_empty() || name.len() > 32 || !name.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
            return Err((400, "parameter name is not valid".into()));
        }
        let Some(value) = item["value"].as_f64().filter(|value| value.is_finite()) else {
            return Err((400, "value is required".into()));
        };
        let from = item["from"].as_f64().filter(|value| value.is_finite());
        changes.push((name.to_string(), from, value));
    }
    let batch = if changes.len() > 1 { Uuid::new_v4().to_string() } else { String::new() };
    let mut applied = 0;
    for (name, from, value) in &changes {
        let sent = send_param(name, *value);
        let status = if sent.get("status").and_then(|v| v.as_str()) == Some("applied") { "applied" } else { "failed" };
        if status == "applied" {
            applied += 1;
        }
        audit_detail(c, &format!("param {name}"), "Restore the audited value", status, "ui", &change_detail(*from, *value, &batch));
    }
    Ok(json!({ "ok": true, "hold": false, "applied": applied, "count": changes.len() }))
}

fn audit_list(c: &Connection) -> Value {
    let mut out = Vec::new();
    if let Ok(mut st) = c.prepare("SELECT at, action, reason, result, source, detail FROM ai_audit ORDER BY id DESC LIMIT 200") {
        let _ = st.query_map([], |row| {
            Ok(json!({
                "at": row.get::<_, i64>(0)?,
                "action": row.get::<_, String>(1)?,
                "reason": row.get::<_, String>(2)?,
                "result": row.get::<_, String>(3)?,
                "source": row.get::<_, String>(4)?,
                "detail": row.get::<_, String>(5)?,
            }))
        }).map(|iter| { for item in iter.flatten() { out.push(item); } });
    }
    json!({"events": out})
}

fn bench(c: &Connection, body: &Value) -> Result<Value, (u16, String)> {
    if body["propellers"].as_bool() != Some(true)
        || body["power"].as_bool() != Some(true)
        || body["workspace"].as_bool() != Some(true)
        || body["control"].as_bool() != Some(true)
    {
        return Err((400, "Safe mode checklist is incomplete".into()));
    }
    let minutes = body["minutes"].as_i64().unwrap_or(5).clamp(5, 15);
    let until = now() * 1000 + minutes * 60 * 1000;
    c.execute(
        "INSERT INTO ai_bench (id, until_ms, params) VALUES (1, ?1, 'all')
         ON CONFLICT(id) DO UPDATE SET until_ms=excluded.until_ms, params=excluded.params",
        [until],
    ).map_err(|e| (500, e.to_string()))?;
    audit(c, "bench", "Props off, workspace clear, power confirmed", "active", "ui");
    Ok(json!({"ok": true, "until_ms": until}))
}

fn bench_stop(c: &Connection, reason: &str) -> Value {
    c.execute("DELETE FROM ai_bench WHERE id=1", []).ok();
    audit(c, "bench", reason, "revoked", "ui");
    json!({"ok": true, "bench": null})
}

fn bench_left(c: &Connection) -> Option<Value> {
    let until: i64 = c.query_row("SELECT until_ms FROM ai_bench WHERE id=1", [], |r| r.get(0)).ok()?;
    let now_ms = now() * 1000;
    if until <= now_ms {
        c.execute("DELETE FROM ai_bench WHERE id=1", []).ok();
        return None;
    }
    Some(json!({"until_ms": until, "left_s": (until - now_ms) / 1000}))
}

fn safe_on(c: &Connection) -> bool {
    bench_left(c).is_some()
}

fn fold_identical_pending(c: &Connection, id: &str, status: &str) {
    let row: Result<(String, String, String, Option<f64>, f64, String), _> = c.query_row(
        "SELECT chat_id, kind, param, old_value, new_value, payload FROM ai_proposal WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
    );
    let Ok((chat, kind, param, old, value, payload)) = row else { return };
    let sql = "UPDATE ai_proposal SET status=?1 WHERE chat_id=?2 AND status='pending' AND kind=?3 AND param=?4 AND payload=?5 AND id!=?6 AND new_value=?7 AND ((old_value IS NULL AND ?8 IS NULL) OR old_value=?8)";
    c.execute(sql, params![status, chat, kind, param, payload, id, value, old]).ok();
}

/// Stores a vehicle change until the user approves it. Nothing is sent.
fn hold_change(c: &Connection, chat: &str, kind: &str, title: &str, old: Option<f64>, new_value: f64, reason: &str, payload: &str) -> Value {
    let existing: Result<String, _> = c.query_row(
        "SELECT id FROM ai_proposal WHERE chat_id=?1 AND status='pending' AND kind=?2 AND param=?3 AND payload=?4 AND new_value=?5 AND ((old_value IS NULL AND ?6 IS NULL) OR old_value=?6) ORDER BY created_at LIMIT 1",
        params![chat, kind, title, payload, new_value, old],
        |row| row.get(0),
    );
    if let Ok(id) = existing {
        return json!({ "hold": true, "id": id, "action": title });
    }
    let id = Uuid::new_v4().to_string();
    c.execute(
        "INSERT INTO ai_proposal (id, chat_id, status, param, old_value, new_value, reason, created_at, kind, payload) VALUES (?1,?2,'pending',?3,?4,?5,?6,?7,?8,?9)",
        params![id, chat, title, old, new_value, reason, now(), kind, payload],
    ).ok();
    json!({
        "hold": true,
        "id": id,
        "action": title
    })
}

fn action_failed(value: &Value) -> bool {
    value.get("ok") == Some(&Value::Bool(false))
        || (value.get("error").is_some() && value.get("ok") != Some(&Value::Bool(true)))
}

fn run_saved(kind: &str, param: &str, value: f64, payload: &str, tx: &Sender<Cmd>) -> Result<(), String> {
    let result = match kind {
        "param" | "" => {
            tx.send(Cmd::Param { name: param.to_string(), value }).map_err(|_| "Link stopped".to_string())?;
            return Ok(());
        }
        "mode" => bridge_post("/cmd", &json!({"op": "mode", "mode": param}), 15),
        "arm" => bridge_post("/cmd", &json!({"op": "arm", "on": true}), 8),
        "disarm" => bridge_post("/cmd", &json!({"op": "arm", "on": false}), 8),
        "reboot" => bridge_post("/cmd", &json!({"op": "reboot"}), 8),
        "erase_logs" => bridge_post("/logs/erase", &json!({"confirm": true}), 15),
        "flash" => {
            let args: Value = serde_json::from_str(payload).unwrap_or_else(|_| json!({}));
            bridge_post("/firmware/flash", &args, 60)
        }
        _ => json!({ "ok": false, "error": "Unknown saved action" }),
    };
    if action_failed(&result) {
        let message = result.get("error").and_then(|v| v.as_str()).unwrap_or("The vehicle refused the action");
        return Err(message.to_string());
    }
    Ok(())
}
