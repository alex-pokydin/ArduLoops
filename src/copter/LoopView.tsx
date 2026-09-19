import { Loop } from "../components/Loop";
import type { Axis } from "../mav/axis";

function resolve(sel: string | null, axis: Axis): string {
  if (!sel || sel === "inner") return "atc_rat";
  if (sel === "outer") return axis === "d" ? "psc_d_pos" : "psc_ne_pos";
  if (sel === "pilot") return axis === "d" ? "psc_d_pos" : "atc_ang";
  if (sel === "nav") return axis === "d" ? "psc_d_pos" : "psc_ne_pos";
  if (sel === "lean") return "atc_ang";
  if (sel === "motors") return axis === "d" ? "psc_d_acc" : "atc_rat";
  return sel;
}

const PID = new Set([
  "atc_rat",
  "atc_ang",
  "psc_d_pos",
  "psc_d_vel",
  "psc_d_acc",
  "psc_ne_pos",
  "psc_ne_vel",
]);

const OPEN_LOOP = new Set(["psc_ne_pos", "psc_ne_vel", "psc_d_pos", "psc_d_vel", "psc_d_acc"]);

export function CopterLoopView({
  sel,
  axis,
  compact,
}: {
  sel: string | null;
  axis: Axis;
  compact?: boolean;
}) {
  const id = resolve(sel, axis);
  const loopAxis: Axis = id.startsWith("psc_d") ? "d" : id.startsWith("psc_ne") ? (axis === "d" || axis === "yaw" ? "roll" : axis) : axis === "d" ? "roll" : axis;
  return <Loop sel={PID.has(id) ? id : "atc_rat"} axis={loopAxis} compact={compact} />;
}

export function loopNeedsAxis(sel: string | null, axis: Axis): boolean {
  const id = resolve(sel, axis);
  return PID.has(id) || id === "pilot";
}

export function opensLoop(id: string | null): boolean {
  return !!id && OPEN_LOOP.has(id);
}
