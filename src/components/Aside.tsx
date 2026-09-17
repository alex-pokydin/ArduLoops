import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { NODES } from "../cascade";
import { tDetail, useT } from "../i18n/i18n";
import { addLog } from "../log";
import { axisView, type Axis } from "../mav/axis";
import { send } from "../mav/cmd";
import { getBuffer, getSnapshot, subscribe } from "../mav/store";
import type { Sample } from "../mav/types";
import { GainRow } from "./GainRow";
import { Craft } from "./Craft";

type Feel = { kind: string; title: string; hint: string; axis?: Axis };

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
  const t = useT();
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [p, setP] = useState(0.135);
  const [, setI] = useState(0.135);
  const [, setD] = useState(0.0036);
  const [, setTc] = useState(0.1);
  const [, setAcc] = useState(1100);
  const [, setRmax] = useState(0);
  const [feel, setFeel] = useState<Feel>({
    kind: "ok",
    title: "—",
    hint: "Preset sets P I D. Throttle is left stick, roll is right.",
  });
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
      addLog(
        s.ok ? t("Link {url}", { url: s.detail || "" }) : t("No link · {detail}", { detail: tDetail(s.detail) }),
        s.ok ? "ok" : "bad",
      );
      prev.current.ok = s.ok;
    }
    if (s.mode && s.mode !== prev.current.mode) {
      addLog(t("Mode {mode}", { mode: (prev.current.mode ? prev.current.mode + " → " : "") + s.mode }));
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
      addLog(
        grounded
          ? t("On the ground · AGL < 2 m, sticks barely rotate the craft")
          : t("Airborne"),
        grounded ? "bad" : "ok",
      );
    }
    prev.current.grounded = grounded;
    classify(s, axis);
  }, [s, axis]);

  useEffect(() => {
    const el = logEl.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  function classify(_s: Sample, ax: Axis) {
    if (_s.alt != null && !Number.isNaN(_s.alt) && _s.alt < 2) {
      setFeel({
        kind: "gnd",
        title: "On the ground",
        hint: "SITL is sitting. Raise throttle — otherwise the stick will not move the craft.",
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
    const g = ax === "yaw" ? yawP : ax === "d" ? Number(_s.params?.PSC_D_POS_P ?? NaN) : Number(shownGain.current || (_s.gain_p ?? NaN));
    if (ax === "d") {
      const climb = Math.abs(_s.climb || 0);
      const thr = Math.abs(_s.thr_cmd || 0);
      if (climb > 0.2 || thr > 12) {
        setFeel({
          kind: "ok",
          title: "Climb",
          axis: ax,
          hint: "Throttle stick is climb. Amber on the lower plot should meet cyan.",
        });
        return;
      }
      setFeel({
        kind: "ok",
        title: "Holding",
        axis: ax,
        hint: "D+ is down. Height is AGL (−D). Left stick up/down is throttle.",
      });
      return;
    }
    const moving =
      ax === "yaw"
        ? Math.max(...rates.map(Math.abs), ...cmds.map(Math.abs), 0) > 8
        : meanAbs > 4 || Math.max(...cmds.map(Math.abs), 0) > 2;
    const ringing = rstd > 8 || (zcHz > 4 && rstd > 1.5);
    if (!Number.isNaN(g) && g < 0.1) {
      setFeel({
        kind: "wool",
        title: "Wool",
        axis: ax,
        hint: moving
          ? "Act lags Tar. P and I are small: there is error, little rate."
          : ax === "yaw"
            ? "Yaw P is small. Left stick — a slow turn."
            : "P×0.2 and I are cut. Quiet in hover; {stick} stick — slow return (wool).",
      });
      return;
    }
    if (!Number.isNaN(g) && g >= 0.4) {
      setFeel({
        kind: "hot",
        title: ringing ? "Harsh / ringing" : "Sharp",
        axis: ax,
        hint: ringing || moving
          ? "Act chases Tar. P is large — expect overshoot or ringing."
          : "P is high. {Stick} stick will show overshoot or ringing.",
      });
      return;
    }
    if (moving) {
      setFeel({
        kind: "ok",
        title: "Maneuver",
        hint:
          ax === "yaw"
            ? "Yaw stick is rate. Watch whether amber and cyan match on the lower plot."
            : "Watch whether cyan meets yellow after you release the stick.",
      });
      return;
    }
    setFeel({
      kind: "ok",
      title: Number.isNaN(g) ? "—" : "Stock",
      axis: ax,
      hint:
        ax === "yaw"
          ? "Yaw is separate: I is smaller, D is often 0. Left stick is the reference — does rate catch the command."
          : "Typical P. {Stick} stick is the horizon-return reference.",
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

  function applyPreset(name: "wool" | "stock" | "hot") {
    const pset = PRESET[name];
    holdUntil.current = Date.now() + 1500;
    send({ op: "preset", name });
    setP(pset.p);
    setI(pset.i);
    setD(pset.d);
    shownGain.current = pset.p.toFixed(3);
    if ("tc" in pset && pset.tc != null) {
      setTc(pset.tc);
      setAcc(pset.acc);
      setRmax(pset.rmax);
      addLog(
        t("Stock · P {p} I {i} D {d} · TC {tc} ACC {acc} Rmax {rmax}", {
          p: pset.p,
          i: pset.i,
          d: pset.d,
          tc: pset.tc.toFixed(2),
          acc: Math.round(pset.acc),
          rmax: pset.rmax <= 0 ? t("off") : Math.round(pset.rmax),
        }),
        "cmd",
      );
    } else if (name === "wool") {
      addLog(t("Wool · P {p} I {i} D {d}", { p: pset.p, i: pset.i, d: pset.d }), "cmd");
    } else {
      addLog(t("Sharp · P {p} I {i} D {d}", { p: pset.p, i: pset.i, d: pset.d }), "cmd");
    }
    onSel("atc_rat");
  }

  const modeOptions = MODES.includes(s.mode) || s.mode === "?" ? MODES : [...MODES, s.mode];
  const alt = s.alt;
  const grounded = alt != null && !Number.isNaN(alt) && alt < 2;
  let altLabel: ReactNode = t("AGL height");
  let altClass = "";
  if (grounded) {
    const c = s.climb || 0;
    altLabel = c > 0.15 ? t("takeoff ↑ {v} m/s", { v: c.toFixed(1) }) : t("Sitting");
    altClass = "gnd";
  } else if (alt != null && !Number.isNaN(alt)) {
    const c = s.climb || 0;
    if (c > 0.15) {
      altLabel = t("↑ {v} m/s", { v: c.toFixed(1) });
      altClass = "up";
    } else if (c < -0.15) {
      altLabel = t("↓ {v} m/s", { v: Math.abs(c).toFixed(1) });
      altClass = "dn";
    } else altLabel = t("Holding");
  }

  const tuneNode = NODES.find((n) => n.id === sel) ?? NODES.find((n) => n.id === "atc_rat") ?? null;
  const tarRoll = s.tar == null ? s.cmd || 0 : s.tar;
  const tarPitch = s.pitch_tar == null ? s.pitch_cmd || 0 : s.pitch_tar;
  const tarYaw = s.yaw_tar == null ? s.yaw || 0 : s.yaw_tar;
  const stickName = t(feel.axis ?? axis);
  const StickName = stickName.charAt(0).toUpperCase() + stickName.slice(1);

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
        status={s.texts?.[0] ?? ""}
      />
      <div className="flight">
        <select
          title={t("Flight mode")}
          aria-label={t("Mode")}
          value={modeOptions.includes(s.mode) ? s.mode : "STABILIZE"}
          onChange={(ev) => {
            send({ op: "mode", mode: ev.target.value });
            addLog(t("Mode {mode}", { mode: ev.target.value }), "cmd");
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
            addLog(t("arm · {mode}", { mode: s.mode }), "cmd");
          }}
        >
          {s.armed ? "armed" : "disarm"}
        </button>
      </div>
      <div className={`sticks ${live3d ? "axis-3d" : `axis-${axis}`}`} aria-label={t("Virtual Mode 2 sticks")}>
        <div className="stick thr" ref={stickL} role="button" tabIndex={0} title={axis === "d" && !live3d ? t("Left stick: throttle (up-down)") : axis === "yaw" && !live3d ? t("Left stick: yaw (left-right)") : t("Left stick: throttle and yaw")}>
          <div className="cross" />
          <span className="tag n">{t("Thr")}</span>
          <span className="tag s">{t("Thr−")}</span>
          <span className="tag w">{t("Yaw−")}</span>
          <span className="tag e">{t("Yaw+")}</span>
          <div className="knob" ref={knobL} />
        </div>
        <div className="stick" ref={stickR} role="button" tabIndex={0} title={live3d ? t("Right stick: roll and pitch") : axis === "pitch" ? t("Right stick: pitch (up-down)") : t("Right stick: roll (left-right)")}>
          <div className="cross" />
          <span className="tag n">{t("pitch")}</span>
          <span className="tag s">{t("pitch")}</span>
          <span className="tag w">{t("Roll−")}</span>
          <span className="tag e">{t("Roll+")}</span>
          <div className="knob" ref={knobR} />
        </div>
      </div>
      <div className={`feel ${feel.kind}`}>{feel.title === "—" ? "—" : t(feel.title)}</div>
      <div className="hint">{t(feel.hint, { stick: stickName, Stick: StickName })}</div>
      <div className="btns">
        <button className={p < 0.1 ? "cyan on" : "cyan"} onClick={() => applyPreset("wool")}>{t("Wool")}</button>
        <button className={p >= 0.1 && p < 0.4 ? "on" : ""} onClick={() => applyPreset("stock")}>{t("Stock")}</button>
        <button className={p >= 0.4 ? "hot on" : "hot"} onClick={() => applyPreset("hot")}>{t("Sharp")}</button>
      </div>
      {tuneNode ? (
          <>
            <div className="tune-cap">
              {t(tuneNode.title)}
              <span>{t(tuneNode.unit)}</span>
            </div>
            {tuneNode.gains.length ? (
              <div className="sliders">
                {tuneNode.gains.map((g) => (
                  <GainRow key={g.key} gain={g} sample={s} node={tuneNode} axis={axis} />
                ))}
              </div>
            ) : (
              <p className="tune-empty">{t("No gains. Pick a regulator — sliders stay here and on the plot.")}</p>
            )}
          </>
        ) : null}
      <div className="log-label">{t("Log")}</div>
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
