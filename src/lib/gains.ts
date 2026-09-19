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
  /** Rate P/I/D go through op:tune so both axes stay in sync. Copter only. */
  tune?: "p" | "i" | "d";
};

export type AxisFocus =
  | "cmd"
  | "nav"
  | "ne"
  | "d"
  | "lean"
  | "att"
  | "rate"
  | "mix"
  | "energy"
  | "yaw"
  | "steer"
  | "aspd";

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
  /** Short, common mistake from the First Flight Tuning pages. */
  trap?: string;
  live?: Array<"cmd" | "tar" | "roll" | "des" | "rate" | "alt" | "climb" | "aspd" | "thr">;
  /** First Flight Tuning: shown in the aside sliders. */
  guide?: boolean;
  /** After attitude is good. */
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

export type Band = "ends" | "outer" | "inner";

/** P / I / D letters for map cards. Empty if the block is not a P/PID regulator. */
export function pidTerms(node: NodeDef): Array<"P" | "I" | "D"> {
  const found = new Set<"P" | "I" | "D">();
  for (const g of node.gains) {
    const letter = g.label.replace(/^ANG\s+/i, "").trim();
    if (letter === "P" || letter === "I" || letter === "D") found.add(letter);
  }
  return (["P", "I", "D"] as const).filter((k) => found.has(k));
}

/** Corner marks: FF P I D, or the first two knob labels (TC, Damp, Per…). */
export function cardMarks(node: NodeDef): string[] {
  const pid = pidTerms(node);
  const ff = node.gains.some((g) => g.label === "FF");
  if (ff || pid.length) return [...(ff ? ["FF"] : []), ...pid];
  const out: string[] = [];
  for (const g of node.gains) {
    const lab = g.label.replace(/^ANG\s+/i, "").trim();
    if (!lab || out.includes(lab)) continue;
    out.push(lab);
    if (out.length === 2) break;
  }
  return out;
}

export function hasKnobs(node: NodeDef): boolean {
  return node.gains.length > 0;
}

/** IMU harmonic notch. Loop extend, on the gyro return — not a PID extra. */
export const GYRO_NOTCH: Gain[] = [
  { key: "INS_HNTCH_ENABLE", label: "EN", min: 0, max: 1, step: 1, digits: 0 },
  { key: "INS_HNTCH_FREQ", label: "FREQ", min: 10, max: 495, step: 1, digits: 0 },
  { key: "INS_HNTCH_BW", label: "BW", min: 5, max: 250, step: 1, digits: 0 },
];
