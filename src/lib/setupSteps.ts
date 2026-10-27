export type StepState = "done" | "warn" | "fail" | "todo" | "opt";

/**
 * Which setup step a PreArm line belongs to. ArduPilot's own text, matched loosely;
 * a line that matches nothing still shows in the header tile.
 */
const PREARM_STEP: [RegExp, string][] = [
  [/compass|\bmag\b|magnetometer/i, "compass"],
  [/batt|voltage/i, "battery"],
  [/accel|gyro|\bINS\b|AHRS|level|inconsistent/i, "level"],
  [/\bRC\b|radio|throttle below/i, "radio"],
  [/fs_|failsafe/i, "failsafe"],
  [/motors|frame|servo/i, "motors"],
  [/airspeed|ARSPD/i, "airspeed"],
];

export function prearmStep(text: string): string | null {
  const line = text.replace(/^PreArm:\s*/, "");
  for (const [re, step] of PREARM_STEP) if (re.test(line)) return step;
  return null;
}

/**
 * One state per step. A current PreArm failure wins; otherwise the step's own glance:
 * live = done, something to say but not live = needs attention, nothing yet = to do.
 */
/**
 * What to do next on the Overview: required steps that are not done, the ones that block arming first,
 * then those that need attention, then the rest, each in step order.
 */
export function nextSteps<T>(items: { item: T; state: StepState; optional: boolean }[], limit = 3): T[] {
  const rank: Record<StepState, number> = { fail: 0, warn: 1, todo: 2, done: 9, opt: 9 };
  return items
    .map((entry, order) => ({ ...entry, order }))
    .filter((entry) => !entry.optional && rank[entry.state] < 9)
    .sort((a, b) => rank[a.state] - rank[b.state] || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function stepState(glance: { text: string; live: boolean }, prearm: string[], optional: boolean): { state: StepState; reason: string } {
  if (prearm.length) return { state: "fail", reason: prearm[0].replace(/^PreArm:\s*/, "") };
  if (glance.live) return { state: "done", reason: glance.text };
  if (optional) return { state: "opt", reason: glance.text };
  return { state: glance.text ? "warn" : "todo", reason: glance.text };
}
