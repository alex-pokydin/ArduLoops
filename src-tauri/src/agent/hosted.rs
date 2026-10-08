// Hosted subscription. The provider key stays on arduloops-api.

use std::io::Write;

use futures_util::StreamExt;
use genai::chat::ToolCall;

struct Session {
    refresh_token: String,
    id_token: String,
    email: String,
    plan: String,
}

fn local_host(url: &str) -> bool {
    url.contains("127.0.0.1") || url.contains("localhost")
}

fn api_base() -> String {
    // Hosting login posts the handoff to Cloud Run. A local ARDULOOPS_API is only
    // paired with a local cabinet (ARDULOOPS_AUTH_ORIGIN on 127.0.0.1).
    if local_host(&auth_origin()) {
        return std::env::var("ARDULOOPS_API").unwrap_or_else(|_| "http://127.0.0.1:8788".into());
    }
    std::env::var("ARDULOOPS_HOSTED_API").unwrap_or_else(|_| "https://api-qm4zps6yqa-ew.a.run.app".into())
}

fn firebase_web_key() -> String {
    std::env::var("ARDULOOPS_FIREBASE_API_KEY")
        .unwrap_or_else(|_| "AIzaSyBdm2Ih-WzEWJpWb4_CIERBX0rvf9gp0Wc".into())
}

fn session_path() -> std::path::PathBuf {
    data_dir().join("ai-session.json")
}

fn load_session() -> Option<Session> {
    let bytes = fs::read(session_path()).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    let refresh_token = value["refresh_token"].as_str()?.to_string();
    if refresh_token.is_empty() {
        return None;
    }
    Some(Session {
        refresh_token,
        id_token: value["id_token"].as_str().unwrap_or("").to_string(),
        email: value["email"].as_str().unwrap_or("").to_string(),
        plan: value["plan"].as_str().unwrap_or("free").to_string(),
    })
}

fn form_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn jwt_exp(token: &str) -> Option<u64> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, payload).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value["exp"].as_u64()
}

fn session_id_token() -> Result<String, String> {
    let session = load_session().ok_or_else(|| "Sign in required.".to_string())?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|item| item.as_secs()).unwrap_or(0);
    if let Some(exp) = jwt_exp(&session.id_token) {
        if exp > now + 120 {
            return Ok(session.id_token);
        }
    }
    let url = format!("https://securetoken.googleapis.com/v1/token?key={}", firebase_web_key());
    let body = format!(
        "grant_type=refresh_token&refresh_token={}",
        form_encode(&session.refresh_token)
    );
    let refreshed = match http_agent()
        .post(&url)
        .set("content-type", "application/x-www-form-urlencoded")
        .send_string(&body)
    {
        Ok(response) => {
            let text = response.into_string().unwrap_or_default();
            serde_json::from_str::<Value>(&text).map_err(|err| err.to_string())?
        }
        Err(_) => {
            clear_session();
            return Err("Sign in required.".into());
        }
    };
    let id_token = refreshed["id_token"].as_str().unwrap_or("").to_string();
    if id_token.is_empty() {
        clear_session();
        return Err("Sign in required.".into());
    }
    let refresh_token = refreshed["refresh_token"].as_str().unwrap_or(&session.refresh_token).to_string();
    let mut stored = json!({
        "refresh_token": refresh_token,
        "id_token": id_token,
        "email": session.email,
        "plan": session.plan,
    });
    if let Ok(raw) = fs::read_to_string(session_path()) {
        if let Ok(prev) = serde_json::from_str::<Value>(&raw) {
            if prev["assistant"].is_string() {
                stored["assistant"] = prev["assistant"].clone();
            }
        }
    }
    save_session(&stored)?;
    Ok(id_token)
}

fn save_session(value: &Value) -> Result<(), String> {
    let path = session_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string(value).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())
}

fn clear_session() {
    let _ = fs::remove_file(session_path());
}

fn hosted_assistant_on() -> bool {
    let Ok(bytes) = fs::read(session_path()) else {
        return false;
    };
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return false;
    };
    value["assistant"].as_str() != Some("off")
}

fn set_hosted_assistant(on: bool) {
    let Ok(raw) = fs::read_to_string(session_path()) else {
        return;
    };
    let Ok(mut stored) = serde_json::from_str::<Value>(&raw) else {
        return;
    };
    stored["assistant"] = json!(if on { "on" } else { "off" });
    let _ = fs::write(session_path(), stored.to_string());
}

fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(30)).build()
}

fn html_page(body: &str) -> String {
    format!("<!doctype html><meta charset=\"utf-8\"><title>ArduLoops</title><body style=\"font:16px sans-serif;background:#111;color:#eee;padding:32px\">{body}</body>")
}

fn esc(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub fn finish_login(nonce: &str) -> String {
    match claim_session(nonce) {
        Ok(email) => html_page(&format!("<p>Signed in as {}.</p><p>You can close this window and return to ArduLoops.</p>", esc(&email))),
        Err(err) => html_page(&format!("<p>{}</p>", esc(&err))),
    }
}

fn post_json(url: &str, token: Option<&str>, body: &Value) -> Result<Value, String> {
    let mut req = http_agent().post(url).set("content-type", "application/json");
    if let Some(token) = token {
        req = req.set("authorization", &format!("Bearer {token}"));
    }
    match req.send_string(&body.to_string()) {
        Ok(response) => {
            let text = response.into_string().unwrap_or_default();
            serde_json::from_str(&text).map_err(|err| err.to_string())
        }
        Err(ureq::Error::Status(code, response)) => {
            let text = response.into_string().unwrap_or_default();
            let value: Value = serde_json::from_str(&text).unwrap_or(json!({}));
            Err(value["message"].as_str().map(str::to_string).unwrap_or_else(|| format!("{code} {text}")))
        }
        Err(err) => Err(err.to_string()),
    }
}

fn claim_session(nonce: &str) -> Result<String, String> {
    if nonce.is_empty() {
        return Err("Sign-in did not return a code.".into());
    }
    let url = format!("{}/v1/auth/claim", api_base());
    let value = post_json(&url, None, &json!({"nonce": nonce}))?;
    if value["refresh_token"].as_str().unwrap_or("").is_empty() {
        return Err("Sign-in expired. Try again.".into());
    }
    save_session(&json!({
        "refresh_token": value["refresh_token"].as_str().unwrap_or(""),
        "id_token": "",
        "email": value["email"].as_str().unwrap_or(""),
        "uid": value["uid"].as_str().unwrap_or(""),
        "plan": value["plan"].as_str().unwrap_or("free"),
    }))?;
    if let Ok(c) = conn() {
        arm_default_hosted(&c);
    }
    Ok(value["email"].as_str().unwrap_or("").to_string())
}

pub fn signed_in() -> bool {
    load_session().is_some()
}

fn api_post(path: &str, body: &Value) -> Result<Value, String> {
    let token = session_id_token()?;
    let url = format!("{}{path}", api_base());
    post_json(&url, Some(&token), body)
}

pub fn account_status() -> Value {
    let Some(session) = load_session() else {
        return json!({"signed_in": false});
    };
    match api_post("/v1/account", &json!({})) {
        Ok(mut value) => {
            if let Some(plan) = value["plan"].as_str() {
                if let Ok(mut raw) = fs::read_to_string(session_path()) {
                    if let Ok(mut stored) = serde_json::from_str::<Value>(&raw) {
                        stored["plan"] = json!(plan);
                        raw = stored.to_string();
                        let _ = fs::write(session_path(), raw);
                    }
                }
            }
            value["signed_in"] = json!(true);
            value
        }
        Err(_) => json!({
            "signed_in": true,
            "email": session.email,
            "plan": session.plan,
            "used": null,
            "limit": null,
            "models": {},
        }),
    }
}

fn auth_origin() -> String {
    std::env::var("ARDULOOPS_AUTH_ORIGIN")
        .unwrap_or_else(|_| "https://arduloops-api.firebaseapp.com".into())
}

pub fn login_url() -> String {
    // Google rejects the Cloud Run host. The button is served from Firebase Hosting.
    format!("{}/login?return=http://127.0.0.1:8767/auth/callback", auth_origin())
}

pub fn cabinet_url() -> Result<String, String> {
    Ok(format!("{}/account", auth_origin()))
}

pub fn logout_session() {
    clear_session();
}

pub fn checkout_url(plan: &str) -> Result<String, String> {
    let value = api_post("/v1/checkout", &json!({"plan": plan}))?;
    value["url"].as_str().map(str::to_string).ok_or_else(|| "Checkout did not return a link.".into())
}

pub fn portal_url() -> Result<String, String> {
    let value = api_post("/v1/portal", &json!({}))?;
    value["url"].as_str().map(str::to_string).ok_or_else(|| "The subscription page did not return a link.".into())
}

fn wire_message(message: &genai::chat::ChatMessage) -> Value {
    let role = match message.role {
        genai::chat::ChatRole::System => "system",
        genai::chat::ChatRole::User => "user",
        genai::chat::ChatRole::Assistant => "assistant",
        genai::chat::ChatRole::Tool => "tool",
    };
    let tools: Vec<Value> = message.content.tool_calls().into_iter().map(|call| json!({
        "id": call.call_id,
        "name": call.fn_name,
        "arguments": call.fn_arguments,
    })).collect();
    let results: Vec<Value> = message.content.tool_responses().into_iter().map(|item| json!({
        "id": item.call_id,
        "name": item.fn_name,
        "text": item.content,
    })).collect();
    json!({
        "role": role,
        "text": message.content.texts().join(""),
        "tools": tools,
        "thought_signatures": message.content.thought_signatures(),
        "tool_results": results,
    })
}

fn hosted_client() -> reqwest::Client {
    install_tls();
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(100))
        .build()
        .expect("subscription client")
}

fn tool_from_event(value: &Value) -> ToolCall {
    let signatures = value["thought_signatures"].as_array().map(|items| {
        items.iter().filter_map(|item| item.as_str().map(str::to_string)).collect::<Vec<_>>()
    }).filter(|items| !items.is_empty());
    ToolCall {
        call_id: value["id"].as_str().unwrap_or("call").to_string(),
        fn_name: value["name"].as_str().unwrap_or("").to_string(),
        fn_arguments: value["arguments"].clone(),
        thought_signatures: signatures,
    }
}

fn apply_sse(buf: &mut String, text: &mut String, thought: &mut String, calls: &mut Vec<ToolCall>, turn_id: &mut Option<String>) -> Result<(), String> {
    while let Some(cut) = buf.find("\n\n") {
        let block = buf[..cut].to_string();
        *buf = buf[cut + 2..].to_string();
        let mut event = String::from("message");
        let mut data = String::new();
        for line in block.lines() {
            if let Some(rest) = line.strip_prefix("event:") {
                event = rest.trim().to_string();
            } else if let Some(rest) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(rest.trim());
            }
        }
        if data.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(&data).unwrap_or(json!({}));
        match event.as_str() {
            "meta" => {
                if let Some(id) = value["turn_id"].as_str().filter(|id| !id.is_empty()) {
                    *turn_id = Some(id.to_string());
                }
            }
            "text" => {
                text.push_str(value["text"].as_str().unwrap_or(""));
                if calls.is_empty() {
                    live_reply(&shown_reply(text));
                }
            }
            "reasoning" => {
                thought.push_str(value["text"].as_str().unwrap_or(""));
                live_thought(thought);
            }
            "tool" => {
                calls.push(tool_from_event(&value));
                live_clear_reply();
            }
            "document" => live_document(&value),
            "error" => return Err(value["message"].as_str().unwrap_or("The model request failed.").to_string()),
            _ => {}
        }
    }
    Ok(())
}

fn hosted_request(provider: &str, model: &str, reasoning: &str, system: &str, messages: &[genai::chat::ChatMessage], quota: &str, chat_id: &str, turn_id: &Option<String>) -> Value {
    let wire: Vec<Value> = messages.iter().map(wire_message).collect();
    json!({
        "provider": provider,
        "model": model,
        "reasoning": reasoning,
        "system": system,
        "quota": quota,
        "chat_id": chat_id,
        "turn_id": turn_id,
        "messages": wire,
        "tools": tool_schema(),
    })
}

async fn read_hosted(resp: reqwest::Response, gen: u64, turn_slot: &mut Option<String>) -> Result<ProviderTurn, String> {
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let value: Value = serde_json::from_str(&text).unwrap_or(json!({}));
        let message = value["message"].as_str().unwrap_or(text.as_str());
        return Err(format!("{status} {message}"));
    }
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut text = String::new();
    let mut thought = String::new();
    let mut calls = Vec::new();
    while let Some(item) = stream.next().await {
        if gen_halted(gen) {
            return Err("stopped".into());
        }
        let chunk = item.map_err(|err| err.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        apply_sse(&mut buf, &mut text, &mut thought, &mut calls, turn_slot)?;
    }
    apply_sse(&mut buf, &mut text, &mut thought, &mut calls, turn_slot)?;
    let assistant = if calls.is_empty() { None } else { Some(assistant_from_calls(calls.clone())) };
    Ok(ProviderTurn { text, calls, assistant })
}

fn hosted_turn(provider: &str, model: &str, reasoning: &str, system: &str, messages: &[genai::chat::ChatMessage], quota: &str, chat_id: &str, turn_slot: &mut Option<String>) -> Result<ProviderTurn, String> {
    let token = session_id_token()?;
    let body = hosted_request(provider, model, reasoning, system, messages, quota, chat_id, turn_slot);
    let client = hosted_client();
    let url = format!("{}/v1/chat", api_base());
    let gen = turn_gen();
    block_on(async move {
        let resp = client.post(url)
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .map_err(|err| err.to_string())?;
        read_hosted(resp, gen, turn_slot).await
    })
}

fn hosted_complete(provider: &str, model: &str, prompt: &str) -> Result<String, String> {
    let mut slot = None;
    let messages = vec![genai::chat::ChatMessage::user(prompt)];
    let turn = hosted_turn(provider, model, "", "", &messages, "fold", "", &mut slot)?;
    if turn.text.trim().is_empty() {
        return Err("empty provider response".into());
    }
    Ok(turn.text)
}
