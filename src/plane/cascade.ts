import type { Band, EdgeDef, NodeDef } from "../lib/gains";
import { layoutRanks, type CascadeLayout } from "../lib/layout";
import type { Sample } from "../mav/types";

export type { Band, EdgeDef, NodeDef };

export type BandId = "outer" | "inner";

export function isBandId(id: string | null | undefined): id is BandId {
  return id === "outer" || id === "inner";
}

export const BAND_LABEL: Record<Band, string> = {
  ends: "command · plant",
  outer: "Navigate",
  inner: "Attitude",
};

export const BAND_COPY: Record<BandId, { kind: string; unit: string; does: string; more: string; trap: string }> = {
  outer: {
    kind: "L1 + TECS",
    unit: "track · energy",
    does: "L1 turns cross-track error into a desired bank for the roll loop. TECS shares height and airspeed: one energy, two outputs — pitch and throttle. Live in AUTO / LOITER / RTL / GUIDED / TAKEOFF; TECS also in FBWB / CRUISE.",
    more: "Tune after the wing holds bank in FBWA. NAVL1_PERIOD smaller = tighter turns. TECS_SPDWEIGHT mixes height vs speed: 0 height, 2 speed, 1 both.",
    trap: "Do not hunt a ‘height P’ here. If the nose porpoises, the pitch rate loop is still wrong — go back to Rate.",
  },
  inner: {
    kind: "RLL / PTCH",
    unit: "° · body → servo",
    does: "Angle error becomes a rate command (TCONST). Rate FF then moves aileron or elevator. Authority grows with airspeed. Tune in FBWA.",
    more: "Yaw is a damper on the rudder: DAMP resists gyro z; RLL coordinates from measured AHRS bank. Ground steer writes the nosewheel below GROUND_STEER_ALT.",
    trap: "Tune in FBWA, not MANUAL. FF until desired rate matches achieved, then I = FF, then P, then D. Pitch P is usually about half of roll.",
  },
};

export const NODES: NodeDef[] = [
  {
    id: "pilot",
    title: "Pilot stick",
    param: "RC / sticks",
    kind: "command",
    unit: "stick",
    axes: "cmd",
    does: "In FBWA the stick asks for roll and pitch angle; the left stick is still throttle. In MANUAL the stick is the surface. In ACRO the stick is a rate. AUTO / RTL ignore the stick for the path.",
    trap: "Inner tuning in MANUAL does nothing — the autopilot is not in the loop. Switch to FBWA.",
    live: ["cmd"],
    guide: true,
    gains: [],
  },
  {
    id: "nav",
    title: "Navigation",
    param: "WP_RADIUS / WP_LOITER_RAD",
    kind: "targets",
    unit: "track · altitude",
    axes: "nav",
    does: "In AUTO / LOITER / RTL / GUIDED / TAKEOFF this writes the ground track and the altitude to hold. WP_RADIUS is how close is ‘there’; WP_LOITER_RAD is the circle.",
    trap: "Drifting off the line is often a weak roll loop, not L1. Tune Rate in FBWA before touching NAVL1_PERIOD or WP_RADIUS.",
    later: true,
    gains: [
      { key: "WP_RADIUS", label: "WP", min: 5, max: 200, step: 1, digits: 0 },
      { key: "WP_LOITER_RAD", label: "Loit", min: 20, max: 200, step: 5, digits: 0 },
    ],
  },
  {
    id: "navl1",
    title: "L1 track",
    param: "NAVL1_*",
    kind: "track → bank",
    unit: "desired roll",
    axes: "nav",
    does: "Reads cross-track error and asks the roll loop for a bank. Period is the main knob — smaller is a tighter turn. Live whenever nav is flying the line.",
    trap: "Soft tracking is often a weak roll loop, not L1. Tune Rate first. Raising period will not hold a wing that cannot hold bank.",
    later: true,
    gains: [
      { key: "NAVL1_PERIOD", label: "Per", min: 5, max: 60, step: 0.5, digits: 1 },
      { key: "NAVL1_DAMPING", label: "Damp", min: 0.4, max: 1.2, step: 0.05, digits: 2 },
    ],
  },
  {
    id: "tecs",
    title: "TECS energy",
    param: "TECS_*",
    kind: "energy mix",
    unit: "pitch + throttle",
    axes: "energy",
    does: "Shares height and airspeed: one energy, two outputs — desired pitch and throttle. Live in AUTO / FBWB / CRUISE / RTL / LOITER. Click this card for W and TIME_CONST; expand the scheme and click a block for extra limits.",
    trap: "SPDWEIGHT 0 = pitch holds height; 2 = pitch holds speed (glider); 1 = mix. Tune pitch rate before TECS.",
    live: ["alt", "aspd"],
    later: true,
    gains: [
      { key: "TECS_TIME_CONST", label: "TC", min: 3, max: 10, step: 0.5, digits: 1 },
      { key: "TECS_SPDWEIGHT", label: "W", min: 0, max: 2, step: 0.1, digits: 1 },
    ],
  },
  {
    id: "rll_ang",
    title: "Roll angle",
    param: "RLL2SRV_TCONST",
    kind: "P / TCONST",
    inner: true,
    unit: "° · roll",
    axes: "att",
    does: "Turns demanded bank into a roll-rate command. FBWA / TRAINING / STABILIZE / FBWB / CRUISE: the stick is the demand. AUTO: L1 writes the demand. TCONST is how fast that happens. If ANGLE_P is 0, P = 1/TCONST.",
    trap: "Do not crank TCONST down to hide a weak rate loop. Rate FF first.",
    live: ["tar", "cmd"],
    guide: true,
    gains: [
      { key: "RLL2SRV_TCONST", label: "TC", min: 0.2, max: 1, step: 0.05, digits: 2 },
      { key: "RLL_ANGLE_P", label: "ANG P", min: 0, max: 8, step: 0.1, digits: 1 },
    ],
    extras: [
      { key: "RLL2SRV_RMAX", label: "Rmax", min: 0, max: 360, step: 5, digits: 0 },
      { key: "RLL2SRV_ACCEL", label: "ACC", min: 0, max: 1800, step: 20, digits: 0 },
    ],
  },
  {
    id: "ptch_ang",
    title: "Pitch angle",
    param: "PTCH2SRV_TCONST",
    kind: "P / TCONST",
    inner: true,
    unit: "° · pitch",
    axes: "att",
    does: "Turns demanded pitch into an elevator-rate command. FBWA: the stick. AUTO / FBWB: TECS writes the demand. PTCH2SRV_RLL adds pitch in a bank so the nose does not drop.",
    trap: "Porpoise in FBWA is usually PTCH_RATE, not TCONST. Check Rate before touching this.",
    live: ["tar"],
    guide: true,
    gains: [
      { key: "PTCH2SRV_TCONST", label: "TC", min: 0.2, max: 1, step: 0.05, digits: 2 },
      { key: "PTCH_ANGLE_P", label: "ANG P", min: 0, max: 8, step: 0.1, digits: 1 },
    ],
    extras: [
      { key: "PTCH2SRV_RMAX_UP", label: "Up", min: 0, max: 360, step: 5, digits: 0 },
      { key: "PTCH2SRV_RMAX_DN", label: "Dn", min: 0, max: 360, step: 5, digits: 0 },
      { key: "PTCH2SRV_RLL", label: "RLL", min: 0.5, max: 1.5, step: 0.05, digits: 2 },
    ],
  },
  {
    id: "rll_rate",
    title: "Roll rate",
    param: "RLL_RATE_*",
    kind: "rate + FF",
    inner: true,
    unit: "°/s · aileron",
    axes: "rate",
    does: "Turns demanded °/s into aileron. FF is the lead — like the stick in MANUAL. Then I = FF, then P, then D. Live in every flying mode except MANUAL.",
    trap: "FBWA, not MANUAL. Match FF to surface, set I = FF, then add P, then D. Do not copy pitch numbers onto roll.",
    live: ["des", "rate"],
    guide: true,
    gains: [
      { key: "RLL_RATE_FF", label: "FF", min: 0, max: 0.8, step: 0.005, digits: 3 },
      { key: "RLL_RATE_P", label: "P", min: 0, max: 0.5, step: 0.005, digits: 3 },
      { key: "RLL_RATE_I", label: "I", min: 0, max: 0.8, step: 0.005, digits: 3 },
      { key: "RLL_RATE_D", label: "D", min: 0, max: 0.05, step: 0.001, digits: 3 },
    ],
    extras: [
      { key: "RLL_RATE_FLTT", label: "FLTT", min: 0, max: 100, step: 1, digits: 0 },
      { key: "RLL_RATE_FLTE", label: "FLTE", min: 0, max: 100, step: 1, digits: 0 },
      { key: "RLL_RATE_FLTD", label: "FLTD", min: 0, max: 100, step: 1, digits: 0 },
      { key: "RLL_RATE_IMAX", label: "IMAX", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "RLL_RATE_SMAX", label: "SMAX", min: 0, max: 200, step: 0.5, digits: 1 },
    ],
  },
  {
    id: "ptch_rate",
    title: "Pitch rate",
    param: "PTCH_RATE_*",
    kind: "rate + FF",
    inner: true,
    unit: "°/s · elevator",
    axes: "rate",
    does: "Turns demanded °/s into elevator. Same FF-first order as roll. Default P is about half of roll — the tail is a different surface.",
    trap: "Copying RLL_RATE_P onto pitch will porpoise. Independent writes. Same FF-first order.",
    live: ["des", "rate"],
    guide: true,
    gains: [
      { key: "PTCH_RATE_FF", label: "FF", min: 0, max: 0.8, step: 0.005, digits: 3 },
      { key: "PTCH_RATE_P", label: "P", min: 0, max: 0.4, step: 0.005, digits: 3 },
      { key: "PTCH_RATE_I", label: "I", min: 0, max: 0.8, step: 0.005, digits: 3 },
      { key: "PTCH_RATE_D", label: "D", min: 0, max: 0.05, step: 0.001, digits: 3 },
    ],
    extras: [
      { key: "PTCH_RATE_FLTT", label: "FLTT", min: 0, max: 100, step: 1, digits: 0 },
      { key: "PTCH_RATE_FLTE", label: "FLTE", min: 0, max: 100, step: 1, digits: 0 },
      { key: "PTCH_RATE_FLTD", label: "FLTD", min: 0, max: 100, step: 1, digits: 0 },
      { key: "PTCH_RATE_IMAX", label: "IMAX", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "PTCH_RATE_SMAX", label: "SMAX", min: 0, max: 200, step: 0.5, digits: 1 },
    ],
  },
  {
    id: "yaw_damp",
    title: "Yaw damper",
    param: "YAW2SRV_*",
    kind: "damper",
    inner: true,
    unit: "rudder",
    axes: "yaw",
    does: "In FBWA and the nav modes this writes the rudder. DAMP resists gyro z. RLL coordinates the turn from measured AHRS bank (sin of roll). YAW_RATE_* exists only in ACRO and is off by default.",
    trap: "Flying wings with no fuselage skip SLIP. Tune DAMP / KFF_RDDRMIX before INT. Coordination uses AHRS roll even while the rate loop is still catching up.",
    live: ["rate"],
    gains: [
      { key: "YAW2SRV_DAMP", label: "Damp", min: 0, max: 2, step: 0.05, digits: 2 },
      { key: "YAW2SRV_RLL", label: "RLL", min: 0.5, max: 1.5, step: 0.05, digits: 2 },
      { key: "YAW2SRV_SLIP", label: "Slip", min: 0, max: 4, step: 0.1, digits: 1 },
      { key: "YAW2SRV_INT", label: "Int", min: 0, max: 2, step: 0.05, digits: 2 },
    ],
  },
  {
    id: "ahrs",
    title: "AHRS",
    param: "AP_AHRS",
    kind: "sensor",
    unit: "measured roll",
    axes: "att",
    does: "Measured attitude. The yaw damper reads sin(this bank), gyro z and lateral accel. Always measuring; the damper uses it whenever yaw is in the loop.",
    trap: "The damper uses this bank now, even while the rate loop is still catching up.",
    live: ["roll"],
    gains: [],
  },
  {
    id: "steer",
    title: "Ground steer",
    param: "STEER2SRV_*",
    kind: "runway",
    unit: "wheel / rudder",
    axes: "steer",
    does: "Tracks heading on the ground and writes the nosewheel. Live in every mode except MANUAL, only below GROUND_STEER_ALT. Click this card for the runway loop.",
    trap: "This is runway tracking, not flight yaw. If it fights you in the air, GROUND_STEER_ALT is too high.",
    later: true,
    gains: [
      { key: "STEER2SRV_P", label: "P", min: 0.2, max: 4, step: 0.05, digits: 2 },
      { key: "STEER2SRV_I", label: "I", min: 0, max: 1, step: 0.02, digits: 2 },
      { key: "STEER2SRV_D", label: "D", min: 0, max: 0.05, step: 0.001, digits: 3 },
      { key: "GROUND_STEER_ALT", label: "Alt", min: 0, max: 20, step: 0.5, digits: 1 },
    ],
    extras: [
      { key: "STEER2SRV_TCONST", label: "TC", min: 0.2, max: 2, step: 0.05, digits: 2 },
      { key: "STEER2SRV_FF", label: "FF", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "STEER2SRV_MINSPD", label: "Min", min: 0, max: 5, step: 0.1, digits: 1 },
    ],
  },
  {
    id: "throttle",
    title: "Throttle",
    param: "THR_MAX / TRIM_THROTTLE",
    kind: "PWM",
    unit: "% · throttle",
    axes: "energy",
    does: "The throttle channel. TECS writes it in AUTO / FBWB / CRUISE / RTL / LOITER. In FBWA, ACRO and MANUAL the left stick is still throttle. Click TECS for the mix.",
    trap: "If climb oscillates, pitch rate first, then TECS_TIME_CONST — do not hunt a throttle P.",
    live: ["thr"],
    gains: [
      { key: "TRIM_THROTTLE", label: "Trim", min: 0, max: 100, step: 1, digits: 0 },
      { key: "THR_MAX", label: "Max", min: 0, max: 100, step: 1, digits: 0 },
    ],
  },
  {
    id: "aileron",
    title: "Aileron",
    param: "SCALING_SPEED",
    kind: "PWM",
    unit: "roll surface",
    axes: "mix",
    does: "The roll surface. In the air, roll rate writes this channel. In MANUAL the stick writes it. Authority scales with airspeed² around SCALING_SPEED.",
    trap: "If it is tame at cruise and wild in a dive, that is the scaler — not a new P. Do not retune FF after changing SCALING_SPEED without flying it again.",
    live: ["aspd"],
    guide: true,
    gains: [{ key: "SCALING_SPEED", label: "V", min: 5, max: 50, step: 0.5, digits: 1 }],
  },
  {
    id: "elevator",
    title: "Elevator",
    param: "elevator",
    kind: "PWM",
    unit: "pitch surface",
    axes: "mix",
    does: "The pitch surface. Pitch rate writes this in the air; the stick writes it in MANUAL. Same SCALING_SPEED as aileron.",
    trap: "If the nose porpoises, the pitch rate loop is still wrong. Do not hunt a new elevator P here.",
    live: ["aspd"],
    gains: [],
  },
  {
    id: "rudder",
    title: "Rudder",
    param: "rudder",
    kind: "PWM",
    unit: "yaw surface",
    axes: "yaw",
    does: "The yaw surface in the air. The damper writes it. Separate from the nosewheel. KFF_RDDRMIX can add aileron into this channel.",
    trap: "A flying wing with no fuselage still has this PWM if you mapped a rudder; the damper may be doing almost nothing useful.",
    live: ["aspd"],
    gains: [],
  },
  {
    id: "nose",
    title: "Nose",
    param: "GroundSteering",
    kind: "PWM",
    unit: "wheel",
    axes: "steer",
    does: "Nosewheel channel (GroundSteering). Ground steer writes it below GROUND_STEER_ALT. Idle above that height and in MANUAL.",
    trap: "If the wheel fights you in the air, GROUND_STEER_ALT is too high. This channel is idle above that height.",
    later: true,
    gains: [],
  },
];

export const EDGES: EdgeDef[] = [
  { from: "pilot", to: "rll_ang", label: "FBWA angle" },
  { from: "pilot", to: "ptch_ang", label: "FBWA angle" },
  { from: "pilot", to: "rll_rate", label: "ACRO rate" },
  { from: "pilot", to: "ptch_rate", label: "ACRO rate" },
  { from: "pilot", to: "aileron", label: "MANUAL" },
  { from: "pilot", to: "elevator", label: "MANUAL" },
  { from: "pilot", to: "rudder", label: "MANUAL" },
  { from: "pilot", to: "throttle", label: "throttle" },
  { from: "pilot", to: "tecs", label: "hold alt" },
  { from: "pilot", to: "steer", label: "rudder" },
  { from: "nav", to: "navl1", label: "track" },
  { from: "nav", to: "tecs", label: "alt / cruise" },
  { from: "nav", to: "steer", label: "course" },
  { from: "navl1", to: "rll_ang", label: "desired roll" },
  { from: "tecs", to: "ptch_ang", label: "desired pitch" },
  { from: "tecs", to: "throttle", label: "throttle" },
  { from: "rll_ang", to: "rll_rate", label: "desired rate" },
  { from: "ptch_ang", to: "ptch_rate", label: "desired rate" },
  { from: "ahrs", to: "yaw_damp", label: "measured bank" },
  { from: "rll_rate", to: "aileron", label: "aileron" },
  { from: "ptch_rate", to: "elevator", label: "elevator" },
  { from: "yaw_damp", to: "rudder", label: "rudder" },
  { from: "steer", to: "nose", label: "wheel" },
];

export const LAYERS: { label: string; ids: string[]; band: Band }[] = [
  { label: "command", ids: ["pilot", "nav"], band: "ends" },
  { label: "L1 / TECS", ids: ["navl1", "tecs"], band: "outer" },
  { label: "angle", ids: ["rll_ang", "ptch_ang"], band: "inner" },
  { label: "rate", ids: ["rll_rate", "ptch_rate"], band: "inner" },
  { label: "yaw / ground", ids: ["ahrs", "yaw_damp", "steer"], band: "inner" },
  { label: "surfaces", ids: ["aileron", "rudder", "elevator"], band: "ends" },
  { label: "actuator", ids: ["throttle", "nose"], band: "ends" },
];

const WING = ["aileron", "elevator", "rudder"];
const ATTITUDE = ["rll_ang", "ptch_ang", "rll_rate", "ptch_rate", "ahrs", "yaw_damp", "throttle", ...WING];
const INNER_FBWA = ["pilot", ...ATTITUDE];
const INNER_ACRO = ["pilot", "rll_rate", "ptch_rate", "ahrs", "yaw_damp", "throttle", ...WING];
const WITH_TECS = [...INNER_FBWA, "tecs"];
const WITH_NAV = [...ATTITUDE, "tecs", "nav", "navl1"];

const MODE_NODES: Record<string, string[]> = {
  MANUAL: ["pilot", "throttle", ...WING],
  FBWA: INNER_FBWA,
  AUTOTUNE: INNER_FBWA,
  TRAINING: INNER_FBWA,
  STABILIZE: INNER_FBWA,
  ACRO: INNER_ACRO,
  FBWB: WITH_TECS,
  CRUISE: WITH_TECS,
  AUTO: WITH_NAV,
  LOITER: WITH_NAV,
  RTL: WITH_NAV,
  GUIDED: WITH_NAV,
  TAKEOFF: WITH_NAV,
  CIRCLE: WITH_NAV,
};

export function nodeBand(id: string): Band {
  return LAYERS.find((l) => l.ids.includes(id))?.band ?? "outer";
}

export function layoutPlane(width: number, height = 0): CascadeLayout {
  return layoutRanks(LAYERS, width, BAND_LABEL, height);
}

export function steerLive(s: Sample, mode: string): boolean {
  const m = (mode || "").toUpperCase();
  if (m === "ALL") return true;
  if (m === "MANUAL" || m === "?" || m === "") return false;
  const ceil = s.params.GROUND_STEER_ALT ?? 5;
  const alt = s.alt;
  if (alt == null || Number.isNaN(alt)) return true;
  return alt < ceil;
}

const SOURCES = new Set(["pilot", "nav", "ahrs"]);
const SINKS = new Set(["aileron", "elevator", "rudder", "throttle", "nose"]);

export function modeKeyOf(mode: string): string {
  const m = (mode || "").toUpperCase();
  if (m === "ALL") return "ALL";
  if (MODE_NODES[m]) return m;
  return "MANUAL";
}

export function nodesLiveIn(mode: string, s?: Sample): Set<string> {
  const m = modeKeyOf(mode);
  if (m === "ALL") return new Set(NODES.map((n) => n.id));
  const set = new Set(MODE_NODES[m]);
  if (s && steerLive(s, m)) {
    set.add("steer");
    set.add("nose");
  } else {
    set.delete("steer");
    set.delete("nose");
  }
  if (set.has("yaw_damp")) set.add("ahrs");
  else set.delete("ahrs");
  return set;
}

export function edgeLiveIn(edge: EdgeDef, mode: string, live: Set<string>): boolean {
  const m = modeKeyOf(mode);
  if (m === "ALL") return true;
  if (edge.from === "pilot" && (edge.to === "aileron" || edge.to === "elevator" || edge.to === "rudder")) {
    return m === "MANUAL";
  }
  if (edge.from === "pilot" && edge.to === "throttle") {
    return m === "MANUAL" || m === "FBWA" || m === "AUTOTUNE" || m === "TRAINING" || m === "STABILIZE" || m === "ACRO";
  }
  if (edge.from === "pilot" && edge.to === "tecs") return m === "FBWB" || m === "CRUISE";
  if (edge.from === "pilot" && (edge.to === "rll_ang" || edge.to === "ptch_ang")) {
    return m === "FBWA" || m === "AUTOTUNE" || m === "TRAINING" || m === "STABILIZE" || m === "FBWB" || m === "CRUISE";
  }
  if (edge.from === "pilot" && (edge.to === "rll_rate" || edge.to === "ptch_rate")) return m === "ACRO";
  if (edge.from === "tecs" && edge.to === "throttle") return live.has("tecs");
  return live.has(edge.from) && live.has(edge.to);
}

/** Live graph for a mode: every controller sits on a path from command/AHRS to a PWM sink. */
export function auditModeGraph(mode: string, s?: Sample): string[] {
  const live = nodesLiveIn(mode, s);
  const edges = EDGES.filter((e) => edgeLiveIn(e, mode, live));
  const issues: string[] = [];
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  for (const id of live) {
    out.set(id, []);
    inn.set(id, []);
  }
  for (const e of edges) {
    if (!live.has(e.from) || !live.has(e.to)) {
      issues.push(`${mode}: live edge ${e.from}→${e.to} but node idle`);
      continue;
    }
    out.get(e.from)?.push(e.to);
    inn.get(e.to)?.push(e.from);
  }
  for (const id of live) {
    const incoming = inn.get(id) ?? [];
    const outgoing = out.get(id) ?? [];
    if (!incoming.length && !SOURCES.has(id)) issues.push(`${mode}: ${id} has no in`);
    if (!outgoing.length && !SINKS.has(id) && id !== "ahrs") issues.push(`${mode}: ${id} has no out`);
  }
  const reach = new Set<string>();
  const stack = [...live].filter((id) => SOURCES.has(id));
  while (stack.length) {
    const id = stack.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    for (const to of out.get(id) ?? []) stack.push(to);
  }
  for (const id of live) {
    if (SOURCES.has(id)) continue;
    if (!reach.has(id)) issues.push(`${mode}: ${id} unreachable from command/AHRS`);
  }
  for (const id of live) {
    if (!SINKS.has(id)) continue;
    if (!reach.has(id)) issues.push(`${mode}: sink ${id} not on the path`);
  }
  return issues;
}

export function auditAllModes(s?: Sample): string[] {
  const modes = ["ALL", ...Object.keys(MODE_NODES)];
  return modes.flatMap((m) => auditModeGraph(m, s));
}

export function isTuneNode(node: NodeDef): boolean {
  return !!node.guide;
}

export function isLaterNode(node: NodeDef): boolean {
  return !!node.later;
}

export const MODES = ["MANUAL", "FBWA", "FBWB", "CRUISE", "AUTOTUNE", "AUTO", "LOITER", "RTL"];
