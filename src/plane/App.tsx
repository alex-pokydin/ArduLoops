import { lazy, Suspense, useMemo, useState } from "react";
import { Aside, type LogRow } from "../components/Aside";
import { AuditLibrary } from "../components/AuditLibrary";
import { ControllerView } from "../components/ControllerView";
import { PLANE_WORKSPACES, WorkspaceTabs, type WorkspaceId } from "../components/WorkspaceTabs";
import { MissionView } from "../components/MissionView";

const ScriptsLibrary = lazy(() => import("../components/ScriptsLibrary").then((mod) => ({ default: mod.ScriptsLibrary })));
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
  const [workspace, setWorkspace] = useState<WorkspaceId>("loops");
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

  if (workspace === "mission") {
    return (
      <main>
        <MissionView current="mission" ids={PLANE_WORKSPACES} onWorkspace={setWorkspace} />
        <Aside
          log={log}
          sel={sel}
          onSel={onPick}
          axis={loopAxis}
          modes={MODES}
          nodes={NODES}
          presets={false}
          vehicle="plane"
          inspect={<PlaneInspect sel={sel} onSel={onPick} showAll={showAll} />}
        />
      </main>
    );
  }

  if (workspace === "firmware") {
    return (
      <main>
        <ControllerView ids={PLANE_WORKSPACES} onWorkspace={setWorkspace} />
        <Aside
          log={log}
          sel={sel}
          onSel={onPick}
          axis={loopAxis}
          modes={MODES}
          nodes={NODES}
          presets={false}
          vehicle="plane"
          inspect={<PlaneInspect sel={sel} onSel={onPick} showAll={showAll} />}
        />
      </main>
    );
  }

  if (workspace === "scripts") {
    return (
      <main>
        <Suspense fallback={<section className="scope work"><p className="work-empty">…</p></section>}>
          <ScriptsLibrary current="scripts" ids={PLANE_WORKSPACES} onWorkspace={setWorkspace} />
        </Suspense>
        <Aside
          log={log}
          sel={sel}
          onSel={onPick}
          axis={loopAxis}
          modes={MODES}
          nodes={NODES}
          presets={false}
          vehicle="plane"
          inspect={<PlaneInspect sel={sel} onSel={onPick} showAll={showAll} />}
        />
      </main>
    );
  }

  if (workspace === "audit") {
    return (
      <main>
        <AuditLibrary current="audit" ids={PLANE_WORKSPACES} onWorkspace={setWorkspace} />
        <Aside
          log={log}
          sel={sel}
          onSel={onPick}
          axis={loopAxis}
          modes={MODES}
          nodes={NODES}
          presets={false}
          vehicle="plane"
          inspect={<PlaneInspect sel={sel} onSel={onPick} showAll={showAll} />}
        />
      </main>
    );
  }

  return (
    <main>
      <section className="scope">
        <Studio
          frame="plane"
          col1Default={col1Default}
          toolbar={<>
            <WorkspaceTabs current="loops" ids={PLANE_WORKSPACES} onSelect={setWorkspace} />
            <PlaneAxisSwitch axis={loopAxis} onAxis={onAxis} />
          </>}
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
        modes={MODES}
        nodes={NODES}
        presets={false}
        vehicle="plane"
        inspect={<PlaneInspect sel={sel} onSel={onPick} showAll={showAll} />}
      />
    </main>
  );
}
