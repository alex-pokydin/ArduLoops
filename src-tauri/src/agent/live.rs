// Live turn: generation, stop, and the status the UI polls.


thread_local! {
    static THIS_TURN: Cell<u64> = const { Cell::new(0) };
}

static TURN_SEQ: AtomicU64 = AtomicU64::new(1);
/// Generation of the turn the user stopped. A later turn has a different generation.
static HALT: AtomicU64 = AtomicU64::new(0);

struct LiveTurn {
    gen: u64,
    chat: String,
    tool: String,
    input: String,
    thought: String,
    /// Reasoning of the provider step that is still streaming. Sealed into `thought` when the next step starts.
    step: String,
    reply: String,
    note: String,
    docs: Vec<(String, String, String)>,
}

static LIVE: Mutex<Option<LiveTurn>> = Mutex::new(None);

fn begin_live(chat: &str) -> u64 {
    let gen = TURN_SEQ.fetch_add(1, Ordering::Relaxed);
    THIS_TURN.with(|cell| cell.set(gen));
    if let Ok(mut guard) = LIVE.lock() {
        *guard = Some(LiveTurn {
            gen,
            chat: chat.to_string(),
            tool: String::new(),
            input: String::new(),
            thought: String::new(),
            step: String::new(),
            reply: String::new(),
            note: String::new(),
            docs: Vec::new(),
        });
    }
    gen
}

fn end_live(gen: u64) {
    THIS_TURN.with(|cell| {
        if cell.get() == gen {
            cell.set(0);
        }
    });
    if let Ok(mut guard) = LIVE.lock() {
        if guard.as_ref().is_some_and(|live| live.gen == gen) {
            *guard = None;
        }
    }
}

fn halt_turn() {
    // Leave the live row up until the turn thread notices and calls end_live.
    // Clearing it here let a new message start a second turn while this one was still blocked.
    if let Ok(guard) = LIVE.lock() {
        if let Some(live) = guard.as_ref() {
            HALT.store(live.gen, Ordering::Relaxed);
        }
    }
}

pub(crate) fn turn_stop_requested() -> bool {
    let halt = HALT.load(Ordering::Relaxed);
    if halt == 0 {
        return false;
    }
    LIVE.lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|live| live.gen == halt))
        .unwrap_or(false)
}

fn turn_gen() -> u64 {
    THIS_TURN.with(|cell| cell.get())
}

fn turn_halted() -> bool {
    gen_halted(turn_gen())
}

fn gen_halted(gen: u64) -> bool {
    gen != 0 && HALT.load(Ordering::Relaxed) == gen
}

fn turn_is_live(chat: &str) -> bool {
    LIVE.lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|live| live.chat == chat))
        .unwrap_or(false)
}

fn live_mut(f: impl FnOnce(&mut LiveTurn)) {
    let gen = THIS_TURN.with(|cell| cell.get());
    if gen == 0 {
        return;
    }
    if let Ok(mut guard) = LIVE.lock() {
        if let Some(live) = guard.as_mut() {
            if live.gen == gen {
                f(live);
            }
        }
    }
}

fn live_thinking() {
    live_mut(|live| {
        seal_step(live);
        live.tool.clear();
        live.input.clear();
        live.reply.clear();
    });
}

fn live_reply(text: &str) {
    if text.is_empty() {
        return;
    }
    let text: String = text.chars().take(16_000).collect();
    live_mut(|live| live.reply = text);
}

fn live_clear_reply() {
    live_mut(|live| live.reply.clear());
}

fn live_thought(text: &str) {
    if text.is_empty() {
        return;
    }
    let count = text.chars().count();
    let text: String = if count <= 4_000 { text.to_string() } else { text.chars().skip(count - 4_000).collect() };
    live_mut(|live| live.step = text);
}

fn seal_step(live: &mut LiveTurn) {
    if live.step.is_empty() {
        return;
    }
    if !live.thought.is_empty() {
        live.thought.push_str("\n\n");
    }
    live.thought.push_str(&live.step);
    live.step.clear();
    let cap = 12_000usize;
    let count = live.thought.chars().count();
    if count > cap {
        live.thought = live.thought.chars().skip(count - cap).collect();
    }
}

fn thought_text(live: &LiveTurn) -> String {
    if live.step.is_empty() {
        live.thought.clone()
    } else if live.thought.is_empty() {
        live.step.clone()
    } else {
        format!("{}\n\n{}", live.thought, live.step)
    }
}

fn live_note(text: &str) {
    live_mut(|live| live.note = text.to_string());
}

fn live_tool(name: &str, args: &Value) {
    let name = name.to_string();
    let input = live_args(args);
    live_mut(|live| {
        live.tool = name;
        live.input = input;
    });
}

fn live_args(args: &Value) -> String {
    let Some(obj) = args.as_object() else { return String::new() };
    let mut keep = serde_json::Map::new();
    for key in ["file", "message", "messages", "names", "name", "glob", "query", "field", "op", "log_id", "prefix", "action"] {
        if let Some(value) = obj.get(key) {
            keep.insert(key.to_string(), value.clone());
        }
    }
    if let Some(jobs) = obj.get("jobs").and_then(Value::as_array) {
        let brief: Vec<Value> = jobs.iter().take(6).map(|job| json!({
            "field": job.get("field").cloned().unwrap_or(Value::Null),
            "op": job.get("op").cloned().unwrap_or(Value::Null),
        })).collect();
        keep.insert("jobs".to_string(), json!(brief));
    }
    if keep.is_empty() {
        return brief_args(args);
    }
    serde_json::to_string(&Value::Object(keep)).unwrap_or_default()
}

fn brief_args(args: &Value) -> String {
    let Some(obj) = args.as_object() else { return String::new() };
    if obj.is_empty() {
        return String::new();
    }
    if obj.len() == 1 {
        if let Some((_, value)) = obj.iter().next() {
            return brief_value(value);
        }
    }
    args.to_string().chars().take(80).collect()
}

fn brief_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.chars().take(80).collect(),
        Value::Array(items) => items.iter().filter_map(|item| item.as_str()).take(4).collect::<Vec<_>>().join(", "),
        other => other.to_string().chars().take(80).collect(),
    }
}

fn live_document(doc: &Value) {
    let url = doc["url"].as_str().unwrap_or("").trim().to_string();
    if url.is_empty() {
        return;
    }
    let title = doc["title"].as_str().unwrap_or("Document").trim().to_string();
    let format = doc["format"].as_str().unwrap_or("").trim().to_string();
    let mut chat = String::new();
    let mut fresh = false;
    live_mut(|live| {
        chat = live.chat.clone();
        if live.docs.iter().any(|item| item.2 == url) {
            return;
        }
        live.docs.push((title.clone(), format.clone(), url.clone()));
        fresh = true;
    });
    if !fresh || chat.is_empty() {
        return;
    }
    if let Ok(c) = conn() {
        note_doc(&c, &chat, &json!({ "title": title, "format": format, "url": url }));
    }
}

fn live_status(chat: &str) -> Value {
    let guard = LIVE.lock().ok();
    let Some(live) = guard.as_ref().and_then(|guard| guard.as_ref()) else {
        return json!({ "active": false });
    };
    if live.chat != chat {
        return json!({ "active": false });
    }
    let docs: Vec<Value> = live.docs.iter().map(|(title, format, url)| json!({ "title": title, "format": format, "url": url })).collect();
    json!({ "active": true, "tool": live.tool, "input": live.input, "thought": thought_text(live), "reply": live.reply, "note": live.note, "docs": docs })
}
