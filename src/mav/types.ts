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
  att_hz: number;
  rx: string;
  /** HEARTBEAT.type → copter | plane. Empty until the vehicle speaks. */
  frame: "copter" | "plane" | "";
  params: Record<string, number>;
  /** STATUSTEXT, newest first. Optional so older bridge samples still parse. */
  texts?: string[];
  init_done?: number;
  init_total?: number;
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
  | { op: "reboot" };
