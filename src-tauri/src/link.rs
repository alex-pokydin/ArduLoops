//! MAVLink bridge for ArduLoops.
use std::collections::HashMap;
use std::sync::mpsc::{Receiver, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use mavlink::ardupilotmega::{
    MavAutopilot, MavCmd, MavMessage, MavModeFlag, MavParamType, MavType, PidTuningAxis,
    ATTITUDE_DATA, ATTITUDE_TARGET_DATA, COMMAND_LONG_DATA, GLOBAL_POSITION_INT_DATA, HEARTBEAT_DATA,
    NAV_CONTROLLER_OUTPUT_DATA, PARAM_REQUEST_READ_DATA, PARAM_SET_DATA, PARAM_VALUE_DATA,
    PID_TUNING_DATA, RC_CHANNELS_DATA, RC_CHANNELS_OVERRIDE_DATA, RC_CHANNELS_RAW_DATA,
    REQUEST_DATA_STREAM_DATA, STATUSTEXT_DATA, VFR_HUD_DATA,
};
use mavlink::{MavConnection, MavHeader};
use serde::{Deserialize, Serialize};

const STOCK_P: f64 = 0.135;
const STOCK_I: f64 = 0.135;
const STOCK_D: f64 = 0.0036;
const STOCK_ANG: f64 = 4.5;
const STOCK_TC: f64 = 0.10;
const STOCK_ACC: f64 = 1100.0;
const STOCK_RMAX: f64 = 0.0;

pub const DEFAULT_URL: &str = "tcpout:127.0.0.1:5763";

const PARAM_WATCH: &[&str] = &[
    "ATC_RAT_RLL_P",
    "ATC_RAT_RLL_I",
    "ATC_RAT_RLL_D",
    "ATC_RAT_RLL_FLTT",
    "ATC_RAT_RLL_FLTE",
    "ATC_RAT_RLL_FLTD",
    "ATC_RAT_RLL_IMAX",
    "ATC_RAT_RLL_SMAX",
    "ATC_RAT_RLL_FF",
    "ATC_RAT_PIT_P",
    "ATC_RAT_PIT_I",
    "ATC_RAT_PIT_D",
    "ATC_RAT_PIT_FLTT",
    "ATC_RAT_PIT_FLTE",
    "ATC_RAT_PIT_FLTD",
    "ATC_RAT_PIT_IMAX",
    "ATC_RAT_PIT_SMAX",
    "ATC_RAT_PIT_FF",
    "ATC_RAT_YAW_P",
    "ATC_RAT_YAW_I",
    "ATC_RAT_YAW_D",
    "ATC_RAT_YAW_FLTT",
    "ATC_RAT_YAW_FLTE",
    "ATC_RAT_YAW_FLTD",
    "ATC_RAT_YAW_IMAX",
    "ATC_RAT_YAW_SMAX",
    "ATC_RAT_YAW_FF",
    "ATC_ANG_RLL_P",
    "ATC_ANG_PIT_P",
    "ATC_ANG_YAW_P",
    "ATC_INPUT_TC",
    "ATC_ACC_R_MAX",
    "ATC_ACC_P_MAX",
    "ATC_RATE_R_MAX",
    "ATC_RATE_P_MAX",
    "ATC_RATE_Y_MAX",
    "PSC_NE_POS_P",
    "PSC_NE_VEL_P",
    "PSC_NE_VEL_I",
    "PSC_NE_VEL_D",
    "PSC_NE_VEL_FLTE",
    "PSC_NE_VEL_FLTD",
    "PSC_NE_VEL_IMAX",
    "PSC_NE_VEL_FF",
    "PSC_D_POS_P",
    "PSC_D_VEL_P",
    "PSC_D_VEL_I",
    "PSC_D_VEL_D",
    "PSC_D_VEL_FLTE",
    "PSC_D_VEL_FLTD",
    "PSC_D_VEL_IMAX",
    "PSC_D_VEL_FF",
    "PSC_D_ACC_P",
    "PSC_D_ACC_I",
    "PSC_D_ACC_D",
    "PSC_D_ACC_FLTT",
    "PSC_D_ACC_FLTE",
    "PSC_D_ACC_FLTD",
    "PSC_D_ACC_IMAX",
    "PSC_D_ACC_SMAX",
    "PSC_D_ACC_FF",
    "ANGLE_MAX",
    "ATC_ANGLE_MAX",
    "PILOT_SPD_UP",
    "PILOT_SPD_DN",
    "PILOT_SPEED_UP",
    "PILOT_SPEED_DN",
    "THR_DZ",
    "MOT_THST_HOVER",
    "INS_HNTCH_ENABLE",
    "INS_HNTCH_FREQ",
    "INS_HNTCH_BW",
    "INS_HNTCH_MODE",
    "WP_SPD",
    "WPNAV_SPEED",
    "LOIT_SPEED_MS",
    "LOIT_SPEED",
    "RCMAP_ROLL",
    "RCMAP_PITCH",
    "RCMAP_THROTTLE",
    "RCMAP_YAW",
    // SITL world (`src/mav/sim.ts`). Harmless PARAM_REQUEST_READ on a real board.
    "SIM_WIND_SPD",
    "SIM_WIND_DIR",
    "SIM_WIND_TURB",
    "SIM_WIND_DIR_Z",
    "SIM_WIND_TC",
    "SIM_SPEEDUP",
    "SIM_GPS1_ENABLE",
    "SIM_GPS1_NUMSATS",
    "SIM_GPS1_LAG_MS",
    "SIM_GPS1_JAM",
    "SIM_GPS1_GLTCH_X",
    "SIM_GPS_DISABLE",
    "SIM_GPS_NUMSATS",
    "SIM_GPS_GLITCH_X",
    "SIM_RC_FAIL",
    "SIM_ENGINE_FAIL",
    "SIM_ENGINE_MUL",
    "SIM_VIB_FREQ_X",
    "SIM_VIB_FREQ_Y",
    "SIM_VIB_FREQ_Z",
    "SIM_VIB_MOT_MAX",
    "SIM_ACCEL1_FAIL",
    "SIM_DRIFT_SPEED",
    "SIM_MAG_RND",
    "SIM_MAG_DELAY",
    "SIM_MAG1_FAIL",
    "SIM_BARO_DISABLE",
    "SIM_BARO_FREEZE",
    "SIM_BARO_RND",
    "SIM_BARO_GLITCH",
    "SIM_BARO_DRIFT",
    "SIM_BARO_DELAY",
    "SIM_BATT_VOLTAGE",
    "SIM_BATT_CAP_AH",
];

/// Bare-SITL lab stand (same keys as UI `labInit.ts` / `wsl/params/copter.parm`).
const LAB_PARAMS: &[&str] = &[
    "FRAME_CLASS",
    "FRAME_TYPE",
    "INS_GYR_CAL",
    "INS_USE2",
    "INS_ACCOFFS_X",
    "INS_ACCOFFS_Y",
    "INS_ACCOFFS_Z",
    "INS_ACCSCAL_X",
    "INS_ACCSCAL_Y",
    "INS_ACCSCAL_Z",
    "INS_ACC2OFFS_X",
    "INS_ACC2OFFS_Y",
    "INS_ACC2OFFS_Z",
    "INS_ACC2SCAL_X",
    "INS_ACC2SCAL_Y",
    "INS_ACC2SCAL_Z",
    "COMPASS_OFS_X",
    "COMPASS_OFS_Y",
    "COMPASS_OFS_Z",
    "COMPASS_OFS2_X",
    "COMPASS_OFS2_Y",
    "COMPASS_OFS2_Z",
    "COMPASS_LEARN",
    "BATT_MONITOR",
    "BRD_SAFETY_DEFLT",
    "RC1_MIN",
    "RC1_MAX",
    "RC1_TRIM",
    "RC2_MIN",
    "RC2_MAX",
    "RC2_TRIM",
    "RC3_MIN",
    "RC3_MAX",
    "RC3_TRIM",
    "RC4_MIN",
    "RC4_MAX",
    "RC4_TRIM",
    "RC5_MIN",
    "RC5_MAX",
    "RC5_TRIM",
    "RC6_MIN",
    "RC6_MAX",
    "RC6_TRIM",
    "FLTMODE1",
    "FLTMODE2",
    "FLTMODE3",
    "FLTMODE4",
    "FLTMODE5",
    "FLTMODE6",
    "INITIAL_MODE",
    "FS_THR_ENABLE",
    "LOG_DISARMED",
];

const MSG_ATTITUDE: f32 = 30.0;
const MSG_PID_TUNING: f32 = 194.0;
const MSG_ATTITUDE_TARGET: f32 = 83.0;
const MSG_NAV_CONTROLLER_OUTPUT: f32 = 62.0;
const MSG_RC_CHANNELS: f32 = 65.0;
const MSG_GLOBAL_POSITION_INT: f32 = 33.0;
const MSG_VFR_HUD: f32 = 74.0;

#[derive(Debug, Clone, Serialize)]
pub struct Sample {
    pub ok: bool,
    pub detail: String,
    pub t: f64,
    pub mode: String,
    pub armed: bool,
    pub roll: f64,
    pub pitch: f64,
    pub yaw: f64,
    pub rate: f64,
    pub pitch_rate: f64,
    pub yaw_rate: f64,
    pub des: Option<f64>,
    pub pitch_des: Option<f64>,
    pub yaw_des: Option<f64>,
    pub p: Option<f64>,
    pub i: Option<f64>,
    pub d: Option<f64>,
    pub pitch_p: Option<f64>,
    pub pitch_i: Option<f64>,
    pub pitch_d: Option<f64>,
    pub yaw_p: Option<f64>,
    pub yaw_i: Option<f64>,
    pub yaw_d: Option<f64>,
    pub gain_p: Option<f64>,
    pub gain_i: Option<f64>,
    pub gain_d: Option<f64>,
    pub input_tc: Option<f64>,
    pub acc_max: Option<f64>,
    pub rate_max: Option<f64>,
    pub cmd: f64,
    pub pitch_cmd: f64,
    pub yaw_cmd: f64,
    pub tar: Option<f64>,
    pub pitch_tar: Option<f64>,
    pub yaw_tar: Option<f64>,
    pub alt: Option<f64>,
    pub alt_tar: Option<f64>,
    pub climb: Option<f64>,
    pub climb_des: Option<f64>,
    pub thr_cmd: f64,
    pub att_hz: u32,
    pub rx: String,
    pub frame: String,
    pub params: HashMap<String, f64>,
    /// Newest first. STATUSTEXT from the vehicle.
    pub texts: Vec<String>,
    /// Init dump progress. `init_total == 0` means not running.
    pub init_done: u32,
    pub init_total: u32,
}

impl Sample {
    pub fn empty() -> Self {
        Self {
            ok: false,
            detail: "немає лінку".into(),
            t: 0.0,
            mode: "?".into(),
            armed: false,
            roll: 0.0,
            pitch: 0.0,
            yaw: 0.0,
            rate: 0.0,
            pitch_rate: 0.0,
            yaw_rate: 0.0,
            des: None,
            pitch_des: None,
            yaw_des: None,
            p: None,
            i: None,
            d: None,
            pitch_p: None,
            pitch_i: None,
            pitch_d: None,
            yaw_p: None,
            yaw_i: None,
            yaw_d: None,
            gain_p: None,
            gain_i: None,
            gain_d: None,
            input_tc: None,
            acc_max: None,
            rate_max: None,
            cmd: 0.0,
            pitch_cmd: 0.0,
            yaw_cmd: 0.0,
            tar: None,
            pitch_tar: None,
            yaw_tar: None,
            alt: None,
            alt_tar: None,
            climb: None,
            climb_des: None,
            thr_cmd: 0.0,
            att_hz: 0,
            rx: String::new(),
            frame: String::new(),
            params: HashMap::new(),
            texts: Vec::new(),
            init_done: 0,
            init_total: 0,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op")]
pub enum Cmd {
    #[serde(rename = "param")]
    Param { name: String, value: f64 },
    #[serde(rename = "preset")]
    Preset { name: String },
    #[serde(rename = "tune")]
    Tune { p: f64, i: f64, d: f64 },
    #[serde(rename = "mode")]
    Mode { mode: String },
    #[serde(rename = "arm")]
    Arm { on: bool },
    #[serde(rename = "hover")]
    Hover,
    #[serde(rename = "land")]
    Land,
    #[serde(rename = "stick")]
    Stick {
        roll: f64,
        pitch: f64,
        yaw: f64,
        thr: f64,
    },
    #[serde(rename = "release")]
    Release,
    #[serde(rename = "connect")]
    Connect { url: String },
    #[serde(rename = "disconnect")]
    Disconnect,
    #[serde(rename = "init")]
    Init {
        params: HashMap<String, f64>,
    },
    #[serde(rename = "param_read")]
    ParamRead { name: String },
    #[serde(rename = "reboot")]
    Reboot,
}

fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    if s.len() >= prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&s[prefix.len()..])
    } else {
        None
    }
}

pub fn normalize_link(raw: &str) -> String {
    let s = raw.trim();
    if s.is_empty() {
        return DEFAULT_URL.into();
    }
    if strip_prefix_ci(s, "tcpout:").is_some()
        || strip_prefix_ci(s, "tcpin:").is_some()
        || strip_prefix_ci(s, "udpout:").is_some()
        || strip_prefix_ci(s, "udpin:").is_some()
        || strip_prefix_ci(s, "udpbcast:").is_some()
        || strip_prefix_ci(s, "serial:").is_some()
    {
        return s.to_string();
    }
    if let Some(rest) = strip_prefix_ci(s, "tcp:") {
        return format!("tcpout:{rest}");
    }
    if let Some(rest) = strip_prefix_ci(s, "udp:") {
        if rest.contains(':') {
            return format!("udpin:{rest}");
        }
        return format!("udpin:0.0.0.0:{rest}");
    }
    format!("tcpout:{s}")
}

struct RcState {
    roll: i32,
    pitch: i32,
    yaw: i32,
    thr: i32,
}

struct LinkState {
    sample: Sample,
    rc: RcState,
    rcmap: HashMap<&'static str, u8>,
    virtual_stick: bool,
    pulse_until: Option<Instant>,
    pulse_roll: i32,
    rc_in_roll: i32,
    rc_in_pitch: i32,
    rc_in_yaw: i32,
    rc_in_thr: i32,
    angle_max: f64,
    have_att_target: bool,
    alt_error: Option<f64>,
    target_system: u8,
    target_component: u8,
}

impl LinkState {
    fn new() -> Self {
        let mut rcmap = HashMap::new();
        rcmap.insert("roll", 1);
        rcmap.insert("pitch", 2);
        rcmap.insert("thr", 3);
        rcmap.insert("yaw", 4);
        Self {
            sample: Sample::empty(),
            rc: RcState {
                roll: 1500,
                pitch: 1500,
                yaw: 1500,
                thr: 0,
            },
            rcmap,
            virtual_stick: false,
            pulse_until: None,
            pulse_roll: 1740,
            rc_in_roll: 1500,
            rc_in_pitch: 1500,
            rc_in_yaw: 1500,
            rc_in_thr: 1500,
            angle_max: 30.0,
            have_att_target: false,
            alt_error: None,
            target_system: 1,
            target_component: 1,
        }
    }
}

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
        | MavType::MAV_TYPE_VTOL_TILTROTOR => "plane".into(),
        other => {
            if (19..=25).contains(&(other as u32)) {
                "plane".into()
            } else {
                String::new()
            }
        }
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
        _ => return format!("mode{custom}"),
    }
    .into()
}

fn mode_custom(name: &str) -> Option<u32> {
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

fn send_param_set(
    conn: &dyn MavConnection<MavMessage>,
    sys: u8,
    comp: u8,
    name: &str,
    value: f64,
) {
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
}

fn set_param_now(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    name: &str,
    value: f64,
) {
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

fn set_param(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    name: &str,
    value: f64,
) {
    send_param_set(conn, st.target_system, st.target_component, name, value);
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

fn request_params(conn: &dyn MavConnection<MavMessage>, st: &LinkState) {
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

fn gcs_heartbeat() -> MavMessage {
    MavMessage::HEARTBEAT(HEARTBEAT_DATA {
        custom_mode: 0,
        mavtype: MavType::MAV_TYPE_GCS,
        autopilot: MavAutopilot::MAV_AUTOPILOT_INVALID,
        base_mode: MavModeFlag::empty(),
        system_status: mavlink::ardupilotmega::MavState::MAV_STATE_ACTIVE,
        mavlink_version: 3,
    })
}

fn stick_deg(st: &LinkState, pwm: i32) -> f64 {
    (pwm as f64 - 1500.0) / 500.0 * st.angle_max
}

fn axis_pwm(st: &LinkState, pitch: bool) -> i32 {
    let pulsing = st.pulse_until.map(|t| Instant::now() < t).unwrap_or(false);
    if !pitch && pulsing {
        return st.pulse_roll;
    }
    if st.virtual_stick {
        return if pitch { st.rc.pitch } else { st.rc.roll };
    }
    if pitch {
        st.rc_in_pitch
    } else {
        st.rc_in_roll
    }
}

fn yaw_pwm(st: &LinkState) -> i32 {
    if st.virtual_stick {
        st.rc.yaw
    } else {
        st.rc_in_yaw
    }
}

fn thr_pwm(st: &LinkState) -> i32 {
    let raw = if st.virtual_stick {
        st.rc.thr
    } else {
        st.rc_in_thr
    };
    if (801..2200).contains(&raw) {
        raw
    } else {
        1500
    }
}

fn thr_pct(pwm: i32) -> f64 {
    (pwm as f64 - 1500.0) / 5.0
}

fn param_ms(st: &LinkState, names: &[&str], fallback: f64) -> f64 {
    for name in names {
        if let Some(&v) = st.sample.params.get(*name) {
            // Older PILOT_SPEED_* were cm/s (~250). New PILOT_SPD_* are m/s (~2.5).
            return if v.abs() > 20.0 { v / 100.0 } else { v };
        }
    }
    fallback
}

/// AltHold / Loiter: throttle 0…1000 → climb m/s (up +). Matches Copter::get_pilot_desired_climb_rate_ms.
fn pilot_climb_ms(st: &LinkState) -> f64 {
    if !st.sample.armed {
        return 0.0;
    }
    let thr = (thr_pwm(st) as f64 - 1000.0).clamp(0.0, 1000.0);
    let mid = 500.0;
    let dz = st
        .sample
        .params
        .get("THR_DZ")
        .copied()
        .unwrap_or(100.0)
        .clamp(0.0, 400.0);
    let spd_up = param_ms(st, &["PILOT_SPD_UP", "PILOT_SPEED_UP"], 2.5).abs();
    let spd_dn = {
        let v = param_ms(st, &["PILOT_SPD_DN", "PILOT_SPEED_DN"], 0.0).abs();
        if v < 1e-6 {
            spd_up
        } else {
            v
        }
    };
    let top = mid + dz;
    let bot = (mid - dz).max(1.0);
    if thr < bot {
        spd_dn * (thr - bot) / bot
    } else if thr > top {
        spd_up * (thr - top) / (1000.0 - top).max(1.0)
    } else {
        0.0
    }
}

fn apply_d_targets(st: &mut LinkState) {
    if let (Some(alt), Some(err)) = (st.sample.alt, st.alt_error) {
        // NAV alt_error is D-error (target_D − pos_D). AGL = −D, so target AGL = AGL − error_D.
        st.sample.alt_tar = Some(alt - err);
    }
    st.sample.climb_des = Some(pilot_climb_ms(st));
}

fn override_channels(st: &LinkState, roll: i32, pitch: i32, thr: i32, yaw: i32) -> [u16; 8] {
    let mut ch = [0u16; 8];
    let put = |ch: &mut [u16; 8], axis: &str, pwm: i32| {
        if let Some(&n) = st.rcmap.get(axis) {
            if (1..=8).contains(&n) {
                ch[(n - 1) as usize] = pwm as u16;
            }
        }
    };
    put(&mut ch, "roll", roll);
    put(&mut ch, "pitch", pitch);
    put(&mut ch, "thr", thr);
    put(&mut ch, "yaw", yaw);
    ch
}

fn send_rc(conn: &dyn MavConnection<MavMessage>, st: &LinkState) {
    let now = Instant::now();
    let pulsing = st.pulse_until.map(|t| now < t).unwrap_or(false);
    let hover = st.rc.thr > 0;
    if !st.virtual_stick && !hover && !pulsing {
        return;
    }
    let mut roll = 0;
    let mut pitch = 0;
    let mut yaw = 0;
    let mut thr = 0;
    if st.virtual_stick {
        roll = st.rc.roll;
        pitch = st.rc.pitch;
        yaw = st.rc.yaw;
        thr = if st.rc.thr > 0 { st.rc.thr } else { 0 };
    } else if hover {
        thr = st.rc.thr;
    }
    if pulsing {
        roll = st.pulse_roll;
    }
    if hover && thr <= 0 {
        thr = st.rc.thr;
    }
    let ch = override_channels(st, roll, pitch, thr, yaw);
    send_msg(
        conn,
        &MavMessage::RC_CHANNELS_OVERRIDE(RC_CHANNELS_OVERRIDE_DATA {
            chan1_raw: ch[0],
            chan2_raw: ch[1],
            chan3_raw: ch[2],
            chan4_raw: ch[3],
            chan5_raw: ch[4],
            chan6_raw: ch[5],
            chan7_raw: ch[6],
            chan8_raw: ch[7],
            target_system: st.target_system,
            target_component: st.target_component,
        }),
    );
}

fn reboot_fc(conn: &dyn MavConnection<MavMessage>, st: &LinkState) {
    // One COMMAND_LONG. Sending to 1 and 0 as well used to triple-boot
    // Mission Planner SITL (often with -w), which wiped FRAME_CLASS.
    command_long(
        conn,
        st.target_system,
        st.target_component,
        MavCmd::MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
        1.0,
        0.0,
    );
}

fn apply_cmd(
    conn: &dyn MavConnection<MavMessage>,
    st: &mut LinkState,
    cmd: Cmd,
    on_sample: &OnSample,
    latest: &Mutex<Sample>,
) {
    match cmd {
        Cmd::Param { name, value } => set_param(conn, st, &name, value),
        Cmd::ParamRead { name } => {
            send_msg(
                conn,
                &MavMessage::PARAM_REQUEST_READ(PARAM_REQUEST_READ_DATA {
                    param_index: -1,
                    target_system: st.target_system,
                    target_component: st.target_component,
                    param_id: param_id(&name),
                }),
            );
        }
        Cmd::Init { params } => {
            if st.sample.armed {
                return;
            }
            let mut names: Vec<String> = params.keys().cloned().collect();
            names.sort();
            // Frame first. Confirm FRAME_CLASS from the vehicle (not the local
            // cache). Do not reboot: Mission Planner SITL often relaunches with
            // -w, EEPROM is empty, boot prints Frame: UNSUPPORTED. Copter
            // re-inits motors from FRAME_CLASS at 1 Hz while disarmed.
            let mut ordered: Vec<String> = Vec::new();
            for must in ["FRAME_CLASS", "FRAME_TYPE"] {
                if names.iter().any(|n| n == must) {
                    ordered.push(must.to_string());
                }
            }
            ordered.extend(names.into_iter().filter(|n| n != "FRAME_CLASS" && n != "FRAME_TYPE"));
            let extra = usize::from(params.contains_key("FRAME_CLASS"));
            let total = (ordered.len() + extra) as u32;
            let mut done = 0u32;
            st.sample.init_done = 0;
            st.sample.init_total = total;
            emit_sample(on_sample, latest, st);
            for name in &ordered {
                if let Some(&value) = params.get(name) {
                    if name == "FRAME_CLASS" || name == "FRAME_TYPE" {
                        if !set_param_wait(conn, st, name, value) {
                            st.sample.texts.insert(
                                0,
                                format!("WARNING Init: {name} not confirmed"),
                            );
                            st.sample.texts.truncate(24);
                        }
                    } else {
                        set_param_now(conn, st, name, value);
                    }
                    done += 1;
                    st.sample.init_done = done;
                    emit_sample(on_sample, latest, st);
                }
            }
            if let Some(&v) = params.get("FRAME_CLASS") {
                if !set_param_wait(conn, st, "FRAME_CLASS", v) {
                    st.sample.texts.insert(
                        0,
                        "WARNING Init: FRAME_CLASS not confirmed".into(),
                    );
                    st.sample.texts.truncate(24);
                }
                done += 1;
                st.sample.init_done = done;
                emit_sample(on_sample, latest, st);
            }
            let settle = Instant::now() + Duration::from_millis(1200);
            while Instant::now() < settle {
                pump_rx(conn, st);
                std::thread::sleep(Duration::from_millis(50));
            }
            st.sample.init_done = 0;
            st.sample.init_total = 0;
            emit_sample(on_sample, latest, st);
        }
        Cmd::Preset { name } => {
            let (p, i, d, ang, shape) = match name.as_str() {
                "wool" => (0.027, 0.015, STOCK_D, 2.0, false),
                "hot" => (0.675, STOCK_I, STOCK_D, STOCK_ANG, false),
                _ => (STOCK_P, STOCK_I, STOCK_D, STOCK_ANG, true),
            };
            set_rate_pid(conn, st, p, i, d, Some(ang));
            if shape || name == "stock" {
                set_input_shape(conn, st, STOCK_TC, STOCK_ACC, STOCK_RMAX);
            }
        }
        Cmd::Tune { p, i, d } => set_rate_pid(conn, st, p, i, d, None),
        Cmd::Mode { mode } => {
            if let Some(custom) = mode_custom(&mode) {
                command_long(
                    conn,
                    st.target_system,
                    st.target_component,
                    MavCmd::MAV_CMD_DO_SET_MODE,
                    1.0,
                    custom as f32,
                );
            }
        }
        Cmd::Arm { on } => {
            for comp in [st.target_component, 1, 0] {
                command_long(
                    conn,
                    st.target_system,
                    comp,
                    MavCmd::MAV_CMD_COMPONENT_ARM_DISARM,
                    if on { 1.0 } else { 0.0 },
                    0.0,
                );
            }
        }
        Cmd::Hover => {
            st.rc.thr = 1550;
            st.rc.roll = 1500;
            st.rc.pitch = 1500;
            st.rc.yaw = 1500;
        }
        Cmd::Land => {
            st.rc.thr = 1100;
            st.rc.roll = 1500;
            st.rc.pitch = 1500;
            st.rc.yaw = 1500;
        }
        Cmd::Stick {
            roll,
            pitch,
            yaw,
            thr,
        } => {
            st.virtual_stick = true;
            st.rc.roll = pwm(roll, 1500);
            st.rc.pitch = pwm(pitch, 1500);
            st.rc.yaw = pwm(yaw, 1500);
            st.rc.thr = if thr > 0.0 { thr.round() as i32 } else { 0 };
        }
        Cmd::Release => {
            st.virtual_stick = false;
            st.pulse_until = None;
            st.rc.thr = 0;
            st.rc.roll = 1500;
            st.rc.pitch = 1500;
            st.rc.yaw = 1500;
            send_msg(
                conn,
                &MavMessage::RC_CHANNELS_OVERRIDE(RC_CHANNELS_OVERRIDE_DATA {
                    chan1_raw: 0,
                    chan2_raw: 0,
                    chan3_raw: 0,
                    chan4_raw: 0,
                    chan5_raw: 0,
                    chan6_raw: 0,
                    chan7_raw: 0,
                    chan8_raw: 0,
                    target_system: st.target_system,
                    target_component: st.target_component,
                }),
            );
        }
        Cmd::Connect { .. } | Cmd::Disconnect => {}
        Cmd::Reboot => reboot_fc(conn, st),
    }
}

fn read_rc_chan(st: &LinkState, msg_chans: &[u16], axis: &str) -> Option<u16> {
    let fallback = match axis {
        "pitch" => 2,
        "yaw" => 4,
        "thr" => 3,
        _ => 1,
    };
    let n = (*st.rcmap.get(axis).unwrap_or(&fallback) as usize).clamp(1, msg_chans.len());
    msg_chans.get(n - 1).copied()
}

fn handle_msg(st: &mut LinkState, header: &MavHeader, msg: MavMessage) {
    st.sample.rx = msg_name(&msg).into();
    match msg {
        MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            custom_mode,
            mavtype,
            autopilot,
            base_mode,
            ..
        }) => {
            if mavtype == MavType::MAV_TYPE_GCS {
                return;
            }
            if autopilot != MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA {
                return;
            }
            if header.system_id != 0 {
                st.target_system = header.system_id;
            }
            if header.component_id != 0 {
                st.target_component = header.component_id;
            }
            st.sample.mode = copter_mode(custom_mode);
            st.sample.armed = base_mode.contains(MavModeFlag::MAV_MODE_FLAG_SAFETY_ARMED);
            st.sample.frame = frame_of(mavtype);
        }
        MavMessage::ATTITUDE(ATTITUDE_DATA {
            roll,
            pitch,
            yaw,
            rollspeed,
            pitchspeed,
            yawspeed,
            ..
        }) => {
            st.sample.roll = (roll as f64).to_degrees();
            st.sample.pitch = (pitch as f64).to_degrees();
            st.sample.yaw = (yaw as f64).to_degrees();
            if st.sample.des.is_none() {
                st.sample.rate = (rollspeed as f64).to_degrees();
            }
            if st.sample.pitch_des.is_none() {
                st.sample.pitch_rate = (pitchspeed as f64).to_degrees();
            }
            if st.sample.yaw_des.is_none() {
                st.sample.yaw_rate = (yawspeed as f64).to_degrees();
            }
        }
        MavMessage::ATTITUDE_TARGET(ATTITUDE_TARGET_DATA { q, .. }) => {
            if let Some(ang) = quat_roll_deg(&q) {
                st.sample.tar = Some(ang);
                st.have_att_target = true;
            }
            if let Some(ang) = quat_pitch_deg(&q) {
                st.sample.pitch_tar = Some(ang);
                st.have_att_target = true;
            }
            if let Some(ang) = quat_yaw_deg(&q) {
                st.sample.yaw_tar = Some(ang);
                st.have_att_target = true;
            }
        }
        MavMessage::NAV_CONTROLLER_OUTPUT(NAV_CONTROLLER_OUTPUT_DATA {
            nav_roll,
            nav_pitch,
            alt_error,
            ..
        }) => {
            if !st.have_att_target {
                st.sample.tar = Some(nav_roll as f64);
                st.sample.pitch_tar = Some(nav_pitch as f64);
            }
            st.alt_error = Some(alt_error as f64);
            apply_d_targets(st);
        }
        MavMessage::PID_TUNING(PID_TUNING_DATA {
            axis,
            desired,
            achieved,
            P,
            I,
            D,
            ..
        }) => match axis {
            PidTuningAxis::PID_TUNING_ROLL => {
                st.sample.des = Some(desired as f64);
                st.sample.rate = achieved as f64;
                st.sample.p = Some(P as f64);
                st.sample.i = Some(I as f64);
                st.sample.d = Some(D as f64);
            }
            PidTuningAxis::PID_TUNING_PITCH => {
                st.sample.pitch_des = Some(desired as f64);
                st.sample.pitch_rate = achieved as f64;
                st.sample.pitch_p = Some(P as f64);
                st.sample.pitch_i = Some(I as f64);
                st.sample.pitch_d = Some(D as f64);
            }
            PidTuningAxis::PID_TUNING_YAW => {
                st.sample.yaw_des = Some(desired as f64);
                st.sample.yaw_rate = achieved as f64;
                st.sample.yaw_p = Some(P as f64);
                st.sample.yaw_i = Some(I as f64);
                st.sample.yaw_d = Some(D as f64);
            }
            _ => {}
        },
        MavMessage::GLOBAL_POSITION_INT(GLOBAL_POSITION_INT_DATA {
            relative_alt, vz, ..
        }) => {
            st.sample.alt = Some(relative_alt as f64 / 1000.0);
            st.sample.climb = Some(-(vz as f64) / 100.0);
            apply_d_targets(st);
        }
        MavMessage::VFR_HUD(VFR_HUD_DATA { climb, .. }) => {
            if st.sample.climb.is_none() {
                st.sample.climb = Some(climb as f64);
            }
        }
        MavMessage::RC_CHANNELS(RC_CHANNELS_DATA {
            chan1_raw,
            chan2_raw,
            chan3_raw,
            chan4_raw,
            chan5_raw,
            chan6_raw,
            chan7_raw,
            chan8_raw,
            ..
        })
        | MavMessage::RC_CHANNELS_RAW(RC_CHANNELS_RAW_DATA {
            chan1_raw,
            chan2_raw,
            chan3_raw,
            chan4_raw,
            chan5_raw,
            chan6_raw,
            chan7_raw,
            chan8_raw,
            ..
        }) => {
            let chans = [
                chan1_raw, chan2_raw, chan3_raw, chan4_raw, chan5_raw, chan6_raw, chan7_raw,
                chan8_raw,
            ];
            if let Some(raw) = read_rc_chan(st, &chans, "roll") {
                if (801..2200).contains(&raw) {
                    st.rc_in_roll = raw as i32;
                }
            }
            if let Some(raw) = read_rc_chan(st, &chans, "pitch") {
                if (801..2200).contains(&raw) {
                    st.rc_in_pitch = raw as i32;
                }
            }
            if let Some(raw) = read_rc_chan(st, &chans, "yaw") {
                if (801..2200).contains(&raw) {
                    st.rc_in_yaw = raw as i32;
                }
            }
            if let Some(raw) = read_rc_chan(st, &chans, "thr") {
                if (801..2200).contains(&raw) {
                    st.rc_in_thr = raw as i32;
                }
            }
        }
        MavMessage::STATUSTEXT(STATUSTEXT_DATA { severity, text, .. }) => {
            let msg = param_name(&text);
            if msg.is_empty() {
                return;
            }
            let sev = format!("{severity:?}").replace("MAV_SEVERITY_", "");
            st.sample.texts.insert(0, format!("{sev} {msg}"));
            st.sample.texts.truncate(24);
        }
        MavMessage::PARAM_VALUE(PARAM_VALUE_DATA {
            param_id,
            param_value,
            ..
        }) => {
            let name = param_name(&param_id);
            if name.is_empty() {
                return;
            }
            let val = param_value as f64;
            st.sample.params.insert(name.clone(), val);
            match name.as_str() {
                "ATC_RAT_RLL_P" => st.sample.gain_p = Some(val),
                "ATC_RAT_RLL_I" => st.sample.gain_i = Some(val),
                "ATC_RAT_RLL_D" => st.sample.gain_d = Some(val),
                "ANGLE_MAX" | "ATC_ANGLE_MAX" => {
                    if val > 50.0 {
                        st.angle_max = val / 100.0;
                    } else {
                        st.angle_max = val;
                    }
                }
                "RCMAP_ROLL" => {
                    st.rcmap.insert("roll", val as u8);
                }
                "RCMAP_PITCH" => {
                    st.rcmap.insert("pitch", val as u8);
                }
                "RCMAP_THROTTLE" => {
                    st.rcmap.insert("thr", val as u8);
                }
                "RCMAP_YAW" => {
                    st.rcmap.insert("yaw", val as u8);
                }
                "ATC_INPUT_TC" => st.sample.input_tc = Some(val),
                "ATC_ACC_R_MAX" => st.sample.acc_max = Some(val),
                "ATC_RATE_R_MAX" => st.sample.rate_max = Some(val),
                _ => {}
            }
        }
        _ => {}
    }
}

fn msg_name(msg: &MavMessage) -> &'static str {
    match msg {
        MavMessage::HEARTBEAT(_) => "HEARTBEAT",
        MavMessage::ATTITUDE(_) => "ATTITUDE",
        MavMessage::ATTITUDE_TARGET(_) => "ATTITUDE_TARGET",
        MavMessage::PID_TUNING(_) => "PID_TUNING",
        MavMessage::PARAM_VALUE(_) => "PARAM_VALUE",
        MavMessage::STATUSTEXT(_) => "STATUSTEXT",
        MavMessage::GLOBAL_POSITION_INT(_) => "GLOBAL_POSITION_INT",
        MavMessage::VFR_HUD(_) => "VFR_HUD",
        MavMessage::RC_CHANNELS(_) => "RC_CHANNELS",
        MavMessage::NAV_CONTROLLER_OUTPUT(_) => "NAV_CONTROLLER_OUTPUT",
        _ => "MSG",
    }
}

/// SITL extra GCS ports (5760 is often MAVProxy; 5762/5763 are the extras).
fn sitl_alt_urls(url: &str) -> Vec<String> {
    let Some(rest) = strip_prefix_ci(url, "tcpout:") else {
        return Vec::new();
    };
    let Some((host, port)) = rest.rsplit_once(':') else {
        return Vec::new();
    };
    if !matches!(host, "127.0.0.1" | "localhost" | "::1") {
        return Vec::new();
    }
    ["5763", "5762"]
        .into_iter()
        .filter(|p| *p != port)
        .map(|p| format!("tcpout:{host}:{p}"))
        .collect()
}

enum OpenErr {
    Connect,
    NoHeartbeat,
}

fn try_open(url: &str) -> Result<Box<dyn MavConnection<MavMessage> + Send + Sync>, OpenErr> {
    let mut conn = mavlink::connect::<MavMessage>(url).map_err(|_| OpenErr::Connect)?;
    conn.set_protocol_version(mavlink::MavlinkVersion::V2);
    let deadline = Instant::now() + Duration::from_millis(2500);
    while Instant::now() < deadline {
        let _ = conn.send(&header(), &gcs_heartbeat());
        match conn.recv() {
            Ok((_hdr, MavMessage::HEARTBEAT(hb))) => {
                if hb.mavtype != MavType::MAV_TYPE_GCS
                    && hb.autopilot == MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA
                {
                    return Ok(conn);
                }
            }
            Ok(_) => {}
            Err(mavlink::error::MessageReadError::Io(err))
                if err.kind() == std::io::ErrorKind::TimedOut
                    || err.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => return Err(OpenErr::Connect),
        }
    }
    Err(OpenErr::NoHeartbeat)
}

fn open_link(url: &str) -> Result<(Box<dyn MavConnection<MavMessage> + Send + Sync>, String), OpenErr> {
    let mut last = OpenErr::Connect;
    for candidate in std::iter::once(url.to_string()).chain(sitl_alt_urls(url)) {
        match try_open(&candidate) {
            Ok(conn) => return Ok((conn, candidate)),
            Err(err) => last = err,
        }
    }
    Err(last)
}

pub type OnSample = Arc<dyn Fn(&Sample) + Send + Sync>;

fn emit_sample(on_sample: &OnSample, latest: &Mutex<Sample>, st: &LinkState) {
    if let Ok(mut g) = latest.lock() {
        *g = st.sample.clone();
    }
    on_sample(&st.sample);
}

fn wall_time() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

enum Drain {
    None,
    Reconnect,
    Stop,
}

fn drain_cmds(
    cmds: &Mutex<Receiver<Cmd>>,
    url: &Mutex<String>,
    conn: Option<&dyn MavConnection<MavMessage>>,
    st: &mut LinkState,
    on_sample: &OnSample,
    latest: &Mutex<Sample>,
) -> Drain {
    let rx = cmds.lock().unwrap();
    loop {
        match rx.try_recv() {
            Ok(Cmd::Connect { url: u }) => {
                let n = normalize_link(&u);
                let mut g = url.lock().unwrap();
                *g = n;
                return Drain::Reconnect;
            }
            Ok(Cmd::Disconnect) => {
                let mut g = url.lock().unwrap();
                if g.is_empty() {
                    continue;
                }
                g.clear();
                return Drain::Reconnect;
            }
            Ok(cmd) => {
                if let Some(conn) = conn {
                    apply_cmd(conn, st, cmd, on_sample, latest);
                }
            }
            Err(TryRecvError::Empty) => return Drain::None,
            Err(TryRecvError::Disconnected) => return Drain::Stop,
        }
    }
}

pub fn run_loop(
    on_sample: OnSample,
    cmds: Receiver<Cmd>,
    latest: Arc<Mutex<Sample>>,
    url: Arc<Mutex<String>>,
) {
    let cmds = Mutex::new(cmds);
    loop {
        let mut st = LinkState::new();
        let target = url.lock().map(|g| g.clone()).unwrap_or_default();
        if target.is_empty() {
            st.sample.ok = false;
            st.sample.detail = "відключено".into();
            emit_sample(&on_sample, &latest, &st);
            loop {
                match drain_cmds(&cmds, &url, None, &mut st, &on_sample, &latest) {
                    Drain::None => std::thread::sleep(Duration::from_millis(50)),
                    Drain::Reconnect => break,
                    Drain::Stop => return,
                }
            }
            continue;
        }
        let conn = match open_link(&target) {
            Ok((c, actual)) => {
                if actual != target {
                    if let Ok(mut g) = url.lock() {
                        *g = actual.clone();
                    }
                }
                st.sample.detail = actual;
                st.sample.rx = "heartbeat".into();
                st.sample.ok = true;
                Some(c)
            }
            Err(OpenErr::NoHeartbeat) => {
                st.sample.ok = false;
                st.sample.detail = format!("немає HEARTBEAT ({target})");
                None
            }
            Err(OpenErr::Connect) => {
                st.sample.ok = false;
                st.sample.detail = format!("немає MAVLink ({target})");
                None
            }
        };
        let Some(conn) = conn else {
            emit_sample(&on_sample, &latest, &st);
            let until = Instant::now() + Duration::from_secs(2);
            while Instant::now() < until {
                match drain_cmds(&cmds, &url, None, &mut st, &on_sample, &latest) {
                    Drain::None => std::thread::sleep(Duration::from_millis(50)),
                    Drain::Reconnect => break,
                    Drain::Stop => return,
                }
            }
            continue;
        };

        request_streams(&*conn, &st);
        request_params(&*conn, &st);

        let mut last_rc = Instant::now() - Duration::from_millis(50);
        let mut last_stream = Instant::now();
        let mut last_hb = Instant::now();
        let mut last_emit = Instant::now() - Duration::from_millis(40);
        let mut att_n = 0u32;
        let mut att_t0 = Instant::now();
        let mut last_att: Option<Instant> = None;

        loop {
            match drain_cmds(&cmds, &url, Some(&*conn), &mut st, &on_sample, &latest) {
                Drain::None => {}
                Drain::Reconnect => break,
                Drain::Stop => return,
            }

            let now = Instant::now();
            st.sample.t = wall_time();
            st.sample.cmd = stick_deg(&st, axis_pwm(&st, false));
            st.sample.pitch_cmd = stick_deg(&st, axis_pwm(&st, true));
            // Same ±ANGLE_MAX throw as roll. Upper yaw plot adds this to heading
            // so the grey line sits on actual at rest and peels off with the stick.
            st.sample.yaw_cmd = stick_deg(&st, yaw_pwm(&st));
            st.sample.thr_cmd = thr_pct(thr_pwm(&st));
            apply_d_targets(&mut st);
            if now.duration_since(att_t0) >= Duration::from_secs(1) {
                st.sample.att_hz = att_n;
                att_n = 0;
                att_t0 = now;
            }
            if now.duration_since(last_stream) > Duration::from_secs(3) && st.sample.att_hz == 0 {
                request_streams(&*conn, &st);
                last_stream = now;
            }
            if let Some(t) = last_att {
                if now.duration_since(t) > Duration::from_secs(12) {
                    st.sample.ok = false;
                    st.sample.detail = "немає ATTITUDE, reconnect".into();
                    emit_sample(&on_sample, &latest, &st);
                    break;
                }
            }
            if now.duration_since(last_rc) > Duration::from_millis(50) {
                send_rc(&*conn, &st);
                last_rc = now;
            }
            if now.duration_since(last_hb) > Duration::from_secs(1) {
                send_msg(&*conn, &gcs_heartbeat());
                last_hb = now;
            }

            match conn.recv() {
                Ok((hdr, msg)) => {
                    let is_att = matches!(msg, MavMessage::ATTITUDE(_));
                    handle_msg(&mut st, &hdr, msg);
                    if is_att {
                        att_n += 1;
                        last_att = Some(Instant::now());
                    } else if last_att.is_none() && st.sample.frame != "" {
                        last_att = Some(Instant::now());
                    }
                }
                Err(mavlink::error::MessageReadError::Io(err))
                    if err.kind() == std::io::ErrorKind::TimedOut
                        || err.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => {
                    st.sample.ok = false;
                    st.sample.detail = "лінк обірвався".into();
                    emit_sample(&on_sample, &latest, &st);
                    break;
                }
            }

            if now.duration_since(last_emit) >= Duration::from_millis(40) {
                emit_sample(&on_sample, &latest, &st);
                last_emit = now;
            }
        }
    }
}
