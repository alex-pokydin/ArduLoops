import {
  GYRO_NOTCH,
  cardMarks,
  hasKnobs,
  pidTerms,
  type AxisFocus,
  type Band,
  type EdgeDef,
  type Gain,
  type NodeDef,
} from "./lib/gains";
import { layoutRanks, type CascadeLayout } from "./lib/layout";

export {
  GYRO_NOTCH,
  cardMarks,
  hasKnobs,
  pidTerms,
  type AxisFocus,
  type Band,
  type EdgeDef,
  type Gain,
  type NodeDef,
};
export type { CascadeLayout, GroupBox, NodeBox, RankBox } from "./lib/layout";
export { edgeRoute } from "./lib/layout";

/** First Flight Tuning: rate, angle, stick, hover. */
export function isTuneNode(node: NodeDef): boolean {
  return !!node.guide;
}

/** Sometimes, after ATC: Loiter weave — not the Stabilize pass. */
export function isLaterNode(node: NodeDef): boolean {
  return !!node.later;
}


export const NODES: NodeDef[] = [
  {
    id: "pilot",
    title: "Pilot stick",
    param: "RC / sticks",
    kind: "command",
    unit: "stick",
    axes: "cmd",
    does: "The stick request. Stabilize wants an angle, AltHold a climb rate (PILOT_SPD_UP / DN), Loiter a lean/accel, Acro a rate. TC / ACC / Rmax only shape how fast that request may change (Input Shaping).",
    trap: "Do not raise ACC or Rmax past Autotune to “get more P”. That is feel, not stability. If AltHold creeps, hover is not mid-stick — set MOT_THST_HOVER, do not touch PSC yet.",
    live: ["cmd"],
    guide: true,
    gains: [
      { key: "ATC_INPUT_TC", label: "TC", min: 0, max: 0.5, step: 0.01, digits: 2 },
      { key: "ATC_ACC_R_MAX", label: "ACC", min: 0, max: 1800, step: 20, digits: 0, aliases: ["ATC_ACC_P_MAX"] },
      { key: "ATC_RATE_R_MAX", label: "Rmax", min: 0, max: 360, step: 10, digits: 0, aliases: ["ATC_RATE_P_MAX"] },
      { key: "PILOT_SPD_UP", label: "up", min: 0.5, max: 5, step: 0.1, digits: 1, legacy: { key: "PILOT_SPEED_UP", scale: 100 } },
      { key: "PILOT_SPD_DN", label: "dn", min: 0, max: 5, step: 0.1, digits: 1, legacy: { key: "PILOT_SPEED_DN", scale: 100 } },
    ],
  },
  {
    id: "nav",
    title: "Navigation",
    param: "WP_SPD / LOIT_SPEED_MS",
    kind: "targets",
    unit: "m · NED",
    axes: "nav",
    does: "Writes where PSC should hold, and how fast to get there. WP_SPD is mission cruise; LOIT_SPEED_MS is stick speed in Loiter. Live in Loiter / Auto / RTL — idle in Stabilize.",
    trap: "Drifting in Loiter is GPS, compass, vibe or PSC. These speeds only cap how fast it flies the path — raising them will not hold position.",
    later: true,
    gains: [
      { key: "WP_SPD", label: "WP", min: 0.5, max: 20, step: 0.5, digits: 1, legacy: { key: "WPNAV_SPEED", scale: 100 } },
      { key: "LOIT_SPEED_MS", label: "Loit", min: 0.5, max: 20, step: 0.5, digits: 1, legacy: { key: "LOIT_SPEED", scale: 100 } },
    ],
  },
  {
    id: "psc_ne_pos",
    title: "NE position",
    param: "PSC_NE_POS_P",
    kind: "P",
    unit: "m · NED NE",
    axes: "ne",
    does: "Holds North–East in metres: position error → desired horizontal speed. P only.",
    trap: "Leave stock until attitude is tuned. Raising P will not fix a bad rate loop or a bad mag.",
    later: true,
    gains: [
      { key: "PSC_NE_POS_P", label: "P", min: 0.2, max: 3, step: 0.05, digits: 2 },
    ],
  },
  {
    id: "psc_d_pos",
    title: "D position",
    param: "PSC_D_POS_P",
    kind: "P",
    unit: "m · NED D+",
    axes: "d",
    does: "Holds height: AGL error (−D) → desired climb. P only. D+ is down.",
    trap: "Too much P → jerky throttle. Switching into AltHold while climbing makes motors dip, then catch — enter while level.",
    live: ["alt"],
    later: true,
    gains: [
      { key: "PSC_D_POS_P", label: "P", min: 0.2, max: 3, step: 0.05, digits: 2 },
    ],
  },
  {
    id: "psc_ne_vel",
    title: "NE velocity",
    param: "PSC_NE_VEL_*",
    kind: "speed → lean",
    unit: "m/s · NED NE",
    axes: "ne",
    does: "Turns “go there” into a lean request: speed error → desired NE acceleration. There is no separate horizontal accel PID.",
    trap: "If Loiter weaves after a good ATC tune, look here — not at Navigation. Too much D twitches the lean.",
    later: true,
    gains: [
      { key: "PSC_NE_VEL_P", label: "P", min: 0.3, max: 5, step: 0.05, digits: 2 },
      { key: "PSC_NE_VEL_I", label: "I", min: 0, max: 3, step: 0.05, digits: 2 },
      { key: "PSC_NE_VEL_D", label: "D", min: 0, max: 1, step: 0.01, digits: 2 },
    ],
    extras: [
      { key: "PSC_NE_VEL_FLTE", label: "FLTE", min: 0, max: 100, step: 1, digits: 0 },
      { key: "PSC_NE_VEL_FLTD", label: "FLTD", min: 0, max: 100, step: 1, digits: 0 },
      { key: "PSC_NE_VEL_IMAX", label: "IMAX", min: 0, max: 10, step: 0.1, digits: 1 },
      { key: "PSC_NE_VEL_FF", label: "FF", min: 0, max: 10, step: 0.01, digits: 2 },
    ],
  },
  {
    id: "psc_d_vel",
    title: "D velocity",
    param: "PSC_D_VEL_*",
    kind: "climb → accel",
    unit: "m/s · NED D+",
    axes: "d",
    does: "Turns the climb command into vertical acceleration. Usually left at defaults.",
    trap: "Do not chase bounce on this P. Check vibe and PSC_D_ACC I (keep P:I ≈ 1:2) first.",
    live: ["climb"],
    later: true,
    gains: [
      { key: "PSC_D_VEL_P", label: "P", min: 1, max: 12, step: 0.1, digits: 1 },
      { key: "PSC_D_VEL_I", label: "I", min: 0, max: 4, step: 0.05, digits: 2 },
      { key: "PSC_D_VEL_D", label: "D", min: 0, max: 1, step: 0.01, digits: 2 },
    ],
    extras: [
      { key: "PSC_D_VEL_FLTE", label: "FLTE", min: 0, max: 100, step: 1, digits: 0 },
      { key: "PSC_D_VEL_FLTD", label: "FLTD", min: 0, max: 100, step: 1, digits: 0 },
      { key: "PSC_D_VEL_IMAX", label: "IMAX", min: 1, max: 10, step: 0.1, digits: 1 },
      { key: "PSC_D_VEL_FF", label: "FF", min: 0, max: 2, step: 0.01, digits: 2 },
    ],
  },
  {
    id: "lean",
    title: "lean angle",
    param: "ATC_ANGLE_MAX",
    kind: "geometry",
    unit: "° · roll/pitch",
    axes: "lean",
    does: "NE acceleration (earth, m/s²) becomes roll/pitch (body, °). ATC_ANGLE_MAX is the lean ceiling. Between PosControl and Attitude.",
    trap: "Not Loiter speed — that is LOIT_SPEED_MS on Navigation. Raising ANGLE_MAX only lets it tilt more. Wrong lean still usually means velocity PID or ATC.",
    later: true,
    gains: [
      { key: "ATC_ANGLE_MAX", label: "Ang", min: 10, max: 80, step: 1, digits: 0, legacy: { key: "ANGLE_MAX", scale: 100 } },
    ],
  },
  {
    id: "psc_d_acc",
    title: "D acceleration",
    param: "PSC_D_ACC_*",
    kind: "accel → throttle",
    unit: "m/s² · throttle",
    axes: "d",
    does: "Throttle from vertical accel error. Skips the angle loop — motors get force, not a tilt.",
    trap: "Never raise P/I; powerful frames may cut both ~50%. Keep I ≈ 2×P. I = 0 fails pre-arm. High vibe → runaway climb in AltHold.",
    later: true,
    gains: [
      { key: "PSC_D_ACC_P", label: "P", min: 0.01, max: 0.3, step: 0.005, digits: 3 },
      { key: "PSC_D_ACC_I", label: "I", min: 0, max: 0.5, step: 0.01, digits: 2 },
      { key: "PSC_D_ACC_D", label: "D", min: 0, max: 0.05, step: 0.001, digits: 3 },
    ],
    extras: [
      { key: "PSC_D_ACC_FLTT", label: "FLTT", min: 0, max: 50, step: 1, digits: 0 },
      { key: "PSC_D_ACC_FLTE", label: "FLTE", min: 0, max: 100, step: 1, digits: 0 },
      { key: "PSC_D_ACC_FLTD", label: "FLTD", min: 0, max: 100, step: 1, digits: 0 },
      { key: "PSC_D_ACC_IMAX", label: "IMAX", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "PSC_D_ACC_SMAX", label: "SMAX", min: 0, max: 200, step: 0.5, digits: 1 },
      { key: "PSC_D_ACC_FF", label: "FF", min: 0, max: 0.1, step: 0.001, digits: 3 },
    ],
  },
  {
    id: "atc_ang",
    title: "angle → rate",
    param: "ATC_ANG_*_P",
    kind: "P only",
    inner: true,
    unit: "° · body",
    axes: "att",
    does: "Angle error → how fast to rotate (rate command). P only. Motors cannot “be 10°”.",
    trap: "High P → oscillate; low P → sluggish. Do not crank ANG P to hide a weak rate tune. Autotune sets this after rate.",
    live: ["tar", "cmd"],
    guide: true,
    gains: [
      {
        key: "ATC_ANG_RLL_P",
        label: "ANG P",
        min: 1,
        max: 8,
        step: 0.1,
        digits: 1,
        aliases: ["ATC_ANG_PIT_P"],
      },
    ],
  },
  {
    id: "atc_rat",
    title: "rate → torque",
    param: "ATC_RAT_RLL/PIT_*",
    kind: "rate → torque",
    inner: true,
    unit: "°/s · body",
    axes: "rate",
    does: "The loop you actually fly: °/s error → mixer torque. Rate P is the first parameter that matters.",
    trap: "Tune in Stabilize before Autotune. Oscillation → lower P/D, not more I. Fix gyro notch/vibe before chasing D. Yaw is separate (small I, D often 0).",
    live: ["des", "rate"],
    guide: true,
    gains: [
      { key: "ATC_RAT_RLL_P", label: "P", min: 0.01, max: 1.2, step: 0.001, digits: 3, tune: "p", aliases: ["ATC_RAT_PIT_P"] },
      { key: "ATC_RAT_RLL_I", label: "I", min: 0, max: 0.5, step: 0.001, digits: 3, tune: "i", aliases: ["ATC_RAT_PIT_I"] },
      { key: "ATC_RAT_RLL_D", label: "D", min: 0, max: 0.02, step: 0.0001, digits: 4, tune: "d", aliases: ["ATC_RAT_PIT_D"] },
    ],
    extras: [
      { key: "ATC_RAT_RLL_FLTT", label: "FLTT", min: 0, max: 100, step: 1, digits: 0, aliases: ["ATC_RAT_PIT_FLTT"] },
      { key: "ATC_RAT_RLL_FLTE", label: "FLTE", min: 0, max: 100, step: 1, digits: 0, aliases: ["ATC_RAT_PIT_FLTE"] },
      { key: "ATC_RAT_RLL_FLTD", label: "FLTD", min: 0, max: 100, step: 1, digits: 0, aliases: ["ATC_RAT_PIT_FLTD"] },
      { key: "ATC_RAT_RLL_IMAX", label: "IMAX", min: 0, max: 1, step: 0.01, digits: 2, aliases: ["ATC_RAT_PIT_IMAX"] },
      { key: "ATC_RAT_RLL_SMAX", label: "SMAX", min: 0, max: 200, step: 0.5, digits: 1, aliases: ["ATC_RAT_PIT_SMAX"] },
      { key: "ATC_RAT_RLL_FF", label: "FF", min: 0, max: 0.5, step: 0.001, digits: 3, aliases: ["ATC_RAT_PIT_FF"] },
    ],
  },
  {
    id: "motors",
    title: "Motors",
    param: "AP_Motors",
    kind: "mixer",
    unit: "torque + throttle",
    axes: "mix",
    does: "Mixer: rate torque plus vertical-accel throttle. Hover should sit near mid stick — that is MOT_THST_HOVER.",
    trap: "Hover should sit near mid stick (~50%). That is MOT_THST_HOVER below. Above ~70% the frame is underpowered — motors/props, not PIDs.",
    live: ["roll"],
    guide: true,
    gains: [
      { key: "MOT_THST_HOVER", label: "hover", min: 0.2, max: 0.8, step: 0.01, digits: 2 },
    ],
  },
];

export const EDGES: EdgeDef[] = [
  { from: "pilot", to: "atc_ang", label: "want angle" },
  { from: "pilot", to: "nav", label: "stick = lean/accel" },
  { from: "pilot", to: "psc_d_pos", label: "stick = climb" },
  { from: "pilot", to: "atc_rat", label: "stick = rate" },
  { from: "nav", to: "psc_ne_pos", label: "XY target" },
  { from: "nav", to: "psc_d_pos", label: "D target" },
  { from: "psc_ne_pos", to: "psc_ne_vel", label: "desired Vxy" },
  { from: "psc_d_pos", to: "psc_d_vel", label: "desired Vd" },
  { from: "psc_ne_vel", to: "lean", label: "accel NE" },
  { from: "lean", to: "atc_ang", label: "desired roll/pitch" },
  { from: "psc_d_vel", to: "psc_d_acc", label: "desired ad" },
  { from: "psc_d_acc", to: "motors", label: "throttle" },
  { from: "atc_ang", to: "atc_rat", label: "desired rate" },
  { from: "atc_rat", to: "motors", label: "torque" },
];

const MODE_NODES: Record<string, string[]> = {
  ACRO: ["pilot", "atc_ang", "atc_rat", "motors"],
  STABILIZE: ["pilot", "atc_ang", "atc_rat", "motors"],
  ALT_HOLD: ["pilot", "atc_ang", "atc_rat", "motors", "psc_d_pos", "psc_d_vel", "psc_d_acc"],
  LOITER: [
    "pilot", "nav",
    "psc_ne_pos", "psc_ne_vel", "lean",
    "psc_d_pos", "psc_d_vel", "psc_d_acc",
    "atc_ang", "atc_rat", "motors",
  ],
  POSHOLD: [
    "pilot", "nav",
    "psc_ne_pos", "psc_ne_vel", "lean",
    "psc_d_pos", "psc_d_vel", "psc_d_acc",
    "atc_ang", "atc_rat", "motors",
  ],
  LAND: [
    "nav",
    "psc_ne_pos", "psc_ne_vel", "lean",
    "psc_d_pos", "psc_d_vel", "psc_d_acc",
    "atc_ang", "atc_rat", "motors",
  ],
  RTL: [
    "nav",
    "psc_ne_pos", "psc_ne_vel", "lean",
    "psc_d_pos", "psc_d_vel", "psc_d_acc",
    "atc_ang", "atc_rat", "motors",
  ],
};

const OUTER = ["nav", "psc_ne_pos", "psc_ne_vel", "lean", "psc_d_pos", "psc_d_vel", "psc_d_acc"];

export type BandId = "outer" | "inner";

export function isBandId(id: string | null | undefined): id is BandId {
  return id === "outer" || id === "inner";
}

export const BAND_LABEL: Record<Band, string> = {
  ends: "command · plant",
  outer: "PosControl",
  inner: "Attitude",
};

export const BAND_COPY: Record<BandId, { kind: string; unit: string; does: string; more: string; trap: string }> = {
  outer: {
    kind: "PSC",
    unit: "m · NED",
    does: "Holds where to be: position → velocity → acceleration. North–East is metres on the earth; Down is height. Horizontal output is lean. Vertical accel goes straight to throttle.",
    more: "Vertical skips Attitude: Down acceleration (PSC_D_ACC) goes straight to throttle. Navigation writes the place and speed for PSC to hold.",
    trap: "Leave stock until attitude is tuned. Autotune does not write PSC. If Loiter still weaves, NE velocity is the next knob — not Navigation.",
  },
  inner: {
    kind: "ATC",
    unit: "° · body",
    does: "Holds the angle. Motors cannot “be 10°” — only thrust. Angle error becomes a rate command; the rate loop turns °/s error into mixer torque.",
    more: "Yaw is the same two loops. Vertical does not come here: D acceleration stays in PosControl and goes to throttle.",
    trap: "Tune rate first (Manual / QuikTune / AutoTune), then angle P, then stick feel. Do not crank ANG P to hide a weak rate.",
  },
};

export const LAYERS: { label: string; ids: string[]; band: Band }[] = [
  { label: "command", ids: ["pilot", "nav"], band: "ends" },
  { label: "position", ids: ["psc_ne_pos", "psc_d_pos"], band: "outer" },
  { label: "velocity", ids: ["psc_ne_vel", "psc_d_vel"], band: "outer" },
  { label: "acceleration", ids: ["lean", "psc_d_acc"], band: "outer" },
  { label: "angle", ids: ["atc_ang"], band: "inner" },
  { label: "angular rate (rate)", ids: ["atc_rat"], band: "inner" },
  { label: "actuator", ids: ["motors"], band: "ends" },
];

export function nodeBand(id: string): Band {
  return LAYERS.find((l) => l.ids.includes(id))?.band ?? "outer";
}

export function layoutCopter(width: number, height = 0): CascadeLayout {
  return layoutRanks(LAYERS, width, BAND_LABEL, height);
}

export function nodesLiveIn(mode: string): Set<string> {
  const m = (mode || "").toUpperCase();
  if (m === "ALL") return new Set(NODES.map((n) => n.id));
  const listed = MODE_NODES[m];
  if (listed) return new Set(listed);
  return new Set(NODES.map((n) => n.id));
}

export function edgeLiveIn(edge: EdgeDef, mode: string, live: Set<string>): boolean {
  const m = (mode || "").toUpperCase();
  if (m === "ALL") return true;
  if (edge.from === "pilot" && edge.to === "atc_ang") {
    return m === "STABILIZE" || m === "ALT_HOLD";
  }
  if (edge.from === "pilot" && edge.to === "atc_rat") return m === "ACRO";
  if (edge.from === "pilot" && edge.to === "nav") {
    return m !== "STABILIZE" && m !== "ALT_HOLD" && m !== "ACRO";
  }
  if (edge.from === "pilot" && edge.to === "psc_d_pos") {
    return m !== "STABILIZE" && m !== "ACRO";
  }
  if (OUTER.includes(edge.from) || OUTER.includes(edge.to)) {
    if (m === "STABILIZE" || m === "ACRO") return false;
    if (m === "ALT_HOLD") {
      return live.has(edge.from) && live.has(edge.to);
    }
  }
  return live.has(edge.from) && live.has(edge.to);
}

