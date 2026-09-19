import type { ReactNode } from "react";
import { Loop } from "../components/Loop";
import { isBandId } from "./cascade";
import type { Axis } from "../mav/axis";
import { L1Scheme, TecsScheme } from "./Outer";
import { PlaneRate } from "./Rate";
import { PlaneSteer } from "./Steer";

function resolve(sel: string | null, axis: Axis): string {
  if (!sel || (isBandId(sel) && sel === "inner")) {
    if (axis === "pitch") return "ptch_rate";
    if (axis === "yaw") return "yaw_damp";
    return "rll_rate";
  }
  if (sel === "outer") return "navl1";
  if (sel === "aileron") return "rll_rate";
  if (sel === "elevator") return "ptch_rate";
  if (sel === "rudder") return "yaw_damp";
  if (sel === "nose") return "steer";
  return sel;
}

const PID = new Set(["rll_rate", "ptch_rate", "rll_ang", "ptch_ang"]);

export function PlaneLoopView({
  sel,
  axis,
  onPause,
}: {
  sel: string | null;
  axis: Axis;
  onPause: () => void;
}) {
  const id = resolve(sel, axis);
  const pidAxis: Axis =
    id === "ptch_rate" || id === "ptch_ang" ? "pitch" : id === "yaw_damp" ? "yaw" : axis === "d" ? "roll" : axis;

  let scheme: ReactNode;
  if (id === "navl1") scheme = <L1Scheme onPause={onPause} />;
  else if (id === "tecs") scheme = <TecsScheme onPause={onPause} />;
  else if (id === "steer") scheme = <PlaneSteer onPause={onPause} />;
  else if (id === "yaw_damp") scheme = <PlaneRate axis="yaw" onPause={onPause} />;
  else if (PID.has(id)) scheme = <Loop sel={id} axis={pidAxis} onPause={onPause} />;
  else {
    scheme = (
      <Loop
        sel={axis === "pitch" ? "ptch_rate" : axis === "yaw" ? "yaw_damp" : "rll_rate"}
        axis={pidAxis === "yaw" ? "roll" : pidAxis}
        onPause={onPause}
      />
    );
  }

  return scheme;
}

export function loopNeedsAxis(sel: string | null, axis: Axis): boolean {
  const id = resolve(sel, axis);
  return PID.has(id) || id === "yaw_damp" || id === "pilot";
}
