import type { KeyboardEvent } from "react";
import type { MotorFrame } from "../lib/motorFrames";

export type MotorMark = "pending" | "pick" | "current" | "done" | "reversed" | "warn" | "error" | "dim";

const CX = 110;
const COLOR: Record<MotorMark, string> = {
  pending: "#3a4552",
  pick: "var(--cyan)",
  current: "var(--cyan)",
  done: "var(--ok)",
  reversed: "var(--amber)",
  warn: "var(--amber)",
  error: "var(--hot)",
  dim: "#2a333c",
};

/** Two half-arcs with arrowheads, like the ArduPilot frame diagrams. dir 1 = clockwise on screen. */
function rotArrows(cx: number, cy: number, r: number, dir: 1 | -1, color: string, dashed: boolean, key: string) {
  const at = (deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  const head = 4.5;
  return [-150, 30].map((base) => {
    const a0 = dir > 0 ? base : base + 125;
    const a1 = a0 + dir * 125;
    const [sx, sy] = at(a0);
    const [ex, ey] = at(a1);
    const t = (a1 * Math.PI) / 180;
    const ux = -Math.sin(t) * dir, uy = Math.cos(t) * dir, nx = Math.cos(t), ny = Math.sin(t);
    const tip = `${ex + ux * head * 1.2},${ey + uy * head * 1.2}`;
    const b1 = `${ex - ux + nx * head},${ey - uy + ny * head}`;
    const b2 = `${ex - ux - nx * head},${ey - uy - ny * head}`;
    return (
      <g key={`${key}-${base}`}>
        <path
          d={`M ${sx} ${sy} A ${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${ex} ${ey}`}
          stroke={color}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeDasharray={dashed ? "3 3" : undefined}
          fill="none"
        />
        <polygon points={`${tip} ${b1} ${b2}`} fill={color} />
      </g>
    );
  });
}

export function MotorDiagram({
  frame,
  size,
  marks,
  arrows = false,
  outs,
  onPick,
  label,
  servoLabel,
}: {
  frame: MotorFrame;
  size: number;
  marks: Record<number, MotorMark>;
  arrows?: boolean;
  /** Output label under the motor number, e.g. "OUT 3" or "OUT 3·4". */
  outs?: Record<number, string>;
  onPick?: (n: number) => void;
  label: (n: number) => string;
  servoLabel: string;
}) {
  const n = frame.spots.length;
  const coax = frame.spots.some((s) => s.layer);
  const arms = coax ? n / 2 : n;
  const mr = coax ? (arms > 4 ? 12 : 15) : n <= 4 ? 22 : n <= 6 ? 18 : n <= 8 ? 15 : 12;
  const reach = coax ? 72 : n <= 4 ? 66 : n <= 8 ? 72 : 78;
  const ar = mr + 9;
  const arm = new Map<string, { x: number; y: number }>();
  const spots = frame.spots.map((spot) => {
    const ax = CX + spot.armX * reach;
    const ay = CX - spot.armY * reach;
    arm.set(`${ax.toFixed(1)},${ay.toFixed(1)}`, { x: ax, y: ay });
    if (!spot.layer) return { spot, x: ax, y: ay };
    // Coaxial pair: side by side across the arm.
    const a = Math.atan2(spot.armX, spot.armY);
    const d = (mr + 2) * (spot.layer === "top" ? -1 : 1);
    return { spot, x: ax + Math.cos(a) * d, y: ay + Math.sin(a) * d };
  });
  const servoY = CX + reach + mr + 3;
  const keyPick = (ev: KeyboardEvent, num: number) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      onPick?.(num);
    }
  };
  return (
    <svg className="mw-diagram" width={size} height={size} viewBox="0 0 220 220" role="group" aria-label={frame.title}>
      <path d="M110 8l7 10h-14z" fill="var(--cyan)" />
      {[...arm.values()].map((p) => (
        <line key={`${p.x},${p.y}`} x1={CX} y1={CX} x2={p.x} y2={p.y} stroke="#262e3a" strokeWidth={n > 8 ? 6 : 9} strokeLinecap="round" />
      ))}
      <rect x={CX - (n > 6 ? 15 : 18)} y={CX - (n > 6 ? 20 : 24)} width={n > 6 ? 30 : 36} height={n > 6 ? 40 : 48} rx={8} fill="#1c232e" stroke="#2a333c" strokeWidth={1.5} />
      {spots.map(({ spot, x, y }) => {
        const mark = marks[spot.n] ?? "pending";
        const color = COLOR[mark];
        const thin = mark === "pending" || mark === "pick" || mark === "dim";
        const out = outs?.[spot.n];
        const showOut = out != null && mr >= 15;
        const fs = mr >= 18 ? 15 : mr >= 15 ? 13 : 10;
        const text = mark === "pending" ? "var(--ink)" : mark === "dim" ? "var(--dim)" : color;
        const pickable = !!onPick && mark !== "dim";
        return (
          <g
            key={spot.n}
            className={pickable ? "mw-motor pick" : "mw-motor"}
            opacity={mark === "dim" ? 0.45 : 1}
            role={pickable ? "button" : undefined}
            tabIndex={pickable ? 0 : undefined}
            aria-label={label(spot.n)}
            onClick={pickable ? () => onPick?.(spot.n) : undefined}
            onKeyDown={pickable ? (ev) => keyPick(ev, spot.n) : undefined}
          >
            {arrows && mark !== "dim" && spot.yaw !== 0
              ? rotArrows(x, y, ar, spot.yaw < 0 ? 1 : -1, mark === "pending" ? "#5a6778" : color, mark === "pending", `a${spot.n}`)
              : null}
            {mark === "current" && !arrows ? <circle cx={x} cy={y} r={mr + 5} stroke="var(--cyan)" strokeOpacity={0.3} strokeWidth={3} fill="none" /> : null}
            <circle
              className="mw-motor-ring"
              cx={x}
              cy={y}
              r={mr}
              fill={mark === "pick" ? "#0f2230" : "#141a22"}
              stroke={color}
              strokeWidth={thin ? 1.5 : 2.5}
              strokeDasharray={mark === "pick" ? "4 3" : undefined}
            />
            <text x={x} y={showOut ? y + 1.5 : y + fs * 0.35} textAnchor="middle" fontSize={fs} fontWeight={700} fill={text}>
              {spot.n}
            </text>
            {showOut ? (
              <text x={x} y={y + mr * 0.55} textAnchor="middle" fontSize={6.5} fill="var(--dim)" className="mw-mono">
                {out}
              </text>
            ) : null}
            {spot.layer ? (
              <text
                x={x + Math.cos(Math.atan2(y - CX, x - CX)) * (mr + 5)}
                y={y + Math.sin(Math.atan2(y - CX, x - CX)) * (mr + 5) + 2.5}
                textAnchor="middle"
                fontSize={7}
                fontWeight={700}
                fill="var(--dim)"
              >
                {spot.layer === "top" ? "T" : "B"}
              </text>
            ) : null}
            {(mark === "done" || mark === "reversed") && mr >= 15 ? (
              <g>
                <circle cx={x + mr * 0.72} cy={y - mr * 0.72} r={7} fill={color} stroke="#141a22" strokeWidth={2} />
                {mark === "done" ? (
                  <path d={`M ${x + mr * 0.72 - 3} ${y - mr * 0.72 + 0.2} l 2 2 l 4 -4.4`} stroke="#101214" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                ) : (
                  <path d={`M ${x + mr * 0.72 + 3} ${y - mr * 0.72} a 3 3 0 1 1 -1 -2.2`} stroke="#101214" strokeWidth={1.6} strokeLinecap="round" fill="none" />
                )}
              </g>
            ) : null}
          </g>
        );
      })}
      {frame.servo ? (
        <g>
          <rect x={CX - 17} y={servoY} width={34} height={13} rx={4} fill="#2c2212" stroke="var(--amber)" strokeWidth={1.5} />
          <text x={CX} y={servoY + 9.5} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--amber)">
            {servoLabel}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
