import { useEffect, useRef } from "react";
import { GainRow, paramOf } from "../components/GainRow";
import { TRACE } from "../plot";
import { useT } from "../i18n/i18n";
import { isPaused } from "../mav/store";
import { useVehicle, useViewSample, viewBuffer } from "../mav/view";
import { NODES, nodesLiveIn } from "./cascade";
import { drawEnergy } from "./plotEnergy";

const LIMITS = NODES.find((n) => n.id === "tecs")!;

const LIMIT_GAINS = [
  { key: "THR_MAX", label: "THR+", min: 0, max: 100, step: 1, digits: 0 },
  { key: "TRIM_THROTTLE", label: "Trim", min: 0, max: 100, step: 1, digits: 0 },
  { key: "AIRSPEED_MIN", label: "Vmin", min: 5, max: 40, step: 0.5, digits: 1 },
  { key: "AIRSPEED_CRUISE", label: "V", min: 6, max: 50, step: 0.5, digits: 1 },
  { key: "AIRSPEED_MAX", label: "Vmax", min: 8, max: 80, step: 0.5, digits: 1 },
  { key: "PTCH_LIM_MAX_DEG", label: "θ+", min: 0, max: 40, step: 1, digits: 0 },
  { key: "PTCH_LIM_MIN_DEG", label: "θ−", min: -45, max: 0, step: 1, digits: 0 },
  { key: "TECS_CLMB_MAX", label: "Climb", min: 0.5, max: 20, step: 0.1, digits: 1 },
  { key: "TECS_SINK_MIN", label: "Sink−", min: 0.1, max: 10, step: 0.1, digits: 1 },
  { key: "TECS_SINK_MAX", label: "Sink+", min: 1, max: 20, step: 0.1, digits: 1 },
] as const;

const RESP_GAINS = [
  { key: "TECS_TIME_CONST", label: "TC", min: 3, max: 10, step: 0.5, digits: 1 },
  { key: "TECS_PTCH_DAMP", label: "θd", min: 0, max: 1, step: 0.05, digits: 2 },
  { key: "TECS_THR_DAMP", label: "Td", min: 0, max: 1, step: 0.05, digits: 2 },
  { key: "TECS_INTEG_GAIN", label: "I", min: 0, max: 1, step: 0.05, digits: 2 },
  { key: "TECS_SPDWEIGHT", label: "W", min: 0, max: 2, step: 0.1, digits: 1 },
  { key: "TECS_RLL2THR", label: "R2T", min: 0, max: 30, step: 0.5, digits: 1 },
] as const;

export function PlaneEnergy({ onPause }: { onPause: () => void }) {
  const t = useT();
  const vehicle = useVehicle();
  const s = useViewSample();
  const paused = isPaused();
  const c1 = useRef<HTMLCanvasElement>(null);
  const c2 = useRef<HTMLCanvasElement>(null);
  const live = nodesLiveIn(s.mode, s).has("tecs");
  const w = paramOf(s, "TECS_SPDWEIGHT");
  const frozen = !s.ok;

  useEffect(() => {
    const a = c1.current;
    const b = c2.current;
    if (!a || !b) return;
    const x1 = a.getContext("2d");
    const x2 = b.getContext("2d");
    if (!x1 || !x2) return;
    const pull = () => viewBuffer(vehicle);
    const paint = () => drawEnergy(a, x1, b, x2, pull());
    if (frozen) {
      paint();
      return;
    }
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      paint();
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [vehicle, frozen]);

  return (
    <div className="loop">
      {live || !s.ok ? null : (
        <p className="warn">
          {t("In {mode} this loop is not running: the autopilot is not turning it. You can inspect gains, but they will not change behaviour until the mode closes the loop.", {
            mode: s.mode || t("this mode"),
          })}
        </p>
      )}
      <div className="plot-head">
        <b>{t("TECS · height and airspeed share energy")}</b>
        <span>
          {t("Height and airspeed share energy. Pitch and throttle do the work. SPDWEIGHT: 0 height, 2 speed, 1 both.")}
        </span>
        <button type="button" className={paused ? "pause-btn on" : "pause-btn"} onClick={onPause} title={t("Space")}>
          {paused ? t("Resume") : t("Pause")}
        </button>
      </div>
      <div className={frozen ? "plot idle" : paused ? "plot paused" : "plot"}>
        <canvas ref={c1} />
      </div>
      <div className="caption">
        <div className="legend">
          <span>
            <i className="c" />
            {t("AGL")}
          </span>
        </div>
        <div className="readout">
          {t("AGL {ang} m   throttle {cmd}%", {
            ang: (s.alt ?? 0).toFixed(1),
            cmd: (s.thr_out ?? 0).toFixed(0),
          })}
        </div>
      </div>
      <div className="plot-head">
        <b>{t("airspeed, m/s")}</b>
        <span>{t("Demand is not on this MAVLink stream — cyan is what the pitot / estimator reports.")}</span>
      </div>
      <div className={frozen ? "plot idle" : paused ? "plot paused" : "plot"}>
        <canvas ref={c2} />
      </div>
      <div className="caption">
        <div className="legend">
          <span>
            <i className="c" />
            {t("airspeed")}
          </span>
          <span>
            <i className="a" />
            {t("cruise")}
          </span>
        </div>
        <div className="readout">
          {t("V {v} m/s   gs {gs} m/s   W {w}", {
            v: s.aspd == null ? "—" : s.aspd.toFixed(1),
            gs: s.gspd == null ? "—" : s.gspd.toFixed(1),
            w: w == null ? "—" : w.toFixed(1),
          })}
        </div>
      </div>
      <div className="loop-xgain">
        <p className="tune-cap">
          {t("Limits")}
          <span>{t("set in FBWA before trusting TECS")}</span>
        </p>
        {LIMIT_GAINS.map((g) => (
          <GainRow key={g.key} gain={{ ...g }} sample={s} node={LIMITS} axis="roll" />
        ))}
        <p className="tune-cap">
          {t("Response")}
          <span>TECS_SPDWEIGHT {w == null ? "—" : w.toFixed(1)}</span>
        </p>
        {RESP_GAINS.map((g) => (
          <GainRow key={g.key} gain={{ ...g }} sample={s} node={LIMITS} axis="roll" />
        ))}
      </div>
      <p className="frame-hint" style={{ borderLeft: `3px solid ${TRACE.target}`, paddingLeft: 8 }}>
        {t("Tune pitch rate first. If height oscillates after that, raise TECS_TIME_CONST, not a fake height P.")}
      </p>
    </div>
  );
}
