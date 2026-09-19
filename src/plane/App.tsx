import { useState } from "react";
import { Aside, type LogRow } from "../components/Aside";
import { Scope } from "../components/Scope";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { axisLabel, type Axis } from "../mav/axis";
import { PlaneAxisSwitch } from "./AxisSwitch";
import { MODES, NODES } from "./cascade";
import { PlaneMap } from "./Map";
import { PlaneLoopView, loopNeedsAxis } from "./LoopView";

type Tab = "map" | "loop" | "scope";

export function PlaneApp({
  log,
  onPause,
}: {
  log: LogRow[];
  onPause: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("map");
  const [sel, setSel] = useState<string | null>(null);
  const [axis, setAxis] = useState<Axis>("roll");

  function onAxis(next: Axis) {
    setAxis(next);
    if (next === "pitch") setSel("ptch_rate");
    else if (next === "yaw") setSel("yaw_damp");
    else setSel("rll_rate");
    addLog(t("Axis · {axis}", { axis: t(axisLabel(next)) }), "cmd");
  }

  function go(next: Tab) {
    setTab(next);
    if (next === "map") setSel(null);
  }

  function onPick(next: string | null) {
    setSel(next);
    if (next === "ptch_ang" || next === "ptch_rate" || next === "elevator") setAxis("pitch");
    else if (next === "yaw_damp" || next === "rudder") setAxis("yaw");
    else if (next === "rll_ang" || next === "rll_rate" || next === "aileron" || next === "ahrs") setAxis("roll");
  }

  const showAxis = tab === "scope" || (tab === "loop" && loopNeedsAxis(sel, axis));

  return (
    <main>
      <section className="scope">
        <nav className="tabs" aria-label={t("View")}>
          {(
            [
              ["map", t("Map")],
              ["loop", t("Loop")],
              ["scope", t("Scope")],
            ] as const
          ).map(([id, label], i) => (
            <span key={id}>
              {i ? (
                <span className="sep" aria-hidden="true">
                  ·
                </span>
              ) : null}
              <a
                href={`#${id}`}
                className={tab === id ? "on" : undefined}
                aria-current={tab === id ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go(id);
                }}
              >
                {label}
              </a>
            </span>
          ))}
          {showAxis ? <PlaneAxisSwitch axis={axis === "d" ? "roll" : axis} onAxis={onAxis} /> : null}
        </nav>
        {tab === "map" ? (
          <PlaneMap sel={sel} onSel={onPick} />
        ) : tab === "loop" ? (
          <PlaneLoopView sel={sel} axis={axis === "d" ? "roll" : axis} onPause={onPause} />
        ) : (
          <Scope sel={sel} onSel={onPick} axis={axis === "d" ? "roll" : axis} onPause={onPause} />
        )}
      </section>
      <Aside
        log={log}
        sel={sel}
        onSel={onPick}
        axis={axis === "d" ? "roll" : axis}
        live3d={false}
        modes={MODES}
        nodes={NODES}
        presets={false}
        vehicle="plane"
      />
    </main>
  );
}
