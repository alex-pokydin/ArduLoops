import { useEffect, useRef, useSyncExternalStore } from "react";
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
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const c1 = useRef<HTMLCanvasElement>(null);
  const c2 = useRef<HTMLCanvasElement>(null);
  const axisRef = useRef(axis);
  axisRef.current = axis;
  const paused = isPaused();
  const v = axisView(s, axis);
  const tar = axisTar(v);
  const yaw = axis === "yaw";

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
        <b>{v.title}, °</b>
        <span>
          {yaw
            ? "біла — ціль курсу, синя — факт. Стік рискання — це rate, не кут; він на нижньому графіку."
            : "сірий — стик, біла — ціль автопілота, синя — факт. Синя їде до білої."}
        </span>
      </div>
      <div className={paused ? "plot paused" : "plot"}>
        <canvas ref={c1} />
      </div>
      <div className="caption">
        <div className="legend">
          {yaw ? null : (
            <span><i className="g" />стик</span>
          )}
          <span><i className="w" />ціль FC</span>
          <span><i className="c" />{v.name} Act</span>
        </div>
        <button type="button" className={paused ? "pause-btn on" : "pause-btn"} onClick={onPause} title="Пробіл">
          {paused ? "далі" : "пауза"}
        </button>
        <div className="readout">
          факт {fmt(v.ang, 2)}°   ціль {fmt(tar, 1)}°   стик {fmt(v.cmd, 1)}{v.cmdUnit}
        </div>
      </div>
      <div className="cascade">
        <div className="step">
          <span className="lab">хочемо бути</span>
          <b>
            {fmt(tar, 1)}°<em>стик {fmt(v.cmd, 1)}{v.cmdUnit}</em>
          </b>
          <span className="sub">{yaw ? "ціль курсу · стік = rate" : "ціль FC · не стик"}</span>
        </div>
        <div className="step amber">
          <span className="lab">тому крутимо</span>
          <b>{fmt(v.des || 0, 1)} °/с</b>
          <span className="sub">завдання rate · ATC_ANG_{v.tag}_P</span>
        </div>
        <div className="step">
          <span className="lab">виходить</span>
          <b>{fmt(v.rate, 1)} °/с</b>
          <span className="sub">факт rate · ATC_RAT_{v.tag}_*</span>
        </div>
      </div>
      <div className="plot-head">
        <b>{v.rateName}, °/с</b>
        <span>
          {yaw
            ? "сірий — стік (°/с). Жовта — завдання rate від ATC. У Stabilize стік рискання йде сюди, не в кут."
            : "чим туди їдемо. Жовта — не позиція, а команда «крутись ось так швидко»."}
        </span>
      </div>
      <div className={paused ? "plot paused" : "plot"}>
        <canvas ref={c2} />
      </div>
      <div className="caption">
        <div className="legend">
          {yaw ? <span><i className="g" />стик</span> : null}
          <span><i className="a" />tar rate</span>
          <span><i className="c" />rate Act</span>
        </div>
        <div className="readout">
          rate {fmt(v.rate, 2)} °/s   tar {fmt(v.des || 0, 2)} °/s
          {yaw ? `   стик ${fmt(v.cmd, 1)} °/s` : ""}
        </div>
      </div>
    </>
  );
}
