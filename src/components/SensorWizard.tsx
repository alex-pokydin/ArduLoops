import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { Icon } from "./MotorSetup";

/**
 * The motor wizard's dialog (title, numbered steps, picture left, instruction right, footer) for the
 * accelerometer wizards. `blocker` covers the body while the link is lost or the vehicle is armed.
 */
export function SensorWizard({
  title,
  fromAssistant,
  steps,
  step,
  left,
  body,
  footer,
  blocker,
  busy,
  onClose,
}: {
  title: string;
  fromAssistant?: boolean;
  steps: string[];
  step: number;
  left: ReactNode;
  body: ReactNode;
  footer: ReactNode;
  blocker?: "lost" | "armed" | null;
  busy?: boolean;
  onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return createPortal(
    <div className="modal-back" role="presentation">
      <div className="modal mw" role="dialog" aria-modal="true" aria-labelledby="sw-title">
        <div className="mw-head">
          <div className="mw-row">
            <h2 id="sw-title">{title}</h2>
            {fromAssistant ? <span className="mw-tag">{t("From assistant")}</span> : null}
          </div>
          <button type="button" className="mw-icon" disabled={busy} onClick={onClose} aria-label={t("Close")} title={t("Close")}>{Icon.x()}</button>
        </div>
        <ol className="mw-steps" aria-label={t("Steps")}>
          {steps.map((name, i) => (
            <li key={name} className={i < step ? "done" : i === step ? "on" : ""} aria-current={i === step ? "step" : undefined}>
              <span className="mw-step-dot">{i < step ? Icon.check("#101214", 11) : i + 1}</span>
              <span className="mw-step-name">{name}</span>
            </li>
          ))}
        </ol>
        <div className="mw-body">
          <div className="mw-left">{left}</div>
          <div className="mw-right">{body}</div>
          {blocker ? (
            <div className="mw-over" role="alert">
              <div className="mw-blocker">
                <span className="mw-blocker-ic">{blocker === "armed" ? Icon.lock : Icon.unplug}</span>
                <b>{blocker === "armed" ? t("Vehicle is armed") : t("Connection lost")}</b>
                <span>{blocker === "armed" ? t("Calibration is off while armed. Disarm to continue.") : t("The board stopped the calibration. Start again when it is back.")}</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="mw-foot">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

export type Craft = "copter" | "plane";

/** The six faces ArduPilot asks for, in its order (ACCELCAL_VEHICLE_POS 1–6). The hint and view caption follow the vehicle. */
export const FACES = [
  { name: "Level", ask: { copter: "Face {n} of 6. On its legs, on a flat surface.", plane: "Face {n} of 6. Level, on its wheels or belly." }, view: { copter: "", plane: "" } },
  { name: "Left side", ask: { copter: "Face {n} of 6. Roll it onto the left arm and let it rest.", plane: "Face {n} of 6. Stand it on the left wingtip; hold it if it will not stand." }, view: { copter: "Seen from behind", plane: "Seen from behind" } },
  { name: "Right side", ask: { copter: "Face {n} of 6. Roll it onto the right arm and let it rest.", plane: "Face {n} of 6. Stand it on the right wingtip; hold it if it will not stand." }, view: { copter: "Seen from behind", plane: "Seen from behind" } },
  { name: "Nose down", ask: { copter: "Face {n} of 6. Stand it on its nose; hold it if it will not stand.", plane: "Face {n} of 6. Stand it on its nose; hold it." }, view: { copter: "Seen from above; the arrow is the nose", plane: "Seen from above; the arrow is the nose" } },
  { name: "Nose up", ask: { copter: "Face {n} of 6. Stand it on its tail; hold it if it will not stand.", plane: "Face {n} of 6. Stand it on its tail; hold it." }, view: { copter: "Seen from above; the arrow is the nose", plane: "Seen from above; the arrow is the nose" } },
  { name: "On its back", ask: { copter: "Face {n} of 6. Turn it upside down onto its back.", plane: "Face {n} of 6. Upside down, on top of the wing." }, view: { copter: "", plane: "" } },
] as const;

/**
 * Side view in the motor diagram's style: battery on the body, arm, a motor bell with its shaft at each end, and
 * skids; no propellers (they are off for these wizards). The nose is the cyan triangle past the front motor.
 * Top of the battery at y −22, feet at y 26.
 */
function Side({ nose = true }: { nose?: boolean }) {
  return (
    <>
      <path d="M-16 8L-26 26M-38 26H-16M16 8L26 26M16 26H38" className="sw-leg" />
      <line x1="-58" y1="0" x2="58" y2="0" className="sw-arm" />
      <rect x="-26" y="-10" width="52" height="18" rx="5" className="sw-body" />
      <rect x="-18" y="-22" width="36" height="12" rx="4" className="sw-top" />
      {[-58, 58].map((x) => (
        <g key={x}>
          <line x1={x} y1="-15" x2={x} y2="-21" className="sw-shaft" />
          <rect x={x - 9} y="-15" width="18" height="12" rx="3" className="sw-motor" />
        </g>
      ))}
      {nose ? <path d="M74 -7l12 7-12 7z" className="sw-nose" /> : null}
    </>
  );
}

/** Top view of a quad X, as the motor diagram draws it, with the cyan nose triangle. */
function Top() {
  const motors = [45, 135, 225, 315].map((a) => {
    const r = (a * Math.PI) / 180;
    return { x: Math.sin(r) * 48, y: -Math.cos(r) * 48 };
  });
  return (
    <>
      {motors.map((m) => <line key={`a${m.x}${m.y}`} x1="0" y1="0" x2={m.x} y2={m.y} className="sw-arm" />)}
      <rect x="-15" y="-21" width="30" height="42" rx="8" className="sw-body" />
      {motors.map((m) => <circle key={`m${m.x}${m.y}`} cx={m.x} cy={m.y} r="13" className="sw-motor" />)}
      <path d="M0 -66l8 11h-16z" className="sw-nose" />
    </>
  );
}

/**
 * Plane side view, nose to the right: fuselage, high wing in section, fin and tailplane, a spinner, tricycle gear.
 * No propeller. Top of the fin at y −24, wheels at y 26.
 */
function PlaneSide({ nose = true }: { nose?: boolean }) {
  return (
    <>
      <path d="M10 6L14 22M52 5V22" className="sw-leg" />
      <circle cx="14" cy="22" r="4" className="sw-motor" />
      <circle cx="52" cy="22" r="3.5" className="sw-motor" />
      <path d="M-72 -5L-64 -24H-54L-50 -4Z" className="sw-top" />
      <path d="M58 -1C58 -8 48 -9 38 -9L-50 -5L-74 -4L-74 2L-50 4L38 7C48 7 58 5 58 -1Z" className="sw-body" />
      <rect x="-78" y="-4" width="26" height="4" rx="2" className="sw-top" />
      <rect x="-8" y="-15" width="40" height="6" rx="3" className="sw-top" />
      <path d="M58 -6L66 -1L58 4Z" className="sw-motor" />
      {nose ? <path d="M71 -6l10 5-10 5z" className="sw-nose" /> : null}
    </>
  );
}

/** Plane seen from behind: the wing edge-on across, the fuselage, the fin up, the tailplane, two main wheels. Span ±70. */
function PlaneBehind() {
  return (
    <>
      <path d="M-8 6L-14 22M8 6L14 22" className="sw-leg" />
      <circle cx="-14" cy="22" r="4" className="sw-motor" />
      <circle cx="14" cy="22" r="4" className="sw-motor" />
      <rect x="-70" y="-14" width="140" height="6" rx="3" className="sw-top" />
      <path d="M-2 -6L-3 -30H3L2 -6Z" className="sw-top" />
      <rect x="-24" y="-8" width="48" height="4" rx="2" className="sw-top" />
      <circle cx="0" cy="0" r="9" className="sw-body" />
    </>
  );
}

/** Plane from above: wing, fuselage, tailplane, the cyan nose triangle past the spinner. */
function PlaneTop() {
  return (
    <>
      <rect x="-70" y="-14" width="140" height="18" rx="5" className="sw-top" />
      <rect x="-24" y="30" width="48" height="8" rx="3" className="sw-top" />
      <rect x="-7" y="-44" width="14" height="86" rx="7" className="sw-body" />
      <path d="M-5 -44L0 -51L5 -44Z" className="sw-motor" />
      <path d="M0 -66l8 11h-16z" className="sw-nose" />
    </>
  );
}

const FACE_ART: Record<Craft, ReactNode[]> = {
  copter: [
    <g key={0} transform="translate(120 126)"><Side /></g>,
    <g key={1} transform="translate(120 84) rotate(-90)"><Side nose={false} /></g>,
    <g key={2} transform="translate(120 84) rotate(90)"><Side nose={false} /></g>,
    <g key={3} transform="translate(120 86) rotate(180)"><Top /></g>,
    <g key={4} transform="translate(120 100)"><Top /></g>,
    <g key={5} transform="translate(120 130) rotate(180)"><Side /></g>,
  ],
  plane: [
    <g key={0} transform="translate(120 126)"><PlaneSide /></g>,
    <g key={1} transform="translate(120 82) rotate(-90)"><PlaneBehind /></g>,
    <g key={2} transform="translate(120 82) rotate(90)"><PlaneBehind /></g>,
    <g key={3} transform="translate(120 86) rotate(180)"><PlaneTop /></g>,
    <g key={4} transform="translate(120 106)"><PlaneTop /></g>,
    <g key={5} transform="translate(120 128) rotate(180)"><PlaneSide /></g>,
  ],
};

/** Face `i` (0–5) as it must rest on the table, drawn as the vehicle that is linked. */
export function FaceArt({ i, craft = "copter", faded = false }: { i: number; craft?: Craft; faded?: boolean }) {
  const t = useT();
  const view = FACES[i]?.view[craft] ?? "";
  return (
    <div className={`sw-art${faded ? " faded" : ""}`}>
      <svg viewBox="0 0 240 170" aria-hidden="true">
        <line x1="20" y1="152" x2="220" y2="152" className="sw-table" />
        {FACE_ART[craft][i] ?? FACE_ART[craft][0]}
      </svg>
      {view ? <span>{t(view)}</span> : null}
    </div>
  );
}

/** Side view on a table, tilted nose down `tilt` degrees about the front wheel or leg; `ghost` keeps the level outline. */
export function PoseArt({ tilt, craft = "copter", ghost = false }: { tilt: number; craft?: Craft; ghost?: boolean }) {
  const Body = craft === "plane" ? PlaneSide : Side;
  const pivot = craft === "plane" ? 172 : 156;
  return (
    <div className="sw-art">
      <svg viewBox="0 0 240 132" aria-hidden="true">
        <line x1="20" y1="116" x2="220" y2="116" className="sw-table" />
        {ghost ? <g transform="translate(120 90)" className="sw-ghost"><Body nose={false} /></g> : null}
        <g transform={`rotate(${Math.max(0, Math.min(60, tilt))} ${pivot} 116)`}><g transform="translate(120 90)"><Body /></g></g>
      </svg>
    </div>
  );
}

/** The board's slab per face, small, for the strip. */
function Slab({ i }: { i: number }) {
  const turn = ["", "rotate(-90 14 10)", "rotate(90 14 10)", "", "", "rotate(180 14 10)"][i];
  return (
    <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden="true">
      <g transform={turn} className="sw-slab">
        {i === 3 || i === 4 ? <rect x="10" y="3" width="8" height="14" rx="2" /> : <rect x="3" y="8" width="22" height="5" rx="2" />}
      </g>
      {i === 3 ? <path d="M14 19l-3-3h6z" className="sw-nose" /> : i === 4 ? <path d="M14 1l-3 3h6z" className="sw-nose" /> : null}
    </svg>
  );
}

/** All six faces: done ones green, the asked one cyan. */
export function FaceStrip({ done, on }: { done: number; on: number | null }) {
  const t = useT();
  return (
    <div className="sw-strip">
      {FACES.map((f, i) => (
        <div key={f.name} className={`sw-face${i < done ? " done" : i === on ? " on" : ""}`}>
          <Slab i={i} />
          <span>{i < done ? Icon.check("var(--ok)", 11) : null}{t(f.name)}</span>
        </div>
      ))}
    </div>
  );
}

/** A ring that fills while a pose is held still; `pct` null spins for an unknown wait. */
export function HoldRing({ pct, label, tone = "ok" }: { pct: number | null; label: string; tone?: "ok" | "cyan" }) {
  const r = 26;
  const len = 2 * Math.PI * r;
  return (
    <div className={`sw-hold ${tone}`}>
      <svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true" className={pct == null ? "spin" : ""}>
        <circle cx="32" cy="32" r={r} className="sw-hold-track" />
        <circle cx="32" cy="32" r={r} className="sw-hold-fill" strokeDasharray={`${(len * (pct ?? 30)) / 100} ${len}`} transform="rotate(-90 32 32)" />
      </svg>
      <span>{label}</span>
    </div>
  );
}

/** Tilt from 0 to 60°, the usable zone from `min` shaded, the needle at `deg`. */
export function TiltGauge({ deg, min }: { deg: number; min: number }) {
  const t = useT();
  const at = (d: number) => {
    const a = Math.PI - (Math.max(0, Math.min(60, d)) / 60) * Math.PI;
    return [70 + Math.cos(a) * 54, 66 - Math.sin(a) * 54];
  };
  const [zx, zy] = at(min);
  const [nx, ny] = at(deg);
  const ok = deg >= min;
  return (
    <div className="sw-gauge">
      <svg width="140" height="74" viewBox="0 0 140 74" aria-hidden="true">
        <path d="M16 66 A54 54 0 0 1 124 66" className="sw-gauge-track" />
        <path d={`M${zx} ${zy} A54 54 0 0 1 124 66`} className="sw-gauge-zone" />
        <line x1="70" y1="66" x2={nx} y2={ny} className={`sw-gauge-needle${ok ? " ok" : ""}`} />
        <circle cx="70" cy="66" r="4" className={`sw-gauge-hub${ok ? " ok" : ""}`} />
      </svg>
      <b className={ok ? "ok" : ""}>{Math.round(deg)}°</b>
      <span>{t("{n}° or more", { n: min })}</span>
    </div>
  );
}

/** A board seen from above, turned by its yaw mount, with the vehicle's nose arrow above it. */
export function BoardTop({ yaw, tone, label, value }: { yaw: number; tone: "dim" | "warn" | "ok"; label: string; value: string }) {
  return (
    <div className={`sw-board ${tone}`}>
      <svg width="88" height="88" viewBox="0 0 96 96" aria-hidden="true">
        <g transform={`rotate(${yaw} 48 48)`}>
          <rect x="22" y="22" width="52" height="52" rx="8" className="sw-board-rect" />
          <path d="M48 30l7 12H41z" className="sw-board-arrow" />
        </g>
        <path d="M48 4l5 8h-10z" className="sw-nose" />
      </svg>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
