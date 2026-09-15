import { useState, useSyncExternalStore } from "react";
import { GYRO_NOTCH, NODES, pidTerms, type Gain, type NodeDef } from "../cascade";
import { t, useT } from "../i18n/i18n";
import { axisTar, axisView, remapGainKey, type Axis } from "../mav/axis";
import { fmtGain, GainRow, liveGain, paramOf, paramUi } from "./GainRow";
import { getSnapshot, subscribe } from "../mav/store";
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
  const g = node.extras?.find((x) => x.label === label);
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
      refColor: COL.white,
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
  const v = axisView(s, axis === "d" && node.inner ? "roll" : axis);
  const tar = axisTar(v);
  if (node.id === "atc_rat") {
    return {
      ref: v.des,
      act: v.rate,
      unit: t("°/s"),
      digits: 1,
      refName: t("rate command"),
      actName: t("actual rate"),
      refColor: COL.amber,
      outName: t("torque"),
      pTerm: v.p,
      iTerm: v.i,
      dTerm: v.d,
    };
  }
  if (node.id === "atc_ang") {
    return {
      ref: tar,
      act: v.ang,
      unit: "°",
      digits: 1,
      refName: t("angle target"),
      actName: t("Actual {name}", { name: t(v.name) }),
      refColor: COL.white,
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

type FormRow = { name: string; tex: string; live: string };

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
    if (extend) rows.push({ name: "HNTCH", tex: t("gyro IMU"), live: notchOf(s).live });
    return rows;
  }
  const mix = node.id === "atc_rat" ? ` ${t("(−1…+1 mixer)")}` : "";
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
    const u =
      w.pTerm != null && w.iTerm != null && w.dTerm != null
        ? `${fmt(w.pTerm + w.iTerm + w.dTerm, 3)}${mix}`
        : "P + I + D";
    rows.push({
      name: t("output"),
      tex: extend && ff ? "u = P + I + D + FF·r" : "u = P + I + D",
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
      rows.push({ name: label, tex, live: x.text });
    }
    rows.push({ name: "HNTCH", tex: t("gyro IMU"), live: notchOf(s).live });
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
}) {
  return (
    <g opacity={dim ? 0.45 : 1}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="7"
        fill={COL.panel}
        stroke={stroke}
        strokeWidth="1.4"
        strokeDasharray={dashed ? "4 3" : undefined}
      />
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
}: {
  x: number;
  y: number;
  title: string;
  value: string;
  stroke: string;
}) {
  const w = 54;
  const h = 32;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="6"
        fill={COL.panel}
        stroke={stroke}
        strokeWidth="1.2"
        strokeDasharray="3 2"
      />
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
}: {
  sel: string | null;
  axis: Axis;
}) {
  const t = useT();
  const [extend, setExtend] = useState(false);
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const node = NODES.find((n) => n.id === sel) ?? NODES.find((n) => n.id === "atc_rat") ?? NODES[0];
  const terms = pidTerms(node);
  const w = wiresOf(node, s, axis);
  const err =
    w.ref != null && w.act != null && !Number.isNaN(w.ref) && !Number.isNaN(w.act) ? w.ref - w.act : null;
  const regulator = terms.length > 0;
  const extras = node.extras ?? [];
  const fltt = extraOf(node, "FLTT", s, axis);
  const flte = extraOf(node, "FLTE", s, axis);
  const fltd = extraOf(node, "FLTD", s, axis);
  const imax = extraOf(node, "IMAX", s, axis);
  const smax = extraOf(node, "SMAX", s, axis);
  const ff = extraOf(node, "FF", s, axis);
  const notch = notchOf(s);
  const cap = extend
    ? extras.length
      ? t("AC_PID filters are the dashed boxes. Gyro notch is on the cyan return (IMU), before the rate the PID subtracts. FREQ from hover FFT — not a feel slider.")
      : t("This stage is P only. Gyro notch is still on the IMU return.")
    : t("This is a simplification of AC_PID / AC_P. Firmware also has target and D filters (FLTT / FLTE / FLTD), integrator ceiling IMAX and slew limits (SMAX). On the wing, FF · r is added.");

  return (
    <div className="loop">
      <div className="plot-head">
        <b>{t(node.title)}</b>
        <span>
          {t("A loop because the output is compared to the command again.")}
        </span>
        <button
          type="button"
          className={extend ? "map-sw on" : "map-sw"}
          aria-pressed={extend}
          onClick={() => setExtend((v) => !v)}
        >
          <span className="track" aria-hidden="true" />
          {t("extend")}
        </button>
      </div>
      {!regulator ? (
        <p className="loop-note">
          {t("This block is not a PID. Below is a closed regulator loop (the same one on the map with P / I / D). Pick angle → rate or rate → torque to see live numbers.")}
        </p>
      ) : null}
      <div className="loop-board">
        <svg viewBox="0 0 840 300" role="img" aria-label={t("Closed PID loop")}>
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
          </defs>

          {extend ? (
            <>
              <path
                d="M 700 128 L 700 248 L 510 248"
                fill="none"
                stroke={COL.cyan}
                strokeWidth="1.8"
              />
              <path
                d="M 400 248 L 168 248 L 168 122"
                fill="none"
                stroke={COL.cyan}
                strokeWidth="1.8"
                markerEnd="url(#loopArrC)"
              />
              <Box
                x={400}
                y={228}
                w={110}
                h={40}
                stroke={COL.cyan}
                dashed
                dim={!notch.on}
                title={t("gyro notch")}
                sub={notch.on ? notch.mode : "INS_HNTCH"}
                value={notch.ready ? (notch.on ? notch.freq : "off") : "—"}
              />
              <text x="230" y="242" textAnchor="middle" fill={COL.cyan} fontSize="11" fontWeight="650">
                {t("feedback")}
              </text>
            </>
          ) : (
            <>
              <path
                d="M 700 128 L 700 248 L 168 248 L 168 122"
                fill="none"
                stroke={COL.cyan}
                strokeWidth="1.8"
                markerEnd="url(#loopArrC)"
              />
              <text x="430" y="268" textAnchor="middle" fill={COL.cyan} fontSize="11" fontWeight="650">
                {t("feedback — that is why it is a loop")}
              </text>
            </>
          )}

          {extend && ff ? (
            <>
              <path
                d="M 75 72 C 75 10, 492 10, 492 86"
                fill="none"
                stroke={COL.amber}
                strokeWidth="1.3"
                strokeDasharray="5 4"
                opacity={ff.v && ff.v > 0 ? 0.9 : 0.38}
                markerEnd="url(#loopArrA)"
              />
              <text x="284" y="22" textAnchor="middle" fill={COL.amber} fontSize="10" opacity="0.85">
                FF · r  {ff.text}
              </text>
            </>
          ) : null}

          <Box
            x={16}
            y={72}
            w={118}
            h={56}
            stroke={w.refColor}
            title={t("want")}
            sub={extend && fltt ? `FLTT ${fltt.text}` : "setpoint"}
            value={`${fmt(w.ref, w.digits)} ${w.unit}`}
          />
          <text x={75} y={144} textAnchor="middle" fill={w.refColor} fontSize="10">
            {w.refName}
          </text>
          <path d="M 134 100 L 148 100" fill="none" stroke={w.refColor} strokeWidth="1.8" markerEnd="url(#loopArrA)" />

          <circle cx={168} cy={100} r={20} fill={COL.panel} stroke={COL.ink} strokeWidth="1.4" />
          <text x={156} y={104} textAnchor="middle" fill={COL.ink} fontSize="15" fontWeight="700">
            +
          </text>
          <text x={180} y={128} textAnchor="middle" fill={COL.cyan} fontSize="14" fontWeight="700">
            −
          </text>

          <path d="M 188 100 L 210 100" fill="none" stroke={COL.ink} strokeWidth="1.6" markerEnd="url(#loopArr)" />
          <Box
            x={214}
            y={72}
            w={110}
            h={56}
            stroke={COL.ink}
            title={t("error")}
            sub={extend && flte ? `FLTE ${flte.text}` : "e = r − y"}
            value={`${fmt(err, w.digits)} ${w.unit}`}
          />

          <path d="M 324 100 L 352 46 M 324 100 L 352 100 M 324 100 L 352 154" fill="none" stroke={COL.line} strokeWidth="1.4" />

          {(["P", "I", "D"] as const).map((letter, i) => {
            const on = terms.includes(letter);
            const g = gainOf(node, letter, s, axis);
            const term = letter === "P" ? w.pTerm : letter === "I" ? w.iTerm : w.dTerm;
            const computed =
              letter === "P" && term == null && g?.v != null && err != null && !Number.isNaN(err) ? g.v * err : null;
            const y = 28 + i * 54;
            const hint = letter === "P" ? "Kp · e" : letter === "I" ? "∫ Ki · e dt" : "Kd · de/dt";
            const shown = !on
              ? t("none")
              : extend && letter === "I" && imax
                ? `IMAX ${imax.text}`
                : extend && letter === "D" && fltd
                  ? `FLTD ${fltd.text}`
                  : term != null
                    ? fmt(term, 3)
                    : computed != null
                      ? fmt(computed, 2)
                      : hint;
            return (
              <g key={letter} opacity={on ? 1 : 0.28}>
                <rect
                  x={356}
                  y={y}
                  width={88}
                  height={44}
                  rx="7"
                  fill={COL.panel}
                  stroke={on ? COL.cyan : COL.gray}
                  strokeWidth="1.4"
                />
                <text x={400} y={y + 16} textAnchor="middle" fill={on ? COL.cyan : COL.dim} fontSize="13" fontWeight="700">
                  {letter}
                  {g ? `  ${g.text}` : ""}
                </text>
                <text x={400} y={y + 32} textAnchor="middle" fill={COL.dim} fontSize="9">
                  {shown}
                </text>
              </g>
            );
          })}

          <path
            d="M 444 50 L 478 100 M 444 100 L 478 100 M 444 154 L 478 100"
            fill="none"
            stroke={COL.line}
            strokeWidth="1.4"
          />
          <circle cx={492} cy={100} r={14} fill={COL.panel} stroke={COL.line} strokeWidth="1.3" />
          <text x={492} y={104} textAnchor="middle" fill={COL.dim} fontSize="12">
            Σ
          </text>
          <text x={492} y={82} textAnchor="middle" fill={COL.dim} fontSize="9">
            {extend && ff ? "P+I+D+FF" : "P+I+D"}
          </text>

          {extend && smax ? (
            <>
              <line x1="535" y1="72" x2="535" y2="100" stroke={COL.gray} strokeWidth="1" />
              <Pill x={508} y={38} title="SMAX" value={smax.text} stroke={COL.gray} />
            </>
          ) : null}
          <path d="M 506 100 L 528 100" fill="none" stroke={COL.line} strokeWidth="1.6" markerEnd="url(#loopArr)" />
          <Box x={532} y={72} w={108} h={56} stroke={COL.gray} title={t("plant")} sub={t("plant · motors / body")} value={w.outName} />
          <path d="M 640 100 L 662 100" fill="none" stroke={COL.cyan} strokeWidth="1.8" markerEnd="url(#loopArrC)" />
          <Box
            x={666}
            y={72}
            w={118}
            h={56}
            stroke={COL.cyan}
            title={t("actual")}
            sub="process variable"
            value={`${fmt(w.act, w.digits)} ${w.unit}`}
          />
          <text x={725} y={144} textAnchor="middle" fill={COL.cyan} fontSize="10">
            {w.actName}
          </text>
        </svg>
      </div>
      <div className="loop-legend">
        <span>
          <i className="a" />
          {t("rate command")}
        </span>
        <span>
          <i className="w" />
          {t("angle target")}
        </span>
        <span>
          <i className="c" />
          {t("actual")}
        </span>
        <span>
          <i className="g" />
          {t("stick on the plot")}
        </span>
      </div>
      <div className="loop-form">
        {formulaRows(node, w, err, s, axis, extend).map((row) => (
          <div className="frow" key={row.name}>
            <span>{row.name}</span>
            <code>{row.tex}</code>
            <b>{row.live}</b>
          </div>
        ))}
      </div>
      {extend ? (
        <div className="loop-xgain">
          {extras.map((g) => (
            <GainRow key={g.key} gain={g} sample={s} node={node} axis={axis} />
          ))}
          <div className="xhead">{t("gyro notch")}</div>
          {GYRO_NOTCH.map((g) => (
            <GainRow key={g.key} gain={g} sample={s} node={{ ...node, param: "INS_HNTCH_*" }} axis={axis} />
          ))}
        </div>
      ) : null}
      <p className="loop-cap">{cap}</p>
    </div>
  );
}
