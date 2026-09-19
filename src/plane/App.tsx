import { useMemo, useState } from "react";
import { Aside, type LogRow } from "../components/Aside";
import { Scope } from "../components/Scope";
import { Studio } from "../components/Studio";
import { useT } from "../i18n/i18n";
import { preferredLayoutWidth } from "../lib/layout";
import { addLog } from "../log";
import { axisLabel, type Axis } from "../mav/axis";
import { PlaneAxisSwitch } from "./AxisSwitch";
import { LAYERS, MODES, NODES } from "./cascade";
import { PlaneInspect } from "./Inspect";
import { PlaneMap } from "./Map";
import { PlaneLoopView } from "./LoopView";

export function PlaneApp({
  log,
}: {
  log: LogRow[];
}) {
  const t = useT();
  const [sel, setSel] = useState<string | null>(null);
  const [axis, setAxis] = useState<Axis>("roll");
  const [showAll, setShowAll] = useState(false);
  const col1Default = useMemo(() => preferredLayoutWidth(LAYERS), []);
  const loopAxis = axis === "d" ? "roll" : axis;

  function onAxis(next: Axis) {
    setAxis(next);
    if (next === "pitch") setSel("ptch_rate");
    else if (next === "yaw") setSel("yaw_damp");
    else setSel("rll_rate");
    addLog(t("Axis · {axis}", { axis: t(axisLabel(next)) }), "cmd");
  }

  function onPick(next: string | null) {
    setSel(next);
    if (next === "ptch_ang" || next === "ptch_rate" || next === "elevator") setAxis("pitch");
    else if (next === "yaw_damp" || next === "rudder") setAxis("yaw");
    else if (next === "rll_ang" || next === "rll_rate" || next === "aileron" || next === "ahrs") setAxis("roll");
  }

  return (
    <main>
      <section className="scope">
        <Studio
          frame="plane"
          col1Default={col1Default}
          toolbar={<PlaneAxisSwitch axis={loopAxis} onAxis={onAxis} />}
          scheme={<PlaneMap sel={sel} onSel={onPick} showAll={showAll} onShowAll={setShowAll} />}
          loop={(compact) => <PlaneLoopView sel={sel} axis={loopAxis} compact={compact} />}
          scope={<Scope sel={sel} onSel={onPick} axis={loopAxis} />}
        />
      </section>
      <Aside
        log={log}
        sel={sel}
        onSel={onPick}
        axis={loopAxis}
        live3d={false}
        modes={MODES}
        nodes={NODES}
        presets={false}
        vehicle="plane"
        inspect={<PlaneInspect sel={sel} onSel={onPick} showAll={showAll} />}
      />
    </main>
  );
}
