//! Official ArduPilot parameter, wiki, and source lookups.
//! Missing fields stay unknown. Stable tags are a fallback, not proof of the installed firmware.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Map, Value};

use crate::db::data_dir;

const COPTER_TAG: &str = "Copter-4.6.2";
const PLANE_TAG: &str = "Plane-4.6.2";
const ROVER_TAG: &str = "Rover-4.6.2";

/// A document result is text. metadata names what the call resolved. content is the body, and only when there is one.
fn render_doc(lines: &[(&str, &str)], content: Option<&str>) -> Value {
    let mut out = String::from("<metadata>\n");
    for (key, value) in lines {
        out.push_str(key);
        out.push_str(": ");
        out.push_str(&value.replace('\n', " "));
        out.push('\n');
    }
    out.push_str("</metadata>\n");
    if let Some(body) = content.filter(|body| !body.is_empty()) {
        let body = body.replace("</content>", "< /content>");
        out.push_str("<content>\n");
        out.push_str(&body);
        if !body.ends_with('\n') {
            out.push('\n');
        }
        out.push_str("</content>\n");
    }
    Value::String(out)
}

fn yn(value: bool) -> &'static str {
    if value { "true" } else { "false" }
}

fn opt_num(value: Option<usize>) -> String {
    value.map(|n| n.to_string()).unwrap_or_else(|| "null".into())
}

pub fn vehicle_kind(frame: &str) -> &'static str {
    let lower = frame.to_ascii_lowercase();
    if lower.contains("plane") {
        "plane"
    } else if lower.contains("rover") || lower.contains("boat") {
        "rover"
    } else {
        "copter"
    }
}

pub fn param_doc(frame: &str, name: &str) -> Value {
    let name = name.trim().to_ascii_uppercase();
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') {
        return render_doc(&[("ok", "false"), ("error", "parameter name is empty")], None);
    }
    let kind = vehicle_kind(frame);
    let xml = match cached_pdef(kind) {
        Ok(xml) => xml,
        Err(error) => return render_doc(&[
            ("ok", "false"),
            ("name", &name),
            ("known", "false"),
            ("match", "unknown"),
            ("error", &error),
        ], None),
    };
    let needle = format!("name=\"{name}\"");
    let Some(at) = xml.find(&needle) else {
        return render_doc(&[
            ("ok", "true"),
            ("name", &name),
            ("known", "false"),
            ("vehicle", kind),
            ("match", "stable_fallback"),
            ("source", &pdef_url(kind)),
            ("note", concat!(
                "This spelling is not in the stable parameter metadata. ",
                "It does not say whether the vehicle has the name.",
            )),
        ], None);
    };
    let start = xml[..at].rfind("<param").unwrap_or(at);
    let end = xml[at..].find("</param>").map(|n| at + n).unwrap_or(xml.len().min(at + 4000));
    let block = &xml[start..end];
    let human = attr(block, "humanName");
    let documentation: String = attr(block, "documentation").chars().take(1500).collect();
    let range = field(block, "Range");
    let units = field(block, "Units");
    let reboot = field(block, "RebootRequired");
    let mut lines = vec![
        ("ok", "true".to_string()),
        ("name", name.clone()),
        ("known", "true".to_string()),
        ("vehicle", kind.to_string()),
        ("match", "stable_fallback".to_string()),
        ("source", pdef_url(kind).to_string()),
    ];
    for (key, value) in [("human", human), ("range", range), ("units", units), ("reboot", reboot)] {
        if !value.is_empty() {
            lines.push((key, value));
        }
    }
    lines.push(("note", concat!(
        "Stable metadata, not a proof that this firmware build uses the same default. ",
        "The documentation may scale this value against another parameter. ",
        "The magnitude alone does not say the value is low or high. ",
        "A metadata key that is absent was not in the stable metadata.",
    ).to_string()));
    let pairs: Vec<(&str, &str)> = lines.iter().map(|(key, value)| (*key, value.as_str())).collect();
    render_doc(&pairs, Some(&documentation))
}

static PARAM_INDEX: Mutex<Option<HashMap<String, Vec<u8>>>> = Mutex::new(None);

/// Compact stable metadata for the parameter list. Empty fields mean the PDEF has no value.
pub fn param_index(kind: &str) -> Vec<u8> {
    let kind = match kind {
        "plane" | "rover" => kind,
        _ => "copter",
    };
    if let Ok(guard) = PARAM_INDEX.lock() {
        if let Some(hit) = guard.as_ref().and_then(|map| map.get(kind)) {
            return hit.clone();
        }
    }
    let body = serde_json::to_vec(&build_param_index(kind)).unwrap_or_else(|_| b"{}".to_vec());
    let ok = serde_json::from_slice::<Value>(&body).ok().and_then(|v| v.get("ok")?.as_bool()).unwrap_or(false);
    if ok {
        if let Ok(mut guard) = PARAM_INDEX.lock() {
            guard.get_or_insert_with(HashMap::new).insert(kind.to_string(), body.clone());
        }
    }
    body
}

fn build_param_index(kind: &str) -> Value {
    let xml = match cached_pdef(kind) {
        Ok(xml) => xml,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let mut params = Map::new();
    let mut rest = xml.as_str();
    while let Some(at) = rest.find("<param ") {
        rest = &rest[at..];
        let end = rest.find("</param>").unwrap_or(rest.len().min(5000));
        let block = &rest[..end];
        rest = &rest[end..];
        let name = attr(block, "name");
        if name.is_empty() {
            continue;
        }
        let range = field(block, "Range");
        let (min, max) = split_range(&range);
        params.insert(name, json!({
            "human": attr(block, "humanName"),
            "doc": attr(block, "documentation").chars().take(240).collect::<String>(),
            "min": min,
            "max": max,
            "range": range,
            "units": field(block, "Units"),
        }));
    }
    json!({ "ok": true, "vehicle": kind, "source": pdef_url(kind), "params": params })
}

fn split_range(range: &str) -> (String, String) {
    let parts: Vec<&str> = range.split_whitespace().filter(|part| !part.eq_ignore_ascii_case("to")).collect();
    if parts.len() == 2 && parts.iter().all(|part| part.parse::<f64>().is_ok()) {
        (parts[0].to_string(), parts[1].to_string())
    } else {
        (String::new(), String::new())
    }
}

pub fn wiki(frame: &str, query: &str, offset: Option<usize>) -> Value {
    let query = query.trim();
    if query.is_empty() {
        return render_doc(&[
            ("ok", "false"),
            ("error", "query is empty. query is a few words, such as a flight-mode name."),
        ], None);
    }
    if query.contains("://") || query.contains('/') || query.contains(".html") || query.contains(".cpp") {
        return render_doc(&[
            ("ok", "false"),
            ("query", query),
            ("error", "query is a few words, not a URL or a file path."),
        ], None);
    }
    let site = match vehicle_kind(frame) {
        "plane" => "plane",
        "rover" => "rover",
        _ => "copter",
    };
    let pages = match wiki_pages(site) {
        Ok(pages) => pages,
        Err(error) => return render_doc(&[
            ("ok", "false"),
            ("query", query),
            ("error", &error),
            ("note", concat!(
                "The official docs index did not load. ",
                "The page is unknown.",
            )),
        ], None),
    };
    let Some((docname, title)) = best_page(&pages, query) else {
        return render_doc(&[
            ("ok", "true"),
            ("known", "false"),
            ("query", query),
            ("site", site),
            ("note", concat!(
                "No official page matched. ",
                "The page is unknown.",
            )),
        ], None);
    };
    let url = format!("https://ardupilot.org/{site}/{docname}.html");
    let html = match get_text(&url) {
        Ok(html) => html,
        Err(error) => return render_doc(&[
            ("ok", "false"),
            ("query", query),
            ("title", &title),
            ("error", &error),
            ("note", concat!(
                "The page did not load. ",
                "The text is unknown.",
            )),
        ], None),
    };
    let article = html_article(&html);
    let slice = article_window(&article, query, offset);
    let offset_s = slice.offset.to_string();
    let next_s = opt_num(slice.next_offset);
    render_doc(&[
        ("ok", "true"),
        ("known", yn(!slice.text.is_empty())),
        ("query", query),
        ("title", &title),
        ("site", site),
        ("match", "docs_unversioned"),
        ("source", &url),
        ("offset", &offset_s),
        ("next_offset", &next_s),
        ("note", concat!(
            "Official docs text is a general reference, not tied to the installed firmware. ",
            "A method in that text is a general procedure. ",
            "It does not show that a term caused an error in a log. ",
            "next_offset is the rest of this same page. ",
            "Pass it as offset with the same query. ",
            "null means this slice reached the end of the page. ",
            "offset 0 is the beginning of the page.",
        )),
    ], Some(&slice.text))
}

static WIKI_PAGES: Mutex<Option<HashMap<String, Vec<(String, String)>>>> = Mutex::new(None);

fn wiki_pages(site: &str) -> Result<Vec<(String, String)>, String> {
    if let Ok(guard) = WIKI_PAGES.lock() {
        if let Some(hit) = guard.as_ref().and_then(|map| map.get(site)) {
            return Ok(hit.clone());
        }
    }
    let raw = cached_searchindex(site)?;
    let docs = json_string_array(&raw, "docnames").ok_or_else(|| "docs index has no page names".to_string())?;
    let titles = json_string_array(&raw, "titles").unwrap_or_default();
    let pages: Vec<(String, String)> = docs.into_iter().enumerate().map(|(i, doc)| {
        let title = titles.get(i).cloned().unwrap_or_else(|| doc.clone());
        (doc, title)
    }).collect();
    if pages.is_empty() {
        return Err("docs index has no pages".into());
    }
    if let Ok(mut guard) = WIKI_PAGES.lock() {
        guard.get_or_insert_with(HashMap::new).insert(site.to_string(), pages.clone());
    }
    Ok(pages)
}

fn cached_searchindex(site: &str) -> Result<String, String> {
    let path = data_dir().join("cache").join(format!("wiki-{site}-pages.json"));
    let legacy = data_dir().join("cache").join(format!("wiki-{site}-searchindex.js"));
    if let Some(text) = fresh_page_list(&path).or_else(|| fresh_page_list(&legacy)) {
        if legacy.exists() && path != legacy {
            fs::write(&path, &text).ok();
            fs::remove_file(&legacy).ok();
        }
        return Ok(text);
    }
    let url = format!("https://ardupilot.org/{site}/searchindex.js");
    let text = fetch_index_head(&url)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &text).map_err(|e| e.to_string())?;
    fs::remove_file(&legacy).ok();
    Ok(text)
}

fn fresh_page_list(path: &std::path::Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    if modified.elapsed().map(|d| d.as_secs() >= 7 * 24 * 3600).unwrap_or(true) {
        return None;
    }
    let file = fs::File::open(path).ok()?;
    read_index_head(file).ok()
}

fn fetch_index_head(url: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(25)).build();
    match agent.get(url).call() {
        Ok(response) => read_index_head(response.into_reader()),
        Err(ureq::Error::Status(code, _)) => Err(format!("http {code}")),
        Err(err) => Err(err.to_string()),
    }
}

/// Page names and titles only. The Sphinx term table is the rest of the file and is not kept.
fn read_index_head(mut reader: impl Read) -> Result<String, String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let cap = 3 * 1024 * 1024;
    loop {
        let n = reader.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if head_ready(&buf) || buf.len() >= cap {
            break;
        }
    }
    compact_index(&String::from_utf8_lossy(&buf))
}

fn head_ready(buf: &[u8]) -> bool {
    let text = String::from_utf8_lossy(buf);
    json_string_array(&text, "docnames").is_some() && json_string_array(&text, "titles").is_some()
}

fn compact_index(text: &str) -> Result<String, String> {
    let docs = json_string_array(text, "docnames").ok_or_else(|| "docs index has no page names".to_string())?;
    let titles = json_string_array(text, "titles").unwrap_or_default();
    if docs.is_empty() {
        return Err("docs index has no pages".into());
    }
    Ok(json!({ "docnames": docs, "titles": titles }).to_string())
}

fn best_page(pages: &[(String, String)], query: &str) -> Option<(String, String)> {
    let q = query.to_ascii_lowercase();
    let words: Vec<&str> = q.split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| w.len() > 1).collect();
    let mut best: Option<(i32, usize)> = None;
    for (i, (doc, title)) in pages.iter().enumerate() {
        let hay = format!("{title} {doc}").to_ascii_lowercase();
        let mut score = 0;
        if hay.contains(&q) {
            score += 40;
        }
        for word in &words {
            if hay.contains(word) {
                score += 8;
            }
        }
        if doc.contains("mode") && words.iter().any(|word| doc.contains(word)) {
            score += 12;
        }
        if score > best.map(|(s, _)| s).unwrap_or(0) {
            best = Some((score, i));
        }
    }
    best.filter(|(score, _)| *score >= 8).map(|(_, i)| pages[i].clone())
}

fn json_string_array(text: &str, key: &str) -> Option<Vec<String>> {
    let marker = format!("\"{key}\":");
    let at = text.find(&marker)?;
    let rest = text.get(at + marker.len()..)?;
    let start = rest.find('[')?;
    let slice = rest.get(start..)?;
    let end = match_json_bracket(slice)?;
    serde_json::from_str(&slice[..=end]).ok()
}

fn match_json_bracket(slice: &str) -> Option<usize> {
    let mut depth = 0i32;
    let mut in_str = false;
    let mut escape = false;
    for (i, c) in slice.char_indices() {
        if in_str {
            if escape {
                escape = false;
                continue;
            }
            if c == '\\' {
                escape = true;
                continue;
            }
            if c == '"' {
                in_str = false;
            }
            continue;
        }
        match c {
            '"' => in_str = true,
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn html_article(html: &str) -> String {
    let start = html.find("role=\"main\"").unwrap_or(0);
    let slice = &html[start..];
    let end = slice.find("<footer").unwrap_or(slice.len());
    html_text(&slice[..end])
}

const EXCERPT_CAP: usize = 1_400;

struct DocSlice {
    text: String,
    offset: usize,
    next_offset: Option<usize>,
}

/// The first slice starts at the paragraph that mentions the query. A later offset continues through the page.
fn article_window(article: &str, query: &str, offset: Option<usize>) -> DocSlice {
    let total = article.chars().count();
    let start = match offset {
        Some(at) => at.min(total),
        None => paragraph_spans(article)
            .into_iter()
            .filter_map(|(at, text)| {
                let score = query_score(&text, query);
                (score > 0).then_some((score, at))
            })
            .max_by_key(|(score, _)| *score)
            .map(|(_, at)| at)
            .unwrap_or(0),
    };
    let end = (start + EXCERPT_CAP).min(total);
    let text: String = article.chars().skip(start).take(end - start).collect();
    DocSlice {
        text,
        offset: start,
        next_offset: (end < total).then_some(end),
    }
}

fn query_score(text: &str, query: &str) -> i32 {
    let words: Vec<String> = query
        .to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| word.len() > 2)
        .map(|word| word.to_string())
        .collect();
    if words.is_empty() {
        return 0;
    }
    let hay = text.to_ascii_lowercase();
    words.iter().filter(|word| hay.contains(word.as_str())).count() as i32
}

fn paragraph_spans(article: &str) -> Vec<(usize, String)> {
    let mut spans = Vec::new();
    let mut cursor = 0usize;
    for para in article.split("\n\n") {
        let lead = para.chars().count() - para.trim_start().chars().count();
        let text = para.trim();
        if !text.is_empty() {
            spans.push((cursor + lead, text.to_string()));
        }
        cursor += para.chars().count() + 2;
    }
    spans
}

pub fn source(frame: &str, path: &str, start_line: i64, end_line: Option<i64>) -> Value {
    let path = path.trim().trim_start_matches('/');
    if !allowed_path(path) {
        return render_doc(&[
            ("ok", "false"),
            ("error", "path must stay inside ArduCopter, ArduPlane, Rover, or libraries"),
        ], None);
    }
    let (tag, vehicle) = source_tag(frame);
    let url = format!("https://raw.githubusercontent.com/ArduPilot/ardupilot/{tag}/{path}");
    let text = match get_text(&url) {
        Ok(text) => text,
        Err(error) => return render_doc(&[
            ("ok", "false"),
            ("error", &error),
            ("requested", path),
            ("resolved", tag),
            ("match", "unknown"),
        ], None),
    };
    let lines: Vec<&str> = text.lines().collect();
    let slice = line_window(&lines, start_line, end_line);
    source_slice(path, tag, vehicle, &url, &slice)
}

fn source_slice(path: &str, tag: &str, vehicle: &str, url: &str, slice: &LineSlice) -> Value {
    let start = slice.start.to_string();
    let end = slice.end.to_string();
    let next = opt_num(slice.next_line);
    let count = slice.line_count.to_string();
    render_doc(&[
        ("ok", "true"),
        ("requested", path),
        ("resolved", tag),
        ("vehicle", vehicle),
        ("match", "stable_fallback"),
        ("source", url),
        ("start_line", &start),
        ("end_line", &end),
        ("next_line", &next),
        ("line_count", &count),
        ("note", concat!(
            "Stable tag. ",
            "This is not proof the connected firmware matches this commit. ",
            "next_line is the following line in this file, or null at the end. ",
            "line_count is the whole file. ",
            "start_line and end_line are inclusive.",
        )),
    ], Some(&slice.text))
}

const SOURCE_LINES: usize = 500;

struct LineSlice {
    start: usize,
    end: usize,
    text: String,
    next_line: Option<usize>,
    line_count: usize,
}

fn line_window(lines: &[&str], start_line: i64, end_line: Option<i64>) -> LineSlice {
    let line_count = lines.len();
    if line_count == 0 {
        return LineSlice { start: 1, end: 0, text: String::new(), next_line: None, line_count: 0 };
    }
    let start = (start_line.max(1) as usize).min(line_count);
    let requested_end = end_line
        .map(|line| (line.max(start_line.max(1)) as usize).max(start))
        .unwrap_or(start + SOURCE_LINES - 1)
        .min(line_count);
    let end = (start + SOURCE_LINES - 1).min(requested_end);
    let text = lines[start - 1..end].join("\n");
    let next_line = (end < line_count).then_some(end + 1);
    LineSlice { start, end, text, next_line, line_count }
}

const SOURCE_CAP: usize = 8;

pub fn source_many(frame: &str, paths: &[(String, i64, Option<i64>)]) -> Value {
    files_text(frame, paths, None)
}

fn files_text(frame: &str, paths: &[(String, i64, Option<i64>)], glob: Option<&str>) -> Value {
    if paths.is_empty() {
        let mut lines = vec![("ok", "false"), ("error", "pass at least one path")];
        if let Some(glob) = glob {
            lines.push(("glob", glob));
        }
        return render_doc(&lines, None);
    }
    let take = paths.len().min(SOURCE_CAP);
    let files: Vec<Value> = paths.iter().take(take).map(|(path, line, end)| source(frame, path, *line, *end)).collect();
    let remaining = paths.iter().skip(take).map(|(path, _, _)| path.as_str()).collect::<Vec<_>>().join(", ");
    let ok = files.iter().any(|file| file.as_str().is_some_and(|text| text.starts_with("<metadata>\nok: true\n")));
    let count = files.len().to_string();
    let mut lines = vec![
        ("ok", yn(ok)),
        ("count", count.as_str()),
    ];
    if let Some(glob) = glob {
        lines.push(("glob", glob));
    }
    if !remaining.is_empty() {
        lines.push(("remaining", remaining.as_str()));
    }
    let mut text = match render_doc(&lines, None) {
        Value::String(text) => text,
        other => other.to_string(),
    };
    for file in files {
        if let Some(body) = file.as_str() {
            text.push_str(body);
        }
    }
    Value::String(text)
}

pub fn source_glob(frame: &str, pattern: &str, start_line: i64) -> Value {
    let (tag, _) = source_tag(frame);
    let (dir, file_glob) = match split_glob(pattern) {
        Ok(parts) => parts,
        Err(error) => return render_doc(&[("ok", "false"), ("error", &error), ("glob", pattern)], None),
    };
    let listed = match list_dir(tag, &dir) {
        Ok(paths) => paths,
        Err(error) => return render_doc(&[
            ("ok", "false"),
            ("error", &error),
            ("glob", pattern),
            ("resolved", tag),
        ], None),
    };
    let matched: Vec<(String, i64, Option<i64>)> = listed.into_iter()
        .filter(|path| glob_name(path, &file_glob))
        .map(|path| (path, start_line, None))
        .collect();
    if matched.is_empty() {
        return render_doc(&[
            ("ok", "false"),
            ("error", "no files matched"),
            ("glob", pattern),
            ("resolved", tag),
        ], None);
    }
    files_text(frame, &matched, Some(pattern))
}

fn source_tag(frame: &str) -> (&'static str, &'static str) {
    match vehicle_kind(frame) {
        "plane" => (PLANE_TAG, "plane"),
        "rover" => (ROVER_TAG, "rover"),
        _ => (COPTER_TAG, "copter"),
    }
}

fn split_glob(pattern: &str) -> Result<(String, String), String> {
    let pattern = pattern.trim().trim_start_matches('/');
    if pattern.contains("**") || pattern.matches('*').count() != 1 || pattern.contains('\\') || pattern.contains("..") {
        return Err("glob is one directory and one * in the file name, such as libraries/AP_Motors/*.cpp".into());
    }
    let Some((dir, file)) = pattern.rsplit_once('/') else {
        return Err("glob needs a directory, such as libraries/AP_Motors/*.cpp".into());
    };
    if file.is_empty() || !allowed_path(&format!("{dir}/file")) {
        return Err("glob must stay inside ArduCopter, ArduPlane, Rover, or libraries".into());
    }
    Ok((dir.to_string(), file.to_string()))
}

fn glob_name(path: &str, file_glob: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    let Some((prefix, suffix)) = file_glob.split_once('*') else { return name == file_glob };
    name.starts_with(prefix) && name.ends_with(suffix) && name.len() >= prefix.len() + suffix.len()
}

fn list_dir(tag: &str, dir: &str) -> Result<Vec<String>, String> {
    let url = format!("https://api.github.com/repos/ArduPilot/ardupilot/contents/{dir}?ref={tag}");
    let text = get_text(&url)?;
    let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let rows = value.as_array().ok_or_else(|| "directory listing was not a list of files".to_string())?;
    Ok(rows.iter()
        .filter(|row| row["type"].as_str() == Some("file"))
        .filter_map(|row| row["path"].as_str().map(|path| path.to_string()))
        .filter(|path| allowed_path(path))
        .collect())
}

fn allowed_path(path: &str) -> bool {
    if path.contains("..") || path.contains('\\') || path.contains('?') {
        return false;
    }
    path.starts_with("ArduCopter/") || path.starts_with("ArduPlane/") || path.starts_with("Rover/") || path.starts_with("libraries/")
}

fn cached_pdef(kind: &str) -> Result<String, String> {
    let path = data_dir().join("cache").join(format!("pdef-{kind}.xml"));
    if let Ok(meta) = fs::metadata(&path) {
        if let Ok(modified) = meta.modified() {
            if modified.elapsed().map(|d| d.as_secs() < 7 * 24 * 3600).unwrap_or(false) {
                return fs::read_to_string(&path).map_err(|e| e.to_string());
            }
        }
    }
    let xml = get_text(pdef_url(kind))?;
    if !xml.contains("<param") {
        return Err("parameter metadata did not look like a PDEF file".into());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &xml).map_err(|e| e.to_string())?;
    Ok(xml)
}

fn pdef_url(kind: &str) -> &'static str {
    match kind {
        "plane" => "https://autotest.ardupilot.org/Parameters/ArduPlane/apm.pdef.xml",
        "rover" => "https://autotest.ardupilot.org/Parameters/Rover/apm.pdef.xml",
        _ => "https://autotest.ardupilot.org/Parameters/ArduCopter/apm.pdef.xml",
    }
}

const GET_TEXT_LIMIT: u64 = 8 * 1024 * 1024;

fn get_text(url: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(25)).build();
    match agent.get(url).call() {
        Ok(response) => read_body(response, GET_TEXT_LIMIT),
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            let trimmed = body.trim_start();
            if trimmed.starts_with('<') {
                Err(format!("http {code}"))
            } else {
                Err(format!("http {code} {}", body.chars().take(160).collect::<String>()))
            }
        }
        Err(err) => Err(err.to_string()),
    }
}

fn attr(block: &str, name: &str) -> String {
    let key = format!("{name}=\"");
    let Some(at) = block.find(&key) else { return String::new() };
    let rest = &block[at + key.len()..];
    rest.split('"').next().unwrap_or("").replace("&quot;", "\"").replace("&amp;", "&").replace("&lt;", "<")
}

fn field(block: &str, name: &str) -> String {
    let key = format!("name=\"{name}\"");
    let Some(at) = block.find(&key) else { return String::new() };
    let rest = &block[at..];
    let Some(open) = rest.find('>') else { return String::new() };
    let rest = &rest[open + 1..];
    rest.split('<').next().unwrap_or("").trim().to_string()
}

fn url_encode(text: &str) -> String {
    let mut out = String::new();
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' {
            out.push(b as char);
        } else if b == b' ' {
            out.push('+');
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn web_search(query: &str) -> Value {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 200 {
        return json!({ "ok": false, "error": "query is required and at most 200 characters" });
    }
    let url = format!("https://html.duckduckgo.com/html/?q={}", url_encode(query));
    match http_text(&url) {
        Ok(html) => {
            let results = ddg_results(&html);
            json!({ "ok": true, "query": query, "results": results })
        }
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

pub fn web_fetch(raw: &str) -> Value {
    let raw = raw.trim();
    match jina_read(raw) {
        Ok((url, text)) => render_doc(&[("ok", "true"), ("url", &url)], Some(&text)),
        Err(error) => render_doc(&[("ok", "false"), ("error", &error)], None),
    }
}

fn http_text(url: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).redirects(2).build();
    let response = agent
        .get(url)
        .set("User-Agent", "ArduLoops")
        .call()
        .map_err(|e| e.to_string())?;
    read_capped(response)
}

fn jina_read(raw: &str) -> Result<(String, String), String> {
    checked_public(raw)?;
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(25)).redirects(2).build();
    let response = agent
        .get(&format!("https://r.jina.ai/{raw}"))
        .set("User-Agent", "ArduLoops")
        .set("Accept", "application/json")
        .call()
        .map_err(|err| match err {
            ureq::Error::Status(code, _) => format!("http {code}"),
            other => other.to_string(),
        })?;
    let body = read_body(response, 1_000_000)?;
    let parsed: Value = serde_json::from_str(&body).map_err(|_| "the reader returned no page text".to_string())?;
    if parsed["code"].as_u64().is_some_and(|code| code != 200) {
        let message = parsed["message"].as_str().unwrap_or("the reader returned no page text");
        return Err(message.to_string());
    }
    let content = parsed["data"]["content"].as_str().map(str::trim).filter(|text| !text.is_empty())
        .ok_or_else(|| "the reader returned no page text".to_string())?;
    let url = parsed["data"]["url"].as_str().filter(|text| !text.is_empty()).unwrap_or(raw);
    checked_public(url)?;
    let mut text: String = content.chars().take(8000).collect();
    if content.chars().count() > 8000 {
        text.push_str("\n…");
    }
    Ok((url.to_string(), text))
}

fn checked_public(raw: &str) -> Result<(), String> {
    let (host, port) = http_host(raw)?;
    ensure_public(&host)?;
    if port != 80 && port != 443 {
        return Err("only ports 80 and 443".into());
    }
    Ok(())
}

fn read_capped(response: ureq::Response) -> Result<String, String> {
    read_body(response, 200_000)
}

fn read_body(response: ureq::Response, limit: u64) -> Result<String, String> {
    let mut buf = Vec::new();
    response.into_reader().take(limit + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    if buf.len() as u64 > limit {
        return Err(format!("response is larger than {limit} bytes"));
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn http_host(raw: &str) -> Result<(String, u16), String> {
    let raw = raw.trim();
    let (scheme, rest) = if let Some(rest) = raw.strip_prefix("https://") {
        ("https", rest)
    } else if let Some(rest) = raw.strip_prefix("http://") {
        ("http", rest)
    } else {
        return Err("only http and https URLs".into());
    };
    if rest.contains('@') {
        return Err("URLs with a user name are refused".into());
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return Err("missing host".into());
    }
    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        let (host, tail) = rest.split_once(']').ok_or_else(|| "bad host".to_string())?;
        let port = tail.strip_prefix(':').map(|p| p.parse::<u16>().map_err(|_| "bad port".to_string())).transpose()?;
        (host.to_string(), port.unwrap_or(if scheme == "https" { 443 } else { 80 }))
    } else if let Some((host, port)) = authority.rsplit_once(':') {
        (host.to_string(), port.parse::<u16>().map_err(|_| "bad port".to_string())?)
    } else {
        (authority.to_string(), if scheme == "https" { 443 } else { 80 })
    };
    if host.is_empty() {
        return Err("missing host".into());
    }
    Ok((host, port))
}

fn ensure_public(host: &str) -> Result<(), String> {
    let lower = host.to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".local") || lower.ends_with(".internal") {
        return Err("local addresses are not fetched".into());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if ip_is_public(ip) { Ok(()) } else { Err("private addresses are not fetched".into()) };
    }
    let mut any = false;
    for addr in (host, 443u16).to_socket_addrs().map_err(|e| e.to_string())? {
        any = true;
        if !ip_is_public(addr.ip()) {
            return Err("that host resolves to a private address".into());
        }
    }
    if !any {
        return Err("no address for that host".into());
    }
    Ok(())
}

fn ip_is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            !v4.is_private()
                && !v4.is_loopback()
                && !v4.is_link_local()
                && !v4.is_broadcast()
                && !v4.is_unspecified()
                && !v4.is_multicast()
                && !is_cgnat(v4)
        }
        IpAddr::V6(v6) => {
            !v6.is_loopback()
                && !v6.is_unspecified()
                && !v6.is_multicast()
                && !is_ula(v6)
                && !(v6.segments()[0] & 0xffc0 == 0xfe80)
        }
    }
}

fn is_cgnat(v4: Ipv4Addr) -> bool {
    let [a, b, _, _] = v4.octets();
    a == 100 && (64..128).contains(&b)
}

fn is_ula(v6: Ipv6Addr) -> bool {
    (v6.segments()[0] & 0xfe00) == 0xfc00
}

fn ddg_results(html: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(at) = rest.find("uddg=") {
        let after = &rest[at + 5..];
        let raw = after.split(['&', '"', '\'']).next().unwrap_or("");
        let url = percent_decode(raw);
        rest = &after[raw.len()..];
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            continue;
        }
        if out.iter().any(|item: &Value| item["url"].as_str() == Some(url.as_str())) {
            continue;
        }
        let title = link_title(after).unwrap_or_else(|| url.split('/').nth(2).unwrap_or(&url).to_string());
        out.push(json!({ "title": title, "url": url }));
        if out.len() == 8 {
            break;
        }
    }
    out
}

fn link_title(after_uddg: &str) -> Option<String> {
    let body = after_uddg.get(after_uddg.find('>')? + 1..)?;
    let end = body.to_ascii_lowercase().find("</a>")?;
    let text = html_text(&body[..end]).split_whitespace().collect::<Vec<_>>().join(" ");
    let text = text.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">");
    (!text.is_empty()).then_some(text)
}

fn percent_decode(text: &str) -> String {
    let text = text.replace('+', " ");
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn html_text(input: &str) -> String {
    let mut cleaned = input.to_string();
    for tag in ["script", "style"] {
        loop {
            let lower = cleaned.to_ascii_lowercase();
            let Some(start) = lower.find(&format!("<{tag}")) else { break };
            let close = format!("</{tag}>");
            let end = lower[start..].find(&close).map(|at| start + at + close.len()).unwrap_or(cleaned.len());
            cleaned.replace_range(start..end, " ");
        }
    }
    let mut out = String::new();
    let mut in_tag = false;
    for ch in cleaned.chars() {
        if ch == '<' {
            in_tag = true;
            continue;
        }
        if ch == '>' && in_tag {
            in_tag = false;
            out.push('\n');
            continue;
        }
        if !in_tag {
            out.push(ch);
        }
    }
    let mut collapsed = String::new();
    let mut blank = false;
    for line in out.split('\n') {
        let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            if !blank && !collapsed.is_empty() {
                collapsed.push('\n');
            }
            blank = true;
        } else {
            if !collapsed.is_empty() && !collapsed.ends_with('\n') {
                collapsed.push('\n');
            }
            collapsed.push_str(&line);
            blank = false;
        }
    }
    collapsed
}

#[cfg(test)]
mod tests {
    use super::{article_window, best_page, compact_index, glob_name, json_string_array, line_window, read_index_head, source, source_slice, split_glob, LineSlice};

    #[test]
    fn search_index_arrays_match_a_mode_title() {
        let raw = r#"Search.setIndex({"docnames": ["docs/stabilize-mode", "docs/acro-mode"], "titles": ["Stabilize Mode", "Acro Mode"], "terms": {"a": [1]}})"#;
        let docs = json_string_array(raw, "docnames").unwrap();
        let titles = json_string_array(raw, "titles").unwrap();
        let pages: Vec<(String, String)> = docs.into_iter().zip(titles).collect();
        let (doc, title) = best_page(&pages, "STABILIZE").unwrap();
        assert_eq!(doc, "docs/stabilize-mode");
        assert_eq!(title, "Stabilize Mode");
    }

    #[test]
    fn excerpt_starts_at_the_match_and_the_next_offset_continues() {
        let filler = "x".repeat(2_000);
        let article = format!("{filler}\n\nALT_HOLD oscillates when the altitude controller is too stiff.\n\n{filler}");
        let first = article_window(&article, "altitude hold oscillation", None);
        assert!(first.text.starts_with("ALT_HOLD"));
        assert_eq!(first.text.chars().count(), 1_400);
        let next = first.next_offset.expect("the page continues");
        assert_eq!(next, first.offset + first.text.chars().count());
        let second = article_window(&article, "altitude hold oscillation", Some(next));
        assert_eq!(second.offset, next);
        assert!(!second.text.contains("ALT_HOLD"));
        let beginning = article_window(&article, "altitude hold oscillation", Some(0));
        assert!(beginning.text.starts_with('x'));
    }

    #[test]
    fn a_line_range_is_inclusive_and_names_the_following_line() {
        let owned: Vec<String> = (1..=100).map(|n| format!("line {n}")).collect();
        let lines: Vec<&str> = owned.iter().map(String::as_str).collect();
        let slice = line_window(&lines, 10, Some(14));
        assert_eq!(slice.start, 10);
        assert_eq!(slice.end, 14);
        assert_eq!(slice.text.lines().count(), 5);
        assert!(slice.text.contains("line 10"));
        assert!(slice.text.contains("line 14"));
        assert_eq!(slice.next_line, Some(15));
        assert_eq!(slice.line_count, 100);
        let tail = line_window(&lines, 96, None);
        assert_eq!(tail.end, 100);
        assert_eq!(tail.next_line, None);
        let owned_long: Vec<String> = (1..=600).map(|n| format!("line {n}")).collect();
        let long: Vec<&str> = owned_long.iter().map(String::as_str).collect();
        let chunk = line_window(&long, 1, None);
        assert_eq!(chunk.start, 1);
        assert_eq!(chunk.end, 500);
        assert_eq!(chunk.next_line, Some(501));
        let wide: Vec<String> = (0..40).map(|_| "y".repeat(1_000)).collect();
        let wide_lines: Vec<&str> = wide.iter().map(String::as_str).collect();
        let wide_slice = line_window(&wide_lines, 1, None);
        assert_eq!(wide_slice.end, 40);
        assert_eq!(wide_slice.text.lines().count(), 40);
        assert!(wide_slice.text.chars().count() > 32_000);
        assert_eq!(wide_slice.next_line, None);
    }

    #[test]
    fn index_head_keeps_page_names_and_drops_terms() {
        let head = r#"Search.setIndex({"docnames":["docs/althold-mode"],"filenames":["docs/althold-mode"],"titles":["Altitude Hold Mode"],"terms":{"oscillation":[0]}}"#;
        let mut body = head.to_string();
        body.push_str(&" ".repeat(80_000));
        let compact = read_index_head(std::io::Cursor::new(body.into_bytes())).unwrap();
        assert!(compact.contains("althold-mode"));
        assert!(compact.contains("Altitude Hold Mode"));
        assert!(!compact.contains("oscillation"));
        assert!(compact.len() < 1_000);
        let again = compact_index(&compact).unwrap();
        assert_eq!(again, compact);
    }

    #[test]
    fn a_rejected_source_path_is_metadata_without_a_body() {
        let text = source("copter", "../secret", 1, None).as_str().unwrap().to_string();
        assert!(text.starts_with("<metadata>\n"));
        assert!(text.contains("ok: false\n"));
        assert!(!text.contains("<content>"));
    }

    #[test]
    fn a_file_slice_keeps_the_source_text_outside_metadata() {
        let slice = LineSlice {
            start: 10,
            end: 11,
            text: "int x = 1; // {\"a\": true}".into(),
            next_line: Some(12),
            line_count: 40,
        };
        let text = source_slice("libraries/AP_Logger/AP_Logger.cpp", "Copter-4.6.2", "copter", "https://example/file", &slice)
            .as_str()
            .unwrap()
            .to_string();
        assert!(text.contains("start_line: 10\n"));
        assert!(text.contains("next_line: 12\n"));
        assert!(text.contains("<content>\nint x = 1; // {\"a\": true}\n</content>\n"));
        assert!(!text.contains("\\\"a\\\""));
        let tail = LineSlice { next_line: None, ..slice };
        let tail_text = source_slice("libraries/AP_Logger/AP_Logger.cpp", "Copter-4.6.2", "copter", "https://example/file", &tail)
            .as_str()
            .unwrap()
            .to_string();
        assert!(tail_text.contains("next_line: null\n"));
    }

    #[test]
    fn web_fetch_refuses_a_private_address() {
        let text = super::web_fetch("http://127.0.0.1/secret").as_str().unwrap().to_string();
        assert!(text.contains("ok: false"), "{text}");
        assert!(text.contains("private addresses are not fetched"), "{text}");
        assert!(!text.contains("<content>"), "{text}");
    }

    #[test]
    fn web_search_keeps_the_link_title() {
        let html = r#"<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fardupilot.org%2Fcopter%2Fdocs%2Floiter%2Dmode.html&amp;rut=abc">Loiter Mode - Copter documentation</a><a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fardupilot.org%2Fcopter%2Fdocs%2Floiter%2Dmode.html&amp;rut=abc"></a>"#;
        let rows = super::ddg_results(html);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["url"], "https://ardupilot.org/copter/docs/loiter-mode.html");
        assert_eq!(rows[0]["title"], "Loiter Mode - Copter documentation");
    }

    #[test]
    fn a_source_glob_is_one_directory() {
        let (dir, file) = split_glob("libraries/AP_Motors/*.cpp").unwrap();
        assert_eq!(dir, "libraries/AP_Motors");
        assert_eq!(file, "*.cpp");
        assert!(glob_name("libraries/AP_Motors/AP_MotorsMulticopter.cpp", &file));
        assert!(!glob_name("libraries/AP_Motors/README.md", &file));
        assert!(split_glob("libraries/**/*.cpp").is_err());
        assert!(split_glob("*.cpp").is_err());
    }
}
