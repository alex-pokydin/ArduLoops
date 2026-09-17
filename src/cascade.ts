export type Gain = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  /** Write the same value to these names (roll/pitch copies). */
  aliases?: string[];
  /** Older firmware name. UI uses `key` units; vehicle stores `legacy.key` × scale (e.g. cm/s). */
  legacy?: { key: string; scale: number };
  /** Rate P/I/D go through op:tune so both axes stay in sync. */
  tune?: "p" | "i" | "d";
};

export type AxisFocus = "cmd" | "nav" | "ne" | "d" | "lean" | "att" | "rate" | "mix";

export type NodeDef = {
  id: string;
  title: string;
  param: string;
  kind: string;
  /** Fast inner attitude loop (angle / rate). */
  inner?: boolean;
  unit: string;
  axes: AxisFocus;
  does: string;
  /** Short, common mistake from the Copter First Flight Tuning pages. */
  trap?: string;
  live?: Array<"cmd" | "tar" | "roll" | "des" | "rate" | "alt" | "climb">;
  /** First Flight Tuning: rate, angle P, stick feel, hover. Not every P/PID. */
  guide?: boolean;
  /** After attitude is good: Loiter weave → NE velocity. Not Stabilize. */
  later?: boolean;
  gains: Gain[];
  /** AC_PID internals. Loop extend only — not first-flight Aside sliders. */
  extras?: Gain[];
};

export type EdgeDef = {
  from: string;
  to: string;
  label: string;
};

/** P / I / D letters for map cards. Empty if the block is not a P/PID regulator. */
export function pidTerms(node: NodeDef): Array<"P" | "I" | "D"> {
  const found = new Set<"P" | "I" | "D">();
  for (const g of node.gains) {
    const letter = g.label.replace(/^ANG\s+/i, "").trim();
    if (letter === "P" || letter === "I" || letter === "D") found.add(letter);
  }
  return (["P", "I", "D"] as const).filter((k) => found.has(k));
}

/** First Flight Tuning: rate, angle, stick, hover. */
export function isTuneNode(node: NodeDef): boolean {
  return !!node.guide;
}

/** Sometimes, after ATC: Loiter weave — not the Stabilize pass. */
export function isLaterNode(node: NodeDef): boolean {
  return !!node.later;
}

/** IMU harmonic notch. Loop extend, on the gyro return — not a PID extra. */
export const GYRO_NOTCH: Gain[] = [
  { key: "INS_HNTCH_ENABLE", label: "EN", min: 0, max: 1, step: 1, digits: 0 },
  { key: "INS_HNTCH_FREQ", label: "FREQ", min: 10, max: 495, step: 1, digits: 0 },
  { key: "INS_HNTCH_BW", label: "BW", min: 5, max: 250, step: 1, digits: 0 },
];

export const NODES: NodeDef[] = [
  {
    id: "pilot",
    title: "Pilot stick",
    param: "RC / sticks",
    kind: "command",
    unit: "stick",
    axes: "cmd",
    does: "Not a loop — the stick request. Stabilize wants an angle, AltHold a climb rate (PILOT_SPD_UP / DN), Loiter a lean/accel, Acro a rate. TC / ACC / Rmax only shape how fast that request may change (Input Shaping).",
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
    kind: "targets, not PID",
    unit: "m · NED",
    axes: "nav",
    does: "Writes a place for PSC to hold, plus how fast to get there. WP_SPD is mission cruise; LOIT_SPEED_MS is stick speed in Loiter. Not a PID.",
    trap: "Drifting in Loiter is GPS, compass, vibe or PSC. These speeds only cap how fast it flies the path — raising them will not hold position.",
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
    gains: [
      { key: "PSC_D_POS_P", label: "P", min: 0.2, max: 3, step: 0.05, digits: 2 },
    ],
  },
  {
    id: "psc_ne_vel",
    title: "NE velocity",
    param: "PSC_NE_VEL_*",
    kind: "AC_PID_2D",
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
    kind: "AC_PID_Basic",
    unit: "m/s · NED D+",
    axes: "d",
    does: "Turns the climb command into vertical acceleration. Usually left at defaults.",
    trap: "Do not chase bounce on this P. Check vibe and PSC_D_ACC I (keep P:I ≈ 1:2) first.",
    live: ["climb"],
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
    kind: "not PID",
    unit: "° · roll/pitch",
    axes: "lean",
    does: "Geometry, not a loop: NE acceleration (earth, m/s²) becomes roll/pitch (body, °). ATC_ANGLE_MAX is the lean ceiling.",
    trap: "Not Loiter speed — that is LOIT_SPEED_MS on Navigation. Raising ANGLE_MAX only lets it tilt more. Wrong lean still usually means velocity PID or ATC.",
    gains: [
      { key: "ATC_ANGLE_MAX", label: "Ang", min: 10, max: 80, step: 1, digits: 0, legacy: { key: "ANGLE_MAX", scale: 100 } },
    ],
  },
  {
    id: "psc_d_acc",
    title: "D acceleration",
    param: "PSC_D_ACC_*",
    kind: "AC_PID",
    unit: "m/s² · throttle",
    axes: "d",
    does: "Throttle from vertical accel error. Skips the angle loop — motors get force, not a tilt.",
    trap: "Never raise P/I; powerful frames may cut both ~50%. Keep I ≈ 2×P. I = 0 fails pre-arm. High vibe → runaway climb in AltHold.",
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
    kind: "AC_PID",
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
    kind: "PWM / DShot",
    unit: "torque + throttle",
    axes: "mix",
    does: "Mixer: rate torque plus D-accel throttle. Not a PID.",
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

export type Band = "ends" | "outer" | "inner";

export const BAND_LABEL: Record<Band, string> = {
  ends: "not a regulator",
  outer: "PosControl",
  inner: "Attitude",
};

export type BandId = "outer" | "inner";

export function isBandId(id: string | null | undefined): id is BandId {
  return id === "outer" || id === "inner";
}

export const BAND_COPY: Record<BandId, { kind: string; unit: string; does: string; more: string; trap: string }> = {
  outer: {
    kind: "PSC",
    unit: "m · NED",
    does: "Holds where to be: position → velocity → acceleration. North–East is metres on the earth; Down is height. Horizontal output is lean — there is no separate accel PID.",
    more: "Vertical skips Attitude: Down acceleration (PSC_D_ACC) goes straight to throttle. Navigation only writes targets for PSC; it is not a regulator.",
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

export type NodeBox = { id: string; x: number; y: number; w: number; h: number };
export type RankBox = { label: string; x: number; y: number; w: number; h: number; band: Band };
export type GroupBox = { band: "outer" | "inner"; label: string; x: number; y: number; w: number; h: number };
export type CascadeLayout = {
  width: number;
  height: number;
  nodeW: number;
  nodeH: number;
  nodes: NodeBox[];
  ranks: RankBox[];
  groups: GroupBox[];
  cutY: number | null;
};

export function layoutCopter(width: number): CascadeLayout {
  const padL = 96;
  const padR = 14;
  const padT = 10;
  const nodeH = 48;
  const rankGap = 22;
  const nodeGap = 32;
  const bandPad = 8;
  const nodeW = Math.min(168, Math.max(128, Math.floor((Math.max(width, 360) - padL - padR - nodeGap) / 2)));
  const colL = padL;
  const colR = padL + nodeW + nodeGap;
  const colC = padL + (nodeW * 2 + nodeGap - nodeW) / 2;
  const bandW = padL + nodeW * 2 + nodeGap + padR - 16;
  const nodes: NodeBox[] = [];
  const ranks: RankBox[] = [];
  let y = padT;
  for (const layer of LAYERS) {
    const rankH = nodeH + bandPad * 2;
    ranks.push({ label: layer.label, x: 8, y, w: bandW, h: rankH, band: layer.band });
    const ny = y + bandPad;
    if (layer.ids.length === 1) {
      nodes.push({ id: layer.ids[0], x: colC, y: ny, w: nodeW, h: nodeH });
    } else {
      nodes.push({ id: layer.ids[0], x: colL, y: ny, w: nodeW, h: nodeH });
      nodes.push({ id: layer.ids[1], x: colR, y: ny, w: nodeW, h: nodeH });
    }
    y += rankH + rankGap;
  }

  const groups: GroupBox[] = [];
  let i = 0;
  while (i < ranks.length) {
    const band = ranks[i].band;
    if (band === "ends") {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < ranks.length && ranks[j + 1].band === band) j += 1;
    const a = ranks[i];
    const b = ranks[j];
    groups.push({
      band,
      label: BAND_LABEL[band],
      x: 6,
      y: a.y,
      w: 18,
      h: b.y + b.h - a.y,
    });
    i = j + 1;
  }

  const lastOuter = [...ranks].reverse().find((r) => r.band === "outer");
  const firstInner = ranks.find((r) => r.band === "inner");
  const cutY =
    lastOuter && firstInner ? (lastOuter.y + lastOuter.h + firstInner.y) / 2 : null;

  return {
    width: padL + nodeW * 2 + nodeGap + padR,
    height: y - rankGap + padT,
    nodeW,
    nodeH,
    nodes,
    ranks,
    groups,
    cutY,
  };
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

export type EdgePorts = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "h" | "v";
};

/** Side ports for same-row edges, top/bottom for stacked ones. */
export function edgePorts(a: NodeBox, b: NodeBox): EdgePorts {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = bcx - acx;
  const dy = bcy - acy;
  const inset = 3;
  if (Math.abs(dy) < Math.min(a.h, b.h) * 0.6) {
    if (dx >= 0) {
      return { x1: a.x + a.w + inset, y1: acy, x2: b.x - inset, y2: bcy, kind: "h" };
    }
    return { x1: a.x - inset, y1: acy, x2: b.x + b.w + inset, y2: bcy, kind: "h" };
  }
  if (dy >= 0) {
    return { x1: acx, y1: a.y + a.h + inset, x2: bcx, y2: b.y - inset, kind: "v" };
  }
  return { x1: acx, y1: a.y - inset, x2: bcx, y2: b.y + b.h + inset, kind: "v" };
}

export type EdgeRoute = {
  d: string;
  lx: number;
  ly: number;
};

function f(n: number): string {
  return n.toFixed(1);
}

export function edgePath(x1: number, y1: number, x2: number, y2: number, kind: "h" | "v" = "v"): string {
  if (kind === "h") {
    const mx = (x1 + x2) / 2;
    return `M ${f(x1)} ${f(y1)} C ${f(mx)} ${f(y1)}, ${f(mx)} ${f(y2)}, ${f(x2)} ${f(y2)}`;
  }
  const my = (y1 + y2) / 2;
  return `M ${f(x1)} ${f(y1)} C ${f(x1)} ${f(my)}, ${f(x2)} ${f(my)}, ${f(x2)} ${f(y2)}`;
}

/** Same-row: side to side. Otherwise top/bottom cubic. */
export function edgeRoute(a: NodeBox, b: NodeBox): EdgeRoute {
  const p = edgePorts(a, b);
  const lx = (p.x1 + p.x2) / 2;
  const ly = p.kind === "h" ? p.y1 - 8 : (p.y1 + p.y2) / 2 - 6;
  return { d: edgePath(p.x1, p.y1, p.x2, p.y2, p.kind), lx, ly };
}
