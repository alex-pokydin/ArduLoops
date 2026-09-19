/** SITL world knobs (`SIM_*`). Copter and plane share the same names. */

export type SimKind = "range" | "toggle" | "choice";

export type SimChoice = { v: number; label: string };

export type SimKnob = {
  key: string;
  aliases?: string[];
  /** Also write these when present (e.g. vibe X/Y/Z). */
  write?: string[];
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  /** Firmware GroupInfo default (ENABLE is 1 so reset does not kill GPS). */
  def: number;
  kind?: SimKind;
  choices?: SimChoice[];
  hot?: boolean;
  /** Skip this knob when another name is already live (old vs GPS1). */
  hideIf?: string;
};

export type SimGroup = {
  id: string;
  title: string;
  open?: boolean;
  knobs: SimKnob[];
  /** `SIM_ENGINE_FAIL` bitmask, motors 1–4. */
  motors?: boolean;
};

export const SIM_GROUPS: SimGroup[] = [
  {
    id: "wind",
    title: "Wind",
    open: true,
    knobs: [
      { key: "SIM_WIND_SPD", label: "speed", unit: "m/s", min: 0, max: 20, step: 0.1, digits: 1, def: 0 },
      { key: "SIM_WIND_DIR", label: "direction", unit: "°", min: 0, max: 360, step: 1, digits: 0, def: 180 },
      { key: "SIM_WIND_TURB", label: "turbulence", unit: "m/s", min: 0, max: 8, step: 0.1, digits: 1, def: 0 },
      { key: "SIM_WIND_DIR_Z", label: "vertical", unit: "°", min: -90, max: 90, step: 1, digits: 0, def: 0 },
      { key: "SIM_WIND_TC", label: "settle", unit: "s", min: 0, max: 20, step: 0.5, digits: 1, def: 5 },
    ],
  },
  {
    id: "gps",
    title: "GPS",
    knobs: [
      { key: "SIM_GPS1_ENABLE", label: "GPS on", min: 0, max: 1, step: 1, digits: 0, def: 1, kind: "toggle" },
      {
        key: "SIM_GPS_DISABLE",
        label: "GPS fail",
        min: 0,
        max: 1,
        step: 1,
        digits: 0,
        def: 0,
        kind: "toggle",
        hot: true,
        hideIf: "SIM_GPS1_ENABLE",
      },
      {
        key: "SIM_GPS1_NUMSATS",
        aliases: ["SIM_GPS_NUMSATS"],
        label: "satellites",
        min: 0,
        max: 32,
        step: 1,
        digits: 0,
        def: 10,
      },
      {
        key: "SIM_GPS1_LAG_MS",
        label: "lag",
        unit: "ms",
        min: 0,
        max: 800,
        step: 10,
        digits: 0,
        def: 100,
      },
      {
        key: "SIM_GPS1_JAM",
        label: "jam",
        min: 0,
        max: 1,
        step: 1,
        digits: 0,
        def: 0,
        kind: "toggle",
        hot: true,
      },
      {
        key: "SIM_GPS1_GLTCH_X",
        aliases: ["SIM_GPS_GLITCH_X"],
        label: "glitch N",
        unit: "m",
        min: -50,
        max: 50,
        step: 0.5,
        digits: 1,
        def: 0,
      },
    ],
  },
  {
    id: "rc",
    title: "RC",
    knobs: [
      {
        key: "SIM_RC_FAIL",
        label: "RC fail",
        min: 0,
        max: 2,
        step: 1,
        digits: 0,
        def: 0,
        kind: "choice",
        hot: true,
        choices: [
          { v: 0, label: "off" },
          { v: 1, label: "no RC" },
          { v: 2, label: "thr fail" },
        ],
      },
    ],
  },
  {
    id: "motors",
    title: "Motors",
    motors: true,
    knobs: [
      {
        key: "SIM_ENGINE_MUL",
        label: "thrust left",
        unit: "%",
        min: 0,
        max: 1,
        step: 0.05,
        digits: 0,
        def: 0,
      },
    ],
  },
  {
    id: "imu",
    title: "IMU",
    knobs: [
      {
        key: "SIM_VIB_FREQ_X",
        write: ["SIM_VIB_FREQ_Y", "SIM_VIB_FREQ_Z"],
        label: "vibe",
        unit: "Hz",
        min: 0,
        max: 200,
        step: 1,
        digits: 0,
        def: 0,
      },
      {
        key: "SIM_VIB_MOT_MAX",
        label: "motor vibe",
        unit: "Hz",
        min: 0,
        max: 200,
        step: 1,
        digits: 0,
        def: 0,
      },
      {
        key: "SIM_ACCEL1_FAIL",
        label: "accel fail",
        min: 0,
        max: 1,
        step: 1,
        digits: 0,
        def: 0,
        kind: "toggle",
        hot: true,
      },
      {
        key: "SIM_DRIFT_SPEED",
        label: "drift",
        min: 0,
        max: 0.5,
        step: 0.01,
        digits: 2,
        def: 0.05,
      },
    ],
  },
  {
    id: "mag",
    title: "Compass",
    knobs: [
      { key: "SIM_MAG_RND", label: "noise", min: 0, max: 80, step: 1, digits: 0, def: 0 },
      { key: "SIM_MAG_DELAY", label: "delay", unit: "ms", min: 0, max: 500, step: 10, digits: 0, def: 0 },
      {
        key: "SIM_MAG1_FAIL",
        label: "mag fail",
        min: 0,
        max: 1,
        step: 1,
        digits: 0,
        def: 0,
        kind: "toggle",
        hot: true,
      },
    ],
  },
  {
    id: "baro",
    title: "Baro",
    knobs: [
      {
        key: "SIM_BARO_DISABLE",
        label: "disable",
        min: 0,
        max: 1,
        step: 1,
        digits: 0,
        def: 0,
        kind: "toggle",
        hot: true,
      },
      {
        key: "SIM_BARO_FREEZE",
        label: "freeze",
        min: 0,
        max: 1,
        step: 1,
        digits: 0,
        def: 0,
        kind: "toggle",
        hot: true,
      },
      { key: "SIM_BARO_RND", label: "noise", unit: "m", min: 0, max: 8, step: 0.1, digits: 1, def: 0.2 },
      { key: "SIM_BARO_GLITCH", label: "glitch", unit: "m", min: -40, max: 40, step: 0.5, digits: 1, def: 0 },
      { key: "SIM_BARO_DRIFT", label: "drift", unit: "m/s", min: -2, max: 2, step: 0.05, digits: 2, def: 0 },
      { key: "SIM_BARO_DELAY", label: "delay", unit: "ms", min: 0, max: 500, step: 10, digits: 0, def: 0 },
    ],
  },
  {
    id: "batt",
    title: "Battery",
    knobs: [
      {
        key: "SIM_BATT_VOLTAGE",
        label: "voltage",
        unit: "V",
        min: 0,
        max: 52,
        step: 0.1,
        digits: 1,
        def: 12.6,
      },
      {
        key: "SIM_BATT_CAP_AH",
        label: "capacity",
        unit: "Ah",
        min: 0,
        max: 50,
        step: 0.5,
        digits: 1,
        def: 0,
      },
    ],
  },
];

export const SIM_ENGINE_FAIL = "SIM_ENGINE_FAIL";

export const SIM_PARAM_KEYS: string[] = uniqueKeys();

function uniqueKeys(): string[] {
  const out: string[] = [SIM_ENGINE_FAIL, "SIM_SPEEDUP"];
  const seen = new Set(out);
  for (const g of SIM_GROUPS) {
    for (const k of g.knobs) {
      for (const name of simNames(k)) {
        if (!seen.has(name)) {
          seen.add(name);
          out.push(name);
        }
      }
    }
  }
  return out;
}

export function simNames(k: SimKnob): string[] {
  return [k.key, ...(k.aliases || []), ...(k.write || [])];
}

export function isSitl(params: Record<string, number> | undefined): boolean {
  if (!params) return false;
  return params.SIM_SPEEDUP != null || params.SIM_WIND_SPD != null;
}

export function resolveSimKey(k: SimKnob, params: Record<string, number>): string | null {
  for (const name of [k.key, ...(k.aliases || [])]) {
    if (params[name] != null) return name;
  }
  return null;
}

export function writeSimKeys(k: SimKnob, params: Record<string, number>): string[] {
  const name = resolveSimKey(k, params);
  if (!name) return [];
  const extra = (k.write || []).filter((n) => n !== name && params[n] != null);
  return [name, ...extra];
}

export function catalogDef(name: string): number | null {
  if (name === SIM_ENGINE_FAIL) return 0;
  if (name === "SIM_SPEEDUP") return 1;
  for (const g of SIM_GROUPS) {
    for (const k of g.knobs) {
      if (simNames(k).includes(name)) return k.def;
    }
  }
  return null;
}
