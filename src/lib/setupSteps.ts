export type StepState = "done" | "warn" | "fail" | "todo" | "opt" | "off";

/** A step's own summary: `live` = set up and reading; `off` = the hardware is turned off on purpose (settled, not done). */
export type Glance = { text: string; live: boolean; off?: boolean };

/**
 * Which setup step a PreArm line belongs to. ArduPilot's own text, matched loosely;
 * a line that matches nothing still shows in the header tile.
 */
const PREARM_STEP: [RegExp, string][] = [
  [/compass|\bmag\b|magnetometer/i, "compass"],
  [/batt|voltage/i, "battery"],
  [/accel|gyro|\bINS\b|AHRS_ORIENTATION|AHRS_TRIM|level|inconsistent/i, "level"],
  [/\bRC\b|radio|throttle below/i, "radio"],
  [/fs_|failsafe/i, "failsafe"],
  [/motors|frame|servo/i, "motors"],
  [/airspeed|ARSPD/i, "airspeed"],
];

/**
 * PreArm lines that no step fixes: the GPS and serial ports are set up by the assistant, and the EKF depends on
 * several sensors at once. Each has its own request for Fix, so the model looks in the right place.
 */
const PREARM_TOPIC: { re: RegExp; label: string; ask: string }[] = [
  {
    re: /\bGPS|EK[23] sources|\bfix\b|HDOP|satellite|position estimate|\bhome\b/i,
    label: "GPS · assistant",
    ask: "Fix: {line}. Check the GPS: whether a serial port is set to it, whether it reports a fix, and whether the EKF sources (EK3_SRC*) match the sensors this vehicle has. Propose the changes.",
  },
  {
    re: /\bEKF|\bEK[23]\b|AHRS|\bposition\b|velocity variance|yaw/i,
    label: "EKF · assistant",
    ask: "Fix: {line}. Find what the EKF is waiting for on this vehicle (sensors, sources, health) and propose the changes.",
  },
];

export function prearmTopic(text: string): { label: string; ask: string } | null {
  const line = text.replace(/^PreArm:\s*/, "");
  return PREARM_TOPIC.find((topic) => topic.re.test(line)) ?? null;
}

export function prearmStep(text: string): string | null {
  const line = text.replace(/^PreArm:\s*/, "");
  for (const [re, step] of PREARM_STEP) if (re.test(line)) return step;
  return null;
}

/** The request Fix sends for a PreArm line, as an English phrase with {line} for i18n. */
export function prearmAsk(text: string): string {
  return prearmStep(text) == null ? prearmTopic(text)?.ask ?? "Fix: {line}" : "Fix: {line}";
}

/** A step's parameter list holds exact names and prefixes ending in `*` (`COMPASS_*`, `SERVO*`). */
export function paramMatches(pattern: string, name: string): boolean {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

/** The step that owns a parameter: an exact name first, then the first prefix in step order. */
export function stepOfParam<T extends { id: string; params: string[] }>(steps: T[], name: string): T | null {
  return (
    steps.find((step) => step.params.includes(name)) ??
    steps.find((step) => step.params.some((p) => p.endsWith("*") && paramMatches(p, name))) ??
    null
  );
}

/** Names on the board that a step reads, sorted, at most `limit`. */
export function stepParamNames(patterns: string[], params: Record<string, number>, limit = 160): string[] {
  return Object.keys(params).filter((name) => patterns.some((p) => paramMatches(p, name))).sort().slice(0, limit);
}

/**
 * What to do next on the Overview: required steps that are not done, the ones that block arming first,
 * then those that need attention, then the rest, each in step order.
 */
export function nextSteps<T>(items: { item: T; state: StepState; optional: boolean }[], limit = 3): T[] {
  const rank: Record<StepState, number> = { fail: 0, warn: 1, todo: 2, done: 9, opt: 9, off: 9 };
  return items
    .map((entry, order) => ({ ...entry, order }))
    .filter((entry) => !entry.optional && rank[entry.state] < 9)
    .sort((a, b) => rank[a.state] - rank[b.state] || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.item);
}

/**
 * One state per step. A current PreArm failure wins; otherwise the step's own glance:
 * live = done, something to say but not live = needs attention, nothing yet = to do.
 */
export function stepState(glance: Glance, prearm: string[], optional: boolean): { state: StepState; reason: string } {
  if (prearm.length) return { state: "fail", reason: prearm[0].replace(/^PreArm:\s*/, "") };
  if (glance.off) return { state: "off", reason: glance.text };
  if (glance.live) return { state: "done", reason: glance.text };
  if (optional) return { state: "opt", reason: glance.text };
  return { state: glance.text ? "warn" : "todo", reason: glance.text };
}
