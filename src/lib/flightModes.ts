/**
 * ArduPilot's flight modes by number, and what each needs to fly: nothing beyond the IMU, a position (GPS, or optical
 * flow for local position), GPS itself, or optical flow. The six switch positions follow ArduPilot's PWM bands.
 */
export type Needs = "none" | "position" | "gps" | "flow";
export type Mode = { n: number; name: string; needs: Needs };

export const COPTER_MODES: Mode[] = [
  { n: 0, name: "Stabilize", needs: "none" }, { n: 1, name: "Acro", needs: "none" }, { n: 2, name: "AltHold", needs: "none" },
  { n: 3, name: "Auto", needs: "gps" }, { n: 4, name: "Guided", needs: "gps" }, { n: 5, name: "Loiter", needs: "position" },
  { n: 6, name: "RTL", needs: "gps" }, { n: 7, name: "Circle", needs: "position" }, { n: 9, name: "Land", needs: "none" },
  { n: 11, name: "Drift", needs: "position" }, { n: 13, name: "Sport", needs: "none" }, { n: 14, name: "Flip", needs: "none" },
  { n: 15, name: "AutoTune", needs: "none" }, { n: 16, name: "PosHold", needs: "position" }, { n: 17, name: "Brake", needs: "position" },
  { n: 18, name: "Throw", needs: "position" }, { n: 21, name: "SmartRTL", needs: "gps" }, { n: 22, name: "FlowHold", needs: "flow" },
  { n: 24, name: "ZigZag", needs: "position" }, { n: 27, name: "AutoRotate", needs: "none" },
];

export const PLANE_MODES: Mode[] = [
  { n: 0, name: "Manual", needs: "none" }, { n: 1, name: "Circle", needs: "none" }, { n: 2, name: "Stabilize", needs: "none" },
  { n: 3, name: "Training", needs: "none" }, { n: 4, name: "Acro", needs: "none" }, { n: 5, name: "FBWA", needs: "none" },
  { n: 6, name: "FBWB", needs: "none" }, { n: 7, name: "Cruise", needs: "gps" }, { n: 8, name: "AutoTune", needs: "none" },
  { n: 10, name: "Auto", needs: "gps" }, { n: 11, name: "RTL", needs: "gps" }, { n: 12, name: "Loiter", needs: "gps" },
  { n: 13, name: "Takeoff", needs: "gps" }, { n: 15, name: "Guided", needs: "gps" }, { n: 17, name: "QStabilize", needs: "none" },
  { n: 18, name: "QHover", needs: "none" }, { n: 19, name: "QLoiter", needs: "position" }, { n: 20, name: "QLand", needs: "none" },
  { n: 21, name: "QRTL", needs: "gps" }, { n: 22, name: "QAutoTune", needs: "none" }, { n: 23, name: "QAcro", needs: "none" },
  { n: 24, name: "Thermal", needs: "gps" },
];

export function modesFor(vehicle: "copter" | "plane"): Mode[] {
  return vehicle === "plane" ? PLANE_MODES : COPTER_MODES;
}

/** ArduPilot's six switch positions: below 1231, 1231–1360, 1361–1490, 1491–1620, 1621–1749, 1750 and above. */
export const SLOT_BANDS: [number, number][] = [[900, 1230], [1231, 1360], [1361, 1490], [1491, 1620], [1621, 1749], [1750, 2100]];

export function modeSlot(pwm: number): number | null {
  if (pwm < 800 || pwm > 2200) return null;
  const i = SLOT_BANDS.findIndex(([, hi]) => pwm <= hi);
  return i < 0 ? 5 : i;
}

/** What this vehicle can give a mode: GPS from a GPS type, flow when the EKF takes velocity from it. */
export function sources(params: Record<string, number> | undefined): { gps: boolean; flow: boolean } {
  const n = (k: string) => params?.[k];
  const gpsType = n("GPS1_TYPE") ?? n("GPS_TYPE") ?? 0;
  const flow = (n("FLOW_TYPE") ?? 0) > 0 && (n("EK3_SRC1_VELXY") === 5 || n("EK3_SRC1_POSXY") === 5);
  return { gps: gpsType > 0, flow };
}

export function canFly(mode: Mode | undefined, src: { gps: boolean; flow: boolean }): boolean {
  if (!mode) return true;
  if (mode.needs === "none") return true;
  if (mode.needs === "gps") return src.gps;
  if (mode.needs === "flow") return src.flow;
  return src.gps || src.flow;
}

export const NEEDS_TEXT: Record<Needs, string> = { none: "no GPS needed", position: "needs GPS or flow", gps: "needs GPS", flow: "needs optical flow" };
