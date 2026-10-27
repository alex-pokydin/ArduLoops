import { FRAME_DEFS, type FrameDef } from "./motorFrameData";

/** FRAME_CLASS names, from ArduCopter Parameters.cpp @Values. */
export const CLASS_NAMES: Record<number, string> = {
  0: "Undefined", 1: "Quad", 2: "Hexa", 3: "Octa", 4: "OctaQuad", 5: "Y6", 6: "Heli", 7: "Tri", 8: "SingleCopter", 9: "CoaxCopter",
  10: "BiCopter", 11: "Heli_Dual", 12: "Dodeca-Hexa", 13: "HeliQuad", 14: "Deca", 15: "Scripting Matrix", 16: "6DoF Scripting", 17: "Dynamic Scripting Matrix",
};

/** One motor on the drawing. `n` is the 1-based motor number (Motor n output function). */
export type MotorSpot = {
  n: number;
  /** Right and forward, outermost motor at 1. */
  x: number;
  y: number;
  /** 1 = CCW, -1 = CW, 0 = no direction (Tri, NYT). */
  yaw: -1 | 0 | 1;
  /** MAV_CMD_DO_MOTOR_TEST sequence number. */
  test: number;
  /** Coaxial frames: the lower motor number on an arm is the top one. */
  layer: "top" | "bottom" | null;
  /** End of the arm this motor sits on. */
  armX: number;
  armY: number;
};

export type MotorFrame = {
  cls: number;
  type: number;
  title: string;
  spots: MotorSpot[];
  /** Tri yaw servo: Motor 7 output, its own test sequence. */
  servo: { fn: number; test: number } | null;
};

/** SERVOn_FUNCTION for Motor n, as SRV_Channels::get_motor_function. */
export function motorFunction(n: number): number {
  if (n <= 8) return 32 + n;
  if (n <= 12) return 82 + (n - 9);
  return 160 + (n - 13);
}

/** Motor number for a SERVOn_FUNCTION value, or null for anything else. */
export function motorOfFunction(fn: number): number | null {
  const f = Math.round(fn);
  if (f >= 33 && f <= 40) return f - 32;
  if (f >= 82 && f <= 85) return f - 73;
  if (f >= 160 && f <= 179) return f - 147;
  return null;
}

function defOf(cls: number, type: number): FrameDef | null {
  return FRAME_DEFS[`${cls}/${type}`] ?? FRAME_DEFS[`${cls}/*`] ?? null;
}

export function motorFrame(cls: number | null | undefined, type: number | null | undefined): MotorFrame | null {
  if (cls == null || type == null) return null;
  const c = Math.round(cls);
  const t = Math.round(type);
  const def = defOf(c, t);
  if (!def) return null;
  const seen = new Map<string, number>();
  const spots: MotorSpot[] = [];
  def.motors.forEach((m, i) => {
    if (!m) return;
    const key = `${m.x.toFixed(2)},${m.y.toFixed(2)}`;
    const before = seen.get(key) ?? 0;
    seen.set(key, before + 1);
    spots.push({ n: i + 1, x: m.x, y: m.y, yaw: m.yaw, test: m.test, layer: null, armX: m.x, armY: m.y });
  });
  for (const spot of spots) {
    const key = `${spot.x.toFixed(2)},${spot.y.toFixed(2)}`;
    if ((seen.get(key) ?? 0) < 2) continue;
    const first = spots.find((s) => `${s.x.toFixed(2)},${s.y.toFixed(2)}` === key);
    spot.layer = first === spot ? "top" : "bottom";
  }
  return { cls: c, type: t, title: def.title, spots, servo: def.servo ?? null };
}

export function frameFromParams(params: Record<string, number> | undefined): MotorFrame | null {
  return motorFrame(params?.FRAME_CLASS, params?.FRAME_TYPE);
}

/** Classes this wizard cannot draw: heli, single, coax copter, tailsitter, scripting. */
export function servoOnlyClass(cls: number | null | undefined): boolean {
  return cls != null && [6, 8, 9, 10, 11, 13].includes(Math.round(cls));
}
