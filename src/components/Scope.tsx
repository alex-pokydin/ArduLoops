import { useEffect, useRef, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { axisErr, axisTar, axisView, type Axis } from "../mav/axis";
import { drawScope } from "../plot";
import { getBuffer, getSnapshot, isPaused, subscribe } from "../mav/store";

function fmt(n: number, d: number): string {
  const v = Number(n || 0).toFixed(d);
  return (v.startsWith("-") ? "" : " ") + v;
}

export function Scope({
  axis,
  onPause,
}: {
  axis: Axis;
  onPause: () => void;
}) {
  const t = useT();
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const c1 = useRef<HTMLCanvasElement>(null);
  const c2 = useRef<HTMLCanvasElement>(null);
  const axisRef = useRef(axis);
  axisRef.current = axis;
  const paused = isPaused();
  const v = axisView(s, axis);
  const tar = axisTar(v);
  const err = axisErr(v);
  const yaw = axis === "yaw";
  const down = axis === "d";
  const unit = v.cmdUnit === "°/s" ? t("°/s") : v.cmdUnit;

  useEffect(() => {
    const a = c1.current;
    const b = c2.current;
    if (!a || !b) return;
    const x1 = a.getContext("2d");
    const x2 = b.getContext("2d");
    if (!x1 || !x2) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      drawScope(a, x1, b, x2, getBuffer(), axisRef.current);
    };
    loop();
    const onResize = () => drawScope(a, x1, b, x2, getBuffer(), axisRef.current);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <>
      <div className="plot-head">
        <b>{down ? t("want · height, m") : t("want · angle, °")}</b>
        <span>
          {down
            ? t("Yellow is the altitude target, cyan is AGL (−D). Throttle stick is on the readout — 0 = mid.")
            : yaw
              ? t("Grey is the stick throw, 0 = centered. Yellow and cyan are heading.")
              : t("Where we want to be. Target is not the stick — actual should catch the target.")}
        </span>
        <button type="button" className={paused ? "pause-btn on" : "pause-btn"} onClick={onPause} title={t("Space")}>
          {paused ? t("Resume") : t("Pause")}
        </button>
      </div>
      <div className={paused ? "plot paused" : "plot"}>
        <canvas ref={c1} />
      </div>
      <div className="caption">
        <div className="legend">
          {down ? null : (
            <span><i className="g" />{t("Stick")}</span>
          )}
          <span><i className="a" />{t("Target")}</span>
          <span><i className="c" />{t("Actual {name}", { name: t(v.name) })}</span>
          <span><i className="gap" />{t("error gap")}</span>
        </div>
        <div className="readout">
          {down
            ? t("AGL {ang} m   target {tar} m   throttle {cmd}%   error {err} m", {
                ang: fmt(v.ang, 2),
                tar: fmt(tar, 2),
                cmd: fmt(v.cmd, 0),
                err: fmt(err, 2),
              })
            : yaw
              ? t("actual {ang}°   target {tar}°   stick {cmd}°   error {err}°", {
                  ang: fmt(v.ang, 2),
                  tar: fmt(tar, 1),
                  cmd: fmt(v.cmd, 1),
                  err: fmt(err, 1),
                })
              : t("actual {ang}°   target {tar}°   stick {cmd}{unit}", {
                  ang: fmt(v.ang, 2),
                  tar: fmt(tar, 1),
                  cmd: fmt(v.cmd, 1),
                  unit,
                })}
        </div>
      </div>
      <div className="plot-head">
        <b>{down ? t("command · climb, m/s") : t("command · rate, °/s")}</b>
        <span>
          {down
            ? t("Amber is the throttle climb command (PILOT_SPD_UP), cyan is climb. Up is +.")
            : yaw
              ? t("Amber is the ATC yaw-rate command, cyan is the gyro. Left stick asks for rate — on the ground with throttle down the craft will not yaw.")
              : t("How we get there. Rate command is not position — it is “rotate this fast”.")}
        </span>
      </div>
      <div className={paused ? "plot paused" : "plot"}>
        <canvas ref={c2} />
      </div>
      <div className="caption">
        <div className="legend">
          <span><i className="a" />{down ? t("tar climb") : t("tar rate")}</span>
          <span><i className="c" />{down ? t("climb Act") : t("rate Act")}</span>
          <span><i className="gap" />{t("error gap")}</span>
        </div>
        <div className="readout">
          {down
            ? t("climb {v} m/s   tar {tar} m/s", { v: fmt(v.rate, 2), tar: fmt(v.des || 0, 2) })
            : `${t("rate {v}°/s", { v: fmt(v.rate, 2) })}   ${t("tar {v}°/s", { v: fmt(v.des || 0, 2) })}`}
        </div>
      </div>
    </>
  );
}
