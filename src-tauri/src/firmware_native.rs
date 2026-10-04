//! Native implementation of the custom firmware API and serial bootloader.
use base64::Engine;
use flate2::read::ZlibDecoder;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const API: &str = "https://custom.ardupilot.org/api/v1";
const BRIDGE: &str = "http://127.0.0.1:8767";
const MAX: usize = 64 * 1024 * 1024;
const IMAGE: usize = 16 * 1024 * 1024;
fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}
fn need(ok: bool, msg: impl Into<String>) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(msg.into())
    }
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn flash_in_progress() -> bool {
    root().join("flash.lock").exists()
}

fn root() -> PathBuf {
    if let Some(p) = std::env::var_os("ARDULOOPS_FIRMWARE_DIR") {
        PathBuf::from(p)
    } else if let Some(p) = std::env::var_os("LOCALAPPDATA") {
        PathBuf::from(p).join("ArduLoops/firmware")
    } else {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".local/share/ArduLoops/firmware")
    }
}
fn local(kind: &str, id: &str) -> Result<PathBuf, String> {
    need(
        id.len() >= 32 && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_hexdigit()),
        "Invalid local identifier",
    )?;
    let p = root().join(kind).join(id);
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}
fn load(path: &Path) -> Result<Value, String> {
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn save(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid storage path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(".{}.tmp", Uuid::new_v4()));
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}
fn quote(s: &str) -> String {
    s.bytes()
        .flat_map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                vec![b as char]
            } else {
                format!("%{b:02X}").chars().collect()
            }
        })
        .collect()
}
fn request(url: &str, body: Option<&Value>, binary: bool) -> Result<Vec<u8>, String> {
    let r = match body {
        Some(v) => ureq::post(url)
            .set("Content-Type", "application/json")
            .send_string(&v.to_string()),
        None => ureq::get(url).call(),
    }
    .map_err(|e| e.to_string())?;
    need(
        (200..300).contains(&r.status()),
        format!("HTTP {}", r.status()),
    )?;
    let mut bytes = Vec::new();
    r.into_reader()
        .take((MAX + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    need(bytes.len() <= MAX, "Response exceeds size limit")?;
    if !binary {
        serde_json::from_slice::<Value>(&bytes).map_err(|e| format!("Invalid API JSON: {e}"))?;
    }
    Ok(bytes)
}
fn api(path: &str, body: Option<&Value>) -> Result<Value, String> {
    serde_json::from_slice(&request(&format!("{API}{path}"), body, false)?)
        .map_err(|e| e.to_string())
}
fn bridge(path: &str) -> Result<Value, String> {
    serde_json::from_slice(&request(&format!("{BRIDGE}{path}"), None, false)?)
        .map_err(|e| e.to_string())
}
fn field<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
    args[name]
        .as_str()
        .ok_or_else(|| format!("{name} is required"))
}
fn board(args: &Value) -> Result<String, String> {
    Ok(format!(
        "/vehicles/{}/versions/{}/boards/{}",
        quote(field(args, "vehicle_id")?),
        quote(field(args, "version_id")?),
        quote(field(args, "board_id")?)
    ))
}

pub fn call(operation: &str, args: &Value) -> Result<Value, String> {
    let v = match operation {
        "catalog" => catalog(args),
        "build" => build(args),
        "flash" => flash(args),
        _ => Err("Unknown firmware operation".into()),
    }?;
    if operation == "build" && args["action"].as_str() == Some("download") {
        crate::db::record_firmware(&v)?;
    }
    Ok(v)
}
fn catalog(a: &Value) -> Result<Value, String> {
    match field(a, "resource")? {
        "vehicles" => api("/vehicles", None),
        "versions" => api(
            &format!("/vehicles/{}/versions", quote(field(a, "vehicle_id")?)),
            None,
        ),
        "boards" => api(
            &format!(
                "/vehicles/{}/versions/{}/boards",
                quote(field(a, "vehicle_id")?),
                quote(field(a, "version_id")?)
            ),
            None,
        ),
        "features" | "standard_artifacts" => {
            api(&format!("{}/{}", board(a)?, field(a, "resource")?), None)
        }
        _ => Err("Unknown catalog resource".into()),
    }
}
fn list(a: Option<&Value>, name: &str) -> Result<Vec<String>, String> {
    a.unwrap_or(&json!([]))
        .as_array()
        .ok_or_else(|| format!("{name} must be an array"))?
        .iter()
        .map(|v| {
            v.as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("{name} must contain strings"))
        })
        .collect()
}
fn resolve(items: &[Value], enable: Vec<String>, disable: Vec<String>, base: Option<Vec<String>>) -> Result<Value, String> {
    let defs: HashMap<_, _> = items
        .iter()
        .filter_map(|x| x["id"].as_str().map(|id| (id.to_owned(), x)))
        .collect();
    let en: HashSet<_> = enable.into_iter().collect();
    let dis: HashSet<_> = disable.into_iter().collect();
    need(
        en.is_disjoint(&dis),
        "A feature cannot be both enabled and disabled",
    )?;
    need(
        en.iter().chain(dis.iter()).all(|x| defs.contains_key(x)),
        "Unknown feature ID",
    )?;
    let defaults: BTreeSet<_> = defs
        .iter()
        .filter(|(_, x)| x["default"]["enabled"].as_bool() == Some(true))
        .map(|(x, _)| x.clone())
        .collect();
    let mut chosen: BTreeSet<_> = match base {
        Some(ids) => {
            need(ids.iter().all(|id| defs.contains_key(id)), "Unknown feature ID")?;
            ids.into_iter().collect()
        }
        None => defaults.clone(),
    };
    chosen.extend(en.iter().cloned());
    chosen.retain(|x| !dis.contains(x));
    let mut todo: Vec<_> = chosen.iter().cloned().collect();
    while let Some(x) = todo.pop() {
        for dep in defs[&x]["dependencies"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            need(defs.contains_key(dep), format!("Unknown dependency {dep}"))?;
            need(
                !dis.contains(dep),
                format!("{x} requires disabled feature {dep}"),
            )?;
            if chosen.insert(dep.into()) {
                todo.push(dep.into())
            }
        }
    }
    Ok(
        json!({"selected_features":chosen,"added":chosen.difference(&defaults).collect::<Vec<_>>(),"removed":defaults.difference(&chosen).collect::<Vec<_>>(),"default_count":defaults.len()}),
    )
}
fn build(a: &Value) -> Result<Value, String> {
    match field(a, "action")? {
        "plan" => {
            let features = api(&format!("{}/features", board(a)?), None)?
                .as_array()
                .cloned()
                .ok_or("Invalid feature catalog")?;
            let base = match a.get("features") {
                Some(value) if !value.is_null() => Some(list(Some(value), "features")?),
                _ => None,
            };
            let r = resolve(
                &features,
                list(a.get("enable"), "enable")?,
                list(a.get("disable"), "disable")?,
                base,
            )?;
            let id = Uuid::new_v4().simple().to_string();
            let mut request = Map::new();
            for k in ["vehicle_id", "version_id", "board_id"] {
                request.insert(
                    k.into(),
                    a.get(k)
                        .cloned()
                        .ok_or_else(|| format!("{k} is required"))?,
                );
            }
            request.insert("selected_features".into(), r["selected_features"].clone());
            let mut p = r.as_object().cloned().unwrap();
            p.insert("plan_id".into(), json!(id));
            p.insert("created_at".into(), json!(now()));
            p.insert("request".into(), Value::Object(request));
            let p = Value::Object(p);
            save(&local("build-plans", &id)?.join("plan.json"), &p)?;
            Ok(p)
        }
        "submit" => {
            let id = field(a, "plan_id")?;
            let d = local("build-plans", id)?;
            if d.join("submitted.json").exists() {
                return load(&d.join("submitted.json"));
            }
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(d.join("submission-attempted"))
                .map_err(|_| {
                    "Build submission was already attempted; inspect the service before retrying"
                        .to_string()
                })?;
            let p = load(&d.join("plan.json"))?;
            let r = api("/builds", Some(&p["request"]))?;
            let bid = r["build_id"]
                .as_str()
                .ok_or("Build service did not return build_id")?;
            save(
                &local("builds", &sha(bid.as_bytes()))?.join("request.json"),
                &p["request"],
            )?;
            save(&d.join("submitted.json"), &r)?;
            Ok(r)
        }
        "status" => api(&format!("/builds/{}", quote(field(a, "build_id")?)), None),
        "logs" => {
            let id = field(a, "build_id")?;
            let tail = a["tail"].as_i64().unwrap_or(100).clamp(1, 1000);
            Ok(
                json!({"build_id":id,"logs":String::from_utf8_lossy(&request(&format!("{API}/builds/{}/logs?tail={tail}",quote(id)),None,true)?) }),
            )
        }
        "download" => download(a),
        _ => Err("Unknown build action".into()),
    }
}
fn member(name: &str) -> Result<(), String> {
    let n = name.replace('\\', "/");
    need(
        !n.starts_with('/') && !n.split('/').any(|x| x == "..") && !n.contains(':'),
        "Unsafe archive member",
    )
}
fn unpack(bytes: &[u8]) -> Result<(String, Vec<u8>), String> {
    if bytes.iter().skip_while(|x| x.is_ascii_whitespace()).next() == Some(&b'{') {
        return Ok(("firmware.apj".into(), bytes.into()));
    }
    if let Ok(mut z) = zip::ZipArchive::new(Cursor::new(bytes)) {
        need(z.len() <= 4096, "Archive expands beyond count limit")?;
        let mut total = 0;
        let mut found = None;
        for i in 0..z.len() {
            let mut e = z.by_index(i).map_err(|e| e.to_string())?;
            total += e.size() as usize;
            need(total <= MAX, "Archive expands beyond size limit")?;
            member(e.name())?;
            if !e.is_dir() && e.name().to_lowercase().ends_with(".apj") {
                need(found.is_none(), "Artifact must contain exactly one APJ")?;
                need(e.size() <= IMAGE as u64, "APJ archive entry is too large")?;
                let mut b = Vec::new();
                e.read_to_end(&mut b).map_err(|e| e.to_string())?;
                found = Some((e.name().into(), b));
            }
        }
        return found.ok_or_else(|| {
            "Artifact must contain exactly one APJ; ambiguous archives are refused".into()
        });
    }
    let mut t = tar::Archive::new(Cursor::new(bytes));
    let mut total = 0;
    let mut count = 0;
    let mut found = None;
    for e in t.entries().map_err(|e| e.to_string())? {
        let mut e = e.map_err(|e| e.to_string())?;
        count += 1;
        total += e.size() as usize;
        need(
            count <= 4096 && total <= MAX,
            "Archive expands beyond size/count limit",
        )?;
        let name = e
            .path()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned();
        member(&name)?;
        if e.header().entry_type().is_file() && name.to_lowercase().ends_with(".apj") {
            need(found.is_none(), "Artifact must contain exactly one APJ")?;
            let mut b = Vec::new();
            e.read_to_end(&mut b).map_err(|e| e.to_string())?;
            found = Some((name, b));
        }
    }
    found.ok_or_else(|| {
        "Artifact must contain exactly one APJ; ambiguous archives are refused".into()
    })
}
#[derive(Clone)]
struct Image {
    board: u32,
    size: usize,
    bytes: Vec<u8>,
    git: Option<String>,
    description: Option<String>,
    summary: Option<String>,
}
fn apj(bytes: &[u8]) -> Result<Image, String> {
    need(bytes.len() <= IMAGE, "APJ is too large")?;
    let a: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    need(
        a["magic"].as_str() == Some("APJFWv1"),
        "Not an ArduPilot APJ firmware",
    )?;
    let board = a["board_id"]
        .as_u64()
        .filter(|x| *x > 0)
        .ok_or("Missing APJ board ID")? as u32;
    let size = a["image_size"]
        .as_u64()
        .filter(|x| *x > 0 && *x <= IMAGE as u64)
        .ok_or("Invalid firmware size")? as usize;
    need(
        a["extf_image_size"].as_u64().unwrap_or(0) == 0,
        "External flash images are not supported",
    )?;
    if let Some(ext) = a["extf_image"].as_str() {
        let b = base64::engine::general_purpose::STANDARD
            .decode(ext)
            .map_err(|_| "Invalid external image encoding")?;
        let mut d = ZlibDecoder::new(b.as_slice());
        let mut x = [0; 1];
        need(
            d.read(&mut x).map_err(|e| e.to_string())? == 0,
            "External flash images are not supported",
        )?;
    }
    let packed = base64::engine::general_purpose::STANDARD
        .decode(a["image"].as_str().ok_or("Missing APJ image")?)
        .map_err(|_| "Invalid APJ image encoding")?;
    let mut out = Vec::new();
    ZlibDecoder::new(packed.as_slice())
        .take((size + 1) as u64)
        .read_to_end(&mut out)
        .map_err(|e| e.to_string())?;
    need(
        out.len() == size,
        "Firmware decompression or declared size mismatch",
    )?;
    while out.len() % 4 != 0 {
        out.push(0xff)
    }
    Ok(Image {
        board,
        size,
        bytes: out,
        git: a["git_identity"].as_str().map(str::to_owned),
        description: a["description"].as_str().map(str::to_owned),
        summary: a["summary"].as_str().map(str::to_owned),
    })
}

fn board_label(summary: Option<&str>) -> Option<String> {
    let name = summary?.trim();
    let ok = (1..=64).contains(&name.len())
        && name.starts_with(|c: char| c.is_ascii_alphabetic())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    ok.then(|| name.to_string())
}

/// Validate a local APJ and store it where the existing flash plan can read it.
fn stage_local(bytes: &[u8], vehicle: &str, root: &Path) -> Result<Value, String> {
    need(
        vehicle == "copter" || vehicle == "plane",
        "Vehicle must be copter or plane",
    )?;
    let img = apj(bytes)?;
    let aid = sha(bytes);
    let dir = root.join("artifacts").join(&aid);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("firmware.apj");
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    let board_name = board_label(img.summary.as_deref());
    let description = match (board_name.as_deref(), img.git.as_deref()) {
        (Some(board), Some(git)) => format!("{board} · {git}"),
        (Some(board), None) => board.to_string(),
        (None, Some(git)) => git.to_string(),
        (None, None) => img.description.clone().unwrap_or_default(),
    };
    let manifest = json!({
        "artifact_id": aid,
        "sha256": aid,
        "board_id": img.board,
        "image_size": img.size,
        "git_identity": img.git,
        "description": description,
        "build_id": "local",
        "path": path.display().to_string(),
        "built_at": now(),
        "request": {
            "vehicle_id": vehicle,
            "board_id": board_name,
            "selected_features": [],
        }
    });
    save(&dir.join("manifest.json"), &manifest)?;
    Ok(manifest)
}

pub fn import_local(bytes: &[u8], vehicle: &str) -> Result<Value, String> {
    let manifest = stage_local(bytes, vehicle, &root())?;
    crate::db::record_firmware(&manifest)?;
    Ok(manifest)
}
fn artifact(id: &str) -> Result<(Value, Image, PathBuf), String> {
    let d = local("artifacts", id)?;
    let m = load(&d.join("manifest.json"))?;
    let p = d.join("firmware.apj");
    let b = fs::read(&p).map_err(|e| e.to_string())?;
    need(
        sha(&b) == id && m["sha256"].as_str() == Some(id),
        "Firmware SHA256 mismatch",
    )?;
    let image = apj(&b)?;
    need(
        m["board_id"].as_u64() == Some(image.board as u64),
        "Manifest board mismatch",
    )?;
    Ok((m, image, p))
}
fn download(a: &Value) -> Result<Value, String> {
    let id = field(a, "build_id")?;
    let path = format!("/builds/{}", quote(id));
    let wanted = load(&local("builds", &sha(id.as_bytes()))?.join("request.json"))?;
    let status = api(&path, None)?;
    need(
        status["progress"]["state"].as_str() == Some("SUCCESS")
            && status["artifact_available"].as_bool() == Some(true),
        "Build has no successful artifact",
    )?;
    for k in ["vehicle", "board", "version"] {
        need(
            status[k]["id"] == wanted[format!("{k}_id")],
            format!("Build {k} mismatch"),
        )?
    }
    let one: BTreeSet<_> = status["selected_features"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let two: BTreeSet<_> = wanted["selected_features"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    need(one == two, "Build features mismatch")?;
    let (name, raw) = unpack(&request(&format!("{API}{path}/artifact"), None, true)?)?;
    let img = apj(&raw)?;
    if let Some(g) = img.git.as_deref() {
        let expected = status["version"]["git_hash"].as_str().unwrap_or("");
        if !expected.is_empty() {
            need(
                expected.starts_with(g) || g.starts_with(expected),
                "APJ source revision differs from selected build version",
            )?
        }
    }
    let aid = sha(&raw);
    let d = local("artifacts", &aid)?;
    fs::write(d.join("firmware.apj"), &raw).map_err(|e| e.to_string())?;
    let m = json!({"artifact_id":aid,"sha256":aid,"board_id":img.board,"image_size":img.size,"git_identity":img.git,"description":img.description,"archive_name":name,"build_id":id,"request":wanted,"path":d.join("firmware.apj").display().to_string(),"built_at":status["time_created"].as_f64().unwrap_or_else(now),"downloaded_at":now()});
    save(&d.join("manifest.json"), &m)?;
    save(&d.join("build.json"), &status)?;
    Ok(m)
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct Port {
    port: String,
    description: Option<String>,
    serial_number: String,
    vid: u16,
    pid: u16,
}
#[cfg(not(target_os = "android"))]
fn ports() -> Vec<Port> {
    serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| match p.port_type {
            serialport::SerialPortType::UsbPort(u) => {
                u.serial_number.filter(|s| !s.is_empty()).map(|s| Port {
                    port: p.port_name,
                    description: u.product.or(u.manufacturer),
                    serial_number: s,
                    vid: u.vid,
                    pid: u.pid,
                })
            }
            _ => None,
        })
        .collect()
}
#[cfg(target_os = "android")]
fn ports() -> Vec<Port> {
    Vec::new()
}
fn port(name: &str) -> Result<Port, String> {
    ports()
        .into_iter()
        .find(|x| x.port == name)
        .ok_or_else(|| "Selected USB device is absent or has no USB serial identity".into())
}
fn live(diag: &Value, board: u32, vehicle: &str) -> Result<Value, String> {
    let s = &diag["state"];
    need(
        s["ok"].as_bool() == Some(true) && now() - s["heartbeat_at"].as_f64().unwrap_or(0.) <= 3.,
        "A fresh vehicle heartbeat is required",
    )?;
    need(
        s["armed"].as_bool() == Some(false),
        "Vehicle must be disarmed",
    )?;
    need(
        s["frame"].as_str() == Some(vehicle),
        "Connected vehicle type differs from build",
    )?;
    need(
        diag["params"]["complete"].as_bool() == Some(true),
        "Complete parameter download is required before backup",
    )?;
    let v = if let Some(v) = diag.pointer("/telemetry/AUTOPILOT_VERSION") {
        need(
            v.pointer("/data/board_version")
                .and_then(Value::as_u64)
                .map(|x| (x >> 16) as u32)
                == Some(board),
            "Connected board ID differs from firmware",
        )?;
        v.clone()
    } else {
        let c = bridge("/firmware-library")?["controller"].clone();
        need(
            c["board_id"].as_u64() == Some(board as u64),
            "AUTOPILOT_VERSION unavailable and local controller board ID does not match firmware",
        )?;
        json!({"system_id":c["system_id"],"component_id":c["component_id"],"data":{"board_version":(board as u64)<<16,"identity_source":"local_firmware_catalog"}})
    };
    Ok(
        json!({"board_id":board,"system_id":v["system_id"],"component_id":v["component_id"],"version":v["data"]}),
    )
}
fn all_params(v: &Value, n: usize) -> bool {
    v.as_object()
        .is_some_and(|p| p.len() == n && p.values().all(|x| x.as_f64().is_some_and(f64::is_finite)))
}
fn flash(a: &Value) -> Result<Value, String> {
    match field(a, "action")? {
        "ports" => Ok(json!({"ports":ports(),"uploader":"native-rust"})),
        "status" => {
            let d = local("flash-plans", field(a, "plan_id")?)?;
            let mut s = load(&d.join("status.json"))?;
            if let Ok(b) = fs::read(d.join("upload.log")) {
                s["log_tail"] = json!(String::from_utf8_lossy(&b[b.len().saturating_sub(12000)..]));
            }
            Ok(s)
        }
        "prepare" => prepare(a),
        "start" => start(a),
        _ => Err("Unknown flash action".into()),
    }
}
fn prepare(a: &Value) -> Result<Value, String> {
    let aid = field(a, "artifact_id")?;
    let (m, _, _) = artifact(aid)?;
    let p = port(field(a, "port")?)?;
    let d = bridge("/diagnostics")?;
    let vehicle = m
        .pointer("/request/vehicle_id")
        .and_then(Value::as_str)
        .ok_or("Firmware manifest lacks vehicle")?;
    let ident = live(&d, m["board_id"].as_u64().unwrap() as u32, vehicle)?;
    let params = bridge("/params")?;
    need(
        all_params(
            &params,
            d.pointer("/params/expected")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize,
        ),
        "Parameter backup is incomplete",
    )?;
    need(
        live(
            &bridge("/diagnostics")?,
            m["board_id"].as_u64().unwrap() as u32,
            vehicle,
        )? == ident,
        "Vehicle changed during backup",
    )?;
    let id = Uuid::new_v4().simple().to_string();
    let dir = local("flash-plans", &id)?;
    save(&dir.join("parameters.json"), &params)?;
    let backup = dir.join("parameters.param");
    fs::write(
        &backup,
        params
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| format!("{k},{}\n", v.as_f64().unwrap()))
            .collect::<String>(),
    )
    .map_err(|e| e.to_string())?;
    save(&dir.join("diagnostics.json"), &d)?;
    let plan = json!({"plan_id":id,"artifact_id":aid,"port":p,"identity":ident,"expires_at":now()+600.,"backup":backup.display().to_string(),"confirmation":format!("FLASH {id}"),"firmware":m,"next_step":"Review firmware and USB device. start_bootloader requires this confirmation and a fresh disarmed heartbeat. The native uploader will wait for the ArduPilot serial bootloader. DFU is not supported."});
    save(&dir.join("plan.json"), &plan)?;
    save(
        &dir.join("status.json"),
        &json!({"state":"prepared","plan_id":id}),
    )?;
    Ok(plan)
}
fn start(a: &Value) -> Result<Value, String> {
    let id = field(a, "plan_id")?;
    let d = local("flash-plans", id)?;
    let p = load(&d.join("plan.json"))?;
    need(
        a["confirmation"] == p["confirmation"],
        "Explicit flash confirmation does not match this plan",
    )?;
    need(
        now() < p["expires_at"].as_f64().unwrap_or(0.),
        "Flash plan expired; prepare again",
    )?;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(d.join("started"))
        .map_err(|_| "This flash plan has already been used".to_string())?;
    let (m, _, _) = artifact(p["artifact_id"].as_str().ok_or("Plan artifact")?)?;
    let current = port(
        p.pointer("/port/port")
            .and_then(Value::as_str)
            .ok_or("Plan USB port")?,
    )?;
    let expected: Port =
        serde_json::from_value(p["port"].clone()).map_err(|_| "Plan USB identity")?;
    need(current == expected, "USB device changed; prepare again")?;
    need(
        live(
            &bridge("/diagnostics")?,
            m["board_id"].as_u64().unwrap() as u32,
            m.pointer("/request/vehicle_id")
                .and_then(Value::as_str)
                .ok_or("Manifest vehicle")?,
        )? == p["identity"],
        "Connected vehicle changed",
    )?;
    let lock = root().join("flash.lock");
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .map_err(|_| {
            "Another firmware operation is active or an interrupted upload requires recovery"
        })?;
    save(
        &d.join("status.json"),
        &json!({"state":"waiting_for_bootloader","plan_id":id}),
    )?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(d.join("upload.log"))
        .map_err(|e| e.to_string())?;
    let mut c = Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
    c.args(["--firmware-worker", id])
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    let child = c.spawn().map_err(|e| {
        let _ = fs::remove_file(&lock);
        e.to_string()
    })?;
    Ok(
        json!({"state":"started","plan_id":id,"pid":child.id(),"next_step":p["next_step"],"status_action":"status"}),
    )
}

#[cfg(not(target_os = "android"))]
struct Boot {
    port: Box<dyn serialport::SerialPort>,
    rev: u32,
    board: u32,
    flash: u32,
}
#[cfg(not(target_os = "android"))]
impl Boot {
    fn open(name: &str) -> Result<Self, String> {
        let port = serialport::new(name, 115200)
            .timeout(Duration::from_secs(2))
            .open()
            .map_err(|e| e.to_string())?;
        port.clear(serialport::ClearBuffer::All)
            .map_err(|e| e.to_string())?;
        let mut b = Self {
            port,
            rev: 0,
            board: 0,
            flash: 0,
        };
        b.sync()?;
        b.rev = b.info(1)?;
        need(
            (2..=5).contains(&b.rev),
            format!("Unsupported bootloader protocol {}", b.rev),
        )?;
        // External-flash size is optional. A timeout leaves a late reply in the
        // buffer, so resync before the next command, as the reference uploader does.
        if b.info(6).is_err() {
            b.port
                .clear(serialport::ClearBuffer::Input)
                .map_err(|e| e.to_string())?;
            b.sync()?;
        }
        b.board = b.info(2)?;
        let _ = b.info(3)?;
        b.flash = b.info(4)?;
        Ok(b)
    }
    fn write(&mut self, x: &[u8]) -> Result<(), String> {
        self.port.write_all(x).map_err(|e| e.to_string())
    }
    fn exact(&mut self, n: usize) -> Result<Vec<u8>, String> {
        let mut x = vec![0; n];
        self.port
            .read_exact(&mut x)
            .map_err(|e| format!("Bootloader timeout: {e}"))?;
        Ok(x)
    }
    fn reply(&mut self) -> Result<(), String> {
        let x = self.exact(2)?;
        need(
            x[0] == 0x12,
            format!("Unexpected bootloader sync byte 0x{:02x}", x[0]),
        )?;
        match x[1] {
            0x10 => Ok(()),
            0x11 => Err("Bootloader reports operation failed".into()),
            0x13 => Err("Bootloader reports invalid operation".into()),
            v => Err(format!("Unexpected bootloader status 0x{v:02x}")),
        }
    }
    fn sync(&mut self) -> Result<(), String> {
        self.port
            .clear(serialport::ClearBuffer::Input)
            .map_err(|e| e.to_string())?;
        self.write(&[0x21, 0x20])?;
        self.reply()
    }
    fn try_sync(&mut self) -> Result<bool, String> {
        let x = match self.exact(2) {
            Ok(x) => x,
            Err(_) => return Ok(false),
        };
        if x[0] != 0x12 {
            return Ok(false);
        }
        match x[1] {
            0x10 => Ok(true),
            0x11 | 0x13 => Err("Bootloader reports operation failed".into()),
            v => Err(format!("Unexpected bootloader status 0x{v:02x}")),
        }
    }
    fn info(&mut self, k: u8) -> Result<u32, String> {
        self.write(&[0x22, k, 0x20])?;
        let x = self.exact(4)?;
        self.sync()?;
        Ok(u32::from_le_bytes(x.try_into().unwrap()))
    }
    fn upload(&mut self, img: &Image) -> Result<(), String> {
        self.write(&[0x23, 0x20])?;
        let end = std::time::Instant::now() + Duration::from_secs(20);
        while std::time::Instant::now() < end {
            if self.try_sync()? {
                break;
            }
        }
        if std::time::Instant::now() >= end {
            return Err("Timed out waiting for erase".into());
        }
        for x in img.bytes.chunks(252) {
            self.write(&[0x27, x.len() as u8])?;
            self.write(x)?;
            self.write(&[0x20])?;
            self.reply()?
        }
        if self.rev == 2 {
            for x in img.bytes.chunks(252) {
                self.write(&[0x28, x.len() as u8, 0x20])?;
                need(self.exact(x.len())? == x, "Firmware verification failed")?;
                self.sync()?
            }
        } else {
            self.write(&[0x29, 0x20])?;
            let got = u32::from_le_bytes(self.exact(4)?.try_into().unwrap());
            self.sync()?;
            need(
                got == crc(&img.bytes, self.flash as usize),
                "Firmware CRC verification failed",
            )?
        }
        self.write(&[0x30, 0x20])?;
        if self.rev >= 3 {
            self.reply()?
        }
        Ok(())
    }
}
#[cfg(target_os = "android")]
struct Boot;
fn crc(image: &[u8], flash: usize) -> u32 {
    let mut s = 0u32;
    for b in image
        .iter()
        .copied()
        .chain(std::iter::repeat(0xff).take(flash.saturating_sub(image.len())))
    {
        s ^= b as u32;
        for _ in 0..8 {
            s = if s & 1 != 0 {
                (s >> 1) ^ 0xedb88320
            } else {
                s >> 1
            }
        }
    }
    s
}
pub fn run_worker(id: &str) -> Result<(), String> {
    let dir = local("flash-plans", id)?;
    let mut programming = false;
    let result = (|| -> Result<(), String> {
        let plan = load(&dir.join("plan.json"))?;
        let (m, img, _) = artifact(plan["artifact_id"].as_str().ok_or("Plan artifact")?)?;
        let target: Port =
            serde_json::from_value(plan["port"].clone()).map_err(|_| "Plan USB identity")?;
        let deadline = std::time::Instant::now() + Duration::from_secs(60);
        let mut last = "Bootloader not found".into();
        let mut dev = None;
        while std::time::Instant::now() < deadline {
            match port(&target.port).and_then(|p| {
                need(
                    p.vid == target.vid && p.serial_number == target.serial_number,
                    "USB identity mismatch",
                )?;
                Boot::open(&p.port)
            }) {
                Ok(x) => {
                    dev = Some(x);
                    break;
                }
                Err(e) => {
                    last = e;
                    std::thread::sleep(Duration::from_millis(500))
                }
            }
        }
        let mut dev = dev.ok_or_else(|| format!("Bootloader timeout: {last}"))?;
        need(
            dev.board == m["board_id"].as_u64().unwrap_or(0) as u32,
            "Bootloader board ID mismatch; erase refused",
        )?;
        need(
            dev.flash as usize >= img.bytes.len(),
            "Firmware does not fit in bootloader flash space; erase refused",
        )?;
        save(
            &dir.join("status.json"),
            &json!({"state":"programming","plan_id":id,"board_id":dev.board,"flash_size":dev.flash}),
        )?;
        programming = true;
        dev.upload(&img)?;
        save(
            &dir.join("status.json"),
            &json!({"state":"written_verified","plan_id":id,"sha256":m["sha256"],"next_step":"Reconnect and verify firmware, parameters, sensors, modes and pre-arm checks. Flight readiness is not established."}),
        )?;
        if let (Some(artifact_id), Some(vehicle)) = (
            m["artifact_id"].as_str(),
            m.pointer("/request/vehicle_id").and_then(Value::as_str),
        ) {
            let _ = crate::db::note_flashed(&plan["identity"], artifact_id, vehicle);
        }
        Ok(())
    })();
    if let Err(e) = result {
        let _ = save(
            &dir.join("status.json"),
            &json!({"state":"failed","plan_id":id,"error":e,"programming_started":programming}),
        );
    }
    let _ = fs::remove_file(root().join("flash.lock"));
    Ok(())
}
#[allow(dead_code)] // The stable MCP schemas are exposed from firmware.rs.
pub fn tools() -> Vec<Value> {
    vec![
        json!({"name":"ardupilot_firmware_catalog","description":concat!(
            "Read the official custom.ardupilot.org catalog. ",
            "No device changes.",
        ),"inputSchema":{"type":"object","required":["resource"],"properties":{"resource":{"type":"string","enum":["vehicles","versions","boards","features","standard_artifacts"]},"vehicle_id":{"type":"string"},"version_id":{"type":"string"},"board_id":{"type":"string"}}}}),
        json!({"name":"ardupilot_firmware_build","description":concat!(
            "Plan, submit, inspect and download a custom firmware build through the official service. ",
            "The native client validates APJ images and records SHA-256. ",
            "Does not flash.",
        ),"inputSchema":{"type":"object","required":["action"],"properties":{"action":{"type":"string","enum":["plan","submit","status","logs","download"]},"vehicle_id":{"type":"string"},"version_id":{"type":"string"},"board_id":{"type":"string"},"enable":{"type":"array","items":{"type":"string"}},"disable":{"type":"array","items":{"type":"string"}},"plan_id":{"type":"string"},"build_id":{"type":"string"},"tail":{"type":"integer"}}}}),
        json!({"name":"ardupilot_firmware_flash","description":concat!(
            "Native Rust ArduPilot serial-bootloader flashing. ",
            "No Python, pyserial or ArduPilot checkout is required. ",
            "DFU and UDP flashing are not supported.",
        ),"inputSchema":{"type":"object","required":["action"],"properties":{"action":{"type":"string","enum":["ports","prepare","start_bootloader","status"]},"artifact_id":{"type":"string"},"port":{"type":"string"},"plan_id":{"type":"string"},"confirmation":{"type":"string"}}}}),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_dependencies_are_closed() {
        let features = vec![
            json!({"id":"FLOW","default":{"enabled":true},"dependencies":[]}),
            json!({"id":"FLOWHOLD","default":{"enabled":false},"dependencies":["FLOW"]}),
        ];
        assert_eq!(
            resolve(&features, vec!["FLOWHOLD".into()], vec![], None).unwrap()["selected_features"],
            json!(["FLOW", "FLOWHOLD"])
        );
    }

    #[test]
    fn plan_keeps_an_existing_feature_set() {
        let features = vec![
            json!({"id":"A","default":{"enabled":true},"dependencies":[]}),
            json!({"id":"B","default":{"enabled":false},"dependencies":[]}),
            json!({"id":"C","default":{"enabled":false},"dependencies":[]}),
        ];
        let selected = resolve(&features, vec!["C".into()], vec![], Some(vec!["A".into(), "B".into()])).unwrap();
        assert_eq!(selected["selected_features"], json!(["A", "B", "C"]));
    }

    #[test]
    fn bootloader_crc_matches_reference() {
        assert_eq!(crc(&[1, 2, 3, 4], 4), 0x9778_24d1);
    }

    fn tiny_apj() -> Vec<u8> {
        use flate2::write::ZlibEncoder;
        use flate2::Compression;
        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&[0x11, 0x22, 0x33, 0x44]).unwrap();
        let image = base64::engine::general_purpose::STANDARD.encode(enc.finish().unwrap());
        serde_json::to_vec(&json!({
            "board_id": 1081,
            "magic": "APJFWv1",
            "description": "Firmware for a STM32F405xx board",
            "image": image,
            "image_size": 4,
            "summary": "JHEM_JHEF405",
            "git_identity": "37ea692e",
            "extf_image_size": 0
        }))
        .unwrap()
    }

    #[test]
    fn local_apj_is_staged_with_board_and_hash() {
        let dir = std::env::temp_dir().join(format!("arduloops-apj-{}", Uuid::new_v4()));
        let bytes = tiny_apj();
        let manifest = stage_local(&bytes, "copter", &dir).unwrap();
        assert_eq!(manifest["board_id"], 1081);
        assert_eq!(manifest["request"]["vehicle_id"], "copter");
        assert_eq!(manifest["request"]["board_id"], "JHEM_JHEF405");
        assert_eq!(manifest["git_identity"], "37ea692e");
        assert_eq!(manifest["sha256"], sha(&bytes));
        assert_eq!(manifest["request"]["selected_features"], json!([]));
        let stored = fs::read(
            dir.join("artifacts")
                .join(manifest["artifact_id"].as_str().unwrap())
                .join("firmware.apj"),
        )
        .unwrap();
        assert_eq!(stored, bytes);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn local_apj_rejects_a_plain_file() {
        let dir = std::env::temp_dir().join(format!("arduloops-apj-{}", Uuid::new_v4()));
        assert!(stage_local(b"not firmware", "copter", &dir).is_err());
        assert_eq!(
            stage_local(b"{}", "copter", &dir).unwrap_err(),
            "Not an ArduPilot APJ firmware"
        );
        assert_eq!(
            stage_local(&tiny_apj(), "rover", &dir).unwrap_err(),
            "Vehicle must be copter or plane"
        );
        let _ = fs::remove_dir_all(dir);
    }
}
