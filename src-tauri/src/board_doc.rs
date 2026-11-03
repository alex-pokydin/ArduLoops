//! The board's own documentation from the ArduPilot tree: `libraries/AP_HAL_ChibiOS/hwdef/<board>/README.md`,
//! its `hwdef.dat` with the files it includes, and `defaults.parm`. Files are saved under the app data folder,
//! so the Overview shows them offline. Nothing in them is parsed beyond `include` lines and the board list.

use crate::link::Sample;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const RAW: &str = "https://raw.githubusercontent.com/ArduPilot/ardupilot/master";
const HWDEF: &str = "libraries/AP_HAL_ChibiOS/hwdef";
const LISTING: &str = "https://api.github.com/repos/ArduPilot/ardupilot/contents/libraries/AP_HAL_ChibiOS/hwdef";
/// A saved copy older than this is downloaded again when the app is online.
const FRESH_S: u64 = 7 * 24 * 3600;
const MAX_FILES: usize = 16;
const TEXT_LIMIT: u64 = 1_000_000;
const ASSET_LIMIT: u64 = 8_000_000;

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn root() -> PathBuf {
    crate::db::data_dir().join("board-docs")
}

fn get(url: &str, limit: u64) -> Result<Option<Vec<u8>>, String> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).redirects(2).build();
    match agent.get(url).set("User-Agent", "ArduLoops").call() {
        Ok(response) => {
            let mut buf = Vec::new();
            response.into_reader().take(limit + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
            if buf.len() as u64 > limit {
                return Err(format!("{url} is larger than {limit} bytes"));
            }
            Ok(Some(buf))
        }
        Err(ureq::Error::Status(404, _)) => Ok(None),
        Err(ureq::Error::Status(code, _)) => Err(format!("http {code}")),
        Err(err) => Err(err.to_string()),
    }
}

fn get_text(url: &str) -> Result<Option<String>, String> {
    Ok(get(url, TEXT_LIMIT)?.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()))
}

/// Letters and digits only, upper case: `AP_HW_CUBEORANGEPLUS` and `CubeOrangePlus` meet as `CUBEORANGEPLUS`.
fn squash(name: &str) -> String {
    name.chars().filter(char::is_ascii_alphanumeric).collect::<String>().to_ascii_uppercase()
}

/// `Tools/AP_Bootloader/board_types.txt`: `AP_HW_<NAME>  <id>` per line.
fn parse_board_types(text: &str) -> HashMap<i64, String> {
    let mut out = HashMap::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let (Some(name), Some(id)) = (parts.next(), parts.next()) else { continue };
        let Some(name) = name.strip_prefix("AP_HW_") else { continue };
        if let Ok(id) = id.parse::<i64>() {
            out.entry(id).or_insert_with(|| name.to_string());
        }
    }
    out
}

/// The hwdef folders and the board id table, saved once and downloaded again after a week.
fn index(refresh: bool) -> Option<Value> {
    let path = root().join("index.json");
    let saved: Option<Value> = fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let fresh = saved.as_ref().and_then(|v| v["saved_at"].as_u64()).is_some_and(|at| now().saturating_sub(at) < FRESH_S);
    if fresh && !refresh {
        return saved;
    }
    let dirs = get_text(LISTING).ok().flatten().and_then(|text| serde_json::from_str::<Value>(&text).ok()).and_then(|v| {
        v.as_array().map(|items| {
            items.iter().filter(|item| item["type"] == "dir").filter_map(|item| item["name"].as_str().map(str::to_string)).collect::<Vec<_>>()
        })
    });
    let types = get_text(&format!("{RAW}/Tools/AP_Bootloader/board_types.txt")).ok().flatten().map(|text| parse_board_types(&text));
    let (Some(dirs), Some(types)) = (dirs, types) else { return saved };
    let value = json!({
        "saved_at": now(),
        "dirs": dirs,
        "types": types.into_iter().map(|(id, name)| (id.to_string(), Value::String(name))).collect::<serde_json::Map<_, _>>(),
    });
    let _ = fs::create_dir_all(root());
    let _ = fs::write(&path, serde_json::to_vec(&value).unwrap_or_default());
    Some(value)
}

/// The hwdef folder for the linked board: the boot banner name when it is a folder, else the board id through board_types.txt.
fn resolve(name: &str, board_id: Option<i64>, index: Option<&Value>) -> Option<String> {
    let dirs: Vec<&str> = index.and_then(|v| v["dirs"].as_array()).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let find = |wanted: &str| -> Option<String> {
        if wanted.is_empty() {
            return None;
        }
        dirs.iter().find(|dir| **dir == wanted).or_else(|| dirs.iter().find(|dir| squash(dir) == squash(wanted))).map(|dir| dir.to_string())
    };
    if let Some(dir) = find(name) {
        return Some(dir);
    }
    let by_id = board_id.and_then(|id| index?["types"][id.to_string()].as_str().map(str::to_string));
    if let Some(dir) = by_id.as_deref().and_then(find) {
        return Some(dir);
    }
    // Offline with no index: a board saved before under this name.
    (!name.is_empty() && root().join(name).join("meta.json").is_file()).then(|| name.to_string())
}

/// Join `rel` onto `base` (both relative to the hwdef folder), refusing anything that leaves it.
fn join_rel(base: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = base.split('/').filter(|p| !p.is_empty()).collect();
    for part in rel.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            p if p.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-+".contains(&b)) => parts.push(p),
            _ => return None,
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("")
}

fn includes(text: &str) -> Vec<String> {
    text.lines().filter_map(|line| line.trim().strip_prefix("include ")).map(|rest| rest.split_whitespace().next().unwrap_or("").to_string()).filter(|p| !p.is_empty()).collect()
}

/// `../CubeOrange/hwdef.inc` as seen from the board folder.
fn shown_path(board: &str, key: &str) -> String {
    match key.strip_prefix(&format!("{board}/")) {
        Some(rest) => rest.to_string(),
        None => format!("../{key}"),
    }
}

/// Download README.md, hwdef.dat with its includes and defaults.parm for one board, and save them.
fn download(board: &str) -> Result<Value, String> {
    let readme = get_text(&format!("{RAW}/{HWDEF}/{board}/README.md"))?;
    let mut files: Vec<(String, String)> = Vec::new();
    let mut queue = vec![format!("{board}/hwdef.dat")];
    while let Some(key) = queue.pop() {
        if files.len() >= MAX_FILES || files.iter().any(|(k, _)| *k == key) {
            continue;
        }
        let Some(text) = get_text(&format!("{RAW}/{HWDEF}/{key}"))? else { continue };
        for inc in includes(&text).into_iter().rev() {
            if let Some(next) = join_rel(dir_of(&key), &inc) {
                queue.push(next);
            }
        }
        files.push((key, text));
    }
    if let Some(text) = get_text(&format!("{RAW}/{HWDEF}/{board}/defaults.parm"))? {
        files.push((format!("{board}/defaults.parm"), text));
    }
    if readme.is_none() && files.is_empty() {
        return Err(format!("no README.md or hwdef.dat for {board}"));
    }
    let dir = root().join(board);
    let _ = fs::remove_dir_all(dir.join("files"));
    fs::create_dir_all(dir.join("files")).map_err(|e| e.to_string())?;
    if let Some(text) = &readme {
        fs::write(dir.join("README.md"), text).map_err(|e| e.to_string())?;
    } else {
        let _ = fs::remove_file(dir.join("README.md"));
    }
    let mut list = Vec::new();
    for (key, text) in &files {
        let path = dir.join("files").join(key);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, text).map_err(|e| e.to_string())?;
        list.push(json!({ "key": key, "path": shown_path(board, key) }));
    }
    let meta = json!({ "saved_at": now(), "files": list });
    fs::write(dir.join("meta.json"), serde_json::to_vec(&meta).unwrap_or_default()).map_err(|e| e.to_string())?;
    Ok(meta)
}

fn saved(board: &str) -> Option<Value> {
    let dir = root().join(board);
    let meta: Value = serde_json::from_slice(&fs::read(dir.join("meta.json")).ok()?).ok()?;
    let readme = fs::read_to_string(dir.join("README.md")).ok();
    let files: Vec<Value> = meta["files"].as_array().map(|items| {
        items.iter().filter_map(|item| {
            let key = item["key"].as_str()?;
            let text = fs::read_to_string(dir.join("files").join(key)).ok()?;
            Some(json!({ "path": item["path"], "text": text }))
        }).collect()
    }).unwrap_or_default();
    Some(json!({ "board": board, "readme": readme, "files": files, "saved_at": meta["saved_at"] }))
}

fn linked_board(sample: &Sample) -> (String, Option<i64>) {
    let id = sample.telemetry.get("AUTOPILOT_VERSION")
        .and_then(|v| v["data"]["board_version"].as_u64())
        .map(|v| (v >> 16) as i64)
        .filter(|id| *id > 0);
    (sample.board_name.clone(), id)
}

/// `GET /board-doc`: the linked board's saved documents, downloaded first when missing, a week old, or `refresh` is set.
/// `state` is `saved`, `stale` (offline, an older copy), `never` (offline, nothing saved) or `none` (no such board).
pub fn board_doc(sample: &Sample, refresh: bool) -> Value {
    if !sample.ok {
        return json!({ "state": "off" });
    }
    let (name, id) = linked_board(sample);
    if name.is_empty() && id.is_none() {
        return json!({ "state": "none" });
    }
    let index = index(refresh);
    let Some(board) = resolve(&name, id, index.as_ref()) else {
        return json!({ "state": if index.is_some() { "none" } else { "never" }, "board": name, "board_id": id });
    };
    let have = saved(&board);
    let fresh = have.as_ref().and_then(|v| v["saved_at"].as_u64()).is_some_and(|at| now().saturating_sub(at) < FRESH_S);
    let mut error = String::new();
    if refresh || !fresh {
        if let Err(err) = download(&board) {
            error = err;
        }
    }
    match saved(&board) {
        Some(mut value) => {
            value["state"] = json!(if error.is_empty() { "saved" } else { "stale" });
            if !error.is_empty() {
                value["error"] = json!(error);
            }
            value
        }
        None if error.starts_with("no README") => json!({ "state": "none", "board": board }),
        None => json!({ "state": "never", "board": board, "error": error }),
    }
}

/// `GET /board-doc/file`: an image the README links, saved on first use. Returns the bytes and their media type.
pub fn board_file(board: &str, path: &str) -> Option<(Vec<u8>, &'static str)> {
    if board.is_empty() || !board.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-+".contains(&b)) {
        return None;
    }
    let key = join_rel(board, path)?;
    if !key.starts_with(&format!("{board}/")) {
        return None;
    }
    let ctype = media_type(&key)?;
    let local = root().join(board).join("assets").join(&key[board.len() + 1..]);
    if let Ok(bytes) = fs::read(&local) {
        return Some((bytes, ctype));
    }
    let bytes = get(&format!("{RAW}/{HWDEF}/{key}"), ASSET_LIMIT).ok()??;
    if let Some(parent) = local.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&local, &bytes);
    Some((bytes, ctype))
}

fn media_type(path: &str) -> Option<&'static str> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_types_map_ids_to_names() {
        let types = parse_board_types("# comment\nAP_HW_DAKEFPVH743                    1193\nAP_HW_CUBEORANGEPLUS 1063\n");
        assert_eq!(types.get(&1193).map(String::as_str), Some("DAKEFPVH743"));
        assert_eq!(squash("CubeOrangePlus"), squash(types.get(&1063).unwrap()));
    }

    #[test]
    fn includes_stay_inside_the_hwdef_folder() {
        assert_eq!(join_rel("CubeOrangePlus", "../CubeOrange/hwdef.inc").as_deref(), Some("CubeOrange/hwdef.inc"));
        assert_eq!(join_rel("CubeOrange", "sdcard.inc").as_deref(), Some("CubeOrange/sdcard.inc"));
        assert_eq!(join_rel("X", "../../etc/passwd"), None);
        assert_eq!(includes("# x\ninclude ../CubeOrange/hwdef.inc\nundef IMU\n"), vec!["../CubeOrange/hwdef.inc"]);
        assert_eq!(shown_path("CubeOrangePlus", "CubeOrange/hwdef.inc"), "../CubeOrange/hwdef.inc");
        assert_eq!(shown_path("CubeOrangePlus", "CubeOrangePlus/hwdef.dat"), "hwdef.dat");
    }

    #[test]
    fn board_resolves_by_name_then_id() {
        let index = json!({ "dirs": ["CubeOrangePlus", "DAKEFPVH743"], "types": { "1193": "DAKEFPVH743" } });
        assert_eq!(resolve("CubeOrangePlus", None, Some(&index)).as_deref(), Some("CubeOrangePlus"));
        assert_eq!(resolve("", Some(1193), Some(&index)).as_deref(), Some("DAKEFPVH743"));
    }

    #[test]
    fn assets_only_inside_the_board_folder() {
        assert!(board_file("CubeOrangePlus", "../CubeOrange/hwdef.inc").is_none());
        assert!(board_file("Cube/../x", "a.png").is_none());
        assert_eq!(media_type("CubeOrangePlus/pinout.SVG"), Some("image/svg+xml"));
    }
}
