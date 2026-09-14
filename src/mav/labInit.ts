/** Lab-ready bare SITL: skip MP wizard, same stand for every student. */
export const LAB_INIT: Record<string, number> = {
  FRAME_CLASS: 1,
  FRAME_TYPE: 1,
  INS_GYR_CAL: 0,
  INS_ACCOFFS_X: 0.001,
  INS_ACCOFFS_Y: 0.001,
  INS_ACCOFFS_Z: 0.001,
  INS_ACCSCAL_X: 1.001,
  INS_ACCSCAL_Y: 1.001,
  INS_ACCSCAL_Z: 1.001,
  INS_ACC2OFFS_X: 0.001,
  INS_ACC2OFFS_Y: 0.001,
  INS_ACC2OFFS_Z: 0.001,
  INS_ACC2SCAL_X: 1.001,
  INS_ACC2SCAL_Y: 1.001,
  INS_ACC2SCAL_Z: 1.001,
  COMPASS_OFS_X: 5,
  COMPASS_OFS_Y: 13,
  COMPASS_OFS_Z: -18,
  COMPASS_OFS2_X: 5,
  COMPASS_OFS2_Y: 13,
  COMPASS_OFS2_Z: -18,
  COMPASS_LEARN: 0,
  BATT_MONITOR: 4,
  BRD_SAFETY_DEFLT: 0,
  RC1_MIN: 1000,
  RC1_MAX: 2000,
  RC1_TRIM: 1500,
  RC2_MIN: 1000,
  RC2_MAX: 2000,
  RC2_TRIM: 1500,
  RC3_MIN: 1000,
  RC3_MAX: 2000,
  RC3_TRIM: 1500,
  RC4_MIN: 1000,
  RC4_MAX: 2000,
  RC4_TRIM: 1500,
  RC5_MIN: 1000,
  RC5_MAX: 2000,
  RC5_TRIM: 1500,
  RC6_MIN: 1000,
  RC6_MAX: 2000,
  RC6_TRIM: 1500,
  FLTMODE1: 7,
  FLTMODE2: 9,
  FLTMODE3: 6,
  FLTMODE4: 3,
  FLTMODE5: 5,
  FLTMODE6: 0,
  INITIAL_MODE: 0,
  FS_THR_ENABLE: 0,
  LOG_DISARMED: 1,
  ATC_RAT_RLL_P: 0.135,
  ATC_RAT_RLL_I: 0.135,
  ATC_RAT_RLL_D: 0.0036,
  ATC_RAT_PIT_P: 0.135,
  ATC_RAT_PIT_I: 0.135,
  ATC_RAT_PIT_D: 0.0036,
  ATC_RAT_YAW_P: 0.18,
  ATC_RAT_YAW_I: 0.018,
  ATC_RAT_YAW_D: 0,
  ATC_ANG_RLL_P: 4.5,
  ATC_ANG_PIT_P: 4.5,
  ATC_ANG_YAW_P: 4.5,
  ATC_INPUT_TC: 0.1,
  ATC_ACC_R_MAX: 1100,
  ATC_ACC_P_MAX: 1100,
  ATC_RATE_R_MAX: 0,
  ATC_RATE_P_MAX: 0,
};

export const LAB_KEYS = Object.keys(LAB_INIT);

/** Compass / battery / safety switch stay in `--add-param-file`. Frame + dummy SITL INS offsets are safe while disarmed. */
const RUNTIME_SKIP = /^(COMPASS_|BATT_MONITOR|BRD_SAFETY)/;

export function runtimeLabParams(
  snapshot: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of LAB_KEYS) {
    if (RUNTIME_SKIP.test(key)) continue;
    const v = snapshot[key];
    if (v != null && Number.isFinite(v)) out[key] = v;
  }
  // Identical lab: Quad X + fake-calibrated SITL IMU (0.0 offset ⇒ PreArm accel cal).
  for (const key of LAB_KEYS) {
    if (key.startsWith("FRAME_") || key.startsWith("INS_")) {
      out[key] = LAB_INIT[key];
    }
  }
  return out;
}

const STORE = "arduloops.lab-init";

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "0";
  if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
  return String(Number(v.toPrecision(7)));
}

export function formatParm(params: Record<string, number>): string {
  const lines = [
    "# ArduLoops · стандарт голого SITL (лаба 5.1)",
    "# Ініт після лінку. FRAME_CLASS=1 Quad, FRAME_TYPE=1 X.",
    "",
  ];
  for (const key of LAB_KEYS) {
    if (params[key] == null || !Number.isFinite(params[key])) continue;
    lines.push(key.padEnd(16) + " " + fmtNum(params[key]));
  }
  return lines.join("\n") + "\n";
}

export function parseParm(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const parts = line.split(/[,\s]+/);
    if (parts.length < 2) continue;
    const name = parts[0];
    const val = Number(parts[1]);
    if (!name || !Number.isFinite(val)) continue;
    if (LAB_INIT[name] == null) continue;
    out[name] = val;
  }
  return out;
}

export function loadLabSnapshot(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return { ...LAB_INIT };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const extra: Record<string, number> = {};
    for (const key of LAB_KEYS) {
      const v = Number(parsed[key]);
      if (Number.isFinite(v)) extra[key] = v;
    }
    return { ...LAB_INIT, ...extra };
  } catch {
    return { ...LAB_INIT };
  }
}

export function saveLabSnapshot(params: Record<string, number>): void {
  localStorage.setItem(STORE, JSON.stringify(params));
}

export function downloadParm(params: Record<string, number>): void {
  const blob = new Blob([formatParm(params)], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "arduloops-lab.parm";
  a.click();
  URL.revokeObjectURL(a.href);
}

export function pickLiveLab(
  live: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!live) return out;
  for (const key of LAB_KEYS) {
    const v = live[key];
    if (v != null && Number.isFinite(v)) out[key] = v;
  }
  return out;
}
