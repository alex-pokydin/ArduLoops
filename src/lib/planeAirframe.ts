/** Plane surface layouts as ArduPlane output functions (SRV_Channel.h). */
export type Layout = "conventional" | "wing" | "vtail";
export type LayoutKind = Layout | "other";

export type Surface = { key: string; title: string; fn: number };

const THROTTLE: Surface = { key: "throttle", title: "Throttle", fn: 70 };

/** What each layout puts on outputs. Throttle is listed so it is checked, but a layout change keeps it. */
export const LAYOUT_SURFACES: Record<Layout, Surface[]> = {
  conventional: [
    { key: "aileron", title: "Aileron", fn: 4 },
    { key: "elevator", title: "Elevator", fn: 19 },
    THROTTLE,
    { key: "rudder", title: "Rudder", fn: 21 },
  ],
  wing: [
    { key: "elevon_left", title: "Left elevon", fn: 77 },
    { key: "elevon_right", title: "Right elevon", fn: 78 },
    THROTTLE,
  ],
  vtail: [
    { key: "aileron", title: "Aileron", fn: 4 },
    { key: "vtail_left", title: "Left ruddervator", fn: 79 },
    { key: "vtail_right", title: "Right ruddervator", fn: 80 },
    THROTTLE,
  ],
};

export const LAYOUT_NAMES: Record<LayoutKind, string> = { conventional: "Conventional", wing: "Flying wing", vtail: "V-tail", other: "Other layout" };

/** Every function a layout change may move: the primary surfaces of all three layouts. */
const SURFACE_FNS = new Set([4, 19, 21, 77, 78, 79, 80]);
/** Flaperons and split throttles make a layout this page does not draw. */
const OTHER_FNS = new Set([24, 25, 73, 74]);
/** ArduPlane's default outputs: SERVO1 aileron, 2 elevator, 3 throttle, 4 rudder. */
const DEFAULT_OUT: Record<number, number> = { 4: 1, 19: 2, 70: 3, 21: 4, 77: 1, 78: 2, 79: 2, 80: 4 };

export const OUTPUTS = 16;

function functions(params: Record<string, number>): (number | null)[] {
  return Array.from({ length: OUTPUTS }, (_, i) => {
    const v = params[`SERVO${i + 1}_FUNCTION`];
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
  });
}

/** The layout the outputs describe now; null when the parameters are missing or no surface is on an output. */
export function classifyLayout(params: Record<string, number> | undefined): LayoutKind | null {
  if (!params) return null;
  const fns = new Set(functions(params).filter((f): f is number => f != null));
  if (!fns.size) return null;
  const has = (...list: number[]) => list.some((f) => fns.has(f));
  if (has(...OTHER_FNS)) return "other";
  const elevon = has(77, 78);
  const vtail = has(79, 80);
  const conv = has(4, 19, 21);
  if (elevon && (vtail || has(21, 19))) return "other";
  if (elevon) return "wing";
  if (vtail) return has(19, 21) ? "other" : "vtail";
  if (conv) return "conventional";
  return null;
}

/** Surfaces a step should list: the layout's own, or the conventional set for a layout that is not drawn. */
export function surfacesFor(kind: LayoutKind | null): Surface[] {
  return LAYOUT_SURFACES[kind && kind !== "other" ? kind : "conventional"];
}

export type PlanRow = Surface & { out: number | null; from: number | null; changed: boolean };
export type Plan = { rows: PlanRow[]; writes: [string, number][]; cleared: number[]; missing: Surface[] };

/**
 * Output changes for a layout. Functions already on an output stay; the other surfaces of the old layout
 * give their outputs to the new ones in output order; what is still missing takes ArduPlane's default
 * output when it is free, else the first free one. Old surface outputs left over are set to 0.
 */
export function outputPlan(params: Record<string, number>, layout: Layout): Plan {
  const now = functions(params);
  const want = LAYOUT_SURFACES[layout];
  const next = [...now];
  const placed = new Map<number, number>();
  for (const s of want) {
    const at = now.indexOf(s.fn);
    if (at >= 0) placed.set(s.fn, at + 1);
  }
  const spare = now
    .map((f, i) => ({ f, out: i + 1 }))
    .filter(({ f }) => f != null && SURFACE_FNS.has(f) && !want.some((s) => s.fn === f))
    .map(({ out }) => out);
  for (const s of want) {
    if (placed.has(s.fn) || s.fn === THROTTLE.fn) continue;
    const out = spare.shift();
    if (out == null) continue;
    placed.set(s.fn, out);
    next[out - 1] = s.fn;
  }
  const free = (out: number) => next[out - 1] === 0 && ![...placed.values()].includes(out);
  for (const s of want) {
    if (placed.has(s.fn)) continue;
    const pref = DEFAULT_OUT[s.fn];
    let out = pref && free(pref) ? pref : null;
    for (let o = 1; out == null && o <= OUTPUTS; o += 1) if (free(o)) out = o;
    if (out == null) continue;
    placed.set(s.fn, out);
    next[out - 1] = s.fn;
  }
  for (const out of spare) next[out - 1] = 0;

  const writes: [string, number][] = [];
  next.forEach((f, i) => {
    if (f != null && f !== now[i]) writes.push([`SERVO${i + 1}_FUNCTION`, f]);
  });
  const rows = want.map((s) => {
    const out = placed.get(s.fn) ?? null;
    const from = out != null ? now[out - 1] : null;
    return { ...s, out, from, changed: out != null && from !== s.fn };
  });
  return { rows, writes, cleared: spare, missing: want.filter((s) => !placed.has(s.fn)) };
}
