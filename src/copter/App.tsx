import { useState } from "react";
import { Aside, type LogRow } from "../components/Aside";
import { AxisSwitch } from "../components/AxisSwitch";
import { Cascade } from "../components/Cascade";
import { Scope } from "../components/Scope";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { axisLabel, type Axis } from "../mav/axis";
import { CopterLoopView, loopNeedsAxis } from "./LoopView";

type Tab = "map" | "loop" | "scope";

export function CopterApp({
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
  const [live3d, setLive3d] = useState(false);

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

  function onLive3d(on: boolean) {
    setLive3d(on);
    addLog(on ? t("Model · 3D") : t("Model · one axis"), "cmd");
  }

  function go(next: Tab) {
    setTab(next);
    if (next === "map") setSel(null);
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

  const showAxis = tab === "scope" || tab === "map" || (tab === "loop" && loopNeedsAxis(sel, axis));

  return (
    <main>
      <section className="scope">
        <nav className="tabs" aria-label={t("View")}>
          {(
            [
              ["map", t("Layers")],
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
          {showAxis ? <AxisSwitch axis={axis} onAxis={onAxis} live3d={live3d} onLive3d={onLive3d} /> : null}
        </nav>
        {tab === "map" ? (
          <Cascade sel={sel} onSel={onPick} axis={axis} />
        ) : tab === "loop" ? (
          <CopterLoopView sel={sel} axis={axis} onPause={onPause} />
        ) : (
          <Scope sel={sel} onSel={onPick} axis={axis} onPause={onPause} />
        )}
      </section>
      <Aside log={log} sel={sel} onSel={onPick} axis={axis} live3d={live3d} />
    </main>
  );
}
