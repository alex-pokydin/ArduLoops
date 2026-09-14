export type Gain = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  /** Write the same value to these names (roll/pitch copies). */
  aliases?: string[];
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
  live?: Array<"cmd" | "tar" | "roll" | "des" | "rate" | "alt">;
  gains: Gain[];
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

export const NODES: NodeDef[] = [
  {
    id: "pilot",
    title: "Pilot stick",
    param: "RC / sticks",
    kind: "command",
    unit: "stick",
    axes: "cmd",
    does: "Pilot command, not a regulator. Where it enters depends on mode: desired attitude (Stabilize), climb rate (AltHold), lean (Loiter), angular rate (Acro).",
    live: ["cmd"],
    gains: [
      { key: "ATC_INPUT_TC", label: "TC", min: 0, max: 0.5, step: 0.01, digits: 2 },
      { key: "ATC_ACC_R_MAX", label: "ACC", min: 0, max: 1800, step: 20, digits: 0, aliases: ["ATC_ACC_P_MAX"] },
      { key: "ATC_RATE_R_MAX", label: "Rmax", min: 0, max: 360, step: 10, digits: 0, aliases: ["ATC_RATE_P_MAX"] },
    ],
  },
  {
    id: "nav",
    title: "Navigation",
    param: "WP_ / LOIT_ / CIRCLE_",
    kind: "targets, not PID",
    unit: "m · NED",
    axes: "nav",
    does: "Sets a target for PosControl (PSC); it does not run a PID. In Loiter the stick sets desired acceleration, then the outer loop. WP and Circle set a point or radius. If it drifts in place — look at PSC, not WP/LOIT.",
    gains: [],
  },
  {
    id: "psc_ne_pos",
    title: "NE position",
    param: "PSC_NE_POS_P",
    kind: "P",
    unit: "m · NED NE",
    axes: "ne",
    does: "P position regulator (PSC_NE_POS): horizontal distance error (North–East, metres) → desired horizontal velocity.",
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
    does: "P altitude regulator (PSC_D_POS): Down-axis error → desired vertical velocity (climb). D+ is down; AGL on the right is −D.",
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
    does: "Horizontal velocity PID (PSC_NE_VEL): m/s error north/east → desired acceleration. There is no separate horizontal accel PID — the output becomes desired lean.",
    gains: [
      { key: "PSC_NE_VEL_P", label: "P", min: 0.3, max: 5, step: 0.05, digits: 2 },
      { key: "PSC_NE_VEL_I", label: "I", min: 0, max: 3, step: 0.05, digits: 2 },
      { key: "PSC_NE_VEL_D", label: "D", min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
  {
    id: "psc_d_vel",
    title: "D velocity",
    param: "PSC_D_VEL_*",
    kind: "AC_PID_Basic",
    unit: "m/s · NED D+",
    axes: "d",
    does: "Vertical velocity PID (PSC_D_VEL): m/s-down error → desired vertical acceleration.",
    gains: [
      { key: "PSC_D_VEL_P", label: "P", min: 1, max: 12, step: 0.1, digits: 1 },
      { key: "PSC_D_VEL_I", label: "I", min: 0, max: 4, step: 0.05, digits: 2 },
      { key: "PSC_D_VEL_D", label: "D", min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
  {
    id: "lean",
    title: "lean angle",
    param: "accel → roll/pitch",
    kind: "not PID",
    unit: "° · roll/pitch",
    axes: "lean",
    does: "Not a regulator. Horizontal acceleration (m/s² in NED) becomes desired lean — roll and pitch. Coordinate frame changes here: earth → body.",
    gains: [],
  },
  {
    id: "psc_d_acc",
    title: "D acceleration",
    param: "PSC_D_ACC_*",
    kind: "AC_PID",
    unit: "m/s² · throttle",
    axes: "d",
    does: "Vertical acceleration PID (PSC_D_ACC): m/s²-down error → throttle. This channel skips the angle loop — straight to the motors.",
    gains: [
      { key: "PSC_D_ACC_P", label: "P", min: 0.01, max: 0.3, step: 0.005, digits: 3 },
      { key: "PSC_D_ACC_I", label: "I", min: 0, max: 0.5, step: 0.01, digits: 2 },
      { key: "PSC_D_ACC_D", label: "D", min: 0, max: 0.05, step: 0.001, digits: 3 },
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
    does: "P attitude regulator (ATC_ANG): from angle error it computes how fast to rotate toward the target and sets the rate command for ATC_RAT. P only, three axes. On the map roll and pitch are aliased (gains write together); yaw is the same loop with its own parameters.",
    live: ["tar", "cmd"],
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
    does: "Angular-rate PID (ATC_RAT): compares command to actual (°/s) and sends torque to the mixer. Three axes. Roll and pitch are aliased on the map; yaw is the same loop with its own P/I/D (smaller I, D defaults to 0).",
    live: ["des", "rate"],
    gains: [
      { key: "ATC_RAT_RLL_P", label: "P", min: 0.01, max: 1.2, step: 0.001, digits: 3, tune: "p", aliases: ["ATC_RAT_PIT_P"] },
      { key: "ATC_RAT_RLL_I", label: "I", min: 0, max: 0.5, step: 0.001, digits: 3, tune: "i", aliases: ["ATC_RAT_PIT_I"] },
      { key: "ATC_RAT_RLL_D", label: "D", min: 0, max: 0.02, step: 0.0001, digits: 4, tune: "d", aliases: ["ATC_RAT_PIT_D"] },
    ],
  },
  {
    id: "motors",
    title: "Motors",
    param: "AP_Motors",
    kind: "PWM / DShot",
    unit: "torque + throttle",
    axes: "mix",
    does: "Motor mixer (AP_Motors), not a PID. Rate-loop torque (ATC_RAT) and vertical-accel throttle (PSC_D_ACC) meet here.",
    live: ["roll"],
    gains: [],
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
  outer: "outer",
  inner: "inner",
};

export const LAYERS: { label: string; ids: string[]; band: Band }[] = [
  { label: "command", ids: ["pilot", "nav"], band: "ends" },
  { label: "position", ids: ["psc_ne_pos", "psc_d_pos"], band: "outer" },
  { label: "velocity", ids: ["psc_ne_vel", "psc_d_vel"], band: "outer" },
  { label: "acceleration", ids: ["lean", "psc_d_acc"], band: "outer" },
  { label: "angle", ids: ["atc_ang"], band: "inner" },
  { label: "rate", ids: ["atc_rat"], band: "inner" },
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
  const nodeGap = 20;
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
    width: Math.max(width, padL + nodeW * 2 + nodeGap + padR),
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

export function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}
