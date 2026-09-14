import type { AxisFocus } from "../cascade";

function ink(on: boolean, hot: string, rest = "#5c6b7a"): string {
  return on ? hot : rest;
}

function QuadTop({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} fill="#1a1e24" stroke="#8b98a8" strokeWidth="1.4">
      <line x1="-18" y1="-14" x2="-6" y2="-5" />
      <line x1="18" y1="-14" x2="6" y2="-5" />
      <line x1="-18" y1="14" x2="-6" y2="5" />
      <line x1="18" y1="14" x2="6" y2="5" />
      <rect x="-7" y="-5" width="14" height="10" rx="2" />
      <polygon points="0,-9 -3,-5 3,-5" fill="#8b98a8" stroke="none" />
      <circle cx="-20" cy="-16" r="4" />
      <circle cx="20" cy="-16" r="4" />
      <circle cx="-20" cy="16" r="4" />
      <circle cx="20" cy="16" r="4" />
    </g>
  );
}

export function FrameGuide({ focus }: { focus: AxisFocus | null }) {
  const ne = focus === "ne" || focus === "nav";
  const d = focus === "d";
  const body = focus === "lean" || focus === "att" || focus === "rate" || focus === "mix";
  const amber = "#ffb74d";
  const cyan = "#4fc3f7";

  const hint =
    focus === "ne" || focus === "nav"
      ? "Земля, горизонт: North і East. Метри і м/с. Не ніс дрона."
      : focus === "d"
        ? "D+ вниз. «Висота» справа — AGL, тобто −D. м, м/с, м/с²."
        : focus === "lean"
          ? "Прискорення NE стає нахилом (lean) — крен і тангаж у градусах."
          : focus === "att"
            ? "Кут тіла (attitude), градуси. Roll / pitch / yaw."
            : focus === "rate"
              ? "Кутова швидкість (rate) тіла, °/с. Не м/с польоту."
              : focus === "mix"
                ? "Мотори: момент з кутової швидкості (rate) і газ з прискорення Down."
                : "NED на землі. Кут і кутова швидкість (rate) — у тілі дрона.";

  return (
    <div className="frames">
      <div className={ne ? "frame on amber" : "frame"}>
        <span className="cap">згори · NE</span>
        <svg viewBox="0 0 140 100" aria-hidden="true">
          <QuadTop x={72} y={58} />
          <g stroke={ink(ne, amber)} fill={ink(ne, amber)} strokeWidth="1.8" strokeLinecap="round">
            <line x1="72" y1="40" x2="72" y2="10" />
            <polygon points="72,6 68,14 76,14" />
            <line x1="92" y1="58" x2="128" y2="58" />
            <polygon points="132,58 124,54 124,62" />
          </g>
          <text x="76" y="18" fontSize="11" fill={ink(ne, amber)}>
            N
          </text>
          <text x="118" y="50" fontSize="11" fill={ink(ne, amber)}>
            E
          </text>
          <text x="8" y="94" fontSize="9" fill="#5c6b7a">
            м · м/с
          </text>
        </svg>
      </div>
      <div className={d ? "frame on amber" : "frame"}>
        <span className="cap">збоку · D+</span>
        <svg viewBox="0 0 140 100" aria-hidden="true">
          <line x1="8" y1="48" x2="132" y2="48" stroke="#3a4650" strokeDasharray="4 3" />
          <g transform="translate(58 48)" fill="#1a1e24" stroke="#8b98a8" strokeWidth="1.4">
            <rect x="-10" y="-6" width="28" height="12" rx="2" />
            <polygon points="18,0 28,-5 28,5" fill="#8b98a8" stroke="none" />
            <circle cx="-8" cy="-8" r="4" />
            <circle cx="14" cy="-8" r="4" />
            <circle cx="-8" cy="8" r="4" />
            <circle cx="14" cy="8" r="4" />
          </g>
          <g stroke={ink(d, amber)} fill={ink(d, amber)} strokeWidth="1.8" strokeLinecap="round">
            <line x1="28" y1="48" x2="28" y2="86" />
            <polygon points="28,90 24,82 32,82" />
          </g>
          <text x="34" y="88" fontSize="11" fill={ink(d, amber)}>
            D+
          </text>
          <text x="8" y="18" fontSize="9" fill="#5c6b7a">
            AGL −D
          </text>
          <text x="8" y="94" fontSize="9" fill="#5c6b7a">
            м · м/с · м/с²
          </text>
        </svg>
      </div>
      <div className={body ? "frame on cyan" : "frame"}>
        <span className="cap">ззаду · тіло</span>
        <svg viewBox="0 0 140 100" aria-hidden="true">
          <line x1="8" y1="58" x2="132" y2="58" stroke="#3a4650" strokeDasharray="4 3" />
          <g transform="translate(70 52)" fill="#1a1e24" stroke="#8b98a8" strokeWidth="1.4">
            <rect x="-8" y="-6" width="16" height="12" rx="2" />
            <line x1="-22" y1="-10" x2="-8" y2="-4" />
            <line x1="22" y1="-10" x2="8" y2="-4" />
            <line x1="-24" y1="12" x2="-8" y2="4" />
            <line x1="24" y1="12" x2="8" y2="4" />
            <circle cx="-24" cy="-12" r="4" />
            <circle cx="24" cy="-12" r="4" />
            <circle cx="-26" cy="14" r="5" />
            <circle cx="26" cy="14" r="5" />
          </g>
          <g
            fill="none"
            stroke={ink(focus === "rate" || focus === "att" || focus === "lean", cyan)}
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M 38 40 A 34 22 0 0 1 102 40" />
          </g>
          <polygon
            points="104,40 96,36 98,44"
            fill={ink(focus === "rate" || focus === "att" || focus === "lean", cyan)}
            stroke="none"
          />
          <text x="108" y="38" fontSize="11" fill={ink(body, cyan)}>
            {focus === "rate" ? "°/с" : "°"}
          </text>
          <text x="8" y="94" fontSize="9" fill="#5c6b7a">
            крен · тангаж · yaw
          </text>
        </svg>
      </div>
      <p className="frame-hint">{hint}</p>
    </div>
  );
}
