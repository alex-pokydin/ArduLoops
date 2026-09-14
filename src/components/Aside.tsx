import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { NODES } from "../cascade";
import { addLog } from "../log";
import { axisView, type Axis } from "../mav/axis";
import { send } from "../mav/cmd";
import { getBuffer, getSnapshot, subscribe } from "../mav/store";
import type { Sample } from "../mav/types";
import { GainRow } from "./GainRow";
import { Craft } from "./Craft";

const PRESET = {
  wool: { p: 0.027, i: 0.015, d: 0.0036 },
  stock: { p: 0.135, i: 0.135, d: 0.0036, tc: 0.1, acc: 1100, rmax: 0 },
  hot: { p: 0.675, i: 0.135, d: 0.0036 },
};

const MODES = ["STABILIZE", "ALT_HOLD", "LOITER", "POSHOLD", "ACRO", "LAND", "RTL"];

export type LogRow = { t: string; msg: string; kind: string };

function stdev(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

function pwmFromNorm(n: number): number {
  return Math.round(1500 + Math.max(-1, Math.min(1, n)) * 500);
}

export function Aside({
  log,
  sel,
  onSel,
  axis,
  live3d,
}: {
  log: LogRow[];
  sel: string | null;
  onSel: (id: string) => void;
  axis: Axis;
  live3d: boolean;
}) {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [p, setP] = useState(0.135);
  const [, setI] = useState(0.135);
  const [, setD] = useState(0.0036);
  const [, setTc] = useState(0.1);
  const [, setAcc] = useState(1100);
  const [, setRmax] = useState(0);
  const [feel, setFeel] = useState({ kind: "ok", title: "—", hint: "Пресет ставить P I D. Газ — лівий стик, крен — правий." });
  const dragging = useRef(false);
  const holdUntil = useRef(0);
  const stickTimer = useRef(0);
  const rc = useRef({ roll: 1500, pitch: 1500, yaw: 1500, thr: 0 });
  const leftN = useRef({ x: 0, y: 0 });
  const rightN = useRef({ x: 0, y: 0 });
  const stickL = useRef<HTMLDivElement>(null);
  const stickR = useRef<HTMLDivElement>(null);
  const knobL = useRef<HTMLDivElement>(null);
  const knobR = useRef<HTMLDivElement>(null);
  const logEl = useRef<HTMLDivElement>(null);
  const shownGain = useRef("");
  const prev = useRef({
    mode: null as string | null,
    armed: null as boolean | null,
    ok: null as boolean | null,
    att: null as boolean | null,
    grounded: null as boolean | null,
  });

  useEffect(() => {
    if (Date.now() >= holdUntil.current && !dragging.current) {
      if (s.gain_p != null) setP(s.gain_p);
      if (s.gain_i != null) setI(s.gain_i);
      if (s.gain_d != null) setD(s.gain_d);
      if (s.input_tc != null) setTc(s.input_tc);
      if (s.acc_max != null) setAcc(s.acc_max);
      if (s.rate_max != null) setRmax(s.rate_max);
    }
    if (s.gain_p != null && Date.now() >= holdUntil.current) {
      const g = s.gain_p.toFixed(3);
      if (g !== shownGain.current) {
        if (shownGain.current && !dragging.current) addLog("P " + shownGain.current + " → " + g);
        shownGain.current = g;
      }
    }
    if (prev.current.ok !== s.ok) {
      addLog(s.ok ? "лінк " + (s.detail || "") : "немає лінку · " + (s.detail || ""), s.ok ? "ok" : "bad");
      prev.current.ok = s.ok;
    }
    if (s.mode && s.mode !== prev.current.mode) {
      addLog("режим " + (prev.current.mode ? prev.current.mode + " → " : "") + s.mode);
      prev.current.mode = s.mode;
    }
    if (prev.current.armed !== null && prev.current.armed !== !!s.armed) {
      addLog(s.armed ? "armed" : "disarm", s.armed ? "ok" : "dim");
    }
    prev.current.armed = !!s.armed;
    const attOk = s.att_hz > 0;
    if (prev.current.att !== null && prev.current.att !== attOk) {
      addLog(attOk ? "ATT " + s.att_hz + " Hz" : "ATT 0 Hz", attOk ? "ok" : "bad");
    }
    prev.current.att = attOk;
    const grounded = s.alt != null && !Number.isNaN(s.alt) && s.alt < 2;
    if (prev.current.grounded !== null && prev.current.grounded !== grounded) {
      addLog(grounded ? "на землі · AGL < 2 м, стики майже не крутять" : "у повітрі", grounded ? "bad" : "ok");
    }
    prev.current.grounded = grounded;
    classify(s, axis);
  }, [s, axis]);

  useEffect(() => {
    const el = logEl.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  function classify(_s: Sample, ax: Axis) {
    const v = axisView(_s, ax);
    if (_s.alt != null && !Number.isNaN(_s.alt) && _s.alt < 2) {
      setFeel({
        kind: "gnd",
        title: "на землі",
        hint: "SITL лежить. Підніміть газ — інакше стик не зрушить апарат.",
      });
      return;
    }
    const last = getBuffer().slice(-80);
    const angs = last.map((p) => axisView(p, ax).ang || 0);
    const rates = last.map((p) => axisView(p, ax).rate || 0);
    const cmds = last.map((p) => axisView(p, ax).cmd || 0);
    const meanAbs = angs.length ? angs.reduce((a, b) => a + Math.abs(b), 0) / angs.length : 0;
    let zc = 0;
    for (let n = 1; n < rates.length; n++) if (rates[n - 1] * rates[n] < 0) zc++;
    const zcHz = zc / ((last.length > 1 ? last[last.length - 1].t - last[0].t : 1) || 1);
    const rstd = rates.length ? stdev(rates) : 0;
    const yawP = Number(_s.params?.ATC_RAT_YAW_P ?? NaN);
    const g = ax === "yaw" ? yawP : Number(shownGain.current || (_s.gain_p ?? NaN));
    const moving =
      ax === "yaw"
        ? Math.max(...rates.map(Math.abs), ...cmds.map(Math.abs), 0) > 8
        : meanAbs > 4 || Math.max(...cmds.map(Math.abs), 0) > 2;
    const ringing = rstd > 8 || (zcHz > 4 && rstd > 1.5);
    const stick = v.name;
    if (!Number.isNaN(g) && g < 0.1) {
      setFeel({
        kind: "wool",
        title: "вата",
        hint: moving
          ? "Act відстає від Tar. P і I малі: помилка є, швидкості мало."
          : ax === "yaw"
            ? "P рискання малий. Лівий стік — повільний розворот."
            : `P×0.2 і I зрізані. На висінні тихо; ${stick} стиком — повільне повернення (вата).`,
      });
      return;
    }
    if (!Number.isNaN(g) && g >= 0.4) {
      setFeel({
        kind: "hot",
        title: ringing ? "різкість / дзвін" : "гостро",
        hint: ringing || moving
          ? "Act ганяється за Tar. P великий — очікуйте переліт або дзвін."
          : `P завищений. ${stick.charAt(0).toUpperCase() + stick.slice(1)} стиком покаже переліт або дзвін.`,
      });
      return;
    }
    if (moving) {
      setFeel({
        kind: "ok",
        title: "маневр",
        hint:
          ax === "yaw"
            ? "Стік рискання — це rate. Дивіться, чи жовта і синя на нижньому графіку збігаються."
            : "Дивіться, чи збігається блакитна лінія з білою після відпускання стика.",
      });
      return;
    }
    setFeel({
      kind: "ok",
      title: Number.isNaN(g) ? "—" : "сток",
      hint:
        ax === "yaw"
          ? "Yaw окремо: I менший, D часто 0. Лівий стік — еталон, чи rate ловить завдання."
          : `Типове P. ${stick.charAt(0).toUpperCase() + stick.slice(1)} стиком — еталон повернення на горизонт.`,
    });
  }

  function setKnob(el: HTMLDivElement | null, nx: number, ny: number) {
    if (!el) return;
    el.style.left = 50 + nx * 38 + "%";
    el.style.top = 50 - ny * 38 + "%";
  }

  function pushStick(immediate: boolean) {
    const fire = () => send({ op: "stick", ...rc.current });
    if (immediate) {
      window.clearTimeout(stickTimer.current);
      stickTimer.current = 0;
      fire();
      return;
    }
    if (stickTimer.current) return;
    stickTimer.current = window.setTimeout(() => {
      stickTimer.current = 0;
      fire();
    }, 40);
  }

  function resetSticks() {
    rc.current = { roll: 1500, pitch: 1500, yaw: 1500, thr: 0 };
    leftN.current = { x: 0, y: 0 };
    rightN.current = { x: 0, y: 0 };
    setKnob(knobL.current, 0, 0);
    setKnob(knobR.current, 0, 0);
  }

  useEffect(() => {
    function bind(
      el: HTMLDivElement | null,
      onMove: (nx: number, ny: number) => void,
      onEnd: () => void,
    ) {
      if (!el) return () => {};
      let down = false;
      const read = (ev: PointerEvent) => {
        const r = el.getBoundingClientRect();
        let nx = (ev.clientX - (r.left + r.width / 2)) / (r.width * 0.42);
        let ny = (r.top + r.height / 2 - ev.clientY) / (r.height * 0.42);
        const mag = Math.hypot(nx, ny);
        if (mag > 1) {
          nx /= mag;
          ny /= mag;
        }
        if (Math.abs(nx) < 0.08) nx = 0;
        if (Math.abs(ny) < 0.08) ny = 0;
        return [nx, ny] as const;
      };
      const downH = (ev: PointerEvent) => {
        ev.preventDefault();
        down = true;
        el.setPointerCapture(ev.pointerId);
        const [nx, ny] = read(ev);
        onMove(nx, ny);
      };
      const moveH = (ev: PointerEvent) => {
        if (!down) return;
        const [nx, ny] = read(ev);
        onMove(nx, ny);
      };
      const endH = () => {
        if (!down) return;
        down = false;
        onEnd();
      };
      el.addEventListener("pointerdown", downH);
      el.addEventListener("pointermove", moveH);
      el.addEventListener("pointerup", endH);
      el.addEventListener("pointercancel", endH);
      return () => {
        el.removeEventListener("pointerdown", downH);
        el.removeEventListener("pointermove", moveH);
        el.removeEventListener("pointerup", endH);
        el.removeEventListener("pointercancel", endH);
      };
    }
    const u1 = bind(stickL.current, (nx, ny) => {
      leftN.current = { x: nx, y: ny };
      rc.current.yaw = pwmFromNorm(nx);
      rc.current.thr = pwmFromNorm(ny);
      setKnob(knobL.current, nx, ny);
      pushStick(false);
    }, () => {
      leftN.current.x = 0;
      rc.current.yaw = 1500;
      setKnob(knobL.current, 0, leftN.current.y);
      pushStick(true);
    });
    const u2 = bind(stickR.current, (nx, ny) => {
      rightN.current = { x: nx, y: ny };
      rc.current.roll = pwmFromNorm(nx);
      rc.current.pitch = pwmFromNorm(-ny);
      setKnob(knobR.current, nx, ny);
      pushStick(false);
    }, () => {
      rightN.current = { x: 0, y: 0 };
      rc.current.roll = 1500;
      rc.current.pitch = 1500;
      setKnob(knobR.current, 0, 0);
      pushStick(true);
    });
    return () => {
      u1();
      u2();
    };
  }, []);

  function applyPreset(name: "wool" | "stock" | "hot", label: string) {
    const t = PRESET[name];
    holdUntil.current = Date.now() + 1500;
    send({ op: "preset", name });
    setP(t.p);
    setI(t.i);
    setD(t.d);
    shownGain.current = t.p.toFixed(3);
    if ("tc" in t && t.tc != null) {
      setTc(t.tc);
      setAcc(t.acc);
      setRmax(t.rmax);
      addLog(
        `${label} · P ${t.p} I ${t.i} D ${t.d} · TC ${t.tc.toFixed(2)} ACC ${Math.round(t.acc)} Rmax ${t.rmax <= 0 ? "off" : Math.round(t.rmax)}`,
        "cmd",
      );
    } else {
      addLog(`${label} · P ${t.p} I ${t.i} D ${t.d}`, "cmd");
    }
    onSel("atc_rat");
  }

  const modeOptions = MODES.includes(s.mode) || s.mode === "?" ? MODES : [...MODES, s.mode];
  const alt = s.alt;
  const grounded = alt != null && !Number.isNaN(alt) && alt < 2;
  let altLabel: ReactNode = "висота AGL";
  let altClass = "";
  if (grounded) {
    const c = s.climb || 0;
    altLabel = c > 0.15 ? `зліт ↑ ${c.toFixed(1)} м/с` : "лежить";
    altClass = "gnd";
  } else if (alt != null && !Number.isNaN(alt)) {
    const c = s.climb || 0;
    if (c > 0.15) {
      altLabel = `↑ ${c.toFixed(1)} м/с`;
      altClass = "up";
    } else if (c < -0.15) {
      altLabel = `↓ ${Math.abs(c).toFixed(1)} м/с`;
      altClass = "dn";
    } else altLabel = "тримає";
  }

  const tuneNode = NODES.find((n) => n.id === sel) ?? NODES.find((n) => n.id === "atc_rat") ?? null;
  const tarRoll = s.tar == null ? s.cmd || 0 : s.tar;
  const tarPitch = s.pitch_tar == null ? s.pitch_cmd || 0 : s.pitch_tar;
  const tarYaw = s.yaw_tar == null ? s.yaw || 0 : s.yaw_tar;

  return (
    <aside>
      <Craft
        roll={s.roll || 0}
        pitch={s.pitch || 0}
        yaw={s.yaw || 0}
        tarRoll={tarRoll}
        tarPitch={tarPitch}
        tarYaw={tarYaw}
        grounded={grounded}
        alt={alt}
        altLabel={altLabel}
        altClass={altClass}
        axis={axis}
        live3d={live3d}
      />
      <div className="flight">
        <select
          title="Режим польоту"
          aria-label="режим"
          value={modeOptions.includes(s.mode) ? s.mode : "STABILIZE"}
          onChange={(ev) => {
            send({ op: "mode", mode: ev.target.value });
            addLog("режим " + ev.target.value, "cmd");
          }}
        >
          {modeOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <button
          type="button"
          className={s.armed ? "arm-sw on" : "arm-sw"}
          aria-pressed={s.armed}
          title="Arm / disarm"
          onClick={() => {
            if (s.armed) {
              send({ op: "land" });
              send({ op: "arm", on: false });
              send({ op: "release" });
              resetSticks();
              addLog("disarm", "cmd");
              return;
            }
            send({ op: "arm", on: true });
            addLog("arm · " + s.mode, "cmd");
          }}
        >
          {s.armed ? "armed" : "disarm"}
        </button>
      </div>
      <div className={`sticks ${live3d ? "axis-3d" : `axis-${axis}`}`} aria-label="віртуальні стики Mode 2">
        <div className="stick thr" ref={stickL} role="button" tabIndex={0} title={axis === "yaw" && !live3d ? "Лівий стик: рискання (ліво-право)" : "Лівий стик: газ і рискання"}>
          <div className="cross" />
          <span className="tag n">газ</span>
          <span className="tag s">газ−</span>
          <span className="tag w">риск−</span>
          <span className="tag e">риск+</span>
          <div className="knob" ref={knobL} />
        </div>
        <div className="stick" ref={stickR} role="button" tabIndex={0} title={live3d ? "Правий стик: крен і тангаж" : axis === "pitch" ? "Правий стик: тангаж (вгору-вниз)" : "Правий стик: крен (ліво-право)"}>
          <div className="cross" />
          <span className="tag n">тангаж</span>
          <span className="tag s">тангаж</span>
          <span className="tag w">крен−</span>
          <span className="tag e">крен+</span>
          <div className="knob" ref={knobR} />
        </div>
      </div>
      <div className={`feel ${feel.kind}`}>{feel.title}</div>
      <div className="hint">{feel.hint}</div>
      <div className="btns">
        <button className={p < 0.1 ? "cyan on" : "cyan"} onClick={() => applyPreset("wool", "вата")}>вата</button>
        <button className={p >= 0.1 && p < 0.4 ? "on" : ""} onClick={() => applyPreset("stock", "сток")}>сток</button>
        <button className={p >= 0.4 ? "hot on" : "hot"} onClick={() => applyPreset("hot", "гостро")}>гостро</button>
      </div>
      {tuneNode ? (
          <>
            <div className="tune-cap">
              {tuneNode.title}
              <span>{tuneNode.unit}</span>
            </div>
            {tuneNode.gains.length ? (
              <div className="sliders">
                {tuneNode.gains.map((g) => (
                  <GainRow key={g.key} gain={g} sample={s} node={tuneNode} axis={axis} />
                ))}
              </div>
            ) : (
              <p className="tune-empty">Немає гейнів. Виберіть регулятор — слайдери залишаться тут і на графіку.</p>
            )}
          </>
        ) : null}
      <div className="log-label">журнал</div>
      <div className="log" ref={logEl}>
        {log.map((row, idx) => (
          <div className="row" key={idx}>
            <span className="t">{row.t}</span>
            <span className={row.kind}>{row.msg}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
