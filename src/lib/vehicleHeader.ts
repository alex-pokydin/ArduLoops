import { motorFrame, servoOnlyClass } from "./motorFrames";

/** AUTOPILOT_VERSION.flight_sw_version: major, minor, patch, then FIRMWARE_VERSION_TYPE in the low byte. */
export function flightVersion(packed: number | null | undefined): string | null {
  if (packed == null || !Number.isFinite(packed) || packed <= 0) return null;
  const major = (packed >>> 24) & 0xff;
  const minor = (packed >>> 16) & 0xff;
  const patch = (packed >>> 8) & 0xff;
  const type = packed & 0xff;
  const suffix = type === 255 ? "" : type >= 192 ? "-rc" : type >= 128 ? "-beta" : type >= 64 ? "-alpha" : "-dev";
  return `${major}.${minor}.${patch}${suffix}`;
}

export type PlaneLayout = "conventional" | "wing" | "vtail";

/** Surface layout from the output functions: elevons (77/78), V-tail (79/80), else conventional. */
export function planeLayout(params: Record<string, number> | undefined): PlaneLayout | null {
  if (!params) return null;
  const fns = new Set<number>();
  for (let ch = 1; ch <= 32; ch += 1) {
    const fn = params[`SERVO${ch}_FUNCTION`];
    if (Number.isFinite(fn)) fns.add(Math.round(fn));
  }
  if (!fns.size) return null;
  if (fns.has(77) || fns.has(78)) return "wing";
  if (fns.has(79) || fns.has(80)) return "vtail";
  return "conventional";
}

/** Longer than this, a first line is a description, not a name. */
export const NOTE_TITLE_MAX = 48;

/**
 * The note is free text: a short first line names the vehicle, the rest is the body.
 * A note written as one long paragraph has no name yet, so all of it is body.
 */
export function splitNote(comment: string | null | undefined): { title: string; body: string } {
  const text = (comment ?? "").trim();
  if (!text) return { title: "", body: "" };
  const lines = text.split(/\r?\n/);
  const first = lines[0].trim();
  const rest = lines.slice(1).join(" ").replace(/\s+/g, " ").trim();
  if (first.length > NOTE_TITLE_MAX) return { title: "", body: text.replace(/\s+/g, " ") };
  return { title: first, body: rest };
}

/** The stored comment: the name on the first line, the note after it. */
export function joinNote(name: string, body: string): string {
  const n = name.replace(/\s+/g, " ").trim();
  const b = body.trim();
  return n ? (b ? `${n}\n${b}` : n) : b;
}

/** ArduPilot repeats a failing pre-arm check about every 30 s while disarmed. */
export const PREARM_FRESH_S = 45;
/** SYS_STATUS sensor bit ArduPilot sets when its pre-arm checks pass. */
export const PREARM_CHECK_BIT = 0x10000000;

export type PreArmState =
  | { kind: "armed" }
  | { kind: "ready" }
  | { kind: "failing"; lines: string[] }
  | { kind: "unknown" };

export function preArmState(input: {
  armed: boolean;
  lines: { text: string; at: number }[];
  now: number;
  present: number | null;
  health: number | null;
}): PreArmState {
  if (input.armed) return { kind: "armed" };
  const fresh = input.lines.filter((line) => input.now - line.at <= PREARM_FRESH_S).map((line) => line.text.replace(/^PreArm:\s*/, ""));
  const reported = input.present != null && (input.present & PREARM_CHECK_BIT) !== 0;
  if (reported && input.health != null && (input.health & PREARM_CHECK_BIT) !== 0) return { kind: "ready" };
  if (fresh.length) return { kind: "failing", lines: fresh };
  return { kind: "unknown" };
}

/** Arms of the vehicle mark, in a 96 × 72 box with the nose up. Null when the frame cannot be drawn. */
export type MarkShape =
  | { kind: "copter"; arms: { x: number; y: number; coax: boolean }[]; tail: boolean; title: string }
  | { kind: "plane"; layout: PlaneLayout; quad: boolean; title: string }
  | { kind: "unknown"; title: string };

/** The plain mark for a vehicle type, when no vehicle is linked. */
export function genericMark(vehicle: "copter" | "plane" | ""): MarkShape {
  if (vehicle === "plane") return { kind: "plane", layout: "conventional", quad: false, title: "" };
  const d = Math.SQRT1_2;
  return { kind: "copter", arms: [{ x: d, y: d, coax: false }, { x: -d, y: d, coax: false }, { x: -d, y: -d, coax: false }, { x: d, y: -d, coax: false }], tail: false, title: "" };
}

export function markShape(vehicle: "copter" | "plane" | "", params: Record<string, number> | undefined): MarkShape {
  if (vehicle === "plane") {
    const layout = planeLayout(params) ?? "conventional";
    const quad = (params?.Q_ENABLE ?? 0) >= 1;
    const title = quad ? "QuadPlane" : layout === "wing" ? "Flying wing" : layout === "vtail" ? "V-tail" : "Conventional";
    return { kind: "plane", layout, quad, title };
  }
  const cls = params?.FRAME_CLASS;
  if (servoOnlyClass(cls)) return { kind: "unknown", title: "" };
  const frame = motorFrame(cls, params?.FRAME_TYPE);
  if (!frame) return { kind: "unknown", title: "" };
  const arms: { x: number; y: number; coax: boolean }[] = [];
  for (const spot of frame.spots) {
    if (spot.layer === "bottom") continue;
    arms.push({ x: spot.armX, y: spot.armY, coax: spot.layer === "top" });
  }
  return { kind: "copter", arms, tail: frame.servo != null, title: frame.title };
}
