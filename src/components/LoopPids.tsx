import { pidTerms, type NodeDef } from "../cascade";
import { useT } from "../i18n/i18n";
import { axisTar, axisView, remapGainKey, type Axis } from "../mav/axis";
import { getBuffer, getSnapshot } from "../mav/store";
import type { Sample } from "../mav/types";
import { sparkSeries } from "../plot";
import { paramOf } from "./GainRow";

export const PID_COL = {
  cyan: "#4fc3f7",
  amber: "#ffb74d",
  white: "rgba(255,255,255,0.92)",
  panel: "#1a1e24",
  dim: "#8b98a8",
  gray: "#6b7884",
  line: "#3a4652",
  ink: "#e8eef4",
  pid: "#6b8cff",
  hot: "#ef5350",
};

export function kpOf(node: NodeDef, s: Sample, axis: Axis): number | null {
  const g = node.gains.find((x) => x.label.replace(/^ANG\s+/i, "").trim() === "P");
  if (!g) return null;
  return paramOf(s, remapGainKey(g.key, axis));
}

function loopErr(node: NodeDef, s: Sample, axis: Axis): number | null {
  if (node.id === "psc_d_pos") {
    if (s.alt_tar == null || s.alt == null) return null;
    return s.alt_tar - s.alt;
  }
  if (node.id === "psc_d_vel") {
    if (s.climb_des == null || s.climb == null) return null;
    return s.climb_des - s.climb;
  }
  const v = axisView(s, axis === "d" && node.inner ? "roll" : axis);
  if (node.id === "atc_rat") return v.des != null ? v.des - v.rate : null;
  if (node.id === "atc_ang") return axisTar(v) - v.ang;
  return null;
}

export function termOf(letter: "P" | "I" | "D", node: NodeDef, s: Sample, axis: Axis, kp: number | null): number | null {
  const v = axisView(s, axis === "d" && node.inner ? "roll" : axis);
  if (node.id === "atc_rat") return letter === "P" ? v.p : letter === "I" ? v.i : v.d;
  if (letter === "P" && kp != null) {
    const e = loopErr(node, s, axis);
    return e == null ? null : kp * e;
  }
  return null;
}

export function termSum(node: NodeDef, s: Sample, axis: Axis, kp: number | null): number | null {
  const on = pidTerms(node);
  let any = false;
  let u = 0;
  for (const letter of on) {
    const v = termOf(letter, node, s, axis, kp);
    if (v == null || Number.isNaN(v)) continue;
    any = true;
    u += v;
  }
  return any ? u : null;
}

export function fmtTerm(v: number | null, letter: "P" | "I" | "D" | "Σ"): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(letter === "D" ? 4 : 3);
}

export function PidSketch({
  letter,
  color,
  muted,
  x = 0,
  y = 0,
  width = 140,
  height = 52,
}: {
  letter: "P" | "I" | "D";
  color: string;
  muted?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}) {
  const s = Math.min(width / 140, height / 52);
  const inner =
    letter === "P" ? (
      <>
        <line x1="70" y1="48" x2="70" y2="6" stroke="#3a4652" />
        <line x1="8" y1="28" x2="132" y2="28" stroke="#3a4652" />
        <line x1="24" y1="44" x2="116" y2="12" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <text x="118" y="14" fontSize="9" fill={color}>
          P
        </text>
        <text x="126" y="40" fontSize="9" fill="#5c6b7a">
          e
        </text>
      </>
    ) : letter === "I" ? (
      <>
        <line x1="16" y1="44" x2="16" y2="8" stroke="#3a4652" />
        <line x1="16" y1="44" x2="132" y2="44" stroke="#3a4652" />
        <path d="M 50 44 L 50 20 L 128 20 L 128 44 Z" fill={color} opacity="0.1" />
        <path
          d="M 16 36 L 50 36 L 50 20 L 128 20"
          fill="none"
          stroke="#8b98a8"
          strokeWidth="1.2"
          strokeDasharray="3 2"
        />
        <path d="M 16 44 L 50 44 L 128 10" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <text x="86" y="18" fontSize="9" fill="#8b98a8">
          e
        </text>
        <text x="118" y="10" fontSize="9" fill={color}>
          I
        </text>
        <text x="126" y="50" fontSize="9" fill="#5c6b7a">
          t
        </text>
      </>
    ) : (
      <>
        <line x1="16" y1="44" x2="16" y2="8" stroke="#3a4652" />
        <line x1="16" y1="44" x2="132" y2="44" stroke="#3a4652" />
        <path
          d="M 16 36 L 58 36 L 58 18 L 128 18"
          fill="none"
          stroke="#8b98a8"
          strokeWidth="1.2"
          strokeDasharray="3 2"
        />
        <path
          d="M 16 44 L 54 44 L 58 8 L 62 44 L 128 44"
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <text x="96" y="16" fontSize="9" fill="#8b98a8">
          e
        </text>
        <text x="64" y="9" fontSize="9" fill={color}>
          D
        </text>
        <text x="126" y="50" fontSize="9" fill="#5c6b7a">
          t
        </text>
      </>
    );
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={muted ? 0.28 : 1}>
      {inner}
    </g>
  );
}

const PID = PID_COL.pid;

export function LoopPidBlock({
  letter,
  x,
  y,
  w,
  h,
  node,
  axis,
  extra,
  extraHot,
}: {
  letter: "P" | "I" | "D";
  x: number;
  y: number;
  w: number;
  h: number;
  node: NodeDef;
  axis: Axis;
  extra?: string | null;
  extraHot?: boolean;
}) {
  const t = useT();
  const s = getSnapshot();
  const on = pidTerms(node).includes(letter);
  const kp = kpOf(node, s, axis);
  const v = termOf(letter, node, s, axis, kp);
  const sparkW = w - 12;
  const sparkH = 22;
  const { ds } = sparkSeries(getBuffer(), [(p) => (on ? termOf(letter, node, p, axis, kpOf(node, p, axis)) : null)], sparkW, sparkH);
  const stroke = PID;
  const liveY = extra ? y + 25 : y + 14;
  return (
    <g opacity={on ? 1 : 0.28}>
      <rect x={x} y={y} width={w} height={h} rx="7" fill={PID_COL.panel} stroke={on ? stroke : PID_COL.gray} strokeWidth="1.4" />
      <text x={x + 8} y={y + 14} fill={on ? stroke : PID_COL.dim} fontSize="11" fontWeight="700">
        {letter}
      </text>
      {extra ? (
        <text x={x + w - 8} y={y + 13} textAnchor="end" fill={extraHot ? PID_COL.hot : on ? stroke : PID_COL.dim} fontSize="10" fontWeight="650">
          {extra}
        </text>
      ) : null}
      <text x={x + w - 8} y={liveY} textAnchor="end" fill={on ? stroke : PID_COL.dim} fontSize="11" fontWeight="650">
        {on ? fmtTerm(v, letter) : t("none")}
      </text>
      <PidSketch letter={letter} color={stroke} muted={!on} x={x + 4} y={y + 4} width={w - 50} height={h - sparkH - 10} />
      <g transform={`translate(${x + 6} ${y + h - sparkH - 4})`}>
        <line x1="0" y1={sparkH / 2} x2={sparkW} y2={sparkH / 2} stroke={PID_COL.line} strokeDasharray="3 3" />
        {ds[0] ? <path d={ds[0]} fill="none" stroke={stroke} strokeWidth="1.5" /> : null}
      </g>
    </g>
  );
}

export function LoopSumBlock({
  x,
  y,
  w,
  h,
  node,
  axis,
  label,
  extra,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  node: NodeDef;
  axis: Axis;
  label: string;
  extra?: string | null;
}) {
  const s = getSnapshot();
  const kp = kpOf(node, s, axis);
  const u = termSum(node, s, axis, kp);
  const sparkW = w - 12;
  const sparkH = h - 28;
  const { ds } = sparkSeries(getBuffer(), [(p) => termSum(node, p, axis, kpOf(node, p, axis))], sparkW, sparkH);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" fill={PID_COL.panel} stroke={PID_COL.pid} strokeWidth="1.3" />
      <text x={x + 8} y={y + 14} fill={PID_COL.dim} fontSize="11" fontWeight="700">
        Σ  {label}
        {extra ? (
          <tspan fill={PID_COL.hot}>{extra}</tspan>
        ) : null}
      </text>
      <text x={x + w - 8} y={y + 14} textAnchor="end" fill={PID_COL.pid} fontSize="11" fontWeight="650">
        {fmtTerm(u, "Σ")}
      </text>
      <g transform={`translate(${x + 6} ${y + 20})`}>
        <line x1="0" y1={sparkH / 2} x2={sparkW} y2={sparkH / 2} stroke={PID_COL.line} strokeDasharray="3 3" />
        {ds[0] ? <path d={ds[0]} fill="none" stroke={PID_COL.pid} strokeWidth="2" /> : null}
      </g>
    </g>
  );
}

export function LoopLiveBox({
  x,
  y,
  w,
  h,
  stroke,
  title,
  sub,
  value,
  pick,
  subColor,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  title: string;
  sub?: string;
  value: string;
  pick: (s: Sample) => number | null;
  subColor?: string;
}) {
  const sparkW = w - 12;
  const sparkH = 24;
  const { ds } = sparkSeries(getBuffer(), [pick], sparkW, sparkH);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="7" fill={PID_COL.panel} stroke={stroke} strokeWidth="1.4" />
      <text x={x + 8} y={y + 13} fill={PID_COL.dim} fontSize="10">
        {title}
      </text>
      <text x={x + w - 8} y={y + 13} textAnchor="end" fill={stroke} fontSize="11" fontWeight="700">
        {value}
      </text>
      {sub ? (
        <text x={x + 8} y={y + 24} fill={subColor ?? PID_COL.dim} fontSize="9">
          {sub}
        </text>
      ) : null}
      <g transform={`translate(${x + 6} ${y + h - sparkH - 4})`}>
        <line x1="0" y1={sparkH / 2} x2={sparkW} y2={sparkH / 2} stroke={PID_COL.line} strokeDasharray="3 3" />
        {ds[0] ? <path d={ds[0]} fill="none" stroke={stroke} strokeWidth="1.6" /> : null}
      </g>
    </g>
  );
}
