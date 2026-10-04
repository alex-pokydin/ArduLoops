import { useMemo, useState } from "react";
import { Aside, type LogRow } from "../components/Aside";
import { AxisSwitch } from "../components/AxisSwitch";
import { Cascade } from "../components/Cascade";
import { CopterInspect } from "../components/CopterInspect";
import { Scope } from "../components/Scope";
import { Studio } from "../components/Studio";
import { LAYERS } from "../cascade";
import { useT } from "../i18n/i18n";
import { preferredLayoutWidth } from "../lib/layout";
import { addLog } from "../log";
import { axisLabel, type Axis } from "../mav/axis";
import { CopterLoopView } from "./LoopView";
import { AuditLibrary } from "../components/AuditLibrary";
import { ControllerView } from "../components/ControllerView";
import { WorkspaceTabs } from "../components/WorkspaceTabs";

export function CopterApp({
  log,
}: {
  log: LogRow[];
}) {
  const t = useT();
  const [sel, setSel] = useState<string | null>(null);
  const [axis, setAxis] = useState<Axis>("roll");
  const [showAll, setShowAll] = useState(false);
  const [workspace, setWorkspace] = useState<"loops" | "firmware" | "audit">("loops");
  const col1Default = useMemo(() => preferredLayoutWidth(LAYERS), []);

  function onAxis(next: Axis) {
    setAxis(next);
    setSel((id) => {
      if (next === "d") {
        if (id?.startsWith("psc_d") || id === "pilot" || id === "nav" || id === "motors") return id;
        return "psc_d_pos";
      }
      if (id?.startsWith("psc_d")) return "atc_rat";
      return id;
    });
    addLog(t("Axis · {axis}", { axis: t(axisLabel(next)) }), "cmd");
  }

  function onPick(next: string | null) {
    setSel(next);
    if (next?.startsWith("psc_d")) setAxis("d");
    else if (next === "psc_ne_pos" || next === "psc_ne_vel" || next === "lean") {
      setAxis((a) => (a === "d" || a === "yaw" ? "roll" : a));
    } else if (next === "atc_ang" || next === "atc_rat") {
      setAxis((a) => (a === "d" ? "roll" : a));
    }
  }

  if (workspace === "firmware") {
    return (
      <main>
        <ControllerView onWorkspace={setWorkspace} />
        <Aside
          log={log}
          sel={sel}
          onSel={onPick}
          axis={axis}
          inspect={<CopterInspect sel={sel} onSel={onPick} axis={axis} showAll={showAll} />}
        />
      </main>
    );
  }

  if (workspace === "audit") {
    return (
      <main>
        <AuditLibrary current="audit" ids={["loops", "firmware", "audit"]} onWorkspace={setWorkspace} />
        <Aside
          log={log}
          sel={sel}
          onSel={onPick}
          axis={axis}
          inspect={<CopterInspect sel={sel} onSel={onPick} axis={axis} showAll={showAll} />}
        />
      </main>
    );
  }

  return (
    <main>
      <section className="scope">
        <Studio
          frame="copter"
          col1Default={col1Default}
          toolbar={<>
            <WorkspaceTabs current="loops" ids={["loops", "firmware", "audit"]} onSelect={setWorkspace} />
            <AxisSwitch axis={axis} onAxis={onAxis} />
          </>}
          scheme={<Cascade sel={sel} onSel={onPick} axis={axis} showAll={showAll} onShowAll={setShowAll} />}
          loop={(compact) => <CopterLoopView sel={sel} axis={axis} compact={compact} />}
          scope={<Scope sel={sel} onSel={onPick} axis={axis} />}
        />
      </section>
      <Aside
        log={log}
        sel={sel}
        onSel={onPick}
        axis={axis}
        inspect={<CopterInspect sel={sel} onSel={onPick} axis={axis} showAll={showAll} />}
      />
    </main>
  );
}
