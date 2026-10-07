// Sample, commands, modes, and link state.


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
    // Plane First Flight / Tuning (harmless PARAM_REQUEST_READ on copter).
    "RLL_RATE_P",
    "RLL_RATE_I",
    "RLL_RATE_D",
    "RLL_RATE_FF",
    "RLL_RATE_IMAX",
    "RLL_RATE_FLTT",
    "RLL_RATE_FLTE",
    "RLL_RATE_FLTD",
    "RLL_RATE_SMAX",
    "RLL_ANGLE_P",
    "RLL2SRV_TCONST",
    "RLL2SRV_RMAX",
    "RLL2SRV_ACCEL",
    "PTCH_RATE_P",
    "PTCH_RATE_I",
    "PTCH_RATE_D",
    "PTCH_RATE_FF",
    "PTCH_RATE_IMAX",
    "PTCH_RATE_FLTT",
    "PTCH_RATE_FLTE",
    "PTCH_RATE_FLTD",
    "PTCH_RATE_SMAX",
    "PTCH_ANGLE_P",
    "PTCH2SRV_TCONST",
    "PTCH2SRV_RMAX_UP",
    "PTCH2SRV_RMAX_DN",
    "PTCH2SRV_RLL",
    "PTCH2SRV_ACCEL",
    "YAW2SRV_SLIP",
    "YAW2SRV_INT",
    "YAW2SRV_DAMP",
    "YAW2SRV_RLL",
    "YAW2SRV_IMAX",
    "YAW_RATE_ENABLE",
    "YAW_RATE_P",
    "YAW_RATE_I",
    "YAW_RATE_D",
    "YAW_RATE_FF",
    "STEER2SRV_TCONST",
    "STEER2SRV_P",
    "STEER2SRV_I",
    "STEER2SRV_D",
    "STEER2SRV_FF",
    "STEER2SRV_IMAX",
    "STEER2SRV_MINSPD",
    "GROUND_STEER_ALT",
    "NAVL1_PERIOD",
    "NAVL1_DAMPING",
    "NAVL1_XTRACK_I",
    "NAVL1_LIM_BANK",
    "TECS_TIME_CONST",
    "TECS_SPDWEIGHT",
    "TECS_THR_DAMP",
    "TECS_PTCH_DAMP",
    "TECS_INTEG_GAIN",
    "TECS_RLL2THR",
    "TECS_CLMB_MAX",
    "TECS_SINK_MIN",
    "TECS_SINK_MAX",
    "AIRSPEED_CRUISE",
    "AIRSPEED_MIN",
    "AIRSPEED_MAX",
    "SCALING_SPEED",
    "THR_MAX",
    "THR_MIN",
    "TRIM_THROTTLE",
    "PTCH_LIM_MAX_DEG",
    "PTCH_LIM_MIN_DEG",
    "WP_RADIUS",
    "WP_LOITER_RAD",
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
const MSG_SCALED_IMU: f32 = 26.0;
const MSG_SCALED_IMU2: f32 = 116.0;
const MSG_SCALED_IMU3: f32 = 129.0;
const MSG_MAG_CAL_PROGRESS: f32 = 191.0;
const MSG_MAG_CAL_REPORT: f32 = 192.0;
const MSG_EKF_STATUS_REPORT: f32 = 193.0;
const MSG_SYS_STATUS: f32 = 1.0;
const MSG_BATTERY_STATUS: f32 = 147.0;
const LOG_BLOCK: usize = 90;
const MAX_LOG_BYTES: usize = 512 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct OnboardLog {
    pub id: u16,
    pub num_logs: u16,
    pub last_log_num: u16,
    pub time_utc: u32,
    pub size: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogDownload {
    pub id: u16,
    pub size: u32,
    pub received: u32,
    pub complete: bool,
    pub path: String,
    pub error: String,
    pub updated_at: f64,
}

/// Header facts for one on-board log. Not part of the live sample stream.
#[derive(Debug, Clone, Serialize)]
pub struct LogBrief {
    pub id: u16,
    pub size: u32,
    pub firmware: String,
    pub frame: String,
    pub start_utc: String,
    pub duration_us: u64,
    pub error: String,
    #[serde(skip)]
    pub updated_at: f64,
}

struct ActiveLogDownload {
    id: u16,
    size: usize,
    bytes: Vec<u8>,
    received: Vec<u64>,
    received_chunks: usize,
    started: Instant,
    last_data: Instant,
    last_request: Instant,
    /// Bytes kept from the start. Zero means the whole file is being downloaded.
    peek_head: usize,
    peek_tail: usize,
}

const LOG_PEEK_HEAD: usize = 96 * 1024;
const LOG_PEEK_TAIL: usize = 8 * 1024;

/// Face the vehicle is asking for during a six-face accelerometer calibration.
#[derive(Debug, Clone, Serialize, Default)]
pub struct AccelCal {
    pub pos: u32,
    pub at: f64,
}

/// One compass while MAG_CAL_PROGRESS / MAG_CAL_REPORT are arriving.
#[derive(Debug, Clone, Serialize)]
pub struct MagCalSlot {
    pub id: u8,
    pub status: u8,
    pub attempt: u8,
    pub pct: u8,
    pub mask: [u8; 10],
    pub fitness: Option<f64>,
    pub ofs: [f64; 3],
    pub diag: [f64; 3],
    pub offdiag: [f64; 3],
    pub autosaved: Option<u8>,
}

impl MagCalSlot {
    fn fresh(id: u8) -> Self {
        Self {
            id,
            status: 0,
            attempt: 0,
            pct: 0,
            mask: [0; 10],
            fitness: None,
            ofs: [0.0; 3],
            diag: [0.0; 3],
            offdiag: [0.0; 3],
            autosaved: None,
        }
    }
}

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
    pub aspd: Option<f64>,
    pub gspd: Option<f64>,
    pub hdg: Option<f64>,
    pub thr_out: Option<f64>,
    /// Rangefinder distance, metres. DISTANCE_SENSOR is centimetres on the wire.
    pub rng_m: Option<f64>,
    /// RANGEFINDER voltage.
    pub rng_v: Option<f64>,
    /// OPTICAL_FLOW flow_comp_m_x, metres per second.
    pub flow_x: Option<f64>,
    /// OPTICAL_FLOW flow_comp_m_y, metres per second.
    pub flow_y: Option<f64>,
    /// OPTICAL_FLOW quality, 0–255.
    pub flow_q: Option<f64>,
    pub att_hz: u32,
    pub rx: String,
    pub frame: String,
    /// Board identity announced in the ArduPilot boot banner. Keep it after
    /// COMMAND_ACK events push the banner out of the short diagnostics queue.
    pub board_name: String,
    pub boot_uid: String,
    pub params: HashMap<String, f64>,
    /// RC_CHANNELS raw PWM, channel 1 first.
    pub rc: Vec<u16>,
    #[serde(skip)]
    pub param_received: HashMap<String, f64>,
    #[serde(skip)]
    pub param_indices: HashSet<u16>,
    pub param_count: u16,
    pub heartbeat_at: f64,
    #[serde(skip)]
    pub telemetry: HashMap<String, serde_json::Value>,
    /// Numeric MAVLink fields seen on this link, keyed `MESSAGE.field`.
    #[serde(default)]
    pub live_nums: HashMap<String, f64>,
    #[serde(skip)]
    pub events: Vec<serde_json::Value>,
    /// Newest first. STATUSTEXT from the vehicle.
    pub texts: Vec<String>,
    /// Compass calibration progress and the latest report, one slot per compass id.
    #[serde(default)]
    pub mag_cal: Vec<MagCalSlot>,
    /// Full accelerometer calibration. `pos` is the face the vehicle is asking for.
    #[serde(default)]
    pub accel_cal: AccelCal,
    /// Init dump progress. `init_total == 0` means not running.
    pub init_done: u32,
    pub init_total: u32,
    #[serde(default)]
    pub sitl_phase: String,
    #[serde(default)]
    pub sitl_detail: String,
    #[serde(default)]
    pub sitl_vehicle: String,
    #[serde(default)]
    pub sitl_running: bool,
    #[serde(default)]
    pub sitl_cpu: f32,
    #[serde(default)]
    pub sitl_rss_mb: f32,
    pub logs: Vec<OnboardLog>,
    pub log_list_expected: Option<u16>,
    pub log_list_at: f64,
    pub log_download: Option<LogDownload>,
    #[serde(skip)]
    pub log_briefs: Vec<LogBrief>,
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
            aspd: None,
            gspd: None,
            hdg: None,
            thr_out: None,
            rng_m: None,
            rng_v: None,
            flow_x: None,
            flow_y: None,
            flow_q: None,
            att_hz: 0,
            rx: String::new(),
            frame: String::new(),
            board_name: String::new(),
            boot_uid: String::new(),
            params: HashMap::new(),
            rc: Vec::new(),
            param_received: HashMap::new(),
            param_indices: HashSet::new(),
            param_count: 0,
            heartbeat_at: 0.0,
            telemetry: HashMap::new(),
            live_nums: HashMap::new(),
            events: Vec::new(),
            texts: Vec::new(),
            mag_cal: Vec::new(),
            accel_cal: AccelCal { pos: 0, at: 0.0 },
            init_done: 0,
            init_total: 0,
            sitl_phase: String::new(),
            sitl_detail: String::new(),
            sitl_vehicle: String::new(),
            sitl_running: false,
            sitl_cpu: 0.0,
            sitl_rss_mb: 0.0,
            logs: Vec::new(),
            log_list_expected: None,
            log_list_at: 0.0,
            log_download: None,
            log_briefs: Vec::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op")]
pub enum Cmd {
    #[serde(skip)]
    Calibrate { kind: String, reply: std::sync::mpsc::Sender<String> },
    /// `start`, `cancel`, or `accept` for MAV_CMD_DO_*_MAG_CAL. Not a parameter write.
    #[serde(skip)]
    MagCal { action: String, reply: std::sync::mpsc::Sender<String> },
    /// `start` or `pose` for the six-face accelerometer calibration.
    #[serde(skip)]
    AccelCalCmd { action: String, reply: std::sync::mpsc::Sender<String> },
    /// CompassMot. `start` asks the vehicle to arm and pass the throttle stick through. `finish` sends the ack that stops it.
    #[serde(skip)]
    CompassMot { action: String, reply: std::sync::mpsc::Sender<String> },
    /// Spin one motor for a few seconds. Percent is of the output range, not a flight throttle.
    #[serde(skip)]
    MotorTest {
        seq: u8,
        percent: f32,
        seconds: f32,
        reply: std::sync::mpsc::Sender<String>,
    },
    #[serde(rename = "param")]
    Param { name: String, value: f64 },
    /// Write a parameter file onto the vehicle. The reply channel is not JSON.
    #[serde(skip)]
    ParamsRestore {
        values: Vec<(String, f64)>,
        reply: std::sync::mpsc::Sender<Result<RestoreReport, String>>,
    },
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
    Init { params: HashMap<String, f64> },
    #[serde(rename = "param_read")]
    ParamRead { name: String },
    #[serde(rename = "params_list")]
    ParamsList,
    #[serde(rename = "diagnostics")]
    Diagnostics,
    #[serde(rename = "param_read_index")]
    ParamReadIndex { index: i16 },
    #[serde(rename = "reboot")]
    Reboot,
    #[serde(rename = "reboot_bootloader")]
    RebootBootloader,
    #[serde(rename = "log_list")]
    LogList,
    #[serde(rename = "log_download")]
    LogDownload { id: u16 },
    #[serde(skip)]
    LogPeek { id: u16, size: u32 },
    #[serde(rename = "log_erase")]
    LogErase,
    #[serde(rename = "log_end")]
    LogEnd,
    #[serde(rename = "log_cancel")]
    LogCancel,
    #[serde(rename = "sitl_start")]
    SitlStart {
        vehicle: String,
        wipe: bool,
        home: String,
        speedup: f64,
    },
    #[serde(rename = "sitl_stop")]
    SitlStop,
    /// List, read, write, or delete a Lua script, or reload the scripting engine.
    #[serde(skip)]
    Script {
        job: ScriptJob,
        reply: std::sync::mpsc::Sender<Result<serde_json::Value, String>>,
    },
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
    // 14550/14551 are the GCS UDP ports. A bare host:port was opened as TCP and never heard the vehicle.
    if let Some((_, port)) = s.rsplit_once(':') {
        if port == "14550" || port == "14551" {
            return format!("udpout:{s}");
        }
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
    active_log_download: Option<ActiveLogDownload>,
    params_cached_at: f64,
    params_cache_full: bool,
    params_cache_key: String,
    params_fill_at: Instant,
    params_list_tries: u8,
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
            active_log_download: None,
            params_cached_at: 0.0,
            params_cache_full: false,
            params_cache_key: String::new(),
            params_fill_at: Instant::now(),
            params_list_tries: 0,
        }
    }
}
