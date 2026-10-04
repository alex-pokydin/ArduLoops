export type Sample = {
  ok: boolean;
  detail: string;
  t: number;
  mode: string;
  armed: boolean;
  roll: number;
  pitch: number;
  yaw: number;
  rate: number;
  pitch_rate: number;
  yaw_rate: number;
  des: number | null;
  pitch_des: number | null;
  yaw_des: number | null;
  p: number | null;
  i: number | null;
  d: number | null;
  pitch_p: number | null;
  pitch_i: number | null;
  pitch_d: number | null;
  yaw_p: number | null;
  yaw_i: number | null;
  yaw_d: number | null;
  gain_p: number | null;
  gain_i: number | null;
  gain_d: number | null;
  input_tc: number | null;
  acc_max: number | null;
  rate_max: number | null;
  cmd: number;
  pitch_cmd: number;
  yaw_cmd: number;
  tar: number | null;
  pitch_tar: number | null;
  yaw_tar: number | null;
  alt: number | null;
  alt_tar: number | null;
  climb: number | null;
  /** Desired climb (up +), m/s. PSC_D_POS output ≈ P × height error. */
  climb_des: number | null;
  /** Throttle stick throw, % (−100…+100). 0 = mid / no override. */
  thr_cmd: number;
  /** VFR_HUD airspeed m/s. Plane plant scaler. */
  aspd: number | null;
  gspd: number | null;
  hdg: number | null;
  /** VFR_HUD throttle 0…100. */
  thr_out: number | null;
  /** Rangefinder distance, metres. */
  rng_m?: number | null;
  /** RANGEFINDER voltage. */
  rng_v?: number | null;
  /** OPTICAL_FLOW flow_comp_m_x, metres per second. */
  flow_x?: number | null;
  /** OPTICAL_FLOW flow_comp_m_y, metres per second. */
  flow_y?: number | null;
  /** OPTICAL_FLOW quality, 0–255. */
  flow_q?: number | null;
  /** MAVLink fields that have arrived, keyed `MESSAGE.field`. */
  live_nums?: Record<string, number>;
  att_hz: number;
  rx: string;
  /** HEARTBEAT.type → copter | plane. Empty until the vehicle speaks. */
  frame: "copter" | "plane" | "";
  board_name?: string;
  boot_uid?: string;
  params: Record<string, number>;
  /** PARAM_VALUE count announced by the vehicle. The backup is full only when `params` reaches it. */
  param_count?: number;
  /** Unix seconds of the last HEARTBEAT. Optional on older samples. */
  heartbeat_at?: number;
  /** RC_CHANNELS raw PWM, channel 1 first, up to 18. Empty until a frame arrives. */
  rc?: number[];
  /** STATUSTEXT, newest first. Optional so older bridge samples still parse. */
  texts?: string[];
  /** Face the vehicle is asking for during a six-face accelerometer calibration. */
  accel_cal?: { pos: number; at: number };
  /** Compass calibration progress and the latest report for each compass id. */
  mag_cal?: {
    id: number;
    status: number;
    attempt: number;
    pct: number;
    mask: number[];
    fitness: number | null;
    ofs: number[];
    diag: number[];
    offdiag: number[];
    autosaved: number | null;
  }[];
  /** Live DataFlash transfer. Absent until a download starts. */
  log_download?: {
    id: number;
    size: number;
    received: number;
    complete: boolean;
    path: string;
    error: string;
  };
  init_done?: number;
  init_total?: number;
  sitl_phase?: string;
  sitl_detail?: string;
  sitl_vehicle?: string;
  sitl_running?: boolean;
  sitl_cpu?: number;
  sitl_rss_mb?: number;
};

export const EMPTY: Sample = {
  ok: false,
  detail: "немає лінку",
  t: 0,
  mode: "?",
  armed: false,
  roll: 0,
  pitch: 0,
  yaw: 0,
  rate: 0,
  pitch_rate: 0,
  yaw_rate: 0,
  des: null,
  pitch_des: null,
  yaw_des: null,
  p: null,
  i: null,
  d: null,
  pitch_p: null,
  pitch_i: null,
  pitch_d: null,
  yaw_p: null,
  yaw_i: null,
  yaw_d: null,
  gain_p: null,
  gain_i: null,
  gain_d: null,
  input_tc: null,
  acc_max: null,
  rate_max: null,
  cmd: 0,
  pitch_cmd: 0,
  yaw_cmd: 0,
  tar: null,
  pitch_tar: null,
  yaw_tar: null,
  alt: null,
  alt_tar: null,
  climb: null,
  climb_des: null,
  thr_cmd: 0,
  aspd: null,
  gspd: null,
  hdg: null,
  thr_out: null,
  att_hz: 0,
  rx: "",
  frame: "",
  params: {},
};

export type Cmd =
  | { op: "param"; name: string; value: number }
  | { op: "preset"; name: string }
  | { op: "tune"; p: number; i: number; d: number }
  | { op: "mode"; mode: string }
  | { op: "arm"; on: boolean }
  | { op: "hover" }
  | { op: "land" }
  | { op: "stick"; roll: number; pitch: number; yaw: number; thr: number }
  | { op: "release" }
  | { op: "connect"; url: string }
  | { op: "disconnect" }
  | { op: "init"; params: Record<string, number> }
  | { op: "param_read"; name: string }
  | { op: "params_list" }
  | { op: "reboot" }
  | { op: "sitl_start"; vehicle: "copter" | "plane"; wipe: boolean; home: string; speedup: number }
  | { op: "sitl_stop" };
