// The model loop and provider requests.

const TOOL_BUDGET: u32 = 100;

fn converse(
    provider: &str,
    model: &str,
    key: &str,
    reasoning: &str,
    system: &str,
    lang: &str,
    prompt: &str,
    sample: &Sample,
    c: &Connection,
    tx: &Sender<Cmd>,
    chat: &str,
    log_id: &str,
) -> Result<String, String> {
    let mut messages = vec![genai::chat::ChatMessage::user(prompt)];
    let mut steer_after = latest_message_id(c, chat);
    let mut turn_id: Option<String> = None;
    let mut seen: HashMap<String, Value> = HashMap::new();
    let mut repeat_streak = 0u32;
    let mut used = 0u32;
    let mut charts = ChartBook::default();
    let mut live_on = false;
    let hosted = key.is_empty();
    for _ in 0..TOOL_BUDGET {
        if turn_halted() {
            return Err("stopped".into());
        }
        if used >= TOOL_BUDGET {
            return Err("paused_limit".into());
        }
        if let Some(note) = drain_steers(c, chat, &mut steer_after) {
            append_steer(&mut messages, &note);
        }
        live_thinking();
        let quota = if turn_id.is_some() { "continue" } else { "turn" };
        let mut turn = if hosted {
            match hosted_turn(provider, model, reasoning, system, lang, &messages, quota, chat, &mut turn_id) {
                Ok(turn) => turn,
                Err(err) if err.to_ascii_lowercase().contains("too many tools") => return Err("paused_limit".into()),
                Err(err) => return Err(err),
            }
        } else {
            provider_turn(provider, model, key, reasoning, system, &messages)?
        };
        apply_leaked_tools(&mut turn);
        if turn.calls.is_empty() {
            if turn.text.trim().is_empty() {
                return Err("empty provider response".into());
            }
            return Ok(turn.text);
        }
        messages.push(turn.assistant.unwrap_or_else(|| assistant_from_calls(turn.calls.clone())));
        let planned: Vec<(String, Value)> = turn.calls.iter().map(|call| {
            (call.fn_name.clone(), call.fn_arguments.clone())
        }).collect();
        let added = fresh_calls(&planned, &seen);
        let batch = run_batch(&planned, &mut seen, sample, c, tx, chat, log_id, &mut charts, &mut live_on);
        used += added;
        if batch.all_repeat {
            repeat_streak += 1;
            if repeat_streak >= 2 {
                return Ok(polling_stopped(system));
            }
        } else {
            repeat_streak = 0;
        }
        let responses: Vec<genai::chat::ToolResponse> = turn.calls.iter().zip(batch.results.iter()).map(|(call, result)| {
            genai::chat::ToolResponse::from_tool_call(call, &tool_text(result))
        }).collect();
        messages.push(genai::chat::ChatMessage::tool(responses));
        if batch.waiting {
            save_assistant(c, chat, &turn.text);
            return Err("awaiting_confirmation".into());
        }
    }
    Err("paused_limit".into())
}

fn tool_text(result: &Value) -> String {
    if let Some(text) = result.as_str() {
        return text.to_string();
    }
    if result.get("chart").is_some() {
        let mut brief = result.clone();
        scrub_chart(&mut brief);
        return brief.to_string();
    }
    result.to_string()
}

fn scrub_chart(value: &mut Value) {
    if let Some(axes) = value.get_mut("chart").and_then(|chart| chart.get_mut("axes")).and_then(|axes| axes.as_array_mut()) {
        for axis in axes {
            let Some(lines) = axis.get_mut("lines").and_then(|lines| lines.as_array_mut()) else { continue };
            for line in lines {
                let Some(obj) = line.as_object_mut() else { continue };
                let (x_n, x_min, x_max) = series_span(obj.get("x"));
                let (y_n, y_min, y_max) = series_span(obj.get("y"));
                obj.remove("x");
                obj.remove("y");
                obj.insert("points".into(), json!(if x_n > 0 { x_n } else { y_n }));
                obj.insert("x_min".into(), json_num(x_min));
                obj.insert("x_max".into(), json_num(x_max));
                obj.insert("y_min".into(), json_num(y_min));
                obj.insert("y_max".into(), json_num(y_max));
            }
        }
    }
    let Some(heat) = value.get_mut("chart").and_then(|chart| chart.get_mut("heatmap")).and_then(|heat| heat.as_object_mut()) else { return };
    let (x_n, x_min, x_max) = series_span(heat.get("x"));
    let (y_n, y_min, y_max) = series_span(heat.get("y"));
    let (z_n, z_min, z_max) = matrix_span(heat.get("z"));
    heat.remove("x");
    heat.remove("y");
    heat.remove("z");
    heat.insert("times".into(), json!(x_n));
    heat.insert("bins".into(), json!(y_n));
    heat.insert("cells".into(), json!(z_n));
    heat.insert("x_min".into(), json_num(x_min));
    heat.insert("x_max".into(), json_num(x_max));
    heat.insert("y_min".into(), json_num(y_min));
    heat.insert("y_max".into(), json_num(y_max));
    heat.insert("db_min".into(), json_num(z_min));
    heat.insert("db_max".into(), json_num(z_max));
}

fn series_span(values: Option<&Value>) -> (usize, Option<f64>, Option<f64>) {
    let Some(rows) = values.and_then(|value| value.as_array()) else { return (0, None, None) };
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let mut count = 0usize;
    for row in rows {
        let Some(number) = row.as_f64().filter(|number| number.is_finite()) else { continue };
        count += 1;
        min = min.min(number);
        max = max.max(number);
    }
    if count == 0 { (0, None, None) } else { (count, Some(min), Some(max)) }
}

fn matrix_span(values: Option<&Value>) -> (usize, Option<f64>, Option<f64>) {
    let Some(rows) = values.and_then(|value| value.as_array()) else { return (0, None, None) };
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    let mut count = 0usize;
    for row in rows {
        let Some(cols) = row.as_array() else { continue };
        for cell in cols {
            let Some(number) = cell.as_f64().filter(|number| number.is_finite()) else { continue };
            count += 1;
            min = min.min(number);
            max = max.max(number);
        }
    }
    if count == 0 { (0, None, None) } else { (count, Some(min), Some(max)) }
}

fn json_num(value: Option<f64>) -> Value {
    value.map(|number| json!(number)).unwrap_or(Value::Null)
}

fn reply_language(lang: &str) -> &'static str {
    match lang {
        "uk" => "Ukrainian",
        _ => "English",
    }
}

fn attached_log_note(log_id: &str) -> String {
    if log_id.is_empty() {
        "No local log is selected.".to_string()
    } else {
        format!("The user attached a local log for this turn. file is {log_id}. That id is the file argument for the local log tools. The request text may not repeat it.")
    }
}

fn conversation_prompt(history: &str, log_id: &str) -> String {
    format!("Conversation:\n{history}\n{}", xml_block("attached_log", &attached_log_note(log_id)))
}

fn system_prompt(lang: &str, sample: &Sample, bench: bool, log_id: &str) -> String {
    let language = reply_language(lang);
    let log = attached_log_note(log_id);
    let vehicle = if !sample.ok {
        match crate::db::latest_params() {
            Ok(Some(cache)) => {
                let board = if cache.board_name.is_empty() { "an unnamed board".to_string() } else { cache.board_name.clone() };
                let frame = if cache.frame.is_empty() { "vehicle".to_string() } else { cache.frame.clone() };
                let uid = if cache.boot_uid.is_empty() { String::new() } else { format!(" uid {}", cache.boot_uid) };
                format!(
                    "No vehicle is linked. A saved parameter set from {board} {frame}{uid} is available through get_param and list_params (source cached, saved at unix {}). It is not a live reading. A change needs a link. Connect with the url a tool in this conversation already returned. Do not ask the user to type that port or address again. Ask only when no tool result has a url.",
                    cache.saved_at
                )
            }
            _ => "No vehicle is linked, and no parameter set has been saved. A change needs a link. Connect with the url a tool in this conversation already returned. Do not ask the user to type that port or address again. Ask only when no tool result has a url.".to_string(),
        }
    } else {
        let frame = if sample.frame.is_empty() { "unknown" } else { sample.frame.as_str() };
        let mode = if sample.mode.is_empty() { "unknown" } else { sample.mode.as_str() };
        let armed = if sample.armed { "armed" } else { "disarmed" };
        format!("Vehicle: {frame}, mode {mode}, {armed}.")
    };
    format!(
        "{SKILL_ROOT}\n\nRespond only in {language}. Keep parameter names and MAVLink terms in their original spelling.\n\nLines marked steer are notes the user wrote while this turn is still running, including while a confirmation card is open. Use them on the next step. They do not replace the tool result.\n\n{vehicle} {log}\n\n{}",
        safe_mode_clause(bench)
    )
}

fn safe_mode_clause(on: bool) -> &'static str {
    if on {
        "Safe mode is on for this turn. The user confirmed the propellers are off, the power, and that the vehicle is fixed. Every change to the connected vehicle starts without an approval card: set_param for any parameter name, set_mode, arm, disarm, reboot, erase_vehicle_logs, firmware_flash start_bootloader, connect, and disconnect. If no vehicle is linked, connect with the url already returned before the change. Do not ask the user to type that port again. connect, disconnect, and reboot then wait until the link matches that action. The user can reject that wait. applied means the link matched. rejected_by_user means the user rejected the card or the wait. failed means it did not happen, and error says why. This is not a flight validation. Say when the vehicle is armed. Do not refuse an action only because it is armed. wizard_widget always stops the turn until the user finishes or cancels, including while safe mode is on. It does not start the calibration. vehicle_comment always stops the turn until the user saves or rejects the card, including while safe mode is on. The user can edit the note on that card. Nothing is stored until they save it."
    } else {
        "Safe mode is off. Changes to the connected vehicle do not run until the user approves a card. That includes set_param, set_mode, arm, disarm, reboot, connect, disconnect, erase_vehicle_logs, and firmware_flash start_bootloader. If no vehicle is linked, connect with the url already returned before the change. Do not ask the user to type that port again. Call the tool anyway once the link is up. The turn stops until the user decides. connect, disconnect, and reboot then wait until the link matches that action, and the user can reject that wait. The tool result is applied, with results when there are any, rejected_by_user, or failed with error. Reads, log download, catalog, library, and firmware prepare, ports, and status still run immediately. wizard_widget always stops the turn until the user finishes or cancels. It does not start the calibration. vehicle_comment always stops the turn until the user saves or rejects the card. The user can edit the note on that card. Nothing is stored until they save it."
    }
}


struct ProviderTurn {
    text: String,
    calls: Vec<genai::chat::ToolCall>,
    assistant: Option<genai::chat::ChatMessage>,
}

fn provider_model(provider: &str, model: &str) -> Result<genai::ModelIden, String> {
    let kind = match provider {
        "gemini" => genai::adapter::AdapterKind::Gemini,
        "openai" => genai::adapter::AdapterKind::OpenAI,
        "xai" => genai::adapter::AdapterKind::Xai,
        "anthropic" => genai::adapter::AdapterKind::Anthropic,
        _ => return Err("Unknown provider".into()),
    };
    Ok(genai::ModelIden::new(kind, model))
}

fn chat_tools() -> Vec<genai::chat::Tool> {
    let schema = tool_schema();
    let Some(items) = schema.as_array() else {
        return Vec::new();
    };
    items.iter().filter_map(|item| {
        let name = item["name"].as_str()?;
        let mut tool = genai::chat::Tool::new(name);
        if let Some(description) = item["description"].as_str() {
            tool = tool.with_description(description);
        }
        if !item["parameters"].is_null() {
            tool = tool.with_schema(item["parameters"].clone());
        }
        Some(tool)
    }).collect()
}

fn reasoning_effort(provider: &str, model: &str, reasoning: &str) -> Option<genai::chat::ReasoningEffort> {
    if (provider == "openai" || provider == "xai") && (model == "gpt-6-sol" || model == "gpt-6-luna") {
        return Some(genai::chat::ReasoningEffort::None);
    }
    if provider == "gemini" {
        return match reasoning {
            "low" => Some(genai::chat::ReasoningEffort::Low),
            "medium" => Some(genai::chat::ReasoningEffort::Medium),
            "high" => Some(genai::chat::ReasoningEffort::High),
            _ => None,
        };
    }
    None
}

fn turn_options(provider: &str, model: &str, reasoning: &str) -> genai::chat::ChatOptions {
    let mut options = genai::chat::ChatOptions::default()
        .with_capture_content(true)
        .with_capture_tool_calls(true)
        .with_capture_reasoning_content(true);
    if provider == "anthropic" {
        options = options.with_max_tokens(1200);
    }
    if let Some(effort) = reasoning_effort(provider, model, reasoning) {
        options = options.with_reasoning_effort(effort);
    }
    options
}

fn install_tls() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

fn mozilla_tls() -> rustls::ClientConfig {
    install_tls();
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth()
}

fn provider_client(key: &str, timeout_s: u64) -> genai::Client {
    install_tls();
    let key = key.to_string();
    let mut builder = genai::Client::builder();
    // Desktop keeps the OS trust store (corporate proxies). Phone builds have no
    // platform verifier unless Kotlin/Swift wires it up, so they use Mozilla roots.
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let http = reqwest::Client::builder()
            .use_preconfigured_tls(mozilla_tls())
            .timeout(std::time::Duration::from_secs(timeout_s))
            .build()
            .expect("model client");
        builder = builder.with_reqwest(http);
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.with_web_config(
            genai::WebConfig::default().with_timeout(std::time::Duration::from_secs(timeout_s)),
        );
    }
    builder
        .with_auth_resolver_fn(move |_model: genai::ModelIden| -> genai::resolver::Result<Option<genai::resolver::AuthData>> {
            Ok(Some(genai::resolver::AuthData::from_single(key.clone())))
        })
        .build()
}

fn block_on<T>(fut: impl std::future::Future<Output = T>) -> T {
    static RT: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
    let runtime = RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_name("arduloops-genai")
            .build()
            .expect("genai runtime")
    });
    runtime.block_on(fut)
}

fn shown_reply(text: &str) -> String {
    let shown = strip_proposal_tag(text);
    let shown = hide_leaked_tools(&shown);
    if let Some(start) = shown.rfind("[[propose") {
        if !shown[start..].contains("]]") {
            return shown[..start].trim().to_string();
        }
    }
    shown
}

fn close_at(text: &str, open: char, close: char) -> Option<usize> {
    if !text.starts_with(open) {
        return None;
    }
    let mut depth = 0;
    for (i, ch) in text.char_indices() {
        if ch == open {
            depth += 1;
        } else if ch == close {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
    }
    None
}

fn quote_bare_keys(item: &str) -> String {
    let chars: Vec<char> = item.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '{' || ch == ',' {
            out.push(ch);
            i += 1;
            while i < chars.len() && chars[i].is_whitespace() {
                out.push(chars[i]);
                i += 1;
            }
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let name: String = chars[start..i].iter().collect();
            let mut j = i;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if !name.is_empty() && j < chars.len() && chars[j] == ':' {
                out.push('"');
                out.push_str(&name);
                out.push('"');
                continue;
            }
            out.push_str(&name);
            continue;
        }
        out.push(ch);
        i += 1;
    }
    out
}

fn parse_leaked_args(raw: &str) -> Value {
    let text = raw.trim();
    if text.is_empty() {
        return json!({});
    }
    let colon = text.replace('=', ":");
    let variants = [text.to_string(), format!("{{{text}}}"), format!("{{{colon}}}")];
    for item in &variants {
        if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(item) {
            return Value::Object(map);
        }
        if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&quote_bare_keys(item)) {
            return Value::Object(map);
        }
    }
    json!({})
}

fn declared_tool(name: &str) -> bool {
    tool_schema().as_array().is_some_and(|items| items.iter().any(|item| item["name"].as_str() == Some(name)))
}

fn leaked_call(name: &str, args: Value, index: usize) -> genai::chat::ToolCall {
    genai::chat::ToolCall {
        call_id: format!("leak_{}", index + 1),
        fn_name: name.to_string(),
        fn_arguments: args,
        thought_signatures: None,
    }
}

fn take_leaked_calls(text: &str) -> (String, Vec<genai::chat::ToolCall>) {
    let mut calls = Vec::new();
    let mut out = String::new();
    let mut rest = text;
    while !rest.is_empty() {
        let gemini = rest.find("tool:default_api:");
        let printed = rest.find("print(default_api.");
        let (at, kind) = match (gemini, printed) {
            (Some(g), Some(p)) if g <= p => (g, "gemini"),
            (Some(g), None) => (g, "gemini"),
            (None, Some(p)) => (p, "print"),
            (Some(_), Some(p)) => (p, "print"),
            (None, None) => {
                out.push_str(rest);
                break;
            }
        };
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        if kind == "gemini" {
            rest = &rest["tool:default_api:".len()..];
            let name_len = rest.find(|c: char| !c.is_ascii_alphanumeric() && c != '_').unwrap_or(rest.len());
            let name = &rest[..name_len];
            rest = &rest[name_len..];
            if let Some(end) = close_at(rest, '{', '}') {
                if declared_tool(name) {
                    calls.push(leaked_call(name, parse_leaked_args(&rest[1..end]), calls.len()));
                    rest = &rest[end + 1..];
                    continue;
                }
            }
            out.push_str("tool:default_api:");
            out.push_str(name);
            continue;
        }
        rest = &rest["print(default_api.".len()..];
        let name_len = rest.find(|c: char| !c.is_ascii_alphanumeric() && c != '_').unwrap_or(rest.len());
        let name = &rest[..name_len];
        rest = &rest[name_len..];
        if let Some(end) = close_at(rest, '(', ')') {
            if declared_tool(name) {
                calls.push(leaked_call(name, parse_leaked_args(&rest[1..end]), calls.len()));
                rest = &rest[end + 1..];
                if rest.starts_with(')') {
                    rest = &rest[1..];
                }
                continue;
            }
        }
        out.push_str("print(default_api.");
        out.push_str(name);
    }
    let cleaned = out.replace("```tool_code", "").replace("```tool", "").replace("```", "");
    (cleaned.trim().to_string(), calls)
}

fn unfinished_leak(tail: &str) -> bool {
    let t = tail.trim_start();
    if t.starts_with("tool:default_api:") || t.starts_with("print(default_api") || t.starts_with("```tool") {
        return true;
    }
    const MARKS: &[&str] = &["tool:default_api:", "print(default_api.", "```tool_code"];
    t.len() >= 8 && MARKS.iter().any(|mark| mark.starts_with(t))
}

fn hide_leaked_tools(text: &str) -> String {
    let (clean, _) = take_leaked_calls(text);
    let start = clean.rfind(['\n', ' ']).map(|i| i + 1).unwrap_or(0);
    if unfinished_leak(&clean[start..]) {
        return clean[..start].trim_end().to_string();
    }
    clean
}

fn apply_leaked_tools(turn: &mut ProviderTurn) {
    let (clean, leaked) = take_leaked_calls(&turn.text);
    if leaked.is_empty() {
        turn.text = hide_leaked_tools(&clean);
        return;
    }
    turn.text = clean;
    turn.calls.extend(leaked);
    turn.assistant = Some(assistant_from_calls(turn.calls.clone()));
    live_clear_reply();
}

fn assistant_from_calls(calls: Vec<genai::chat::ToolCall>) -> genai::chat::ChatMessage {
    let signatures = calls.first().and_then(|call| call.thought_signatures.clone()).unwrap_or_default();
    genai::chat::ChatMessage::assistant_tool_calls_with_thoughts(calls, signatures)
}

fn provider_turn(
    provider: &str,
    model: &str,
    key: &str,
    reasoning: &str,
    system: &str,
    messages: &[genai::chat::ChatMessage],
) -> Result<ProviderTurn, String> {
    let iden = provider_model(provider, model)?;
    let options = turn_options(provider, model, reasoning);
    let request = genai::chat::ChatRequest::new(messages.to_vec())
        .with_system(system)
        .with_tools(chat_tools());
    let client = provider_client(key, 90);
    block_on(stream_turn(client, iden, request, options, turn_gen()))
}

/// Poll a provider future often enough that Stop is seen while the socket is quiet.
/// `gen` is the turn on the caller thread. The wait itself runs on the genai runtime.
async fn until_halt<T>(gen: u64, fut: impl std::future::Future<Output = T> + Send) -> Result<T, String> {
    let mut fut = std::pin::pin!(fut);
    loop {
        if gen_halted(gen) {
            return Err("stopped".into());
        }
        let pause = std::pin::pin!(tokio::time::sleep(std::time::Duration::from_millis(200)));
        match futures_util::future::select(fut.as_mut(), pause).await {
            futures_util::future::Either::Left((value, _)) => return Ok(value),
            futures_util::future::Either::Right((_, _)) => {}
        }
    }
}

async fn stream_turn(
    client: genai::Client,
    model: genai::ModelIden,
    request: genai::chat::ChatRequest,
    options: genai::chat::ChatOptions,
    gen: u64,
) -> Result<ProviderTurn, String> {
    use futures_util::StreamExt;
    let started = until_halt(gen, client.exec_chat_stream(model, request, Some(&options))).await?
        .map_err(|err| err.to_string())?;
    let mut stream = started.stream;
    let mut text = String::new();
    let mut thought = String::new();
    let mut calls: Vec<genai::chat::ToolCall> = Vec::new();
    let mut assistant: Option<genai::chat::ChatMessage> = None;
    loop {
        let Some(item) = until_halt(gen, stream.next()).await? else {
            break;
        };
        match item.map_err(|err| err.to_string())? {
            genai::chat::ChatStreamEvent::Start => {}
            genai::chat::ChatStreamEvent::Chunk(chunk) => {
                text.push_str(&chunk.content);
                if calls.is_empty() {
                    live_reply(&shown_reply(&text));
                }
            }
            genai::chat::ChatStreamEvent::ReasoningChunk(chunk) => {
                thought.push_str(&chunk.content);
                live_thought(&thought);
            }
            genai::chat::ChatStreamEvent::ThoughtSignatureChunk(_) => {}
            genai::chat::ChatStreamEvent::ToolCallChunk(chunk) => {
                calls.push(chunk.tool_call);
                live_clear_reply();
            }
            genai::chat::ChatStreamEvent::End(end) => {
                if let Some(captured) = end.captured_texts() {
                    let joined = captured.join("\n");
                    if !joined.is_empty() {
                        text = joined;
                    }
                }
                if let Some(captured) = end.captured_reasoning_content.as_deref() {
                    if !captured.is_empty() {
                        thought = captured.to_string();
                        live_thought(&thought);
                    }
                }
                if let Some(captured) = end.captured_tool_calls() {
                    if !captured.is_empty() {
                        calls = captured.into_iter().cloned().collect();
                    }
                }
                if calls.is_empty() {
                    if !text.is_empty() {
                        live_reply(&shown_reply(&text));
                    }
                } else {
                    live_clear_reply();
                }
                assistant = end.into_assistant_message_for_tool_use();
            }
        }
    }
    if assistant.is_none() && !calls.is_empty() {
        assistant = Some(assistant_from_calls(calls.clone()));
    }
    Ok(ProviderTurn { text, calls, assistant })
}

fn call_provider(provider: &str, model: &str, key: &str, prompt: &str, _tools: &[()]) -> Result<String, String> {
    if key.is_empty() {
        return hosted_complete(provider, model, prompt);
    }
    let iden = provider_model(provider, model)?;
    let mut options = genai::chat::ChatOptions::default().with_capture_content(true);
    if provider == "gemini" || provider == "anthropic" {
        options = options.with_max_tokens(4096);
    }
    let request = genai::chat::ChatRequest::from_user(prompt);
    let client = provider_client(key, 40);
    let response = block_on(client.exec_chat(iden, request, Some(&options))).map_err(|err| err.to_string())?;
    let text = response.into_first_text().unwrap_or_default();
    if text.trim().is_empty() {
        return Err("empty provider response".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::provider_client;

    #[test]
    fn a_model_client_builds_with_ring() {
        let _client = provider_client("key", 5);
    }

    #[test]
    fn mozilla_roots_build_a_rustls_client() {
        let _config = super::mozilla_tls();
    }

    #[test]
    fn a_turn_stops_at_one_hundred_tools() {
        assert_eq!(super::TOOL_BUDGET, 100);
    }
}
