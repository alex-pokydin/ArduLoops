import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n/i18n";
import type { Axis } from "../mav/axis";

const MSG_MS = 60_000;
const SEV = /^(EMERGENCY|ALERT|CRITICAL|ERROR|WARNING|NOTICE|INFO|DEBUG)\s+/i;

function msgTone(text: string): string {
  const sev = text.split(/\s/, 1)[0]?.toUpperCase();
  if (sev === "EMERGENCY" || sev === "ALERT" || sev === "CRITICAL" || sev === "ERROR") return "bad";
  if (sev === "WARNING") return "warn";
  return "";
}

function clamp(v: number): number {
  return Math.max(-50, Math.min(50, v));
}

function att(roll: number, pitch: number, yaw: number): string {
  return `rotateZ(${clamp(roll)}deg) rotateX(${-clamp(pitch)}deg) rotateY(${-clamp(yaw)}deg)`;
}

function pose(roll: number, pitch: number, yaw: number, live3d: boolean, axis: Axis): string {
  if (live3d) return att(roll, pitch, Math.max(-35, Math.min(35, yaw)));
  if (axis === "d") return "rotateZ(0deg)";
  if (axis === "pitch") return `rotateZ(${clamp(-pitch)}deg)`;
  if (axis === "yaw") return `rotateZ(${yaw}deg)`;
  return `rotateZ(${clamp(roll)}deg)`;
}

function QuadSide({ kind }: { kind: "act" | "tar" }) {
  if (kind === "tar") {
    return (
      <svg className="quad-svg tar" viewBox="0 0 200 120" aria-hidden="true">
        <g fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round">
          <line x1="50" y1="46" x2="84" y2="56" />
          <line x1="50" y1="76" x2="84" y2="64" />
          <line x1="122" y1="56" x2="152" y2="46" />
          <line x1="122" y1="64" x2="152" y2="76" />
          <rect x="78" y="52" width="40" height="16" rx="3" />
          <polygon points="118,52 144,60 118,68" />
          <circle cx="48" cy="44" r="7" />
          <circle cx="46" cy="78" r="9" />
          <circle cx="154" cy="44" r="7" />
          <circle cx="156" cy="78" r="9" />
        </g>
      </svg>
    );
  }
  return (
    <svg className="quad-svg act" viewBox="0 0 200 120" aria-hidden="true">
      <g fill="#4fc3f7" stroke="#4fc3f7" strokeWidth="2" strokeLinecap="round">
        <line x1="50" y1="46" x2="84" y2="56" fill="none" />
        <line x1="50" y1="76" x2="84" y2="64" fill="none" />
        <line x1="122" y1="56" x2="152" y2="46" fill="none" />
        <line x1="122" y1="64" x2="152" y2="76" fill="none" />
        <rect x="78" y="52" width="40" height="16" rx="3" fill="#1a1e24" stroke="#4fc3f7" />
        <polygon points="118,52 144,60 118,68" fill="#4fc3f7" stroke="#4fc3f7" />
        <circle cx="48" cy="44" r="7" fill="#1a1e24" />
        <circle cx="46" cy="78" r="9" fill="#1a1e24" />
        <circle cx="154" cy="44" r="7" fill="#1a1e24" />
        <circle cx="156" cy="78" r="9" fill="#1a1e24" />
        <line x1="34" y1="44" x2="62" y2="44" fill="none" />
        <line x1="30" y1="78" x2="62" y2="78" fill="none" />
        <line x1="140" y1="44" x2="168" y2="44" fill="none" />
        <line x1="140" y1="78" x2="172" y2="78" fill="none" />
      </g>
    </svg>
  );
}

function Quad({ kind }: { kind: "act" | "tar" }) {
  if (kind === "tar") {
    return (
      <svg className="quad-svg tar" viewBox="0 0 200 120" aria-hidden="true">
        <g fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round">
          <line x1="58" y1="46" x2="88" y2="58" />
          <line x1="142" y1="46" x2="112" y2="58" />
          <line x1="52" y1="80" x2="88" y2="64" />
          <line x1="148" y1="80" x2="112" y2="64" />
          <rect x="88" y="52" width="24" height="16" rx="3" />
          <circle cx="54" cy="44" r="7" />
          <circle cx="146" cy="44" r="7" />
          <circle cx="48" cy="82" r="9" />
          <circle cx="152" cy="82" r="9" />
        </g>
      </svg>
    );
  }
  return (
    <svg className="quad-svg act" viewBox="0 0 200 120" aria-hidden="true">
      <g fill="#4fc3f7" stroke="#4fc3f7" strokeWidth="2" strokeLinecap="round">
        <line x1="58" y1="46" x2="88" y2="58" fill="none" />
        <line x1="142" y1="46" x2="112" y2="58" fill="none" />
        <line x1="52" y1="80" x2="88" y2="64" fill="none" />
        <line x1="148" y1="80" x2="112" y2="64" fill="none" />
        <rect x="88" y="52" width="24" height="16" rx="3" fill="#1a1e24" stroke="#4fc3f7" />
        <circle cx="54" cy="44" r="7" fill="#1a1e24" />
        <circle cx="146" cy="44" r="7" fill="#1a1e24" />
        <circle cx="48" cy="82" r="9" fill="#1a1e24" />
        <circle cx="152" cy="82" r="9" fill="#1a1e24" />
        <line x1="40" y1="44" x2="68" y2="44" fill="none" />
        <line x1="132" y1="44" x2="160" y2="44" fill="none" />
        <line x1="32" y1="82" x2="64" y2="82" fill="none" />
        <line x1="136" y1="82" x2="168" y2="82" fill="none" />
      </g>
    </svg>
  );
}

function QuadTop({ kind }: { kind: "act" | "tar" }) {
  if (kind === "tar") {
    return (
      <svg className="quad-svg tar" viewBox="0 0 200 120" aria-hidden="true">
        <g fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round">
          <line x1="58" y1="28" x2="88" y2="52" />
          <line x1="142" y1="28" x2="112" y2="52" />
          <line x1="58" y1="92" x2="88" y2="68" />
          <line x1="142" y1="92" x2="112" y2="68" />
          <rect x="88" y="48" width="24" height="24" rx="3" />
          <polygon points="100,36 108,48 92,48" />
          <circle cx="52" cy="24" r="8" />
          <circle cx="148" cy="24" r="8" />
          <circle cx="52" cy="96" r="8" />
          <circle cx="148" cy="96" r="8" />
        </g>
      </svg>
    );
  }
  return (
    <svg className="quad-svg act" viewBox="0 0 200 120" aria-hidden="true">
      <g fill="#4fc3f7" stroke="#4fc3f7" strokeWidth="2" strokeLinecap="round">
        <line x1="58" y1="28" x2="88" y2="52" fill="none" />
        <line x1="142" y1="28" x2="112" y2="52" fill="none" />
        <line x1="58" y1="92" x2="88" y2="68" fill="none" />
        <line x1="142" y1="92" x2="112" y2="68" fill="none" />
        <rect x="88" y="48" width="24" height="24" rx="3" fill="#1a1e24" stroke="#4fc3f7" />
        <polygon points="100,36 108,48 92,48" />
        <circle cx="52" cy="24" r="8" fill="#1a1e24" />
        <circle cx="148" cy="24" r="8" fill="#1a1e24" />
        <circle cx="52" cy="96" r="8" fill="#1a1e24" />
        <circle cx="148" cy="96" r="8" fill="#1a1e24" />
        <line x1="40" y1="24" x2="64" y2="24" fill="none" />
        <line x1="136" y1="24" x2="160" y2="24" fill="none" />
        <line x1="40" y1="96" x2="64" y2="96" fill="none" />
        <line x1="136" y1="96" x2="160" y2="96" fill="none" />
      </g>
    </svg>
  );
}

export function Craft({
  roll,
  pitch,
  yaw,
  tarRoll,
  tarPitch,
  tarYaw,
  grounded,
  alt,
  altLabel,
  altClass,
  axis,
  live3d,
  status,
}: {
  roll: number;
  pitch: number;
  yaw: number;
  tarRoll: number;
  tarPitch: number;
  tarYaw: number;
  grounded: boolean;
  alt: number | null;
  altLabel: ReactNode;
  altClass: string;
  axis: Axis;
  live3d: boolean;
  status: string;
}) {
  const t = useT();
  const [ticker, setTicker] = useState("");
  const [overflow, setOverflow] = useState(0);
  const prevStatus = useRef<string | undefined>(undefined);
  const msgBox = useRef<HTMLDivElement>(null);
  const msgLine = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const next = status.trim();
    if (prevStatus.current === undefined) {
      prevStatus.current = next;
      return;
    }
    if (next === prevStatus.current) return;
    prevStatus.current = next;
    if (!next) return;
    setTicker(next);
    setOverflow(0);
    const hide = window.setTimeout(() => {
      setTicker("");
      setOverflow(0);
    }, MSG_MS);
    return () => window.clearTimeout(hide);
  }, [status]);
  useLayoutEffect(() => {
    const box = msgBox.current;
    const line = msgLine.current;
    if (!box || !line || !ticker) {
      setOverflow(0);
      return;
    }
    const extra = line.scrollWidth - box.clientWidth;
    setOverflow(extra > 2 ? extra : 0);
  }, [ticker]);
  const side = !live3d && (axis === "pitch" || axis === "d");
  const top = !live3d && axis === "yaw";
  const Body = side ? QuadSide : top ? QuadTop : Quad;
  const cap = grounded
    ? t("On the ground")
    : live3d
      ? "3D"
      : axis === "d"
        ? t("side view · height")
        : side
          ? t("side view")
          : top
            ? t("top view")
            : t("rear view");
  return (
    <div className={grounded ? "craft grounded" : top ? "craft top" : "craft"}>
      <span className="cap">{cap}</span>
      <div className="alt-read">
        <b>
          {alt == null || Number.isNaN(alt) ? "—" : alt.toFixed(1)}
          <em>{t("m")}</em>
        </b>
        <span className={altClass}>{altLabel}</span>
      </div>
      <div className="craft-bg">
        <svg viewBox="0 0 200 120" aria-hidden="true">
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={grounded ? "#4a2218" : "#173044"} />
              <stop offset="100%" stopColor={grounded ? "#5c3820" : "#1e3a4a"} />
            </linearGradient>
            <linearGradient id="gnd" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={grounded ? "#6b4a1e" : "#2a3326"} />
              <stop offset="100%" stopColor={grounded ? "#2a2014" : "#1b2018"} />
            </linearGradient>
          </defs>
          {top ? (
            <>
              <rect width="200" height="120" fill="#1b2018" />
              <line x1="100" y1="8" x2="100" y2="112" stroke="#2a3326" strokeWidth="1" />
              <line x1="8" y1="60" x2="192" y2="60" stroke="#2a3326" strokeWidth="1" />
              <text x="100" y="18" textAnchor="middle" fill="#6b7884" fontSize="9">N</text>
            </>
          ) : (
            <>
              <rect width="200" height="60" fill="url(#sky)" />
              <rect y="60" width="200" height="60" fill="url(#gnd)" />
              <line
                x1="6"
                y1="60"
                x2="194"
                y2="60"
                stroke={grounded ? "#ffb74d" : "#8b98a8"}
                strokeWidth={grounded ? 2 : 1}
                strokeDasharray={grounded ? undefined : "5 4"}
              />
            </>
          )}
        </svg>
      </div>
      <div className="craft-stage">
        <div className="att tar" style={{ transform: pose(tarRoll, tarPitch, tarYaw, live3d, axis) }}>
          <Body kind="tar" />
        </div>
        <div className="att act" style={{ transform: pose(roll, pitch, yaw, live3d, axis) }}>
          <Body kind="act" />
        </div>
      </div>
      {ticker ? (
        <div
          ref={msgBox}
          className={["craft-msg", msgTone(ticker), overflow ? "scroll" : ""].filter(Boolean).join(" ")}
          title={ticker}
        >
          <span
            ref={msgLine}
            key={ticker}
            style={overflow ? { ["--shift" as string]: `-${overflow}px` } : undefined}
          >
            {SEV.test(ticker) ? ticker.replace(SEV, "") : ticker}
          </span>
        </div>
      ) : null}
    </div>
  );
}
