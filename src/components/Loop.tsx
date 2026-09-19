import { useState } from "react";
import { GYRO_NOTCH, NODES as COPTER_NODES, nodesLiveIn as copterLive, pidTerms, type Gain, type NodeDef } from "../cascade";
import { t, useT } from "../i18n/i18n";
import { axisTar, axisView, remapGainKey, type Axis } from "../mav/axis";
import { LoopLiveBox, LoopPidBlock, LoopSumBlock, LoopFrame, loopBoxHit, type LoopMark } from "./LoopPids";
import { SchemeKey, SchemeKnobs, schemeHit } from "./SchemeKnobs";
import { fmtGain, liveGain, paramOf, paramUi } from "./GainRow";
import { isPaused } from "../mav/store";
import { useVehicle, useViewSample } from "../mav/view";
import { NODES as PLANE_NODES, nodesLiveIn as planeLive } from "../plane/cascade";
import type { Sample } from "../mav/types";

const COL = {
  ink: "#e8eef4",
  dim: "#8b98a8",
  cyan: "#4fc3f7",
  amber: "#ffb74d",
  white: "rgba(255,255,255,0.92)",
  gray: "#6b7884",
  panel: "#1a1e24",
  line: "#3a4652",
  hot: "#ef5350",
};

function fmt(v: number | null, d: number): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(d);
}

function gainOf(node: NodeDef, letter: "P" | "I" | "D", s: Sample, axis: Axis): { text: string; key: string; v: number | null } | null {
  const g = node.gains.find((x) => x.label.replace(/^ANG\s+/i, "").trim() === letter);
  if (!g) return null;
  const key = remapGainKey(g.key, axis);
  const v = paramOf(s, key);
  return { key, text: v == null ? "—" : fmtGain(g, v, key), v };
}

function extraOf(
  node: NodeDef,
  label: string,
  s: Sample,
  axis: Axis,
): { g: Gain; key: string; text: string; v: number | null } | null {
  const g = node.extras?.find((x) => x.label === label) ?? node.gains.find((x) => x.label === label);
  if (!g) return null;
  const { name } = liveGain(g, s, axis);
  const v = paramUi(s, g, axis);
  return { g, key: name, text: v == null ? "—" : fmtGain(g, v, name), v };
}

type Wire = {
  ref: number | null;
  act: number | null;
  unit: string;
  digits: number;
  refName: string;
  actName: string;
  refColor: string;
  outName: string;
  outUnit?: string;
  pTerm: number | null;
  iTerm: number | null;
  dTerm: number | null;
};

function wiresOf(node: NodeDef, s: Sample, axis: Axis): Wire {
  if (node.id === "psc_d_pos") {
    return {
      ref: s.alt_tar ?? null,
      act: s.alt,
      unit: "m",
      digits: 2,
      refName: t("altitude target"),
      actName: t("AGL"),
      refColor: COL.amber,
      outName: t("desired Vd"),
      outUnit: t("m/s"),
      pTerm: null,
      iTerm: null,
      dTerm: null,
    };
  }
  if (node.id === "psc_d_vel") {
    return {
      ref: s.climb_des ?? null,
      act: s.climb,
      unit: t("m/s"),
      digits: 2,
      refName: t("climb target"),
      actName: t("climb Act"),
      refColor: COL.amber,
      outName: t("desired ad"),
      pTerm: null,
      iTerm: null,
      dTerm: null,
    };
  }
  if (node.id === "psc_d_acc") {
    return {
      ref: null,
      act: null,
      unit: t("m/s²"),
      digits: 2,
      refName: t("accel target"),
      actName: t("accel Act"),
      refColor: COL.amber,
      outName: t("throttle"),
      outUnit: "%",
      pTerm: null,
      iTerm: null,
      dTerm: null,
    };
  }
  if (node.id === "psc_ne_pos") {
    return {
      ref: null,
      act: null,
      unit: "m",
      digits: 2,
      refName: t("NE target"),
      actName: t("NE pos"),
      refColor: COL.amber,
      outName: t("desired Vxy"),
      outUnit: t("m/s"),
      pTerm: null,
      iTerm: null,
      dTerm: null,
    };
  }
  if (node.id === "psc_ne_vel") {
    return {
      ref: null,
      act: null,
      unit: t("m/s"),
      digits: 2,
      refName: t("speed target"),
      actName: t("NE vel"),
      refColor: COL.amber,
      outName: t("accel NE"),
      outUnit: t("m/s²"),
      pTerm: null,
      iTerm: null,
      dTerm: null,
    };
  }
  const v = axisView(s, axis === "d" && node.inner ? "roll" : axis);
  if (node.id === "atc_rat" || node.id === "rll_rate" || node.id === "ptch_rate") {
    return {
      ref: v.des,
      act: v.rate,
      unit: t("°/s"),
      digits: 1,
      refName: t("rate command"),
      actName: t("actual rate"),
      refColor: COL.amber,
      outName: node.id === "ptch_rate" ? t("elevator") : node.id === "rll_rate" ? t("aileron") : t("torque"),
      pTerm: v.p,
      iTerm: v.i,
      dTerm: v.d,
    };
  }
  if (node.id === "atc_ang" || node.id === "rll_ang" || node.id === "ptch_ang") {
    const vv = node.id === "ptch_ang" ? axisView(s, "pitch") : node.id === "rll_ang" ? axisView(s, "roll") : v;
    const tarr = axisTar(vv);
    return {
      ref: tarr,
      act: vv.ang,
      unit: "°",
      digits: 1,
      refName: t("angle target"),
      actName: t("Actual {name}", { name: t(vv.name) }),
      refColor: COL.amber,
      outName: t("desired rate"),
      pTerm: null,
      iTerm: null,
      dTerm: null,
    };
  }
  return {
    ref: null,
    act: null,
    unit: t(node.unit),
    digits: 2,
    refName: t("setpoint"),
    actName: t("actual"),
    refColor: node.inner ? COL.cyan : COL.amber,
    outName: t("output"),
    pTerm: null,
    iTerm: null,
    dTerm: null,
  };
}

const HNTCH_MODE = ["fixed", "throttle", "RPM", "ESC", "FFT", "RPM2"] as const;

function notchOf(s: Sample): { on: boolean; ready: boolean; freq: string; bw: string; mode: string; live: string } {
  const en = paramOf(s, "INS_HNTCH_ENABLE");
  const freq = paramOf(s, "INS_HNTCH_FREQ");
  const bw = paramOf(s, "INS_HNTCH_BW");
  const mode = paramOf(s, "INS_HNTCH_MODE");
  const ready = en != null;
  const on = ready && en >= 0.5;
  const freqTxt = freq == null ? "—" : `${Math.round(freq)} Hz`;
  const bwTxt = bw == null ? "—" : `${Math.round(bw)} Hz`;
  const modeTxt = mode != null && mode >= 0 && mode < HNTCH_MODE.length ? HNTCH_MODE[Math.round(mode)] : "—";
  const live = !ready ? "—" : on ? `${freqTxt} · BW ${bwTxt}` : "off";
  return { on, ready, freq: freqTxt, bw: bwTxt, mode: modeTxt, live };
}

type FormRow = { name: string; tex: string; live: string; extra?: boolean };

function formulaRows(node: NodeDef, w: Wire, err: number | null, s: Sample, axis: Axis, extend: boolean): FormRow[] {
  const terms = pidTerms(node);
  const Kp = gainOf(node, "P", s, axis);
  const Ki = gainOf(node, "I", s, axis);
  const Kd = gainOf(node, "D", s, axis);
  const r = fmt(w.ref, w.digits);
  const y = fmt(w.act, w.digits);
  const eLive = fmt(err, Math.max(w.digits, 2));
  const yTex = w.act != null && w.act < 0 ? `(${y})` : y;
  const rows: FormRow[] = [
    {
      name: t("error"),
      tex: "e = r − y",
      live: w.ref == null || w.act == null ? `${w.unit}` : `${r} − ${yTex} = ${eLive} ${w.unit}`,
    },
  ];
  if (terms.includes("P") && !terms.includes("I") && !terms.includes("D")) {
    const prod =
      Kp?.v != null && err != null && !Number.isNaN(err)
        ? `${Kp.text} × ${eLive} = ${fmt(Kp.v * err, 2)} ${w.unit === "°" ? t("°/s") : w.outUnit ?? w.unit}`
        : "—";
    rows.push({ name: "P", tex: "ω* = P · e", live: prod });
    if (extend) rows.push({ name: "HNTCH", tex: t("gyro IMU"), live: notchOf(s).live, extra: true });
    return rows;
  }
  const mix =
    node.id === "atc_rat"
      ? ` ${t("(−1…+1 mixer)")}`
      : node.id === "rll_rate" || node.id === "ptch_rate"
        ? ` ${t("(−1…+1 servo)")}`
        : "";
  if (terms.includes("P")) {
    const prod =
      w.pTerm != null
        ? fmt(w.pTerm, 3)
        : Kp?.v != null && err != null
          ? fmt(Kp.v * err, 3)
          : "—";
    rows.push({ name: "P", tex: "P = Kp · e", live: `${Kp?.text ?? "Kp"} × ${eLive} → ${prod}${mix}` });
  }
  if (terms.includes("I")) {
    rows.push({
      name: "I",
      tex: "I ← I + Ki · e · Δt",
      live: w.iTerm != null ? t("now {v}{mix}", { v: fmt(w.iTerm, 3), mix }) : `${Ki?.text ?? "Ki"} · e · Δt, |I| ≤ IMAX`,
    });
  }
  if (terms.includes("D")) {
    rows.push({
      name: "D",
      tex: "D = Kd · de/dt",
      live: w.dTerm != null ? `${fmt(w.dTerm, 4)}${mix}` : `${Kd?.text ?? "Kd"} · de/dt`,
    });
  }
  if (terms.length > 1) {
    const ff = extraOf(node, "FF", s, axis);
    const ffLead = node.gains.some((g) => g.label === "FF");
    const u =
      w.pTerm != null && w.iTerm != null && w.dTerm != null
        ? `${fmt(w.pTerm + w.iTerm + w.dTerm, 3)}${mix}`
        : "P + I + D";
    rows.push({
      name: t("output"),
      tex: (extend || ffLead) && ff ? "u = P + I + D + FF·r" : "u = P + I + D",
      live: u,
    });
  }
  if (extend) {
    for (const label of ["FLTT", "FLTE", "FLTD", "IMAX", "SMAX", "FF"] as const) {
      const x = extraOf(node, label, s, axis);
      if (!x) continue;
      const tex =
        label === "FLTT"
          ? "LPF(r)"
          : label === "FLTE"
            ? "LPF(e)"
            : label === "FLTD"
              ? "LPF(D)"
              : label === "IMAX"
                ? "|I| ≤ IMAX"
                : label === "SMAX"
                  ? "slew(P+D)"
                  : "FF · r";
      rows.push({ name: label, tex, live: x.text, extra: true });
    }
    rows.push({ name: "HNTCH", tex: t("gyro IMU"), live: notchOf(s).live, extra: true });
  }
  return rows;
}

function Box({
  x,
  y,
  w,
  h,
  stroke,
  title,
  sub,
  value,
  dashed,
  dim,
  picked,
  onPick,
  mark,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  title: string;
  sub?: string;
  value?: string;
  dashed?: boolean;
  dim?: boolean;
  picked?: boolean;
  onPick?: () => void;
  mark?: LoopMark;
}) {
  const kind: LoopMark | undefined = mark ?? (dashed ? "struct" : undefined);
  return (
    <g opacity={dim ? 0.45 : 1} {...loopBoxHit(onPick)}>
      <LoopFrame x={x} y={y} w={w} h={h} color={stroke} mark={kind} picked={picked} />
      <text x={x + w / 2} y={y + 16} textAnchor="middle" fill={COL.dim} fontSize="10">
        {title}
      </text>
      {value ? (
        <text x={x + w / 2} y={y + (sub ? 34 : 38)} textAnchor="middle" fill={stroke} fontSize="13" fontWeight="700">
          {value}
        </text>
      ) : null}
      {sub ? (
        <text x={x + w / 2} y={y + h - 10} textAnchor="middle" fill={COL.dim} fontSize="9">
          {sub}
        </text>
      ) : null}
    </g>
  );
}

function Pill({
  x,
  y,
  title,
  value,
  stroke,
  picked,
  onPick,
}: {
  x: number;
  y: number;
  title: string;
  value: string;
  stroke: string;
  picked?: boolean;
  onPick?: () => void;
}) {
  const w = 54;
  const h = 32;
  return (
    <g {...loopBoxHit(onPick)}>
      <LoopFrame x={x} y={y} w={w} h={h} rx={6} color={stroke} mark="later" picked={picked} />
      <text x={x + w / 2} y={y + 13} textAnchor="middle" fill={COL.dim} fontSize="9">
        {title}
      </text>
      <text x={x + w / 2} y={y + 25} textAnchor="middle" fill={stroke} fontSize="10" fontWeight="700">
        {value}
      </text>
    </g>
  );
}

export function Loop({
  sel,
  axis,
  onPause,
  embed,
}: {
  sel: string | null;
  axis: Axis;
  onPause: () => void;
  embed?: boolean;
}) {
  const t = useT();
  const [extend, setExtend] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const s = useViewSample();
  const vehicle = useVehicle();
  const plane = vehicle === "plane";
  const nodes = plane ? PLANE_NODES : COPTER_NODES;
  const node =
    nodes.find((n) => n.id === sel) ?? nodes.find((n) => n.id === (plane ? "rll_rate" : "atc_rat")) ?? nodes[0];
  const terms = pidTerms(node);
  const w = wiresOf(node, s, axis);
  const err =
    w.ref != null && w.act != null && !Number.isNaN(w.ref) && !Number.isNaN(w.act) ? w.ref - w.act : null;
  const regulator = terms.length > 0;
  const extras = node.extras ?? [];
  const paused = isPaused();
  const fltt = extraOf(node, "FLTT", s, axis);
  const flte = extraOf(node, "FLTE", s, axis);
  const fltd = extraOf(node, "FLTD", s, axis);
  const imax = extraOf(node, "IMAX", s, axis);
  const smax = extraOf(node, "SMAX", s, axis);
  const ff = extraOf(node, "FF", s, axis);
  const ffLead = node.gains.some((g) => g.label === "FF");
  const showFf = !!ff && (extend || ffLead);
  const notch = notchOf(s);
  const idle = s.ok && !(plane ? planeLive(s.mode, s).has(node.id) : copterLive(s.mode).has(node.id));
  const scale = paramOf(s, "SCALING_SPEED");
  const cap = plane
    ? extend
      ? t("AC_PID filters are the dashed boxes. Gyro notch is on the cyan return (IMU), before the rate the PID subtracts. FREQ from hover FFT — not a feel slider.")
      : t("FF is the lead into the servo. P/I/D trim the error. Same FF at two speeds is a different plant because authority grows with airspeed² around SCALING_SPEED.")
    : extend
      ? extras.length
        ? t("AC_PID filters are the dashed boxes. Gyro notch is on the cyan return (IMU), before the rate the PID subtracts. FREQ from hover FFT — not a feel slider.")
        : t("This stage is P only. Gyro notch is still on the IMU return.")
      : t("This is a simplification of AC_PID / AC_P. Firmware also has target and D filters (FLTT / FLTE / FLTD), integrator ceiling IMAX and slew limits (SMAX). On the wing, FF · r is added.");

  const hit = (id: string) => schemeHit(id, pick, setPick);
  const extraGain = (label: string) => extras.find((x) => x.label === label);
  const knobGains = (() => {
    if (pick === "I") return extraGain("IMAX") ? [extraGain("IMAX")!] : [];
    if (pick === "D") return extraGain("FLTD") ? [extraGain("FLTD")!] : [];
    if (pick === "sum") return extras;
    if (pick === "ff") return extraGain("FF") ? [extraGain("FF")!] : [];
    if (pick === "want") return extraGain("FLTT") ? [extraGain("FLTT")!] : [];
    if (pick === "err") return extraGain("FLTE") ? [extraGain("FLTE")!] : [];
    if (pick === "notch") return [...GYRO_NOTCH];
    if (pick === "smax") return extraGain("SMAX") ? [extraGain("SMAX")!] : [];
    return [];
  })();

  return (
    <div className={embed ? "loop embed" : "loop"}>
      {idle ? (
        <p className="warn">
          {t("In {mode} this loop is not running: the autopilot is not turning it. You can inspect gains, but they will not change behaviour until the mode closes the loop.", {
            mode: s.mode || t("this mode"),
          })}
        </p>
      ) : null}
      <div className="plot-head">
        <b>{t(node.title)}</b>
        <span>
          {t("A loop because the output is compared to the command again.")}
        </span>
        <button
          type="button"
          className={extend ? "map-sw on hot" : "map-sw"}
          aria-pressed={extend}
          onClick={() => setExtend((v) => !v)}
        >
          <span className="track" aria-hidden="true" />
          {t("extend")}
        </button>
        <button type="button" className={paused ? "pause-btn on" : "pause-btn"} onClick={onPause} title={t("Space")}>
          {paused ? t("Resume") : t("Pause")}
        </button>
      </div>
      {!regulator ? (
        <p className="loop-note">
          {t("This block is not a PID. Below is a closed regulator loop (the same one on the map with P / I / D). Pick angle → rate or rate → torque to see live numbers.")}
        </p>
      ) : null}
      <div className={!s.ok ? "loop-board idle" : paused ? "loop-board paused" : "loop-board"} onClick={() => setPick(null)}>
        <svg viewBox="0 0 900 330" preserveAspectRatio="xMidYMid meet" role="img" aria-label={t("Closed PID loop")}>
          <defs>
            <marker id="loopArr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill={COL.line} />
            </marker>
            <marker id="loopArrC" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill={COL.cyan} />
            </marker>
            <marker id="loopArrA" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill={w.refColor} />
            </marker>
            <marker id="loopArrX" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill={COL.hot} />
            </marker>
          </defs>

          {extend ? (
            <>
              <path
                d="M 821 154 L 821 304 L 508 304"
                fill="none"
                stroke={COL.cyan}
                strokeWidth="1.8"
              />
              <path
                d="M 400 304 L 158 304 L 158 138"
                fill="none"
                stroke={COL.cyan}
                strokeWidth="1.8"
                markerEnd="url(#loopArrC)"
              />
              <Box
                x={400}
                y={284}
                w={110}
                h={40}
                stroke={COL.hot}
                dim={!notch.on}
                title={t("gyro notch")}
                sub={notch.on ? notch.mode : "INS_HNTCH"}
                value={notch.ready ? (notch.on ? notch.freq : "off") : "—"}
                mark="later"
                {...hit("notch")}
              />
              <text x="230" y="298" textAnchor="middle" fill={COL.cyan} fontSize="11" fontWeight="650">
                {t("feedback")}
              </text>
            </>
          ) : (
            <>
              <path
                d="M 821 154 L 821 304 L 158 304 L 158 138"
                fill="none"
                stroke={COL.cyan}
                strokeWidth="1.8"
                markerEnd="url(#loopArrC)"
              />
              <text x="470" y="320" textAnchor="middle" fill={COL.cyan} fontSize="11" fontWeight="650">
                {t("feedback — that is why it is a loop")}
              </text>
            </>
          )}

          <LoopLiveBox
            x={12}
            y={82}
            w={108}
            h={72}
            stroke={w.refColor}
            title={t("want")}
            sub={extend && fltt ? `FLTT ${fltt.text}` : "setpoint"}
            value={`${fmt(w.ref, w.digits)} ${w.unit}`}
            pick={(p) => wiresOf(node, p, axis).ref}
            subColor={extend && fltt ? COL.hot : undefined}
            mark={fltt ? "later" : "struct"}
            {...hit("want")}
          />
          <text x={66} y={168} textAnchor="middle" fill={w.refColor} fontSize="10">
            {w.refName}
          </text>
          <path d="M 120 118 L 138 118" fill="none" stroke={w.refColor} strokeWidth="1.8" markerEnd="url(#loopArrA)" />

          <circle cx={158} cy={118} r={20} fill={COL.panel} stroke={COL.ink} strokeWidth="1.4" />
          <text x={146} y={122} textAnchor="middle" fill={COL.ink} fontSize="15" fontWeight="700">
            +
          </text>
          <text x={170} y={146} textAnchor="middle" fill={COL.cyan} fontSize="14" fontWeight="700">
            −
          </text>

          <path d="M 178 118 L 196 118" fill="none" stroke={COL.ink} strokeWidth="1.6" markerEnd="url(#loopArr)" />
          <LoopLiveBox
            x={196}
            y={82}
            w={102}
            h={72}
            stroke={COL.ink}
            title={t("error")}
            sub={extend && flte ? `FLTE ${flte.text}` : "e = r − y"}
            value={`${fmt(err, w.digits)} ${w.unit}`}
            pick={(p) => {
              const ww = wiresOf(node, p, axis);
              if (ww.ref == null || ww.act == null || Number.isNaN(ww.ref) || Number.isNaN(ww.act)) return null;
              return ww.ref - ww.act;
            }}
            subColor={extend && flte ? COL.hot : undefined}
            mark={flte ? "later" : "struct"}
            {...hit("err")}
          />

          <path
            d="M 298 118 L 322 50 M 298 118 L 322 140 M 298 118 L 322 230"
            fill="none"
            stroke={COL.line}
            strokeWidth="1.4"
          />

          {(["P", "I", "D"] as const).map((letter, i) => {
            const g = gainOf(node, letter, s, axis);
            const extra =
              extend && letter === "I" && imax
                ? `IMAX ${imax.text}`
                : extend && letter === "D" && fltd
                  ? `FLTD ${fltd.text}`
                  : g?.text ?? null;
            const extraHot = extend && ((letter === "I" && !!imax) || (letter === "D" && !!fltd));
            return (
              <LoopPidBlock
                key={letter}
                letter={letter}
                x={322}
                y={8 + i * 90}
                w={170}
                h={84}
                node={node}
                axis={axis}
                extra={extra}
                extraHot={extraHot}
                {...hit(letter)}
              />
            );
          })}

          <path
            d="M 492 50 L 508 90 M 492 140 L 508 118 M 492 230 L 508 146"
            fill="none"
            stroke={COL.line}
            strokeWidth="1.4"
          />
          <LoopSumBlock
            x={508}
            y={72}
            w={128}
            h={92}
            node={node}
            axis={axis}
            label="P+I+D"
            extra={showFf ? "+FF" : null}
            mark={extras.length ? "later" : "struct"}
            {...hit("sum")}
          />

          {showFf ? (
            <>
              <path
                d="M 66 82 L 66 5 L 572 5 L 572 70"
                fill="none"
                stroke={COL.hot}
                strokeWidth="1.3"
                strokeDasharray="5 4"
                opacity={ff.v && ff.v > 0 ? 0.9 : 0.38}
                markerEnd="url(#loopArrX)"
              />
              <g {...loopBoxHit(hit("ff").onPick)}>
                <text
                  x="200"
                  y="14"
                  textAnchor="middle"
                  fill={COL.hot}
                  fontSize="10"
                  opacity={pick === "ff" ? 1 : 0.85}
                  fontWeight={pick === "ff" ? 700 : 400}
                >
                  FF · r  {ff.text}
                </text>
              </g>
            </>
          ) : null}

          {extend && smax ? (
            <>
              <line x1="650" y1="72" x2="650" y2="118" stroke={COL.hot} strokeWidth="1" />
              <Pill x={636} y={38} title="SMAX" value={smax.text} stroke={COL.hot} {...hit("smax")} />
            </>
          ) : null}
          <path d="M 636 118 L 650 118" fill="none" stroke={COL.line} strokeWidth="1.6" markerEnd="url(#loopArr)" />
          <Box
            x={650}
            y={90}
            w={100}
            h={56}
            stroke={COL.gray}
            title={t("plant")}
            sub={
              plane
                ? s.aspd != null && scale != null
                  ? `V ${s.aspd.toFixed(0)} / SS ${scale.toFixed(0)}`
                  : t("plant · servo / air")
                : t("plant · motors / body")
            }
            value={w.outName}
            mark="struct"
            {...hit("plant")}
          />
          <path d="M 750 118 L 764 118" fill="none" stroke={COL.cyan} strokeWidth="1.8" markerEnd="url(#loopArrC)" />
          <LoopLiveBox
            x={764}
            y={82}
            w={114}
            h={72}
            stroke={COL.cyan}
            title={t("actual")}
            sub="process variable"
            value={`${fmt(w.act, w.digits)} ${w.unit}`}
            pick={(p) => wiresOf(node, p, axis).act}
            mark="struct"
            {...hit("act")}
          />
          <text x={821} y={168} textAnchor="middle" fill={COL.cyan} fontSize="10">
            {w.actName}
          </text>
        </svg>
      </div>
      <SchemeKey />
      <div className="loop-rest">
      <div className="loop-legend">
        <span>
          <i className={w.refColor === COL.white ? "w" : w.refColor === COL.cyan ? "c" : "a"} />
          {t("want")}
        </span>
        <span>
          <i className="c" />
          {t("actual")}
        </span>
        <span>
          <i className="e" />
          {t("error")}
        </span>
        <span>
          <i className="pid" />
          {t("PID")}
        </span>
        {extend ? (
          <span>
            <i className="x" />
            {t("extend")}
          </span>
        ) : null}
      </div>
      <div className="loop-form">
        {formulaRows(node, w, err, s, axis, extend).map((row) => (
          <div className={row.extra ? "frow extra" : "frow"} key={row.name}>
            <span>{row.name}</span>
            <code>{row.tex}</code>
            <b>{row.live}</b>
          </div>
        ))}
      </div>
      <SchemeKnobs
        node={pick === "notch" ? { ...node, param: "INS_HNTCH_*" } : node}
        axis={axis}
        gains={knobGains}
        picked={pick}
      />
      <p className="loop-cap">{cap}</p>
      </div>
    </div>
  );
}
