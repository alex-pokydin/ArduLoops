// Folded chat context and the recent-turn window.


const RECENT_TURNS: usize = 6;
const RECENT_FLOOR: usize = 2;
const RECENT_BUDGET: usize = 160_000;
const NOTE_CAP: usize = 10_000;

struct MsgRow {
    id: i64,
    role: String,
    body: String,
}

struct ContextPlan {
    opening: Option<String>,
    later_turns: usize,
    summary: Option<String>,
    recent: Vec<(String, String)>,
}

fn prepare_context(c: &Connection, chat: &str) -> String {
    let rows = load_chat_rows(c, chat);
    let plan = plan_context(&rows);
    if let Some(note) = plan.summary.clone() {
        live_note(&note);
        save_context(c, chat, &note);
    }
    render_context(&plan)
}

fn save_context(c: &Connection, chat: &str, note: &str) {
    let note = note.trim();
    if note.is_empty() {
        return;
    }
    c.execute(
        "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'context', ?2, ?3)",
        params![chat, note, now()],
    ).ok();
}

struct CompactJobs {
    running: HashSet<String>,
    again: HashSet<String>,
}

static COMPACT_JOBS: LazyLock<Mutex<CompactJobs>> = LazyLock::new(|| Mutex::new(CompactJobs { running: HashSet::new(), again: HashSet::new() }));

fn schedule_compact(chat: &str, provider: &str, model: &str, key: &str) {
    if chat.is_empty() || provider.is_empty() || key.is_empty() {
        return;
    }
    let mut jobs = match COMPACT_JOBS.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    if !jobs.running.insert(chat.to_string()) {
        jobs.again.insert(chat.to_string());
        return;
    }
    drop(jobs);
    let chat = chat.to_string();
    let provider = provider.to_string();
    let model = model.to_string();
    let key = key.to_string();
    thread::spawn(move || {
        loop {
            fold_pending(&chat, &provider, &model, &key);
            let Ok(mut jobs) = COMPACT_JOBS.lock() else { break };
            if jobs.again.remove(&chat) {
                continue;
            }
            jobs.running.remove(&chat);
            break;
        }
    });
}

fn fold_pending(chat: &str, provider: &str, model: &str, key: &str) {
    let Ok(c) = conn() else { return };
    for _ in 0..24 {
        let rows = load_chat_rows(&c, chat);
        let Some((through, lines)) = next_fold_turn(&rows) else { break };
        let plan = plan_context(&rows);
        let source = fold_source(plan.summary.as_deref(), &lines);
        let Ok(text) = compact_history(provider, model, key, &source) else { break };
        let note = clip_chars(&text, NOTE_CAP);
        if note.is_empty() {
            break;
        }
        let body = json!({ "through": through, "text": note }).to_string();
        if c.execute(
            "INSERT INTO ai_message (chat_id, role, body, created_at) VALUES (?1, 'compact', ?2, ?3)",
            params![chat, body, now()],
        ).is_err() {
            break;
        }
    }
}

fn load_chat_rows(c: &Connection, chat: &str) -> Vec<MsgRow> {
    let mut rows = Vec::new();
    if let Ok(mut st) = c.prepare("SELECT id, role, body FROM ai_message WHERE chat_id=?1 ORDER BY id") {
        let _ = st.query_map([chat], |row| {
            Ok(MsgRow { id: row.get(0)?, role: row.get(1)?, body: row.get(2)? })
        }).map(|iter| {
            for item in iter.flatten() {
                rows.push(item);
            }
        });
    }
    rows
}

fn compact_note(body: &str) -> Option<(i64, String)> {
    let value: Value = serde_json::from_str(body).ok()?;
    let through = value["through"].as_i64()?;
    let text = value["text"].as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    Some((through, text.to_string()))
}

struct ChatIndex {
    visible: Vec<usize>,
    user_at: Vec<usize>,
    opening_at: Option<usize>,
}

fn chat_index(rows: &[MsgRow]) -> ChatIndex {
    let visible: Vec<usize> = rows.iter().enumerate()
        .filter(|(_, row)| !matches!(row.role.as_str(), "held" | "work" | "compact" | "context"))
        .map(|(i, _)| i)
        .collect();
    let user_at: Vec<usize> = visible.iter().copied().filter(|&i| rows[i].role == "user").collect();
    let opening_at = user_at.first().copied();
    ChatIndex { visible, user_at, opening_at }
}

fn recent_count(rows: &[MsgRow], index: &ChatIndex) -> usize {
    let n = index.user_at.len();
    if n == 0 {
        return 0;
    }
    if n <= RECENT_FLOOR {
        return n;
    }
    let mut turns = RECENT_TURNS.min(n);
    while turns > RECENT_FLOOR && window_chars(rows, index, turns) > RECENT_BUDGET {
        turns -= 1;
    }
    turns
}

fn recent_at(index: &ChatIndex, turns: usize) -> usize {
    let n = index.user_at.len();
    if n == 0 {
        return usize::MAX;
    }
    if n > turns {
        index.user_at[n - turns]
    } else {
        index.opening_at.unwrap_or(usize::MAX)
    }
}

fn window_chars(rows: &[MsgRow], index: &ChatIndex, turns: usize) -> usize {
    let start = recent_at(index, turns);
    index.visible.iter().filter(|&&i| start == usize::MAX || i >= start).filter(|&&i| index.opening_at != Some(i)).map(|&i| rows[i].body.chars().count()).sum()
}

fn plan_context(rows: &[MsgRow]) -> ContextPlan {
    let mut summary = None;
    let mut through = 0i64;
    for row in rows {
        if row.role == "compact" {
            if let Some((id, text)) = compact_note(&row.body) {
                if id >= through {
                    through = id;
                    summary = Some(clip_chars(&text, NOTE_CAP));
                }
            }
        }
    }
    let index = chat_index(rows);
    let opening = index.opening_at.map(|i| rows[i].body.trim().to_string()).filter(|text| !text.is_empty());
    let later_turns = index.user_at.len().saturating_sub(usize::from(opening.is_some()));
    let start = recent_at(&index, recent_count(rows, &index));
    let mut recent = Vec::new();
    for &i in &index.visible {
        if start == usize::MAX || i < start || index.opening_at == Some(i) {
            continue;
        }
        let row = &rows[i];
        recent.push((row.role.clone(), for_context(&row.role, &row.body)));
    }
    ContextPlan { opening, later_turns, summary, recent }
}

fn next_fold_turn(rows: &[MsgRow]) -> Option<(i64, Vec<(String, String)>)> {
    let mut through = 0i64;
    for row in rows {
        if row.role == "compact" {
            if let Some((id, _)) = compact_note(&row.body) {
                through = through.max(id);
            }
        }
    }
    let index = chat_index(rows);
    let turns = recent_count(rows, &index);
    if index.user_at.len() <= turns {
        return None;
    }
    let start = recent_at(&index, turns);
    let mut lines = Vec::new();
    let mut end = 0i64;
    let mut started = false;
    for &i in &index.visible {
        if i >= start {
            break;
        }
        let row = &rows[i];
        if index.opening_at == Some(i) || row.id <= through {
            continue;
        }
        if !matches!(row.role.as_str(), "user" | "steer" | "assistant" | "tool") {
            continue;
        }
        if started && row.role == "user" {
            break;
        }
        started = true;
        end = row.id;
        lines.push((row.role.clone(), for_context(&row.role, &row.body)));
    }
    if lines.is_empty() { None } else { Some((end, lines)) }
}

fn fold_source(summary: Option<&str>, lines: &[(String, String)]) -> String {
    let note = summary.unwrap_or("(none)");
    let body = lines.iter().map(|(role, text)| format!("{role}: {text}")).collect::<Vec<_>>().join("\n");
    format!("{}\n{}", xml_block("previous_note", note), xml_block("turns_to_fold", &body))
}

fn compact_prompt(source: &str) -> String {
    format!(
        "Update the note of this chat. previous_note is the note so far. turns_to_fold is the single next turn to add, and it is newer. Where they conflict, the turn replaces the note: a changed value, a new decision, or a limit the user restates wins. Where they do not conflict, keep the previous note. Write the note as plain headings, without those tags. Keep every heading below, in this order. If a heading has nothing, write none under it.\nConstraints: limits and refusals the user stated, in their words.\nDecisions: what was agreed, rejected, or already written, with parameter names and values.\nFindings: measurements and log results that a tool or a reply actually returned.\nVehicle: board, frame, link, and log ids that later turns still need.\nOpen: work that was started and is not finished.\nDo not invent a measurement. Do not add a method the user ruled out. Carry every constraint, decision, and finding from the previous note forward even when this turn does not repeat it. Stay under 8000 characters.\n\n{source}"
    )
}

fn compact_history(provider: &str, model: &str, key: &str, source: &str) -> Result<String, String> {
    call_provider(provider, model, key, &compact_prompt(source), &[])
}

fn clip_chars(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(max).collect();
    out.push('…');
    out
}

fn xml_block(tag: &str, body: &str) -> String {
    let close = format!("</{tag}>");
    let safe = body.replace(&close, &format!("< /{tag}>"));
    format!("<{tag}>\n{safe}\n</{tag}>\n")
}

fn for_context(role: &str, body: &str) -> String {
    let body = body.trim();
    if role != "tool" {
        return body.to_string();
    }
    let Ok(mut value) = serde_json::from_str::<Value>(body) else {
        return body.to_string();
    };
    drop_long_notes(&mut value);
    if let Some(output) = value.get_mut("output") {
        scrub_chart(output);
    }
    value.to_string()
}

fn drop_long_notes(value: &mut Value) {
    let Some(obj) = value.as_object_mut() else {
        if let Some(list) = value.as_array_mut() {
            for child in list {
                drop_long_notes(child);
            }
        }
        return;
    };
    if obj.get("note").and_then(|item| item.as_str()).is_some_and(|text| text.chars().count() > 400) {
        obj.remove("note");
    }
    for child in obj.values_mut() {
        drop_long_notes(child);
    }
}

fn render_lines(lines: &[(String, String)]) -> String {
    let mut out = String::new();
    for (role, body) in lines {
        out.push_str(role);
        out.push_str(": ");
        out.push_str(body);
        out.push('\n');
    }
    out
}

fn render_context(plan: &ContextPlan) -> String {
    let mut out = String::new();
    if let Some(opening) = &plan.opening {
        let body = if plan.later_turns == 0 {
            format!("user: {opening}")
        } else {
            format!(
                "The first message, unchanged. {} user turns follow it. Act on the latest user message in recent_turns.\nuser: {opening}",
                plan.later_turns
            )
        };
        out.push_str(&xml_block("opening_request", &body));
    }
    if let Some(summary) = &plan.summary {
        out.push_str(&xml_block("folded_turns", summary));
    }
    if !plan.recent.is_empty() {
        out.push_str(&xml_block("recent_turns", &render_lines(&plan.recent)));
    }
    out
}
