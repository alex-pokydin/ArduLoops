// Lua scripts on the vehicle, over MAVLink file transfer.
// SITL keeps them in ./scripts. A board keeps them in /APM/scripts.

const OP_TERMINATE: u8 = 1;
const OP_RESET: u8 = 2;
const OP_LIST: u8 = 3;
const OP_OPEN_RO: u8 = 4;
const OP_READ: u8 = 5;
const OP_CREATE: u8 = 6;
const OP_WRITE: u8 = 7;
const OP_REMOVE: u8 = 8;
const OP_MKDIR: u8 = 9;
const OP_ACK: u8 = 128;
const OP_NAK: u8 = 129;
const ERR_EOF: u8 = 6;
const ERR_FAIL_ERRNO: u8 = 2;
const ERR_NOT_FOUND: u8 = 10;
const DATA_MAX: usize = 239;
const SCRIPT_MAX: usize = 96 * 1024;
const ROOTS: &[&str] = &["scripts", "/APM/scripts", "APM/scripts"];

#[derive(Debug)]
pub enum ScriptJob {
    List,
    Read { name: String },
    Write { name: String, body: String },
    Delete { name: String },
    Restart,
}

pub fn script_file_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.len() < 5 || name.len() > 64 || !name.to_ascii_lowercase().ends_with(".lua") {
        return Err("Script name must end with .lua and be at most 64 characters".into());
    }
    let stem = &name[..name.len() - 4];
    if stem.is_empty() || stem.starts_with('.') || name.contains("..") {
        return Err("Script name must end with .lua".into());
    }
    if !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.') {
        return Err("Script name may use letters, digits, underscore, hyphen, and dot".into());
    }
    Ok(name.to_string())
}

struct DirEntry {
    kind: char,
    name: String,
    bytes: u64,
}

fn parse_dir_entries(buf: &[u8]) -> Vec<DirEntry> {
    let mut out = Vec::new();
    for raw in buf.split(|b| *b == 0) {
        if raw.is_empty() {
            continue;
        }
        let kind = raw[0] as char;
        let text = String::from_utf8_lossy(&raw[1..]);
        let mut parts = text.split('\t');
        let name = parts.next().unwrap_or("").trim().to_string();
        let bytes = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        if name.is_empty() {
            continue;
        }
        out.push(DirEntry { kind, name, bytes });
    }
    out
}

fn nak_text(code: u8) -> String {
    match code {
        5 => "File transfer is busy".into(),
        7 => "This vehicle has no file transfer".into(),
        ERR_NOT_FOUND => "Script was not found".into(),
        _ => format!("File transfer refused ({code})"),
    }
}

struct Reply {
    opcode: u8,
    data: Vec<u8>,
}

struct Ftp<'a> {
    conn: &'a dyn MavConnection<MavMessage>,
    st: &'a mut LinkState,
    on_sample: &'a OnSample,
    latest: &'a std::sync::Mutex<Sample>,
    sitl: &'a SitlCtl,
    seq: u16,
    session: u8,
    last_emit: Instant,
}

fn next_session() -> u8 {
    static SESSION: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(1);
    loop {
        let id = SESSION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        if id != 0 {
            return id;
        }
    }
}

impl<'a> Ftp<'a> {
    fn exchange(&mut self, opcode: u8, data: &[u8], offset: u32, size: u8) -> Result<Reply, String> {
        let seq = self.seq;
        self.seq = self.seq.wrapping_add(1);
        let mut payload = [0u8; 251];
        payload[0..2].copy_from_slice(&seq.to_le_bytes());
        payload[2] = self.session;
        payload[3] = opcode;
        payload[4] = size;
        payload[8..12].copy_from_slice(&offset.to_le_bytes());
        let n = data.len().min(DATA_MAX);
        payload[12..12 + n].copy_from_slice(&data[..n]);
        send_msg(
            self.conn,
            &MavMessage::FILE_TRANSFER_PROTOCOL(mavlink::ardupilotmega::FILE_TRANSFER_PROTOCOL_DATA {
                target_network: 0,
                target_system: self.st.target_system,
                target_component: self.st.target_component,
                payload,
            }),
        );
        let deadline = Instant::now() + Duration::from_millis(2500);
        while Instant::now() < deadline {
            match self.conn.recv() {
                Ok((hdr, msg)) => {
                    let ftp = match &msg {
                        MavMessage::FILE_TRANSFER_PROTOCOL(v) => Some(v.payload),
                        _ => None,
                    };
                    // High-rate telemetry must not be decoded here. That copy
                    // falls behind the socket, and the file-transfer reply
                    // stays stuck behind it until this wait gives up.
                    if matches!(
                        &msg,
                        MavMessage::STATUSTEXT(_) | MavMessage::HEARTBEAT(_) | MavMessage::COMMAND_ACK(_)
                    ) {
                        handle_msg(self.st, &hdr, msg);
                    }
                    if self.last_emit.elapsed() >= Duration::from_millis(200) {
                        emit_sample(self.on_sample, self.latest, self.st, self.sitl);
                        self.last_emit = Instant::now();
                    }
                    if let Some(payload) = ftp {
                        let got = u16::from_le_bytes([payload[0], payload[1]]);
                        if payload[2] == self.session && got == seq.wrapping_add(1) {
                            let size = payload[4] as usize;
                            return Ok(Reply {
                                opcode: payload[3],
                                data: payload[12..12 + size.min(DATA_MAX)].to_vec(),
                            });
                        }
                    }
                }
                Err(mavlink::error::MessageReadError::Io(err))
                    if err.kind() == std::io::ErrorKind::TimedOut
                        || err.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => return Err("Connection lost during file transfer".into()),
            }
        }
        Err("The vehicle did not answer file transfer".into())
    }

    fn reset(&mut self) -> Result<(), String> {
        let reply = self.exchange(OP_RESET, &[], 0, 0)?;
        if reply.opcode == OP_NAK {
            return Err(nak_text(reply.data.first().copied().unwrap_or(0)));
        }
        Ok(())
    }

    fn list_page(&mut self, path: &str, offset: u32) -> Result<Vec<DirEntry>, ListEnd> {
        let reply = self
            .exchange(OP_LIST, path.as_bytes(), offset, path.len() as u8)
            .map_err(ListEnd::Fail)?;
        if reply.opcode == OP_NAK {
            let code = reply.data.first().copied().unwrap_or(0);
            return Err(match code {
                ERR_EOF => ListEnd::Eof,
                ERR_FAIL_ERRNO | ERR_NOT_FOUND => ListEnd::Missing,
                _ => ListEnd::Fail(nak_text(code)),
            });
        }
        if reply.opcode != OP_ACK {
            return Err(ListEnd::Fail("File transfer refused".into()));
        }
        Ok(parse_dir_entries(&reply.data))
    }

    fn find_root(&mut self) -> Result<(&'static str, bool), String> {
        self.reset()?;
        for path in ROOTS {
            match self.list_page(path, 0) {
                Ok(_) | Err(ListEnd::Eof) => return Ok((*path, true)),
                Err(ListEnd::Missing) => continue,
                Err(ListEnd::Fail(message)) => return Err(message),
            }
        }
        Ok(("scripts", false))
    }

    fn list_lua(&mut self, path: &str) -> Result<Vec<serde_json::Value>, String> {
        let mut offset = 0u32;
        let mut files = Vec::new();
        loop {
            match self.list_page(path, offset) {
                Ok(page) => {
                    if page.is_empty() {
                        break;
                    }
                    offset += page.len() as u32;
                    for entry in page {
                        // "." and ".." still count toward the next offset. The
                        // vehicle skips that many directory entries, not files.
                        if entry.name == "." || entry.name == ".." {
                            continue;
                        }
                        if entry.kind == 'F' && script_file_name(&entry.name).is_ok() {
                            files.push(serde_json::json!({ "name": entry.name, "bytes": entry.bytes }));
                        }
                    }
                    if offset > 4_000 {
                        break;
                    }
                }
                Err(ListEnd::Eof) => break,
                Err(ListEnd::Missing) => return Err("Scripts directory was not found".into()),
                Err(ListEnd::Fail(message)) => return Err(message),
            }
        }
        files.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
        Ok(files)
    }

    fn read_file(&mut self, path: &str) -> Result<Vec<u8>, String> {
        let outcome = self.read_open(path);
        let _ = self.exchange(OP_TERMINATE, &[], 0, 0);
        outcome
    }

    fn read_open(&mut self, path: &str) -> Result<Vec<u8>, String> {
        let open = self.exchange(OP_OPEN_RO, path.as_bytes(), 0, path.len() as u8)?;
        if open.opcode == OP_NAK {
            return Err(nak_text(open.data.first().copied().unwrap_or(0)));
        }
        let total = if open.data.len() >= 4 {
            u32::from_le_bytes([open.data[0], open.data[1], open.data[2], open.data[3]]) as usize
        } else {
            0
        };
        if total > SCRIPT_MAX {
            return Err("Script is larger than 96 KB".into());
        }
        let mut out = Vec::with_capacity(total);
        while out.len() < total {
            let want = (total - out.len()).min(DATA_MAX) as u8;
            let page = self.exchange(OP_READ, &[], out.len() as u32, want)?;
            if page.opcode == OP_NAK {
                let code = page.data.first().copied().unwrap_or(0);
                if code == ERR_EOF {
                    break;
                }
                return Err(nak_text(code));
            }
            if page.data.is_empty() {
                break;
            }
            out.extend_from_slice(&page.data);
        }
        Ok(out)
    }

    fn write_file(&mut self, path: &str, body: &[u8]) -> Result<(), String> {
        let outcome = self.write_open(path, body);
        let _ = self.exchange(OP_TERMINATE, &[], 0, 0);
        outcome
    }

    fn write_open(&mut self, path: &str, body: &[u8]) -> Result<(), String> {
        let created = self.exchange(OP_CREATE, path.as_bytes(), 0, path.len() as u8)?;
        if created.opcode == OP_NAK {
            return Err(nak_text(created.data.first().copied().unwrap_or(0)));
        }
        let mut offset = 0usize;
        while offset < body.len() {
            let n = (body.len() - offset).min(DATA_MAX);
            let page = self.exchange(OP_WRITE, &body[offset..offset + n], offset as u32, n as u8)?;
            if page.opcode == OP_NAK {
                return Err(nak_text(page.data.first().copied().unwrap_or(0)));
            }
            offset += n;
        }
        Ok(())
    }

    fn remove_file(&mut self, path: &str) -> Result<(), String> {
        let reply = self.exchange(OP_REMOVE, path.as_bytes(), 0, path.len() as u8)?;
        if reply.opcode == OP_NAK {
            return Err(nak_text(reply.data.first().copied().unwrap_or(0)));
        }
        Ok(())
    }

    fn mkdir(&mut self, path: &str) -> Result<(), String> {
        let reply = self.exchange(OP_MKDIR, path.as_bytes(), 0, path.len() as u8)?;
        if reply.opcode == OP_NAK {
            let code = reply.data.first().copied().unwrap_or(0);
            if code != ERR_FAIL_ERRNO {
                return Err(nak_text(code));
            }
        }
        Ok(())
    }
}

enum ListEnd {
    Eof,
    Missing,
    Fail(String),
}

fn script_path(root: &str, name: &str) -> String {
    format!("{}/{}", root.trim_end_matches('/'), name)
}

fn run_script_job(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    job: ScriptJob,
    on_sample: &OnSample,
    latest: &std::sync::Mutex<Sample>,
    sitl: &SitlCtl,
) -> Result<serde_json::Value, String> {
    if !st.sample.ok {
        return Err("Disconnected".into());
    }
    if let ScriptJob::Restart = job {
        return reload_scripts(conn, st, on_sample, latest, sitl);
    }
    let mut ftp = Ftp {
        conn,
        st,
        on_sample,
        latest,
        sitl,
        seq: 1,
        session: next_session(),
        last_emit: Instant::now(),
    };
    match job {
        ScriptJob::List => {
            let (root, exists) = ftp.find_root()?;
            if !exists {
                return Ok(serde_json::json!({ "files": [] }));
            }
            let files = ftp.list_lua(root)?;
            Ok(serde_json::json!({ "files": files }))
        }
        ScriptJob::Read { name } => {
            let name = script_file_name(&name)?;
            let (root, exists) = ftp.find_root()?;
            if !exists {
                return Err("Script was not found".into());
            }
            let bytes = ftp.read_file(&script_path(root, &name))?;
            let body = String::from_utf8(bytes).map_err(|_| "Script is not UTF-8 text".to_string())?;
            Ok(serde_json::json!({ "name": name, "body": body, "bytes": body.len() }))
        }
        ScriptJob::Write { name, body } => {
            let name = script_file_name(&name)?;
            if body.len() > SCRIPT_MAX {
                return Err("Script is larger than 96 KB".into());
            }
            if body.contains('\0') {
                return Err("Script must be text".into());
            }
            let (root, exists) = ftp.find_root()?;
            if !exists {
                ftp.mkdir(root)?;
            }
            ftp.write_file(&script_path(root, &name), body.as_bytes())?;
            Ok(serde_json::json!({ "ok": true, "name": name, "bytes": body.len() }))
        }
        ScriptJob::Delete { name } => {
            let name = script_file_name(&name)?;
            let (root, exists) = ftp.find_root()?;
            if !exists {
                return Err("Script was not found".into());
            }
            ftp.remove_file(&script_path(root, &name))?;
            Ok(serde_json::json!({ "ok": true, "name": name }))
        }
        ScriptJob::Restart => unreachable!(),
    }
}

fn reload_scripts(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    on_sample: &OnSample,
    latest: &std::sync::Mutex<Sample>,
    sitl: &SitlCtl,
) -> Result<serde_json::Value, String> {
    command_long(
        conn,
        st.target_system,
        st.target_component,
        mavlink::ardupilotmega::MavCmd::MAV_CMD_SCRIPTING,
        3.0,
        0.0,
    );
    let deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < deadline {
        match conn.recv() {
            Ok((hdr, msg)) => {
                let ack = if hdr.system_id == st.target_system && hdr.component_id == st.target_component {
                    if let MavMessage::COMMAND_ACK(v) = &msg {
                        (v.command == mavlink::ardupilotmega::MavCmd::MAV_CMD_SCRIPTING).then_some(v.result as u8)
                    } else {
                        None
                    }
                } else {
                    None
                };
                handle_msg(st, &hdr, msg);
                emit_sample(on_sample, latest, st, sitl);
                if let Some(code) = ack {
                    if code == 0 {
                        return Ok(serde_json::json!({ "ok": true }));
                    }
                    if code != 5 {
                        return Err("The vehicle refused to reload scripts".into());
                    }
                }
            }
            Err(mavlink::error::MessageReadError::Io(err))
                if err.kind() == std::io::ErrorKind::TimedOut
                    || err.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => return Err("Connection lost during reload".into()),
        }
    }
    Err("The vehicle did not answer the reload".into())
}

pub fn scripting_flags(sample: &Sample) -> serde_json::Value {
    let compiled = sample.params.contains_key("SCR_ENABLE");
    let enable = sample.params.get("SCR_ENABLE").copied().unwrap_or(0.0);
    let complete = sample.param_count > 0 && sample.param_indices.len() >= sample.param_count as usize;
    serde_json::json!({
        "linked": sample.ok,
        "params_complete": complete,
        "compiled": compiled,
        "enabled": compiled && enable != 0.0,
        "heap": sample.params.get("SCR_HEAP_SIZE").copied(),
    })
}
