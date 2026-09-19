import {
  EDGES as COPTER_EDGES,
  NODES as COPTER_NODES,
  edgeLiveIn as copterEdge,
  isBandId as copterBand,
  nodeBand as copterNodeBand,
  nodesLiveIn as copterLive,
} from "../cascade";
import type { NodeDef } from "./gains";
import type { Sample } from "../mav/types";
import {
  EDGES as PLANE_EDGES,
  NODES as PLANE_NODES,
  edgeLiveIn as planeEdge,
  isBandId as planeBand,
  nodeBand as planeNodeBand,
  nodesLiveIn as planeLive,
} from "../plane/cascade";
import type { Frame } from "./traces";

function liveSet(frame: Frame, s: Sample): Set<string> {
  return frame === "plane" ? planeLive(s.mode, s) : copterLive(s.mode);
}

function nodesOf(frame: Frame): NodeDef[] {
  return frame === "plane" ? PLANE_NODES : COPTER_NODES;
}

export function isScopeBand(frame: Frame, id: string | null): boolean {
  if (!id) return false;
  return frame === "plane" ? planeBand(id) : copterBand(id);
}

/** Cascade order, only blocks this mode actually closes. */
export function liveNodes(frame: Frame, s: Sample): NodeDef[] {
  const live = liveSet(frame, s);
  return nodesOf(frame).filter((n) => live.has(n.id));
}

export function neighborIds(frame: Frame, sel: string | null, s: Sample): Set<string> {
  const out = new Set<string>();
  if (!sel || isScopeBand(frame, sel)) return out;
  const live = liveSet(frame, s);
  const edges = frame === "plane" ? PLANE_EDGES : COPTER_EDGES;
  const edgeOn = frame === "plane" ? planeEdge : copterEdge;
  for (const e of edges) {
    if (!edgeOn(e, s.mode, live)) continue;
    if (e.from === sel && live.has(e.to)) out.add(e.to);
    if (e.to === sel && live.has(e.from)) out.add(e.from);
  }
  return out;
}

export function defaultWatch(frame: Frame, sel: string | null, s: Sample): string[] {
  const live = liveSet(frame, s);
  if (!sel) return [];
  if (isScopeBand(frame, sel)) {
    const bandOf = frame === "plane" ? planeNodeBand : copterNodeBand;
    return nodesOf(frame)
      .filter((n) => live.has(n.id) && bandOf(n.id) === sel)
      .map((n) => n.id);
  }
  if (!live.has(sel)) return [];
  return [sel, ...neighborIds(frame, sel, s)];
}

/** Mode + runway steer (plane) — when this changes, rebuild the picker. */
export function watchModeKey(frame: Frame, s: Sample): string {
  if (frame !== "plane") return s.mode || "";
  return `${s.mode}:${liveSet(frame, s).has("steer") ? 1 : 0}`;
}
