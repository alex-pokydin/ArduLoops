import type { Gain } from "../lib/gains";
import type { Sample } from "./types";

export type Axis = "roll" | "pitch" | "yaw" | "d";

export type AxisView = {
  axis: Axis;
  name: string;
  title: string;
  rateName: string;
  tag: "RLL" | "PIT" | "YAW" | "D";
  cmdUnit: "°" | "°/s" | "%";
  ang: number;
  rate: number;
  des: number | null;
  cmd: number;
  tar: number | null;
  p: number | null;
  i: number | null;
  d: number | null;
};

export function axisLabel(axis: Axis): string {
  if (axis === "pitch") return "pitch";
  if (axis === "yaw") return "yaw";
  if (axis === "d") return "height";
  return "roll";
}

export function axisView(s: Sample, axis: Axis): AxisView {
  if (axis === "d") {
    return {
      axis,
      name: "height",
      title: "Height",
      rateName: "climb",
      tag: "D",
      cmdUnit: "%",
      ang: s.alt ?? 0,
      rate: s.climb ?? 0,
      des: s.climb_des ?? null,
      cmd: s.thr_cmd ?? 0,
      tar: s.alt_tar ?? null,
      p: null,
      i: null,
      d: null,
    };
  }
  if (axis === "pitch") {
    return {
      axis,
      name: "pitch",
      title: "Pitch",
      rateName: "Pitch rate",
      tag: "PIT",
      cmdUnit: "°",
      ang: s.pitch ?? 0,
      rate: s.pitch_rate ?? 0,
      des: s.pitch_des ?? null,
      cmd: s.pitch_cmd ?? 0,
      tar: s.pitch_tar ?? null,
      p: s.pitch_p ?? null,
      i: s.pitch_i ?? null,
      d: s.pitch_d ?? null,
    };
  }
  if (axis === "yaw") {
    return {
      axis,
      name: "yaw",
      title: "Yaw",
      rateName: "Yaw rate",
      tag: "YAW",
      cmdUnit: "°",
      ang: s.yaw ?? 0,
      rate: s.yaw_rate ?? 0,
      des: s.yaw_des ?? null,
      cmd: s.yaw_cmd ?? 0,
      tar: s.yaw_tar ?? null,
      p: s.yaw_p ?? null,
      i: s.yaw_i ?? null,
      d: s.yaw_d ?? null,
    };
  }
  return {
    axis,
    name: "roll",
    title: "Roll",
    rateName: "Roll rate",
    tag: "RLL",
    cmdUnit: "°",
    ang: s.roll ?? 0,
    rate: s.rate ?? 0,
    des: s.des ?? null,
    cmd: s.cmd ?? 0,
    tar: s.tar ?? null,
    p: s.p ?? null,
    i: s.i ?? null,
    d: s.d ?? null,
  };
}

/** Heading / height target is not the stick. */
export function axisTar(v: AxisView): number {
  if (v.tar != null) return v.tar;
  if (v.axis === "yaw" || v.axis === "d") return v.ang;
  return v.cmd || 0;
}

export function wrap180(d: number): number {
  let x = d;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

/** Angle error, shortest way for yaw. */
export function axisErr(v: AxisView): number {
  const d = axisTar(v) - v.ang;
  return v.axis === "yaw" ? wrap180(d) : d;
}

/** Inner ATC_RAT / ATC_ANG RLL keys → selected axis. Outer PSC / D stay as-is. */
export function remapGainKey(key: string, axis: Axis): string {
  if ((axis !== "pitch" && axis !== "yaw") || !key.includes("_RLL_")) return key;
  return key.replace("_RLL_", `_${axis === "pitch" ? "PIT" : "YAW"}_`);
}

export function gainKeysForAxis(g: Gain, axis: Axis): string[] {
  if (axis === "yaw" && g.key.includes("_RLL_")) return [remapGainKey(g.key, "yaw")];
  return [g.key, ...(g.aliases || [])];
}
