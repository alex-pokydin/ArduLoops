/** Compass mount angles. Matrices match ArduPilot Matrix3::from_euler / to_euler. */

export type V3 = [number, number, number];
/** Rows, matching ArduPilot Matrix3 a, b, c. */
export type M3 = [V3, V3, V3];

export type MountFit = {
  roll: number;
  pitch: number;
  yaw: number;
  nearestId: number;
  nearestDeg: number;
};

/** Roll, pitch, yaw degrees for MAV_SENSOR_ORIENTATION 0–40, 42 and 43. */
const NAMED: [number, number, number, number][] = [
  [0, 0, 0, 0], [1, 0, 0, 45], [2, 0, 0, 90], [3, 0, 0, 135], [4, 0, 0, 180], [5, 0, 0, 225], [6, 0, 0, 270], [7, 0, 0, 315],
  [8, 180, 0, 0], [9, 180, 0, 45], [10, 180, 0, 90], [11, 180, 0, 135], [12, 0, 180, 0], [13, 180, 0, 225], [14, 180, 0, 270], [15, 180, 0, 315],
  [16, 90, 0, 0], [17, 90, 0, 45], [18, 90, 0, 90], [19, 90, 0, 135], [20, 270, 0, 0], [21, 270, 0, 45], [22, 270, 0, 90], [23, 270, 0, 135],
  [24, 0, 90, 0], [25, 0, 270, 0], [26, 0, 180, 90], [27, 0, 180, 270], [28, 90, 90, 0], [29, 180, 90, 0], [30, 270, 90, 0], [31, 90, 180, 0],
  [32, 270, 180, 0], [33, 90, 270, 0], [34, 180, 270, 0], [35, 270, 270, 0], [36, 90, 180, 90], [37, 90, 0, 270], [38, 90, 68, 293], [39, 0, 315, 0],
  [40, 90, 315, 0], [42, 45, 0, 0], [43, 315, 0, 0],
];

const DEG = 180 / Math.PI;

export function orientLabel(value: number): string {
  if (value === 100) return "Custom";
  if (value === 101) return "Custom 1";
  if (value === 102) return "Custom 2";
  const row = NAMED.find((item) => item[0] === value);
  if (!row) return String(value);
  if (value === 0) return "None";
  const parts = [
    row[1] ? `Roll ${row[1]}` : "",
    row[2] ? `Pitch ${row[2]}` : "",
    row[3] ? `Yaw ${row[3]}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

export function fromEuler(rollDeg: number, pitchDeg: number, yawDeg: number): M3 {
  const roll = rollDeg / DEG;
  const pitch = pitchDeg / DEG;
  const yaw = yawDeg / DEG;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  return [
    [cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy],
    [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy],
    [-sp, sr * cp, cr * cp],
  ];
}

export function toEuler(m: M3): { roll: number; pitch: number; yaw: number } {
  const pitch = -Math.asin(Math.max(-1, Math.min(1, m[2][0])));
  const roll = Math.atan2(m[2][1], m[2][2]);
  const yaw = Math.atan2(m[1][0], m[0][0]);
  return { roll: roll * DEG, pitch: pitch * DEG, yaw: yaw * DEG };
}

function wrap(deg: number): number {
  let v = deg % 360;
  if (v > 180) v -= 360;
  if (v < -180) v += 360;
  return v;
}

export function matMul(a: M3, b: M3): M3 {
  const out: M3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
    }
  }
  return out;
}

export function transpose(m: M3): M3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function scale(a: V3, k: number): V3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vlen(a: V3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function norm(a: V3): V3 | null {
  const n = vlen(a);
  if (!(n > 1e-6)) return null;
  return scale(a, 1 / n);
}

export function mean(points: V3[]): V3 {
  const s: V3 = [0, 0, 0];
  for (const p of points) {
    s[0] += p[0];
    s[1] += p[1];
    s[2] += p[2];
  }
  const n = points.length || 1;
  return [s[0] / n, s[1] / n, s[2] / n];
}

function rotationAngle(a: M3, b: M3): number {
  const r = matMul(transpose(a), b);
  const trace = r[0][0] + r[1][1] + r[2][2];
  const c = Math.max(-1, Math.min(1, (trace - 1) / 2));
  return Math.acos(c) * DEG;
}

export function namedMatrix(id: number): M3 | null {
  const row = NAMED.find((item) => item[0] === id);
  if (!row) return null;
  return fromEuler(row[1], row[2], row[3]);
}

export function currentMatrix(orient: number, custom: { roll: number; pitch: number; yaw: number } | null): M3 {
  if ((orient === 100 || orient === 101 || orient === 102) && custom) {
    return fromEuler(custom.roll, custom.pitch, custom.yaw);
  }
  return namedMatrix(orient) ?? fromEuler(0, 0, 0);
}

/**
 * Body-frame samples from a level full turn, plus the sample taken with the nose on magnetic north.
 * `downPositive` is true in the northern hemisphere, where the field points down.
 * Returns the mount rotation that should replace the current orientation.
 */
export function fitMount(points: V3[], north: V3, current: M3, downPositive: boolean): MountFit | null {
  if (points.length < 8) return null;
  const center = mean(points);
  const down = norm(center);
  if (!down || vlen(center) < 80) return null;
  const axis = downPositive ? down : scale(down, -1);
  const horiz = sub(north, scale(axis, dot(north, axis)));
  const forward = norm(horiz);
  if (!forward || vlen(horiz) < 50) return null;
  const right = cross(axis, forward);
  const error: M3 = [
    [forward[0], right[0], axis[0]],
    [forward[1], right[1], axis[1]],
    [forward[2], right[2], axis[2]],
  ];
  const mount = matMul(transpose(error), current);
  const euler = toEuler(mount);
  let nearestId = 0;
  let nearestDeg = 180;
  for (const row of NAMED) {
    const named = fromEuler(row[1], row[2], row[3]);
    const deg = rotationAngle(mount, named);
    if (deg < nearestDeg) {
      nearestDeg = deg;
      nearestId = row[0];
    }
  }
  return {
    roll: wrap(euler.roll),
    pitch: wrap(euler.pitch),
    yaw: wrap(euler.yaw),
    nearestId,
    nearestDeg,
  };
}
