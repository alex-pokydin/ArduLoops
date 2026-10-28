/**
 * The vehicle profile: what the board cannot report about the airframe. Saved per board next to the note
 * (`controller_profile`); the bridge keeps only these fields and checks each one.
 */
export type Chemistry = "lipo" | "lihv" | "liion";
export type FlyingStyle = "freestyle" | "cinematic" | "long_range" | "racing" | "heavy_lift";
export type PlaneType = "trainer" | "sport" | "glider" | "fpv_wing" | "vtol";

export type VehicleProfile = {
  /** Prop diameter in inches, decimals allowed (8.3 for an 8330 prop). */
  props_in: number | null;
  blades: number | null;
  cells: number | null;
  chemistry: Chemistry | null;
  /** Per-cell full and empty voltage; set when they differ from the chemistry's usual pair (Li-ion packs vary). */
  cell_v_max: number | null;
  cell_v_min: number | null;
  capacity_mah: number | null;
  weight_g: number | null;
  /** Plane: wingspan. Copter: frame size, motor to motor across the diagonal. */
  span_mm: number | null;
  motors: string;
  style: FlyingStyle[];
  plane_type: PlaneType | null;
};

export const EMPTY_PROFILE: VehicleProfile = {
  props_in: null, blades: null, cells: null, chemistry: null, cell_v_max: null, cell_v_min: null,
  capacity_mah: null, weight_g: null, span_mm: null, motors: "", style: [], plane_type: null,
};

/** Prop sizes offered as shortcuts; the inch field takes any size. */
export const COPTER_PROPS = [3, 5, 7, 10, 13, 15];
export const PLANE_PROPS = [6, 8, 10, 12, 14];
export const BLADES = [2, 3, 4, 5];
export const CHEMISTRIES: [Chemistry, string][] = [["lipo", "LiPo"], ["lihv", "LiHV"], ["liion", "Li-ion"]];
/** Usual per-cell full and empty voltage by chemistry. */
export const CELL_VOLTS: Record<Chemistry, { max: number; min: number }> = {
  lipo: { max: 4.2, min: 3.3 },
  lihv: { max: 4.35, min: 3.3 },
  liion: { max: 4.2, min: 3.0 },
};
export const STYLES: [FlyingStyle, string][] = [
  ["freestyle", "Freestyle"],
  ["cinematic", "Cinematic"],
  ["long_range", "Long range"],
  ["racing", "Racing"],
  ["heavy_lift", "Heavy lift"],
];
export const PLANE_TYPES: [PlaneType, string][] = [
  ["trainer", "Trainer"],
  ["sport", "Sport"],
  ["glider", "Glider"],
  ["fpv_wing", "FPV wing"],
  ["vtol", "VTOL"],
];

/** A stored profile, or null when nothing (or nothing readable) is stored. */
export function readProfile(value: unknown): VehicleProfile | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const pick = <T extends string>(x: unknown, list: [T, string][]) => (list.some(([k]) => k === x) ? (x as T) : null);
  return {
    props_in: num(v.props_in),
    blades: num(v.blades),
    cells: num(v.cells),
    chemistry: pick(v.chemistry, CHEMISTRIES),
    cell_v_max: num(v.cell_v_max),
    cell_v_min: num(v.cell_v_min),
    capacity_mah: num(v.capacity_mah),
    weight_g: num(v.weight_g),
    span_mm: num(v.span_mm),
    motors: typeof v.motors === "string" ? v.motors : "",
    style: Array.isArray(v.style) ? (v.style.filter((s) => STYLES.some(([k]) => k === s)) as FlyingStyle[]) : [],
    plane_type: pick(v.plane_type, PLANE_TYPES),
  };
}

export function propLabel(inches: number): string {
  return `${+inches.toFixed(1)}″`;
}

/**
 * Cells guessed from the pack voltage: the fewest cells that keep each one at or below 4.25 V.
 * A charged pack reads right; a pack that is nearly empty can read one cell short, so the form says it is a guess.
 * `MOT_BAT_VOLT_MAX` (full-pack voltage), when set, is the better source.
 */
export function guessCells(volts: number | null, voltMax: number | null): { cells: number; from: "max" | "volts"; volts: number } | null {
  if (voltMax != null && voltMax > 2) return { cells: Math.max(1, Math.round(voltMax / 4.2)), from: "max", volts: Math.round(voltMax * 10) / 10 };
  if (volts == null || volts < 2.5) return null;
  return { cells: Math.max(1, Math.ceil(volts / 4.25)), from: "volts", volts };
}

type Translate = (s: string, vars?: Record<string, string | number>) => string;

/** Header chips from the profile, in the drawn order. Capacity is not here: the board's BATT_CAPACITY wins. */
export function profileChips(p: VehicleProfile, vehicle: "copter" | "plane" | "", t: Translate): string[] {
  const out: string[] = [];
  if (vehicle === "plane" && p.span_mm != null) out.push(t("{n} mm span", { n: Math.round(p.span_mm) }));
  if (p.props_in != null) out.push(t("{size} props", { size: propLabel(p.props_in) }));
  if (p.cells != null) out.push(`${p.cells}S`);
  if (p.weight_g != null) out.push(`${Math.round(p.weight_g)} g`);
  if (vehicle === "plane") {
    if (p.plane_type) out.push(t(PLANE_TYPES.find(([k]) => k === p.plane_type)?.[1] ?? p.plane_type));
  } else if (p.style.length) {
    out.push(p.style.map((s) => t(STYLES.find(([k]) => k === s)?.[1] ?? s)).join(", "));
  }
  return out;
}

export function hasProfile(p: VehicleProfile | null): boolean {
  if (!p) return false;
  return Object.entries(p).some(([k, v]) => (k === "style" ? (v as unknown[]).length > 0 : k === "motors" ? !!v : v != null));
}
