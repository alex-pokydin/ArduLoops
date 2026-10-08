// Chat storage, provider keys, and the /ai routes.


pub fn migrate(conn: &Connection) -> Result<(), String> {
    crate::migrate::apply(conn)
}

fn conn() -> Result<Connection, String> {
    let c = Connection::open(data_dir().join("catalog.sqlite3")).map_err(|e| e.to_string())?;
    c.execute_batch("PRAGMA foreign_keys=ON;").ok();
    migrate(&c)?;
    Ok(c)
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn secrets_path() -> std::path::PathBuf {
    data_dir().join("ai-secrets.json")
}

fn load_secrets() -> HashMap<String, String> {
    let Ok(bytes) = fs::read(secrets_path()) else {
        return HashMap::new();
    };
    serde_json::from_slice::<HashMap<String, String>>(&bytes).unwrap_or_default()
}

fn save_secrets(map: &HashMap<String, String>) -> Result<(), String> {
    let path = secrets_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string(map).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

fn default_model(provider: &str) -> &'static str {
    match provider {
        "gemini" => "gemini-3.8-flash",
        "openai" => "gpt-6-sol",
        "anthropic" => "claude-opus-5-5",
        "xai" => "grok-4.7",
        _ => "",
    }
}

pub fn route(
    method: &str,
    path: &str,
    query: &HashMap<String, String>,
    body: &Value,
    sample: &Sample,
    tx: &Sender<Cmd>,
) -> Result<Value, (u16, String)> {
    let c = conn().map_err(|e| (500, e))?;
    match (method, path) {
        ("GET", "/ai/status") => Ok(status(&c)),
        ("POST", "/ai/provider") => provider_op(&c, body),
        ("POST", "/ai/login") => Ok(json!({"url": login_url()})),
        ("POST", "/ai/cabinet") => {
            let url = cabinet_url().map_err(|e| (502, e))?;
            Ok(json!({"url": url}))
        }
        ("POST", "/ai/logout") => {
            logout_session();
            Ok(status(&c))
        }
        ("POST", "/ai/checkout") => {
            let plan = body["plan"].as_str().unwrap_or("start");
            let url = checkout_url(plan).map_err(|e| (502, e))?;
            Ok(json!({"url": url}))
        }
        ("POST", "/ai/portal") => {
            let url = portal_url().map_err(|e| (502, e))?;
            Ok(json!({"url": url}))
        }
        ("GET", "/ai/chats") => Ok(list_chats(&c)),
        ("POST", "/ai/chats") => Ok(create_chat(&c, body)),
        ("POST", "/ai/chats/rename") => rename_chat(&c, body),
        ("GET", "/ai/messages") => messages(&c, query.get("chat").map(String::as_str).unwrap_or("")),
        ("GET", "/ai/live") => Ok(live_status(query.get("chat").map(String::as_str).unwrap_or(""))),
        ("POST", "/ai/send") => send(&c, body, sample, tx),
        ("POST", "/ai/proposal") => decide(&c, body, sample, tx),
        ("POST", "/ai/wizard") => settle_wizard(&c, body, sample, tx),
        ("GET", "/ai/logs") => Ok(crate::dflog::list_logs()),
        ("GET", "/ai/audit") => Ok(audit_list(&c)),
        ("POST", "/ai/revert") => revert_audit(&c, body, sample),
        ("POST", "/ai/note") => note_ui(&c, body),
        ("POST", "/ai/bench") => bench(&c, body),
        ("POST", "/ai/bench/stop") => Ok(bench_stop(&c, "Emergency stop")),
        ("POST", "/ai/stop") => {
            halt_turn();
            Ok(json!({"ok": true}))
        }
        _ => Err((404, "Unknown assistant route".into())),
    }
}

fn arm_default_hosted(c: &Connection) {
    let active: i64 = c
        .query_row("SELECT COUNT(*) FROM ai_provider WHERE active=1", [], |row| row.get(0))
        .unwrap_or(0);
    if active > 0 {
        return;
    }
    let model = default_model("gemini");
    let _ = c.execute(
        "INSERT INTO ai_provider (provider, active, model, status, storage, updated_at) VALUES ('gemini', 1, ?1, 'ready', 'hosted', ?2)
         ON CONFLICT(provider) DO UPDATE SET active=1, model=excluded.model, status='ready', storage='hosted', updated_at=excluded.updated_at",
        params![model, now()],
    );
}

fn status(c: &Connection) -> Value {
    if signed_in() && hosted_assistant_on() {
        arm_default_hosted(c);
    }
    let mut rows = Vec::new();
    if let Ok(mut st) = c.prepare("SELECT provider, active, model, status, storage FROM ai_provider ORDER BY provider") {
        let _ = st.query_map([], |row| {
            Ok(json!({
                "provider": row.get::<_, String>(0)?,
                "active": row.get::<_, i64>(1)? == 1,
                "model": row.get::<_, String>(2)?,
                "status": row.get::<_, String>(3)?,
                "storage": row.get::<_, String>(4)?,
                "configured": true,
            }))
        }).map(|iter| {
            for item in iter.flatten() {
                rows.push(item);
            }
        });
    }
    let active = rows.iter().find(|r| r["active"] == true).cloned();
    let hosted = active.as_ref().map(|r| r["storage"] == "hosted").unwrap_or(false);
    let ready = active.as_ref().map(|r| r["status"] == "ready").unwrap_or(false);
    let own_key = active.as_ref()
        .and_then(|r| r["provider"].as_str())
        .and_then(|provider| load_secrets().get(provider).cloned())
        .is_some_and(|key| !key.is_empty());
    let bench = bench_left(c);
    json!({
        "configured": ready && ((hosted && signed_in()) || own_key),
        "active": active,
        "providers": rows,
        "storage": "Local storage (reduced protection)",
        "bench": bench,
        "account": account_status(),
    })
}

fn provider_op(c: &Connection, body: &Value) -> Result<Value, (u16, String)> {
    let provider = body["provider"].as_str().unwrap_or("disabled");
    let op = body["op"].as_str().unwrap_or("");
    if provider == "disabled" || op == "disable" {
        c.execute("UPDATE ai_provider SET active=0", []).ok();
        if signed_in() {
            set_hosted_assistant(false);
        }
        return Ok(status(c));
    }
    if !matches!(provider, "gemini" | "openai" | "anthropic" | "xai") {
        return Err((400, "Unknown provider".into()));
    }
    let mut secrets = load_secrets();
    if op == "remove" {
        secrets.remove(provider);
        save_secrets(&secrets).map_err(|e| (500, e))?;
        c.execute("DELETE FROM ai_provider WHERE provider=?1", [provider]).ok();
        return Ok(status(c));
    }
    if op == "hosted" {
        if !signed_in() {
            return Err((401, "Sign in required.".into()));
        }
        set_hosted_assistant(true);
        let model = default_model(provider);
        c.execute("UPDATE ai_provider SET active=0", []).ok();
        c.execute(
            "INSERT INTO ai_provider (provider, active, model, status, storage, updated_at) VALUES (?1, 1, ?2, 'ready', 'hosted', ?3)
             ON CONFLICT(provider) DO UPDATE SET active=1, model=excluded.model, status='ready', storage='hosted', updated_at=excluded.updated_at",
            params![provider, model, now()],
        ).map_err(|e| (500, e.to_string()))?;
        return Ok(status(c));
    }
    if op == "save" || op == "check" {
        if let Some(key) = body["api_key"].as_str().filter(|s| !s.trim().is_empty()) {
            secrets.insert(provider.into(), key.trim().to_string());
            save_secrets(&secrets).map_err(|e| (500, e))?;
        }
        let key = secrets.get(provider).cloned().ok_or((400, "API key required".into()))?;
        let requested = body["model"].as_str().filter(|s| !s.is_empty()).unwrap_or(default_model(provider));
        let (state, model) = if op == "check" {
            probe(provider, requested, &key)
        } else {
            ("saved".into(), requested.to_string())
        };
        if op == "check" && state != "ready" {
            c.execute(
                "INSERT INTO ai_provider (provider, active, model, status, storage, updated_at) VALUES (?1, 0, ?2, ?3, 'local', ?4)
                 ON CONFLICT(provider) DO UPDATE SET model=excluded.model, status=excluded.status, updated_at=excluded.updated_at",
                params![provider, model, state, now()],
            ).ok();
            return Ok(json!({"ok": false, "status": state, "detail": status(c)}));
        }
        c.execute("UPDATE ai_provider SET active=0", []).ok();
        c.execute(
            "INSERT INTO ai_provider (provider, active, model, status, storage, updated_at) VALUES (?1, 1, ?2, 'ready', 'local', ?3)
             ON CONFLICT(provider) DO UPDATE SET active=1, model=excluded.model, status='ready', storage='local', updated_at=excluded.updated_at",
            params![provider, model, now()],
        ).map_err(|e| (500, e.to_string()))?;
        return Ok(status(c));
    }
    Err((400, "Unknown provider action".into()))
}

fn probe(provider: &str, model: &str, key: &str) -> (String, String) {
    match call_provider(provider, model, key, "Reply with the single word OK.", &[]) {
        Ok(_) => ("ready".into(), model.to_string()),
        Err(err) => {
            if let Some(next) = replacement_model(&err) {
                if next != model && call_provider(provider, &next, key, "Reply with the single word OK.", &[]).is_ok() {
                    return ("ready".into(), next);
                }
            }
            (classify(&err), model.to_string())
        }
    }
}

/// Google names the replacement in a 404: "use models/gemini-3.8-flash".
fn replacement_model(err: &str) -> Option<String> {
    let marker = "use models/";
    let start = err.find(marker)? + marker.len();
    let rest = &err[start..];
    let end = rest
        .find(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '.' && c != '_')
        .unwrap_or(rest.len());
    let name = &rest[..end];
    if name.is_empty() { None } else { Some(name.to_string()) }
}

fn provider_failure(err: &str) -> &'static str {
    let lower = err.to_ascii_lowercase();
    if lower.contains("empty provider response") {
        "The model returned no text."
    } else if lower.contains("context length")
        || lower.contains("context_length")
        || lower.contains("token count")
        || lower.contains("too many tokens")
        || lower.contains("maximum number of input")
    {
        "The model rejected this turn because the request was too long."
    } else if lower.contains("timed out") || lower.contains("timeout") || lower.contains("deadline") {
        "The model did not answer in time."
    } else if code_of(&lower) == 401
        || code_of(&lower) == 403
        || lower.contains("api_key_invalid")
        || lower.contains("permission_denied")
        || lower.contains("invalid api key")
    {
        "invalid key"
    } else if code_of(&lower) == 404 || lower.contains("no longer available") || lower.contains("not_found") {
        "model unavailable"
    } else if code_of(&lower) == 429 || lower.contains("resource_exhausted") || lower.contains("quota") {
        "quota exceeded"
    } else {
        "The model request failed."
    }
}

fn code_of(lower: &str) -> u16 {
    lower.split_whitespace().find_map(|word| word.parse::<u16>().ok()).unwrap_or(0)
}

fn failure_body(err: &str, kind: &str) -> String {
    let detail: String = err.chars().take(300).collect();
    if kind == "The model returned no text." || kind == "invalid key" || detail == kind || detail.is_empty() {
        return kind.to_string();
    }
    format!("{kind}\n{detail}")
}

const STOPPED_TURN: &str = "This turn stopped before a reply.";

pub(crate) fn note_stopped_turns() {
    let Ok(c) = conn() else { return };
    note_stopped_turns_on(&c);
}

fn note_stopped_turns_on(c: &Connection) {
    let mut chats = Vec::new();
    if let Ok(mut st) = c.prepare("SELECT id FROM ai_chat") {
        let _ = st.query_map([], |row| row.get::<_, String>(0)).map(|iter| {
            for id in iter.flatten() {
                chats.push(id);
            }
        });
    }
    for chat in chats {
        let last: Option<String> = c.query_row(
            "SELECT role FROM ai_message WHERE chat_id=?1 AND role NOT IN ('held', 'compact', 'context', 'work', 'attach', 'quote', 'doc') ORDER BY id DESC LIMIT 1",
            [&chat],
            |row| row.get(0),
        ).ok();
        if last.as_deref() != Some("tool") {
            continue;
        }
        let open: i64 = c.query_row(
            "SELECT COUNT(*) FROM ai_proposal WHERE chat_id=?1 AND status IN ('pending', 'waiting')",
            [&chat],
            |row| row.get(0),
        ).unwrap_or(0);
        if open > 0 {
            continue;
        }
        save_assistant(c, &chat, STOPPED_TURN);
    }
}

fn classify(err: &str) -> String {
    let lower = err.to_ascii_lowercase();
    let code = lower.split_whitespace().find_map(|word| word.parse::<u16>().ok()).unwrap_or(0);
    if code == 401 || code == 403 || lower.contains("api_key_invalid") || lower.contains("permission_denied") || lower.contains("invalid api key") {
        "invalid key".into()
    } else if code == 404 || lower.contains("no longer available") || lower.contains("not_found") {
        "model unavailable".into()
    } else if code == 429 || lower.contains("resource_exhausted") || lower.contains("quota") {
        "quota exceeded".into()
    } else {
        "network unavailable".into()
    }
}

fn list_chats(c: &Connection) -> Value {
    backfill_chat_vehicles(c);
    let mut out = Vec::new();
    if let Ok(mut st) = c.prepare("SELECT id, title, updated_at, vehicle_key FROM ai_chat ORDER BY updated_at DESC LIMIT 40") {
        let _ = st.query_map([], |row| {
            Ok(json!({"id": row.get::<_, String>(0)?, "title": row.get::<_, String>(1)?, "updated_at": row.get::<_, i64>(2)?, "vehicle_key": row.get::<_, String>(3)?}))
        }).map(|iter| { for item in iter.flatten() { out.push(item); } });
    }
    json!({"chats": out})
}

fn create_chat(c: &Connection, body: &Value) -> Value {
    let id = Uuid::new_v4().to_string();
    let title = body["title"].as_str().filter(|s| !s.is_empty()).unwrap_or("New chat");
    let vehicle = body["vehicle_key"].as_str().unwrap_or("").trim();
    let t = now();
    let _ = c.execute(
        "INSERT INTO ai_chat (id, title, created_at, updated_at, vehicle_key) VALUES (?1, ?2, ?3, ?3, ?4)",
        params![id, title, t, vehicle],
    );
    json!({"id": id, "title": title, "vehicle_key": vehicle})
}

fn rename_chat(c: &Connection, body: &Value) -> Result<Value, (u16, String)> {
    let id = body["id"].as_str().unwrap_or("");
    let title = body["title"].as_str().unwrap_or("").trim();
    if id.is_empty() || title.is_empty() {
        return Err((400, "Chat title required".into()));
    }
    c.execute("UPDATE ai_chat SET title=?1, updated_at=?2 WHERE id=?3", params![title, now(), id])
        .map_err(|e| (500, e.to_string()))?;
    Ok(json!({"ok": true}))
}

fn chat_vehicle(sample: &Sample) -> String {
    if sample.boot_uid.is_empty() && sample.board_name.is_empty() && sample.frame.is_empty() {
        String::new()
    } else {
        crate::db::vehicle_cache_key(&sample.frame, &sample.board_name, &sample.boot_uid)
    }
}

fn json_string_field(body: &str, field: &str) -> Option<String> {
    let needle = format!("\"{field}\":\"");
    let start = body.find(&needle)? + needle.len();
    let rest = body.get(start..)?;
    let end = rest.find('"')?;
    let value = &rest[..end];
    if value.is_empty() { None } else { Some(value.to_string()) }
}

fn vehicle_key_from_messages(c: &Connection, chat: &str) -> Option<String> {
    let mut st = c.prepare("SELECT body FROM ai_message WHERE chat_id=?1 AND role='tool' ORDER BY id").ok()?;
    let rows = st.query_map([chat], |row| row.get::<_, String>(0)).ok()?;
    for body in rows.flatten() {
        let name = json_string_field(&body, "board").or_else(|| json_string_field(&body, "board_name"));
        let Some(name) = name else { continue };
        if name.is_empty() {
            continue;
        }
        let uid = c.query_row(
            "SELECT boot_uid FROM param_cache_meta WHERE board_name=?1 AND boot_uid!='' LIMIT 1",
            [name.as_str()],
            |row| row.get::<_, String>(0),
        );
        if let Ok(uid) = uid {
            if !uid.is_empty() {
                return Some(uid);
            }
        }
        return Some(format!("board:{name}"));
    }
    None
}

fn backfill_chat_vehicles(c: &Connection) {
    let mut ids = Vec::new();
    if let Ok(mut st) = c.prepare("SELECT id FROM ai_chat WHERE vehicle_key=''") {
        let _ = st.query_map([], |row| row.get::<_, String>(0)).map(|iter| {
            for id in iter.flatten() {
                ids.push(id);
            }
        });
    }
    for id in ids {
        let Some(key) = vehicle_key_from_messages(c, &id) else { continue };
        c.execute(
            "UPDATE ai_chat SET vehicle_key=?1 WHERE id=?2 AND vehicle_key=''",
            params![key, id],
        ).ok();
    }
}

fn remember_chat_vehicle(c: &Connection, chat: &str, sample: &Sample) {
    let key = chat_vehicle(sample);
    if key.is_empty() {
        return;
    }
    c.execute(
        "UPDATE ai_chat SET vehicle_key=?1 WHERE id=?2 AND vehicle_key=''",
        params![key, chat],
    ).ok();
}

fn messages(c: &Connection, chat: &str) -> Result<Value, (u16, String)> {
    if chat.is_empty() {
        return Err((400, "Missing chat".into()));
    }
    let mut out = Vec::new();
    let mut st = c.prepare("SELECT role, body, created_at FROM ai_message WHERE chat_id=?1 AND role NOT IN ('held', 'compact') ORDER BY id").map_err(|e| (500, e.to_string()))?;
    let iter = st.query_map([chat], |row| {
        Ok(json!({"role": row.get::<_, String>(0)?, "body": row.get::<_, String>(1)?, "at": row.get::<_, i64>(2)?}))
    }).map_err(|e| (500, e.to_string()))?;
    for item in iter.flatten() {
        out.push(item);
    }
    let mut props = Vec::new();
    if let Ok(mut st) = c.prepare("SELECT id, status, param, old_value, new_value, reason, kind, payload, created_at FROM ai_proposal WHERE chat_id=?1 ORDER BY created_at") {
        let _ = st.query_map([chat], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "status": row.get::<_, String>(1)?,
                "param": row.get::<_, String>(2)?,
                "old": row.get::<_, Option<f64>>(3)?,
                "new": row.get::<_, f64>(4)?,
                "reason": row.get::<_, String>(5)?,
                "kind": row.get::<_, String>(6)?,
                "payload": row.get::<_, String>(7)?,
                "at": row.get::<_, i64>(8)?,
            }))
        }).map(|iter| { for item in iter.flatten() { props.push(item); } });
    }
    Ok(json!({"messages": out, "proposals": props}))
}

fn store_script_quote(c: &Connection, chat: &str, body: &Value, t: i64) -> Result<(), (u16, String)> {
    let Some(stored) = script_quote_body(body) else {
        return Ok(());
    };
    c.execute(
        "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'quote', ?2, ?3)",
        params![chat, stored, t],
    ).map_err(|e| (500, e.to_string()))?;
    Ok(())
}

fn send(c: &Connection, body: &Value, sample: &Sample, tx: &Sender<Cmd>) -> Result<Value, (u16, String)> {
    let chat = body["chat"].as_str().unwrap_or("");
    let text = body["text"].as_str().unwrap_or("").trim();
    if chat.is_empty() || text.is_empty() {
        return Err((400, "Message required".into()));
    }
    let lang = body["lang"].as_str().unwrap_or("en");
    active_key(c, body["model"].as_str())?;
    let t = now();
    // An open card, or a turn that is still running, must not start a second
    // turn. The note is steering for that turn. A stopped turn is not running.
    if pending_count(c, chat) > 0 || turn_is_live(chat) {
        c.execute(
            "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'steer', ?2, ?3)",
            params![chat, text, t],
        ).map_err(|e| (500, e.to_string()))?;
        store_script_quote(c, chat, body, t)?;
        c.execute("UPDATE ai_chat SET updated_at=?1 WHERE id=?2", params![t, chat]).ok();
        return Ok(json!({"ok": true, "status": "steer", "message": text}));
    }
    c.execute("INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'user', ?2, ?3)", params![chat, text, t])
        .map_err(|e| (500, e.to_string()))?;
    let log_id = body["log"].as_str().unwrap_or("").trim();
    if !log_id.is_empty() {
        c.execute(
            "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'attach', ?2, ?3)",
            params![chat, log_id, t],
        ).map_err(|e| (500, e.to_string()))?;
    }
    store_script_quote(c, chat, body, t)?;
    remember_chat_vehicle(c, chat, sample);
    if title_is_new(c, chat) {
        let title: String = text.chars().take(48).collect();
        c.execute("UPDATE ai_chat SET title=?1, updated_at=?2 WHERE id=?3", params![title, t, chat]).ok();
    } else {
        c.execute("UPDATE ai_chat SET updated_at=?1 WHERE id=?2", params![t, chat]).ok();
    }
    complete_turn(c, body, sample, tx, chat, lang, log_id)
}

fn complete_turn(
    c: &Connection,
    body: &Value,
    sample: &Sample,
    tx: &Sender<Cmd>,
    chat: &str,
    lang: &str,
    log_id: &str,
) -> Result<Value, (u16, String)> {
    let (provider, model, key) = active_key(c, body["model"].as_str())?;
    let started = now_ms();
    let gen = begin_live(chat);
    // Notes written while the previous step was still open are part of this turn.
    claim_steers_through(c, chat, latest_message_id(c, chat));
    let history = prepare_context(c, chat);
    let reasoning = body["reasoning"].as_str().unwrap_or("");
    let system = system_prompt(lang, sample, bench_left(c).is_some(), log_id);
    let prompt = conversation_prompt(&history, log_id);
    let reply = converse(&provider, &model, &key, reasoning, &system, &prompt, sample, c, tx, chat, log_id);
    save_work(c, chat, now_ms().saturating_sub(started));
    schedule_compact(chat, &provider, &model, &key);
    let reply = match reply {
        Ok(text) => text,
        Err(err) => {
            end_live(gen);
            if err == "stopped" {
                let note = "Stopped.";
                c.execute(
                    "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'assistant', ?2, ?3)",
                    params![chat, note, now()],
                ).ok();
                return Ok(json!({"ok": true, "message": note, "status": "cancelled"}));
            }
            if err == "awaiting_confirmation" {
                return Ok(json!({"ok": true, "status": "awaiting_confirmation"}));
            }
            if err == "paused_limit" {
                let note = "Paused at the tool limit. Continue to give a new budget.";
                c.execute(
                    "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'assistant', ?2, ?3)",
                    params![chat, note, now()],
                ).ok();
                return Ok(json!({"ok": false, "status": "paused_limit", "message": note}));
            }
            let kind = provider_failure(&err);
            audit(c, "assistant", "Provider request failed", kind, "agent");
            save_assistant(c, chat, &failure_body(&err, kind));
            return Ok(json!({"ok": false, "status": kind, "error": kind}));
        }
    };
    let shown = strip_proposal_tag(&reply);
    if !shown.is_empty() {
        c.execute(
            "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'assistant', ?2, ?3)",
            params![chat, shown, now()],
        ).ok();
    }
    end_live(gen);
    Ok(json!({"ok": true, "message": shown, "status": "ready"}))
}

fn strip_proposal_tag(text: &str) -> String {
    if let Some(start) = text.find("[[propose ") {
        if let Some(end) = text[start..].find("]]") {
            let mut out = String::new();
            out.push_str(text[..start].trim());
            out.push_str(text[start + end + 2..].trim());
            return out.trim().to_string();
        }
    }
    text.trim().to_string()
}

fn title_is_new(c: &Connection, chat: &str) -> bool {
    c.query_row("SELECT title FROM ai_chat WHERE id=?1", [chat], |r| r.get::<_, String>(0))
        .map(|t| t == "New chat")
        .unwrap_or(false)
}

fn active_key(c: &Connection, model_override: Option<&str>) -> Result<(String, String, String), (u16, String)> {
    let row: Result<(String, String, String), _> = c.query_row(
        "SELECT provider, model, storage FROM ai_provider WHERE active=1 AND status='ready'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    );
    let (provider, model, storage) = row.map_err(|_| (409, "not configured".to_string()))?;
    let model = model_override.filter(|s| !s.is_empty()).unwrap_or(&model).to_string();
    let key = load_secrets().get(&provider).cloned().filter(|key| !key.is_empty());
    if storage == "hosted" && signed_in() {
        return Ok((provider, model, String::new()));
    }
    let key = key.ok_or((409, "not configured".to_string()))?;
    Ok((provider, model, key))
}
