/**
 * ArduPilot's arming checks (AP_Arming::Check bits) and the parameter that skips them.
 * 4.7 stores the checks to skip as ARMING_SKIPCHK (bit set = skipped, -1 = skip all); older firmware stores the
 * checks to run as ARMING_CHECK (bit set = on, bit 0 = all on, 0 = all off).
 */
export type ArmingCheck = { bit: number; name: string; what: string; re: RegExp; only?: "copter" | "plane" };

/** In ArduPilot's bit order. The text patterns attribute a PreArm line to its check; a line that matches none is not counted. */
export const ARMING_CHECKS: ArmingCheck[] = [
  { bit: 1, name: "Barometer", what: "Healthy, and the barometers agree", re: /baro/i },
  { bit: 2, name: "Compass", what: "Calibrated, healthy, compasses agree", re: /compass|\bmag/i },
  { bit: 3, name: "GPS lock", what: "3D fix and accuracy, for modes that need GPS", re: /\bGPS\b(?!.*config)|EK[23] sources|need position|\bfix\b|HDOP/i },
  { bit: 4, name: "INS", what: "Accels and gyros healthy, calibrated, agreeing", re: /accel|gyro|\bINS\b|AHRS|EKF|inconsistent/i },
  { bit: 5, name: "Parameters", what: "Key parameters in range", re: /param|check (?:FS|[A-Z]+_)/i },
  { bit: 6, name: "RC channels", what: "Radio calibrated, failsafe set", re: /\bRC\b|radio|throttle/i },
  { bit: 7, name: "Board voltage", what: "Board supply in range", re: /board|vcc|servo voltage/i },
  { bit: 8, name: "Battery level", what: "Above arming voltage and capacity", re: /batt/i },
  { bit: 9, name: "Airspeed", what: "Airspeed sensor healthy", re: /airspeed|arspd/i, only: "plane" },
  { bit: 10, name: "Logging", what: "Log storage working", re: /\blog/i },
  { bit: 11, name: "Safety switch", what: "Safety switch pressed", re: /safety/i },
  { bit: 12, name: "GPS configuration", what: "Receiver configured as ArduPilot expects", re: /GPS.*config|configur.*GPS/i },
  { bit: 13, name: "System", what: "Firmware, scripts, internal errors", re: /internal error|script|system|firmware/i },
  { bit: 14, name: "Mission", what: "Mission valid for Auto", re: /mission/i },
  { bit: 15, name: "Rangefinder", what: "Rangefinder healthy", re: /rangefinder|rngfnd/i },
  { bit: 16, name: "Camera", what: "Camera ready", re: /camera/i },
  { bit: 17, name: "Aux auth", what: "Approval from an external system", re: /auth/i },
  { bit: 18, name: "Vision", what: "Visual odometry healthy", re: /visual|vision|odom/i, only: "copter" },
  { bit: 19, name: "FFT", what: "In-flight FFT ready", re: /\bFFT\b/i },
];

export function checksFor(frame: "copter" | "plane"): ArmingCheck[] {
  return ARMING_CHECKS.filter((check) => !check.only || check.only === frame);
}

/** The check a PreArm line belongs to, or null. */
export function checkOfLine(text: string, checks: ArmingCheck[]): number | null {
  const line = text.replace(/^PreArm:\s*/, "");
  return checks.find((check) => check.re.test(line))?.bit ?? null;
}

export type SkipState = { param: "ARMING_SKIPCHK" | "ARMING_CHECK"; raw: number; skipped: Set<number> };

/** Which checks are skipped now, from whichever parameter the board has; null until it arrives. */
export function readSkipped(params: Record<string, number> | undefined, checks: ArmingCheck[]): SkipState | null {
  const skip = params?.ARMING_SKIPCHK;
  if (typeof skip === "number") {
    const raw = Math.round(skip) | 0;
    return { param: "ARMING_SKIPCHK", raw, skipped: new Set(checks.filter((c) => (raw & (1 << c.bit)) !== 0).map((c) => c.bit)) };
  }
  const run = params?.ARMING_CHECK;
  if (typeof run === "number") {
    const raw = Math.round(run) | 0;
    const all = (raw & 1) !== 0;
    return { param: "ARMING_CHECK", raw, skipped: new Set(checks.filter((c) => !all && (raw & (1 << c.bit)) === 0).map((c) => c.bit)) };
  }
  return null;
}

/** The value to write so exactly `skipped` (of the known checks) is skipped; bits for checks not listed are kept. */
export function skipValue(state: SkipState, skipped: Set<number>, checks: ArmingCheck[]): number {
  const known = checks.reduce((mask, c) => mask | (1 << c.bit), 0);
  const chosen = checks.reduce((mask, c) => (skipped.has(c.bit) ? mask | (1 << c.bit) : mask), 0);
  if (state.param === "ARMING_SKIPCHK") return (state.raw & ~known) | chosen;
  if (skipped.size === 0) return 1;
  // Older firmware: bit set = run. Keep the bits of checks this list does not know, as they were.
  const valid = (1 << 21) - 1; // the checks that existed when ARMING_CHECK was replaced
  const before = (state.raw & 1) !== 0 ? valid : state.raw;
  const on = (before & valid & ~known & ~1) | (known & ~chosen);
  return on === 0 ? 0 : on;
}
