import { useEffect, useRef, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { axisTar, axisView, type Axis } from "../mav/axis";
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
  const yaw = axis === "yaw";
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
        <b>{t("want · angle, °")}</b>
        <span>
          {yaw
            ? t("Where we want to be. Target is heading; actual should catch it. Yaw stick is rate, not angle — that is below.")
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
          {yaw ? null : (
            <span><i className="g" />{t("Stick")}</span>
          )}
          <span><i className="w" />{t("FC target")}</span>
          <span><i className="c" />{t("Actual {name}", { name: t(v.name) })}</span>
        </div>
        <div className="readout">
          {t("actual {ang}°   target {tar}°   stick {cmd}{unit}", {
            ang: fmt(v.ang, 2),
            tar: fmt(tar, 1),
            cmd: fmt(v.cmd, 1),
            unit,
          })}
        </div>
      </div>
      <div className="plot-head">
        <b>{t("command · rate, °/s")}</b>
        <span>
          {yaw
            ? t("Stick here is rate, not angle. Target is the ATC rate command. In Stabilize the yaw stick goes here.")
            : t("How we get there. Rate command is not position — it is “rotate this fast”.")}
        </span>
      </div>
      <div className={paused ? "plot paused" : "plot"}>
        <canvas ref={c2} />
      </div>
      <div className="caption">
        <div className="legend">
          {yaw ? <span><i className="g" />{t("Stick")}</span> : null}
          <span><i className="a" />{t("tar rate")}</span>
          <span><i className="c" />{t("rate Act")}</span>
        </div>
        <div className="readout">
          {t("rate {v}°/s", { v: fmt(v.rate, 2) })}   {t("tar {v}°/s", { v: fmt(v.des || 0, 2) })}
          {yaw ? `   ${t("stick {cmd} °/s", { cmd: fmt(v.cmd, 1) })}` : ""}
        </div>
      </div>
    </>
  );
}
