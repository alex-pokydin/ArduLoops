import { useEffect, useMemo, useState } from "react";
import {
  CUSTOM_ID,
  customCatalog,
  customPane,
  panesForIds,
  resolveLine,
  type CatalogTrace,
} from "../lib/traces";
import { defaultWatch, liveNodes, neighborIds, watchModeKey } from "../lib/watch";
import type { Axis } from "../mav/axis";
import { send } from "../mav/cmd";
import { useVehicle, useViewSample } from "../mav/view";
import { TracePanes } from "./TracePanes";

const LINE_STORE = "arduloops.custom-lines.";

function loadLines(frame: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LINE_STORE + frame) || "[]") as unknown;
    if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) return [];
    return raw;
  } catch {
    return [];
  }
}

function saveLines(frame: string, keys: string[]) {
  try {
    localStorage.setItem(LINE_STORE + frame, JSON.stringify(keys));
  } catch {
    /* ignore */
  }
}

function scopePanes(
  frame: "copter" | "plane",
  watch: string[],
  axis: Axis,
  catalog: CatalogTrace[],
  lines: string[],
) {
  const customOn = watch.includes(CUSTOM_ID);
  const ids = watch.filter((id) => id !== CUSTOM_ID);
  const base = panesForIds(frame, ids, axis);
  if (!customOn) return base;
  const picked = lines
    .map((id) => resolveLine(id, catalog))
    .filter((tr): tr is CatalogTrace => !!tr);
  return [...base, customPane(picked)];
}

export function Scope({
  sel,
  onSel,
  axis,
  onPause,
}: {
  sel: string | null;
  onSel?: (id: string) => void;
  axis: Axis;
  onPause: () => void;
}) {
  const vehicle = useVehicle();
  const s = useViewSample();
  const frame = vehicle === "plane" ? "plane" : "copter";
  const modeKey = watchModeKey(frame, s);
  const blocks = useMemo(() => liveNodes(frame, s), [frame, modeKey]);
  const near = useMemo(() => neighborIds(frame, sel, s), [frame, sel, modeKey]);
  const paramN = Object.keys(s.params || {}).length;
  const catalog = useMemo(() => customCatalog(s.params || {}), [paramN]);
  const [watch, setWatch] = useState<string[]>(() => defaultWatch(frame, sel, s));
  const [lines, setLines] = useState<string[]>(() => loadLines(frame));
  const customOn = watch.includes(CUSTOM_ID);

  useEffect(() => {
    setLines(loadLines(frame));
  }, [frame]);

  useEffect(() => {
    if (!customOn || !s.ok) return;
    send({ op: "params_list" });
  }, [customOn, s.ok]);

  useEffect(() => {
    setWatch((w) => {
      const keepCustom = w.includes(CUSTOM_ID);
      const live = new Set(liveNodes(frame, s).map((n) => n.id));
      let next: string[];
      if (sel && w.includes(sel)) {
        const kept = w.filter((id) => id !== CUSTOM_ID && live.has(id));
        next = kept.length ? kept : defaultWatch(frame, sel, s);
      } else {
        next = defaultWatch(frame, sel, s);
      }
      return keepCustom && !next.includes(CUSTOM_ID) ? [...next, CUSTOM_ID] : next;
    });
  }, [frame, sel, modeKey]);

  function onToggle(id: string, on: boolean) {
    setWatch((w) => (on ? (w.includes(id) ? w : [...w, id]) : w.filter((x) => x !== id)));
    if (on && id !== CUSTOM_ID) onSel?.(id);
  }

  function onToggleLine(id: string, on: boolean) {
    setLines((ls) => {
      const next = on ? (ls.includes(id) ? ls : [...ls, id]) : ls.filter((k) => k !== id);
      saveLines(frame, next);
      return next;
    });
  }

  return (
    <TracePanes
      panes={scopePanes(frame, watch, axis, catalog, lines)}
      onPause={onPause}
      blocks={blocks}
      checked={watch}
      near={near}
      onToggle={onToggle}
      catalog={catalog}
      customLines={lines}
      onToggleLine={onToggleLine}
    />
  );
}
