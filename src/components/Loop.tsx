import { useSyncExternalStore } from "react";
import { NODES, pidTerms, type NodeDef } from "../cascade";
import { t, useT } from "../i18n/i18n";
import { axisTar, axisView, remapGainKey, type Axis } from "../mav/axis";
import { fmtGain, paramOf } from "./GainRow";
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

type Wire = {
  ref: number | null;
  act: number | null;
  unit: string;
  digits: number;
  refName: string;
  actName: string;
  refColor: string;
  outName: string;
  pTerm: number | null;
  iTerm: number | null;
  dTerm: number | null;
};

function wiresOf(node: NodeDef, s: Sample, axis: Axis): Wire {
  const v = axisView(s, axis);
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

type FormRow = { name: string; tex: string; live: string };

function formulaRows(node: NodeDef, w: Wire, err: number | null, s: Sample, axis: Axis): FormRow[] {
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
        ? `${Kp.text} × ${eLive} = ${fmt(Kp.v * err, 2)} ${w.unit === "°" ? t("°/s") : w.unit}`
        : "—";
    rows.push({ name: "P", tex: "ω* = P · e", live: prod });
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
    const u =
      w.pTerm != null && w.iTerm != null && w.dTerm != null
        ? `${fmt(w.pTerm + w.iTerm + w.dTerm, 3)}${mix}`
        : "P + I + D";
    rows.push({ name: t("output"), tex: "u = P + I + D", live: u });
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
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  title: string;
  sub?: string;
  value?: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="7" fill={COL.panel} stroke={stroke} strokeWidth="1.4" />
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

export function Loop({
  sel,
  axis,
}: {
  sel: string | null;
  axis: Axis;
}) {
  const t = useT();
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const node = NODES.find((n) => n.id === sel) ?? NODES.find((n) => n.id === "atc_rat") ?? NODES[0];
  const terms = pidTerms(node);
  const w = wiresOf(node, s, axis);
  const err =
    w.ref != null && w.act != null && !Number.isNaN(w.ref) && !Number.isNaN(w.act) ? w.ref - w.act : null;
  const regulator = terms.length > 0;

  return (
    <div className="loop">
      <div className="plot-head">
        <b>{t(node.title)}</b>
        <span>
          {t("A loop because the output is compared to the command again.")}
        </span>
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

          <Box
            x={16}
            y={72}
            w={118}
            h={56}
            stroke={w.refColor}
            title={t("want")}
            sub="setpoint"
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
            sub="e = r − y"
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
            const shown =
              !on ? t("none") : term != null ? fmt(term, 3) : computed != null ? fmt(computed, 2) : hint;
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
            P+I+D
          </text>

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
        {formulaRows(node, w, err, s, axis).map((row) => (
          <div className="frow" key={row.name}>
            <span>{row.name}</span>
            <code>{row.tex}</code>
            <b>{row.live}</b>
          </div>
        ))}
      </div>
      <p className="loop-cap">
        {t("This is a simplification of AC_PID / AC_P. Firmware also has target and D filters (FLTT / FLTE / FLTD), integrator ceiling IMAX and slew limits (SMAX). On the wing, FF · r is added.")}
      </p>
    </div>
  );
}
