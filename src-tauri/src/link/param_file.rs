// Every parameter in one file over MAVLink file transfer, as Mission Planner does.
// ArduPilot 4.1+ serves `@PARAM/param.pck` (AP_Filesystem_Param.cpp). A vehicle
// without it keeps the PARAM_REQUEST_READ path in `fill_missing_params`.

const PARAM_FILE: &str = "@PARAM/param.pck";
const OP_BURST_READ: u8 = 15;
const PCK_MAGIC: u16 = 0x671b;
const PCK_MAGIC_DEFAULTS: u16 = 0x671c;
/// A slow radio link still finishes well inside this; the ATTITUDE watchdog is 12 s.
const PARAM_FILE_BUDGET: Duration = Duration::from_secs(10);
const PARAM_FILE_MAX: usize = 256 * 1024;

#[derive(Debug, PartialEq)]
struct ParamPack {
    /// Parameters on the vehicle (`param_count` in PARAM_VALUE).
    total: u16,
    /// In index order from 0, so the position is the parameter index.
    values: Vec<(String, f64)>,
}

/// Packed format: header `magic u16, num_params u16, total_params u16`, then per parameter
/// `type:4 flags:4, common_len:4 name_len-1:4, name bytes, value` (value twice when flag bit 0
/// says a default follows). Zero bytes before an entry are padding.
fn parse_param_pack(buf: &[u8]) -> Result<ParamPack, String> {
    if buf.len() < 6 {
        return Err("Parameter file is too short".into());
    }
    let word = |i: usize| u16::from_le_bytes([buf[i], buf[i + 1]]);
    let magic = word(0);
    if magic != PCK_MAGIC && magic != PCK_MAGIC_DEFAULTS {
        return Err(format!("Parameter file has an unknown header {magic:#06x}"));
    }
    let num = word(2) as usize;
    let total = word(4);
    let mut values = Vec::with_capacity(num);
    let mut last = String::new();
    let mut at = 6;
    while values.len() < num {
        while at < buf.len() && buf[at] == 0 {
            at += 1;
        }
        if at + 2 > buf.len() {
            break;
        }
        let kind = buf[at] & 0x0f;
        let with_default = buf[at] >> 4 & 1 == 1;
        let common = (buf[at + 1] & 0x0f) as usize;
        let name_len = (buf[at + 1] >> 4) as usize + 1;
        at += 2;
        let size = match kind {
            1 => 1,
            2 => 2,
            3 | 4 => 4,
            _ => return Err(format!("Parameter file has an unknown type {kind}")),
        };
        if common > last.len() || at + name_len + size > buf.len() {
            break;
        }
        let mut name = last[..common].to_string();
        name.push_str(&String::from_utf8_lossy(&buf[at..at + name_len]));
        at += name_len;
        let raw = &buf[at..at + size];
        let value = match kind {
            1 => raw[0] as i8 as f64,
            2 => i16::from_le_bytes([raw[0], raw[1]]) as f64,
            3 => i32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]) as f64,
            _ => f32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]) as f64,
        };
        at += size * if with_default { 2 } else { 1 };
        last = name.clone();
        values.push((name, value));
    }
    Ok(ParamPack { total, values })
}

/// What a burst left: the pieces by offset, and where the file ends when the vehicle said so.
#[derive(Default)]
struct Burst {
    pieces: std::collections::BTreeMap<u32, Vec<u8>>,
    eof: Option<u32>,
    /// Parameters already stored while the file was still arriving.
    applied: usize,
    shown_at: Option<Instant>,
}

impl Burst {
    /// The first offset with no data yet, from the start.
    fn first_gap(&self) -> u32 {
        let mut at = 0u32;
        for (offset, data) in &self.pieces {
            if *offset > at {
                break;
            }
            at = at.max(offset + data.len() as u32);
        }
        at
    }

    /// The file from the start up to the first gap. Pieces may overlap when a burst restarts.
    fn bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for (offset, data) in &self.pieces {
            let (offset, done) = (*offset as usize, out.len());
            if offset <= done && offset + data.len() > done {
                out.extend_from_slice(&data[done - offset..]);
            }
        }
        out
    }
}

impl<'a> Ftp<'a> {
    /// Reads a file of unknown length to its end. The size from open is only an estimate for
    /// `param.pck`. The vehicle streams it in one burst; pieces lost on the way are read one by
    /// one. Every read asks for the same size, because `param.pck` pads values to that size.
    /// Returns the file, how many pieces needed a single read, and how many values are stored.
    fn read_to_end(&mut self, path: &str, deadline: Instant) -> Result<(Vec<u8>, usize, usize), String> {
        let open = self.exchange(OP_OPEN_RO, path.as_bytes(), 0, path.len() as u8)?;
        if open.opcode == OP_NAK {
            return Err(nak_text(open.data.first().copied().unwrap_or(0)));
        }
        let mut file = Burst::default();
        // A burst stops after 2000 packets or when the link goes quiet; the next one starts at
        // the first gap. Two that bring nothing new hand over to single reads.
        let mut idle_bursts = 0;
        while file.eof.is_none() && idle_bursts < 2 && Instant::now() < deadline {
            let before = file.pieces.len();
            if !self.burst(&mut file, deadline)? {
                break;
            }
            idle_bursts = if file.pieces.len() == before { idle_bursts + 1 } else { 0 };
        }
        let mut singles = 0;
        loop {
            // Out of time: keep what arrived whole; the by-index path reads the rest.
            if Instant::now() > deadline {
                break;
            }
            let at = file.first_gap();
            if file.eof.is_some_and(|end| at >= end) {
                break;
            }
            if at as usize > PARAM_FILE_MAX {
                return Err("Parameter file is too large".into());
            }
            // One lost packet is asked for again, not the whole file.
            singles += 1;
            let mut page = None;
            for _ in 0..3 {
                if let Ok(reply) = self.exchange(OP_READ, &[], at, DATA_MAX as u8) {
                    page = Some(reply);
                    break;
                }
            }
            let Some(page) = page else {
                break;
            };
            if page.opcode == OP_NAK {
                let code = page.data.first().copied().unwrap_or(0);
                if code != ERR_EOF {
                    return Err(nak_text(code));
                }
                file.eof = Some(at);
                break;
            }
            if page.data.is_empty() {
                file.eof = Some(at);
                break;
            }
            file.pieces.insert(at, page.data);
            self.show_progress(&mut file);
        }
        Ok((file.bytes(), singles, file.applied))
    }

    /// One burst read from the first gap: the vehicle sends packet after packet until the end
    /// of the file or 2000 packets, without a request for each. False when the vehicle refuses
    /// bursts, so single reads do the rest.
    fn burst(&mut self, file: &mut Burst, deadline: Instant) -> Result<bool, String> {
        let seq = self.seq;
        self.seq = self.seq.wrapping_add(1);
        let mut payload = [0u8; 251];
        payload[0..2].copy_from_slice(&seq.to_le_bytes());
        payload[2] = self.session;
        payload[3] = OP_BURST_READ;
        payload[4] = DATA_MAX as u8;
        payload[8..12].copy_from_slice(&file.first_gap().to_le_bytes());
        send_msg(
            self.conn,
            &MavMessage::FILE_TRANSFER_PROTOCOL(mavlink::ardupilotmega::FILE_TRANSFER_PROTOCOL_DATA {
                target_network: 0,
                target_system: self.st.target_system,
                target_component: self.st.target_component,
                payload,
            }),
        );
        let mut refused = false;
        let mut heard = Instant::now();
        let mut last_seq = seq;
        while heard.elapsed() < Duration::from_millis(1000) && Instant::now() < deadline {
            let Some(reply) = self.next_payload()? else {
                continue;
            };
            let got = u16::from_le_bytes([reply[0], reply[1]]);
            // Replies to this burst count up from its request.
            if reply[5] != OP_BURST_READ || got.wrapping_sub(seq) == 0 || got.wrapping_sub(seq) > 2001 {
                continue;
            }
            heard = Instant::now();
            last_seq = if got.wrapping_sub(seq) > last_seq.wrapping_sub(seq) { got } else { last_seq };
            let offset = u32::from_le_bytes([reply[8], reply[9], reply[10], reply[11]]);
            let size = (reply[4] as usize).min(DATA_MAX);
            if reply[3] == OP_NAK {
                if reply[12] == ERR_EOF {
                    file.eof = Some(offset);
                } else {
                    refused = true;
                }
                break;
            }
            if reply[3] == OP_ACK && size > 0 {
                file.pieces.insert(offset, reply[12..12 + size].to_vec());
                self.show_progress(file);
            }
            if reply[6] == 1 {
                break;
            }
        }
        // The vehicle answers a repeated sequence number with its last reply, so the next
        // request must not reuse one from this burst.
        self.seq = last_seq.wrapping_add(1);
        Ok(!refused)
    }

    /// Stores the parameters that have arrived whole, a few times a second, so the
    /// parameter bar fills while the file is still coming and pages can use early values.
    fn show_progress(&mut self, file: &mut Burst) {
        if file.shown_at.is_some_and(|at| at.elapsed() < Duration::from_millis(100)) {
            return;
        }
        file.shown_at = Some(Instant::now());
        if let Ok(pack) = parse_param_pack(&file.bytes()) {
            apply_pack(self.st, &pack, &mut file.applied);
        }
    }
}

/// Stores the values of a pack from `applied` on. The position in the file is the index.
fn apply_pack(st: &mut LinkState, pack: &ParamPack, applied: &mut usize) {
    // Count first, so the set is seen as complete when the last value lands.
    st.sample.param_count = pack.total;
    for (index, (name, value)) in pack.values.iter().enumerate().skip(*applied) {
        apply_param(st, name, *value, index as u16, pack.total);
    }
    *applied = (*applied).max(pack.values.len());
}

/// Downloads every parameter in one file and stores them as if each came by PARAM_VALUE.
/// Returns how many arrived and how many pieces needed a single read; an error leaves the by-index path to do the work.
fn download_param_file(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    on_sample: &OnSample,
    latest: &std::sync::Mutex<Sample>,
    sitl: &SitlCtl,
    budget: Duration,
) -> Result<(usize, usize), String> {
    let deadline = Instant::now() + budget;
    let (bytes, singles, mut applied) = {
        let mut ftp = Ftp {
            conn,
            st: &mut *st,
            on_sample,
            latest,
            sitl,
            seq: 1,
            session: next_session(),
            last_emit: Instant::now(),
            live: true,
            atts: 0,
            atts_from: Instant::now(),
            last_hb: Instant::now(),
            last_rc: Instant::now(),
            until: Some(deadline),
        };
        let outcome = ftp.reset().and_then(|_| ftp.read_to_end(PARAM_FILE, deadline));
        // Closing the session gets a short wait of its own after the budget.
        ftp.until = Some(Instant::now() + Duration::from_millis(500));
        let _ = ftp.exchange(OP_TERMINATE, &[], 0, 0);
        outcome?
    };
    let pack = parse_param_pack(&bytes)?;
    apply_pack(st, &pack, &mut applied);
    Ok((pack.values.len(), singles))
}
