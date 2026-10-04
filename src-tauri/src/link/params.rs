// Parameter reads, writes, and stream requests.


fn param_id(name: &str) -> [u8; 16] {
    let mut id = [0u8; 16];
    let bytes = name.as_bytes();
    let n = bytes.len().min(16);
    id[..n].copy_from_slice(&bytes[..n]);
    id
}

fn param_name(id: &[u8]) -> String {
    let end = id.iter().position(|&b| b == 0).unwrap_or(id.len());
    String::from_utf8_lossy(&id[..end]).trim().to_string()
}

fn frame_of(mavtype: MavType) -> String {
    match mavtype {
        MavType::MAV_TYPE_QUADROTOR
        | MavType::MAV_TYPE_COAXIAL
        | MavType::MAV_TYPE_HELICOPTER
        | MavType::MAV_TYPE_HEXAROTOR
        | MavType::MAV_TYPE_OCTOROTOR
        | MavType::MAV_TYPE_TRICOPTER
        | MavType::MAV_TYPE_DODECAROTOR => "copter".into(),
        MavType::MAV_TYPE_FIXED_WING
        | MavType::MAV_TYPE_FLAPPING_WING
        | MavType::MAV_TYPE_VTOL_TILTROTOR
        | MavType::MAV_TYPE_VTOL_TAILSITTER_DUOROTOR
        | MavType::MAV_TYPE_VTOL_TAILSITTER_QUADROTOR
        | MavType::MAV_TYPE_VTOL_FIXEDROTOR
        | MavType::MAV_TYPE_VTOL_TAILSITTER
        | MavType::MAV_TYPE_VTOL_TILTWING
        | MavType::MAV_TYPE_VTOL_RESERVED5 => "plane".into(),
        _ => String::new(),
    }
}

fn copter_mode(custom: u32) -> String {
    match custom {
        0 => "STABILIZE",
        1 => "ACRO",
        2 => "ALT_HOLD",
        3 => "AUTO",
        4 => "GUIDED",
        5 => "LOITER",
        6 => "RTL",
        7 => "CIRCLE",
        9 => "LAND",
        16 => "POSHOLD",
        17 => "BRAKE",
        22 => "FLOWHOLD",
        _ => return format!("mode{custom}"),
    }
    .into()
}

fn plane_mode(custom: u32) -> String {
    match custom {
        0 => "MANUAL",
        1 => "CIRCLE",
        2 => "STABILIZE",
        3 => "TRAINING",
        4 => "ACRO",
        5 => "FBWA",
        6 => "FBWB",
        7 => "CRUISE",
        8 => "AUTOTUNE",
        10 => "AUTO",
        11 => "RTL",
        12 => "LOITER",
        13 => "TAKEOFF",
        15 => "GUIDED",
        16 => "INIT",
        _ => return format!("mode{custom}"),
    }
    .into()
}

pub(crate) fn mode_custom(frame: &str, name: &str) -> Option<u32> {
    if frame == "plane" {
        return Some(match name {
            "MANUAL" => 0,
            "CIRCLE" => 1,
            "STABILIZE" => 2,
            "TRAINING" => 3,
            "ACRO" => 4,
            "FBWA" | "FLY_BY_WIRE_A" => 5,
            "FBWB" | "FLY_BY_WIRE_B" => 6,
            "CRUISE" => 7,
            "AUTOTUNE" => 8,
            "AUTO" => 10,
            "RTL" => 11,
            "LOITER" => 12,
            "TAKEOFF" => 13,
            "GUIDED" => 15,
            _ => return None,
        });
    }
    Some(match name {
        "STABILIZE" => 0,
        "ACRO" => 1,
        "ALT_HOLD" => 2,
        "AUTO" => 3,
        "GUIDED" => 4,
        "LOITER" => 5,
        "RTL" => 6,
        "CIRCLE" => 7,
        "LAND" => 9,
        "POSHOLD" => 16,
        "BRAKE" => 17,
        "FLOWHOLD" => 22,
        _ => return None,
    })
}

fn pwm(value: f64, default: i32) -> i32 {
    let n = if value.is_finite() {
        value.round() as i32
    } else {
        default
    };
    n.clamp(1000, 2000)
}

fn quat_roll_deg(q: &[f32]) -> Option<f64> {
    let (w, x, y, z) = (*q.get(0)?, *q.get(1)?, *q.get(2)?, *q.get(3)?);
    let sinr = 2.0 * (w * x + y * z);
    let cosr = 1.0 - 2.0 * (x * x + y * y);
    Some(sinr.atan2(cosr).to_degrees() as f64)
}

fn quat_pitch_deg(q: &[f32]) -> Option<f64> {
    let (w, x, y, z) = (*q.get(0)?, *q.get(1)?, *q.get(2)?, *q.get(3)?);
    let sinp = (2.0 * (w * y - z * x)).clamp(-1.0, 1.0);
    Some((sinp as f64).asin().to_degrees())
}

fn quat_yaw_deg(q: &[f32]) -> Option<f64> {
    let (w, x, y, z) = (*q.get(0)?, *q.get(1)?, *q.get(2)?, *q.get(3)?);
    let siny = 2.0 * (w * z + x * y);
    let cosy = 1.0 - 2.0 * (y * y + z * z);
    Some(siny.atan2(cosy).to_degrees() as f64)
}

fn header() -> MavHeader {
    MavHeader {
        system_id: 255,
        component_id: 190,
        sequence: 0,
    }
}

fn send_msg(conn: &dyn MavConnection<MavMessage>, msg: &MavMessage) {
    let _ = conn.send(&header(), msg);
}

fn command_long(
    conn: &dyn MavConnection<MavMessage>,
    sys: u8,
    comp: u8,
    command: MavCmd,
    p1: f32,
    p2: f32,
) {
    // param1 2 is "erase all parameters". Log erase is a different message
    // and must never be turned into this command.
    if command == MavCmd::MAV_CMD_PREFLIGHT_STORAGE && (p1.round() as i32) == 2 {
        return;
    }
    send_msg(
        conn,
        &MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
            param1: p1,
            param2: p2,
            param3: 0.0,
            param4: 0.0,
            param5: 0.0,
            param6: 0.0,
            param7: 0.0,
            command,
            target_system: sys,
            target_component: comp,
            confirmation: 0,
        }),
    );
}

fn pump_rx(conn: &dyn MavConnection<MavMessage>, st: &mut LinkState) {
    // Cap: SITL never idles (ATTITUDE ~50 Hz). An unbounded recv loop
    // would stall Init at 0/N after the first PARAM_SET.
    for _ in 0..8 {
        match conn.recv() {
            Ok((hdr, msg)) => handle_msg(st, &hdr, msg),
            Err(mavlink::error::MessageReadError::Io(err))
                if err.kind() == std::io::ErrorKind::TimedOut
                    || err.kind() == std::io::ErrorKind::WouldBlock =>
            {
                break;
            }
            Err(_) => break,
        }
    }
}

fn request_param_read(conn: &dyn MavConnection<MavMessage>, st: &LinkState, name: &str) {
    send_msg(
        conn,
        &MavMessage::PARAM_REQUEST_READ(PARAM_REQUEST_READ_DATA {
            param_index: -1,
            target_system: st.target_system,
            target_component: st.target_component,
            param_id: param_id(name),
        }),
    );
}

fn param_close(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.51
}

fn f32_same(a: f64, b: f64) -> bool {
    let x = a as f32;
    let y = b as f32;
    if x == y {
        return true;
    }
    let scale = 1.0 + x.abs().max(y.abs());
    (x - y).abs() <= 1e-4 * scale
}

#[derive(Clone, Serialize)]
pub struct RestoreReport {
    pub wrote: u32,
    pub unchanged: u32,
    pub missing: u32,
    pub failed: u32,
    pub refused: u32,
}

fn param_name_ok(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    name.len() <= 16 && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Mission Planner `.param` text: `NAME,value`, optional `#` comments.
pub fn parse_param_file(text: &str) -> Result<Vec<(String, f64)>, String> {
    let mut out: Vec<(String, f64)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for (line_no, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(cut) = line.find(|c: char| c == ',' || c == ' ' || c == '\t') else {
            return Err("This file is not a parameter backup".into());
        };
        let name = line[..cut].trim();
        if !param_name_ok(name) {
            return Err("This file is not a parameter backup".into());
        }
        let mut rest = line[cut + 1..].trim();
        if let Some(hash) = rest.find(" #") {
            rest = rest[..hash].trim();
        }
        let token = rest
            .split(|c: char| c == ',' || c == ' ' || c == '\t')
            .next()
            .unwrap_or("");
        let value: f64 = match token.parse::<f64>() {
            Ok(value) if value.is_finite() => value,
            _ => return Err(format!("Line {} has no number", line_no + 1)),
        };
        if let Some(&at) = index.get(name) {
            out[at].1 = value;
        } else {
            index.insert(name.to_string(), out.len());
            out.push((name.to_string(), value));
        }
    }
    if out.is_empty() {
        return Err("No parameters in this file".into());
    }
    if out.len() > 8000 {
        return Err("Too many parameters".into());
    }
    Ok(out)
}

fn write_param_confirmed(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    name: &str,
    value: f64,
) -> bool {
    let previous = st.sample.params.get(name).copied();
    if !send_param_set(conn, st.target_system, st.target_component, name, value) {
        return false;
    }
    st.sample.params.remove(name);
    let until = Instant::now() + Duration::from_millis(800);
    while Instant::now() < until {
        match conn.recv() {
            Ok((hdr, msg)) => {
                handle_msg(st, &hdr, msg);
                if st.sample.params.get(name).is_some_and(|got| f32_same(*got, value)) {
                    return true;
                }
            }
            Err(mavlink::error::MessageReadError::Io(err))
                if err.kind() == std::io::ErrorKind::TimedOut
                    || err.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }
    }
    if !st.sample.params.contains_key(name) {
        if let Some(previous) = previous {
            st.sample.params.insert(name.to_string(), previous);
        }
    }
    false
}

fn restore_params(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    values: &[(String, f64)],
    mut tick: impl FnMut(&mut LinkState),
) -> Result<RestoreReport, String> {
    if !st.sample.ok || st.sample.armed || wall_time() - st.sample.heartbeat_at > 3.0 {
        return Err("Restore requires a fresh disarmed connection".into());
    }
    if st.sample.param_count == 0 || st.sample.param_indices.len() < st.sample.param_count as usize {
        return Err("Parameter list is incomplete".into());
    }
    let mut report = RestoreReport {
        wrote: 0,
        unchanged: 0,
        missing: 0,
        failed: 0,
        refused: 0,
    };
    let mut touched = 0u32;
    for (name, value) in values {
        if !st.sample.ok || wall_time() - st.sample.heartbeat_at > 3.0 {
            tick(st);
            return Err("Connection lost during restore. Some parameters may already be written.".into());
        }
        if st.sample.armed {
            tick(st);
            return Err("Restore stopped because the vehicle armed. Some parameters may already be written.".into());
        }
        if storage_wipe_reason(name, *value).is_some() {
            report.refused += 1;
            continue;
        }
        match st.sample.params.get(name).copied() {
            None => report.missing += 1,
            Some(current) if f32_same(current, *value) => report.unchanged += 1,
            Some(_) => {
                if write_param_confirmed(conn, st, name, *value) {
                    report.wrote += 1;
                } else {
                    report.failed += 1;
                }
                touched += 1;
                if touched % 16 == 0 {
                    tick(st);
                }
            }
        }
    }
    tick(st);
    Ok(report)
}

/// Wait for a PARAM_VALUE from the vehicle. Does not trust the optimistic cache.
fn wait_param(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    name: &str,
    expect: f64,
    timeout: Duration,
) -> bool {
    st.sample.params.remove(name);
    request_param_read(conn, st, name);
    let until = Instant::now() + timeout;
    while Instant::now() < until {
        match conn.recv() {
            Ok((hdr, msg)) => {
                handle_msg(st, &hdr, msg);
                if let Some(&v) = st.sample.params.get(name) {
                    if param_close(v, expect) {
                        return true;
                    }
                }
            }
            Err(mavlink::error::MessageReadError::Io(err))
                if err.kind() == std::io::ErrorKind::TimedOut
                    || err.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => return false,
        }
    }
    false
}

/// A write that would wipe parameter storage or the whole internal flash.
/// `FORMAT_VERSION` 0 is the documented full parameter reset on the next boot.
/// `BRD_OPTIONS` bit 16 (value 16) erases the internal flash, firmware included.
pub fn storage_wipe_reason(name: &str, value: f64) -> Option<&'static str> {
    if name.eq_ignore_ascii_case("FORMAT_VERSION") {
        return Some("Refused. Writing FORMAT_VERSION clears every parameter on the next boot.");
    }
    if name.eq_ignore_ascii_case("BRD_OPTIONS") {
        let bits = value as i64;
        if bits & 16 != 0 {
            return Some("Refused. This BRD_OPTIONS value erases the internal flash, including parameters and firmware.");
        }
    }
    None
}

fn send_param_set(conn: &dyn MavConnection<MavMessage>, sys: u8, comp: u8, name: &str, value: f64) -> bool {
    if storage_wipe_reason(name, value).is_some() {
        return false;
    }
    send_msg(
        conn,
        &MavMessage::PARAM_SET(PARAM_SET_DATA {
            param_value: value as f32,
            target_system: sys,
            target_component: comp,
            param_id: param_id(name),
            param_type: MavParamType::MAV_PARAM_TYPE_REAL32,
        }),
    );
    true
}

fn set_param_now(conn: &dyn MavConnection<MavMessage>, st: &mut LinkState, name: &str, value: f64) {
    set_param(conn, st, name, value);
    pump_rx(conn, st);
}

fn set_param_wait(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    name: &str,
    value: f64,
) -> bool {
    for comp in [st.target_component, 1, 0] {
        send_param_set(conn, st.target_system, comp, name, value);
    }
    wait_param(conn, st, name, value, Duration::from_millis(1500))
}

fn set_param(conn: &dyn MavConnection<MavMessage>, st: &mut LinkState, name: &str, value: f64) {
    if !send_param_set(conn, st.target_system, st.target_component, name, value) {
        if let Some(reason) = storage_wipe_reason(name, value) {
            st.sample.texts.insert(0, format!("WARNING {reason}"));
            st.sample.texts.truncate(256);
        }
        return;
    }
    st.sample.params.insert(name.to_string(), value);
}

fn set_rate_pid(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    p: f64,
    i: f64,
    d: f64,
    ang: Option<f64>,
) {
    for axis in ["RLL", "PIT"] {
        set_param(conn, st, &format!("ATC_RAT_{axis}_P"), p);
        set_param(conn, st, &format!("ATC_RAT_{axis}_I"), i);
        set_param(conn, st, &format!("ATC_RAT_{axis}_D"), d);
        if let Some(a) = ang {
            set_param(conn, st, &format!("ATC_ANG_{axis}_P"), a);
        }
    }
    st.sample.gain_p = Some(p);
    st.sample.gain_i = Some(i);
    st.sample.gain_d = Some(d);
}

fn set_input_shape(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    tc: f64,
    acc: f64,
    rmax: f64,
) {
    set_param(conn, st, "ATC_INPUT_TC", tc);
    set_param(conn, st, "ATC_ACC_R_MAX", acc);
    set_param(conn, st, "ATC_ACC_P_MAX", acc);
    set_param(conn, st, "ATC_RATE_R_MAX", rmax);
    set_param(conn, st, "ATC_RATE_P_MAX", rmax);
    st.sample.input_tc = Some(tc);
    st.sample.acc_max = Some(acc);
    st.sample.rate_max = Some(rmax);
}

fn request_streams(conn: &dyn MavConnection<MavMessage>, st: &LinkState) {
    let sys = st.target_system;
    let comps = [st.target_component, 1, 0];
    for comp in comps {
        send_msg(
            conn,
            &MavMessage::REQUEST_DATA_STREAM(REQUEST_DATA_STREAM_DATA {
                target_system: sys,
                target_component: comp,
                req_stream_id: 0,
                req_message_rate: 25,
                start_stop: 1,
            }),
        );
        send_msg(
            conn,
            &MavMessage::REQUEST_DATA_STREAM(REQUEST_DATA_STREAM_DATA {
                target_system: sys,
                target_component: comp,
                req_stream_id: 10,
                req_message_rate: 50,
                start_stop: 1,
            }),
        );
        for (mid, us) in [
            (MSG_ATTITUDE, 20_000.0),
            (MSG_PID_TUNING, 20_000.0),
            (MSG_ATTITUDE_TARGET, 20_000.0),
            (MSG_NAV_CONTROLLER_OUTPUT, 50_000.0),
            (MSG_RC_CHANNELS, 40_000.0),
            (MSG_GLOBAL_POSITION_INT, 100_000.0),
            (MSG_VFR_HUD, 100_000.0),
            (MSG_SCALED_IMU, 200_000.0),
            (MSG_SCALED_IMU2, 200_000.0),
            (MSG_SCALED_IMU3, 200_000.0),
            (MSG_MAG_CAL_PROGRESS, 250_000.0),
            (MSG_MAG_CAL_REPORT, 500_000.0),
            (MSG_EKF_STATUS_REPORT, 500_000.0),
            (MSG_SYS_STATUS, 1_000_000.0),
            (MSG_BATTERY_STATUS, 1_000_000.0),
        ] {
            command_long(
                conn,
                sys,
                comp,
                MavCmd::MAV_CMD_SET_MESSAGE_INTERVAL,
                mid,
                us,
            );
            command_long(conn, sys, comp, MavCmd::MAV_CMD_REQUEST_MESSAGE, mid, 0.0);
        }
    }
    for (name, val) in [
        ("SR0_EXTRA1", 50.0),
        ("SR1_EXTRA1", 50.0),
        ("SR2_EXTRA1", 50.0),
        ("SR0_EXTRA2", 20.0),
        ("SR1_EXTRA2", 20.0),
        ("SR2_EXTRA2", 20.0),
        ("GCS_PID_MASK", 7.0),
    ] {
        send_msg(
            conn,
            &MavMessage::PARAM_SET(PARAM_SET_DATA {
                param_value: val,
                target_system: sys,
                target_component: st.target_component,
                param_id: param_id(name),
                param_type: MavParamType::MAV_PARAM_TYPE_REAL32,
            }),
        );
    }
}

fn request_diagnostics(conn: &dyn MavConnection<MavMessage>, st: &LinkState) {
    // Read-only requests; do not change persistent sensor/stream parameters.
    for (id, interval) in [
        (1.0, 1_000_000.0),
        (100.0, 100_000.0),
        (106.0, 100_000.0),
        (132.0, 200_000.0),
        (173.0, 200_000.0), // RANGEFINDER, the voltage reading
        (193.0, 500_000.0),
    ] {
        command_long(
            conn,
            st.target_system,
            st.target_component,
            MavCmd::MAV_CMD_SET_MESSAGE_INTERVAL,
            id,
            interval,
        );
        command_long(
            conn,
            st.target_system,
            st.target_component,
            MavCmd::MAV_CMD_REQUEST_MESSAGE,
            id,
            0.0,
        );
    }
    command_long(
        conn,
        st.target_system,
        st.target_component,
        MavCmd::MAV_CMD_REQUEST_MESSAGE,
        148.0,
        0.0,
    );
    command_long(
        conn,
        st.target_system,
        st.target_component,
        MavCmd::MAV_CMD_REQUEST_MESSAGE,
        253.0,
        0.0,
    );
}

fn request_param_list(conn: &dyn MavConnection<MavMessage>, st: &LinkState) {
    send_msg(
        conn,
        &MavMessage::PARAM_REQUEST_LIST(PARAM_REQUEST_LIST_DATA {
            target_system: st.target_system,
            target_component: st.target_component,
        }),
    );
}

fn request_params(conn: &dyn MavConnection<MavMessage>, st: &LinkState) {
    request_param_list(conn, st);
    for name in PARAM_WATCH.iter().chain(LAB_PARAMS.iter()) {
        send_msg(
            conn,
            &MavMessage::PARAM_REQUEST_READ(PARAM_REQUEST_READ_DATA {
                param_index: -1,
                target_system: st.target_system,
                target_component: st.target_component,
                param_id: param_id(name),
            }),
        );
    }
}
