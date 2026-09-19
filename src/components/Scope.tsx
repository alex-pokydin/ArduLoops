import { useEffect, useMemo, useState } from "react";
import { panesForIds } from "../lib/traces";
import { defaultWatch, liveNodes, neighborIds, watchModeKey } from "../lib/watch";
import type { Axis } from "../mav/axis";
import { useVehicle, useViewSample } from "../mav/view";
import { TracePanes } from "./TracePanes";

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
  const [watch, setWatch] = useState<string[]>(() => defaultWatch(frame, sel, s));

  useEffect(() => {
    setWatch((w) => {
      const live = new Set(liveNodes(frame, s).map((n) => n.id));
      if (sel && w.includes(sel)) {
        const kept = w.filter((id) => live.has(id));
        return kept.length ? kept : defaultWatch(frame, sel, s);
      }
      return defaultWatch(frame, sel, s);
    });
  }, [frame, sel, modeKey]);

  function onToggle(id: string, on: boolean) {
    setWatch((w) => (on ? (w.includes(id) ? w : [...w, id]) : w.filter((x) => x !== id)));
    if (on) onSel?.(id);
  }

  return (
    <TracePanes
      panes={panesForIds(frame, watch, axis)}
      onPause={onPause}
      blocks={blocks}
      checked={watch}
      near={near}
      onToggle={onToggle}
    />
  );
}
