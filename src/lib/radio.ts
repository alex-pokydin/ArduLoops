/**
 * The four sticks as ArduPilot reads them: which channel each is on (RCMAP_*), the direction ArduPilot expects
 * (roll right, throttle up and yaw right raise the channel; pitch forward lowers it), and whether the ends were ever
 * calibrated (1100 to 1900 are ArduPilot's defaults).
 */
export type Stick = "roll" | "pitch" | "throttle" | "yaw";

export const STICKS: { key: Stick; name: string; map: string; fallback: number; ask: string; expect: 1 | -1; to: [number, number] }[] = [
  { key: "roll", name: "Roll", map: "RCMAP_ROLL", fallback: 1, ask: "Push roll right", expect: 1, to: [1, 0] },
  { key: "pitch", name: "Pitch", map: "RCMAP_PITCH", fallback: 2, ask: "Push pitch forward", expect: -1, to: [0, 1] },
  { key: "throttle", name: "Throttle", map: "RCMAP_THROTTLE", fallback: 3, ask: "Push throttle up", expect: 1, to: [0, 1] },
  { key: "yaw", name: "Yaw", map: "RCMAP_YAW", fallback: 4, ask: "Push yaw right", expect: 1, to: [1, 0] },
];

export function pnum(params: Record<string, number> | undefined, name: string): number | null {
  const v = params?.[name];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function channelOf(params: Record<string, number> | undefined, stick: Stick): number {
  const s = STICKS.find((x) => x.key === stick)!;
  const mapped = pnum(params, s.map);
  return Math.min(16, Math.max(1, mapped != null && mapped > 0 ? Math.round(mapped) : s.fallback));
}

export type Ends = { min: number; trim: number; max: number; reversed: boolean };

export function endsOf(params: Record<string, number> | undefined, ch: number): Ends {
  return {
    min: pnum(params, `RC${ch}_MIN`) ?? 1100,
    trim: pnum(params, `RC${ch}_TRIM`) ?? 1500,
    max: pnum(params, `RC${ch}_MAX`) ?? 1900,
    reversed: (pnum(params, `RC${ch}_REVERSED`) ?? 0) !== 0,
  };
}

/** True once any of the four sticks has ends other than ArduPilot's 1100 to 1900 defaults. */
export function sticksCalibrated(params: Record<string, number> | undefined): boolean | null {
  const ends = STICKS.map((s) => {
    const ch = channelOf(params, s.key);
    return [pnum(params, `RC${ch}_MIN`), pnum(params, `RC${ch}_MAX`)];
  });
  if (ends.some(([a, b]) => a == null || b == null)) return null;
  return ends.every(([a, b]) => !(Math.round(a as number) === 1100 && Math.round(b as number) === 1900));
}

/** A raw channel value as the stick position ArduPilot uses, -1..1 (throttle 0..1 mapped to -1..1), reversal applied. */
export function stickPos(raw: number, e: Ends, stick: Stick): number {
  if (!(raw >= 800 && raw <= 2200)) return stick === "throttle" ? -1 : 0;
  if (stick === "throttle") {
    const span = e.max - e.min || 1;
    const v = ((raw - e.min) / span) * 2 - 1;
    return Math.max(-1, Math.min(1, e.reversed ? -v : v));
  }
  const v = raw >= e.trim ? (raw - e.trim) / (e.max - e.trim || 1) : (raw - e.trim) / (e.trim - e.min || 1);
  return Math.max(-1, Math.min(1, e.reversed ? -v : v));
}

/** Common RCn_OPTION values by name; anything else shows as its number. */
export const AUX_NAMES: Record<number, string> = {
  2: "Flip", 3: "Simple mode", 4: "RTL", 5: "Save trim", 7: "Save waypoint", 9: "Camera trigger", 11: "Fence", 13: "Super simple", 16: "Auto", 17: "AutoTune",
  18: "Land", 19: "Gripper", 21: "Parachute", 22: "Parachute release", 28: "Relay", 31: "Motor emergency stop", 32: "Motor interlock", 37: "Throw", 38: "Avoid ADS-B",
  39: "Precision loiter", 40: "Avoid proximity", 41: "Arm / disarm", 42: "SmartRTL", 46: "RC override", 52: "Acro", 55: "Guided", 56: "Loiter", 57: "Follow",
  58: "Clear waypoints", 61: "Zigzag", 62: "Compass learn", 65: "GPS disable", 66: "Relay 2", 68: "Stabilize", 69: "PosHold", 70: "AltHold", 71: "FlowHold",
  72: "Circle", 73: "Drift", 81: "Disarm", 83: "ZigZag auto", 84: "Air mode", 90: "EKF source", 94: "VTX power", 99: "Auto mission reset", 100: "KillIMU1",
  101: "KillIMU2", 102: "Camera mode", 105: "GPS disable yaw", 109: "Weathervane", 153: "Arm / disarm", 154: "Arm / disarm (air mode)", 165: "Arm / emergency stop",
  174: "Camera zoom", 210: "Airbrake", 212: "Mount 1 roll", 213: "Mount 1 pitch", 214: "Mount 1 yaw",
};
