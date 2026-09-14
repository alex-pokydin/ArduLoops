import type { Gain } from "../cascade";
import type { Sample } from "./types";

export type Axis = "roll" | "pitch" | "yaw";

export type AxisView = {
  axis: Axis;
  name: string;
  title: string;
  rateName: string;
  tag: "RLL" | "PIT" | "YAW";
  cmdUnit: "°" | "°/s";
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
  return "roll";
}

export function axisView(s: Sample, axis: Axis): AxisView {
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
      cmdUnit: "°/s",
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

/** Heading target is not the stick. Stick on yaw is a rate. */
export function axisTar(v: AxisView): number {
  if (v.tar != null) return v.tar;
  if (v.axis === "yaw") return v.ang;
  return v.cmd || 0;
}

/** Inner ATC_RAT / ATC_ANG RLL keys → selected axis. Outer PSC stays as-is. */
export function remapGainKey(key: string, axis: Axis): string {
  if (axis === "roll" || !key.includes("_RLL_")) return key;
  return key.replace("_RLL_", `_${axis === "pitch" ? "PIT" : "YAW"}_`);
}

export function gainKeysForAxis(g: Gain, axis: Axis): string[] {
  if (axis === "yaw" && g.key.includes("_RLL_")) return [remapGainKey(g.key, "yaw")];
  return [g.key, ...(g.aliases || [])];
}
