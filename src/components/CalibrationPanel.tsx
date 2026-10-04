import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { APP_HTTP } from "../mav/link";
import { getLatest, getSnapshot, subscribe } from "../mav/store";
import { paramNum, type WizardClose } from "../wizards/close";
import { useStorePicked } from "../mav/view";

type Kind = "level" | "gyro" | "baro" | "accel";

const STEPS: { id: Kind; label: string; title: string; ask: string }[] = [
  { id: "level", label: "Level", title: "Calibrate level", ask: "Place the motor plane level in both axes. Keep the vehicle still. This updates the level reference, not the full accelerometer calibration." },
  { id: "gyro", label: "Gyro", title: "Calibrate gyroscope", ask: "Keep the vehicle completely still until calibration finishes." },
  { id: "baro", label: "Barometer", title: "Calibrate barometer", ask: "Set the vehicle level and keep it still. This stores the ground pressure." },
  { id: "accel", label: "Accel", title: "Calibrate accelerometer", ask: "Six faces find the accelerometer offsets. Level only stores which way is up." },
];

function Pose({ kind, roll }: { kind: Kind; roll: number }) {
  const tilt = Math.max(-16, Math.min(16, roll));
  return (
    <svg className="sense-art" viewBox="0 0 160 120" aria-hidden="true">
      <line x1="16" y1="96" x2="144" y2="96" stroke="currentColor" strokeOpacity="0.35" />
      <g transform={`rotate(${tilt} 80 78)`}>
        <rect x="58" y="62" width="44" height="28" rx="6" fill="none" stroke="currentColor" />
        <circle cx="62" cy="66" r="5" fill="none" stroke="currentColor" />
        <circle cx="98" cy="66" r="5" fill="none" stroke="currentColor" />
        <circle cx="62" cy="86" r="5" fill="none" stroke="currentColor" />
        <circle cx="98" cy="86" r="5" fill="none" stroke="currentColor" />
        {kind === "level" ? <polygon points="80,66 84,74 76,74" fill="currentColor" /> : null}
        {kind === "gyro" ? <circle cx="80" cy="76" r="8" fill="none" stroke="currentColor" /> : null}
        {kind === "baro" ? <rect x="108" y="58" width="6" height="28" fill="currentColor" opacity="0.7" /> : null}
        {kind === "accel" ? <rect x="70" y="70" width="20" height="14" fill="currentColor" opacity="0.35" /> : null}
      </g>
      {kind === "accel" ? (
        <g fill="none" stroke="currentColor">
          {[0, 1, 2, 3, 4, 5].map((face) => (
            <rect key={face} x={28 + face * 18} y="8" width="12" height="12" fill="currentColor" opacity="0.8" />
          ))}
        </g>
      ) : null}
    </svg>
  );
}

type PoseSnap = { roll: number; pitch: number; moving: boolean; ready: boolean };
let poseSnap: PoseSnap = { roll: 0, pitch: 0, moving: false, ready: false };

function getPose(): PoseSnap {
  const s = getSnapshot();
  const roll = Number.isFinite(s.roll) ? Math.round(s.roll * 10) / 10 : 0;
  const pitch = Number.isFinite(s.pitch) ? Math.round(s.pitch * 10) / 10 : 0;
  const moving = Math.hypot(s.rate, s.pitch_rate) > 2;
  const fresh = typeof s.heartbeat_at === "number" && Date.now() / 1000 - s.heartbeat_at < 3;
  const ready = s.ok && !s.armed && fresh;
  if (poseSnap.roll === roll && poseSnap.pitch === pitch && poseSnap.moving === moving && poseSnap.ready === ready) return poseSnap;
  poseSnap = { roll, pitch, moving, ready };
  return poseSnap;
}

function SenseArt({ kind, ready }: { kind: Kind; ready: boolean }) {
  const pose = useSyncExternalStore(subscribe, getPose, getPose);
  return <Pose kind={kind} roll={ready ? pose.roll : 0} />;
}

function SenseRead({ kind }: { kind: Kind }) {
  const t = useT();
  const pose = useSyncExternalStore(subscribe, getPose, getPose);
  return (
    <>
      <p className="sense-read">{t("Roll {roll}° · pitch {pitch}°", { roll: pose.roll.toFixed(1), pitch: pose.pitch.toFixed(1) })}</p>
      {kind === "gyro" ? <p className={pose.moving ? "sense-read warn" : "sense-read"}>{pose.moving ? t("The board is moving.") : t("The board is still.")}</p> : null}
    </>
  );
}

export function CalibrationPanel() {
  const t = useT();
  const ready = useStorePicked((s) => {
    const fresh = typeof s.heartbeat_at === "number" && Date.now() / 1000 - s.heartbeat_at < 3;
    return s.ok && !s.armed && fresh;
  });
  const [kind, setKind] = useState<Kind | null>(null);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function start() {
    if (!ready || busy || !kind) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${APP_HTTP}/calibrate?kind=${kind}`, { method: "POST" });
      const result = await response.json();
      setMessage(result.message);
    } catch { setMessage("Connection lost during calibration"); }
    finally { setBusy(false); setKind(null); }
  }
  const selected = STEPS.find((step) => step.id === kind);
  const shown = kind ?? "level";
  return (
    <div className="sense">
      <ol className="sense-how">
        <li><b>1</b>{t("Choose a sensor.")}</li>
        <li><b>2</b>{t("Set the vehicle like the picture. Propellers off.")}</li>
        <li><b>3</b>{t(shown === "accel"
          ? "The board asks for six faces. Hold each one still, then capture it."
          : "Start sends one calibration. The vehicle stays disarmed and still.")}</li>
      </ol>
      <div className="sense-stage">
        <SenseArt kind={shown} ready={ready} />
        <div className="sense-copy">
          <SenseRead kind={shown} />
          <p>{selected ? t(selected.ask) : t("Choose a sensor. The picture follows the board.")}</p>
          {selected ? <p>{t("Remove propellers and disarm before calibration.")}</p> : null}
          {!ready && !busy ? <p>{t("Calibration requires a fresh disarmed connection")}</p> : null}
          {message || busy ? <p role="status">{message ? t(message) : t("Calibrating…")}</p> : null}
          {selected ? (
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={kind === "accel" ? busy : !ready || busy} onClick={() => { if (kind === "accel") setFull(true); else void start(); }}>{busy ? t("Calibrating…") : t(kind === "accel" ? "Start accelerometer calibration" : "Start calibration")}</button>
              <button type="button" className="wiz-quiet" disabled={busy} onClick={() => { setKind(null); setMessage(""); }}>{t("Cancel")}</button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="sense-grid" role="listbox" aria-label={t("Calibration")}>
        {STEPS.map((step) => (
          <button
            key={step.id}
            type="button"
            role="option"
            aria-selected={kind === step.id}
            className={kind === step.id ? "sense-card on" : "sense-card"}
            disabled={busy}
            title={t(step.title)}
            onClick={() => { setKind(step.id); setMessage(""); }}
          >
            <Pose kind={step.id} roll={0} />
            <b>{t(step.label)}</b>
          </button>
        ))}
      </div>
      {full ? <AccelWizard ready={ready} onClose={() => setFull(false)} /> : null}
    </div>
  );
}

const ACCEL_SUCCESS = 16777215;
const ACCEL_FAILED = 16777216;
const FACES = ["Level face", "Left side", "Right side", "Nose down", "Nose up", "On its back"] as const;
const FACE_ASK = [
  "Place the board level, belly down.",
  "Place the board on its left side.",
  "Place the board on its right side.",
  "Place the board nose down.",
  "Place the board nose up.",
  "Place the board on its back.",
] as const;
// At rest SCALED_IMU is specific force, opposite gravity. Level reads about (0, 0, −1 g).
const FACE_ACCEL: [number, number, number][] = [
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
  [-1, 0, 0],
  [1, 0, 0],
  [0, 0, 1],
];
const FACE_NOW = [
  "The board is level now.",
  "The board is on its left side now.",
  "The board is on its right side now.",
  "The board is nose down now.",
  "The board is nose up now.",
  "The board is on its back now.",
] as const;

function accelNow(): { x: number; y: number; z: number; still: boolean } | null {
  const live = getLatest().live_nums;
  const x = live?.["SCALED_IMU.xacc"];
  const y = live?.["SCALED_IMU.yacc"];
  const z = live?.["SCALED_IMU.zacc"];
  const gx = live?.["SCALED_IMU.xgyro"];
  const gy = live?.["SCALED_IMU.ygyro"];
  const gz = live?.["SCALED_IMU.zgyro"];
  if (![x, y, z].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const still = [gx, gy, gz].every((value) => typeof value === "number" && Number.isFinite(value))
    && Math.hypot(gx as number, gy as number, gz as number) < 200;
  return { x: x as number, y: y as number, z: z as number, still };
}

function faceDot(pos: number, accel: { x: number; y: number; z: number } | null): number | null {
  const expected = FACE_ACCEL[pos - 1];
  if (!expected || !accel) return null;
  const length = Math.hypot(accel.x, accel.y, accel.z);
  if (length < 600 || length > 1600) return null;
  return (accel.x * expected[0] + accel.y * expected[1] + accel.z * expected[2]) / length;
}

function sensedFace(accel: { x: number; y: number; z: number } | null): number | null {
  let best = 0;
  let score = 0.85;
  for (let pos = 1; pos <= 6; pos += 1) {
    const dot = faceDot(pos, accel);
    if (dot != null && dot > score) {
      score = dot;
      best = pos;
    }
  }
  return best || null;
}

function TableLine() {
  return <line x1="24" y1="152" x2="216" y2="152" stroke="currentColor" strokeWidth="4" strokeOpacity="0.4" />;
}

function NoseArrow({ x, y, deg, length = 46 }: { x: number; y: number; deg: number; length?: number }) {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const tipX = x + dx * length;
  const tipY = y + dy * length;
  const back = 11;
  const wing = 6;
  return (
    <g fill="currentColor" stroke="currentColor">
      <line x1={x + dx * 18} y1={y + dy * 18} x2={tipX - dx * 6} y2={tipY - dy * 6} strokeWidth="3" />
      <polygon
        stroke="none"
        points={`${tipX},${tipY} ${tipX - dx * back - dy * wing},${tipY - dy * back + dx * wing} ${tipX - dx * back + dy * wing},${tipY - dy * back - dx * wing}`}
      />
    </g>
  );
}

function QuadX({ cx, cy, nose }: { cx: number; cy: number; nose: number }) {
  const arm = 56;
  const props = [45, 135, 225, 315].map((offset) => {
    const rad = ((nose + offset) * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    return { x: cx + dx * arm, y: cy + dy * arm, x0: cx + dx * 16, y0: cy + dy * 16 };
  });
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      {props.map((prop) => (
        <line key={`${prop.x}-${prop.y}`} x1={prop.x0} y1={prop.y0} x2={prop.x - (prop.x - cx) * 0.16} y2={prop.y - (prop.y - cy) * 0.16} />
      ))}
      {props.map((prop) => (
        <circle key={`${prop.x}:${prop.y}`} cx={prop.x} cy={prop.y} r="8" />
      ))}
      <circle cx={cx} cy={cy} r="15" />
      <NoseArrow x={cx} y={cy} deg={nose} />
    </g>
  );
}

function LevelCraft() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <line x1="-64" y1="0" x2="64" y2="0" />
      <circle cx="-64" cy="0" r="7" />
      <circle cx="64" cy="0" r="7" />
      <path d="M-16 0 A16 16 0 0 1 16 0" />
      <line x1="-36" y1="0" x2="-42" y2="36" />
      <line x1="-20" y1="0" x2="-26" y2="36" />
      <line x1="20" y1="0" x2="26" y2="36" />
      <line x1="36" y1="0" x2="42" y2="36" />
    </g>
  );
}

function FaceArt({ face }: { face: number }) {
  const side = face === 1 ? "translate(120 110)"
    : face === 2 ? "translate(110 75) rotate(-90)"
      : face === 3 ? "translate(130 75) rotate(90)"
        : face === 6 ? "translate(120 130) rotate(180)"
          : "";
  return (
    <svg className="accel-pose" viewBox="0 0 240 168" aria-hidden="true">
      <TableLine />
      {side ? (
        <g transform={side}>
          <LevelCraft />
        </g>
      ) : null}
      {face === 4 ? <QuadX cx={120} cy={96} nose={180} /> : null}
      {face === 5 ? <QuadX cx={120} cy={96} nose={0} /> : null}
    </svg>
  );
}

function accelClose(phase: "prepare" | "run" | "done" | "fail"): WizardClose {
  const params = getLatest().params;
  return {
    outcome: phase === "done" ? "completed" : phase === "fail" ? "failed" : "cancelled",
    measures: {
      phase,
      INS_ACCOFFS_X: paramNum(params, "INS_ACCOFFS_X"),
      INS_ACCOFFS_Y: paramNum(params, "INS_ACCOFFS_Y"),
      INS_ACCOFFS_Z: paramNum(params, "INS_ACCOFFS_Z"),
      INS_ACCSCAL_X: paramNum(params, "INS_ACCSCAL_X"),
      INS_ACCSCAL_Y: paramNum(params, "INS_ACCSCAL_Y"),
      INS_ACCSCAL_Z: paramNum(params, "INS_ACCSCAL_Z"),
    },
  };
}

export function AccelWizard({ ready, onClose }: { ready: boolean; onClose: (report?: WizardClose) => void }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const [phase, setPhase] = useState<"prepare" | "run" | "done" | "fail">("prepare");
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState(false);
  const [message, setMessage] = useState("");
  const sawFace = useRef(false);
  const pos = sample.accel_cal?.pos ?? 0;
  const accel = accelNow();
  const asked = pos >= 1 && pos <= 6;
  const matched = (faceDot(pos, accel) ?? 0) > 0.85;
  const sensed = sensedFace(accel);
  const step = phase === "done" || phase === "fail" ? 7 : phase === "prepare" ? 0 : asked ? pos : 0;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  function leave() {
    onClose(accelClose(phaseRef.current));
  }

  useEffect(() => { setHolding(false); }, [pos]);

  useEffect(() => {
    if (phase === "prepare" && asked) setPhase("run");
  }, [phase, asked]);

  useEffect(() => {
    if (phase !== "run") return;
    if (asked) sawFace.current = true;
    if (!sawFace.current) return;
    if (pos === ACCEL_SUCCESS) setPhase("done");
    if (pos === ACCEL_FAILED) setPhase("fail");
  }, [phase, pos, asked]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function send(action: "start" | "pose") {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${APP_HTTP}/accel-cal?action=${action}`, { method: "POST" });
      const result = await response.json() as { message?: string };
      const text = result.message || "Could not send calibration command";
      setMessage(text);
      if (action === "start" && text === "Accelerometer calibration started") {
        setHolding(false);
        setPhase("run");
      }
      if (action === "pose" && text === "Face accepted") setHolding(true);
    } catch {
      setMessage("Connection lost during calibration");
    } finally {
      setBusy(false);
    }
  }

  const names = ["Ready the vehicle", ...FACES, "Finished"] as const;
  return createPortal(
    <div className="modal-back" role="presentation">
      <div className="modal orient-wizard" role="dialog" aria-modal="true" aria-labelledby="accel-title">
        <div className="modal-head">
          <h2 id="accel-title">{t("Accelerometer calibration")}</h2>
          <button type="button" className="modal-x" disabled={busy} onClick={leave} aria-label={t("Close")} title={t("Close")}>×</button>
        </div>
        <ol className="orient-steps">
          {names.map((name, index) => (
            <li key={name} className={index === step ? "on" : index < step ? "done" : ""}>{t(name)}</li>
          ))}
        </ol>
        {phase === "prepare" ? (
          <>
            <p className="mag-line">{t("Propellers off. The board asks for six faces. Hold each one still, then capture it.")}</p>
            <p className="mag-line">{t("The gyroscope is calibrated first. Keep the board level and still.")}</p>
            {!ready && !busy ? <p className="mag-line warn">{t("Calibration requires a fresh disarmed connection")}</p> : null}
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={!ready || busy} onClick={() => void send("start")}>
                {busy ? t("Calibrating…") : t("Start accelerometer calibration")}
              </button>
            </div>
          </>
        ) : null}
        {phase === "run" ? (
          <>
            {asked ? (
              <>
                <FaceArt face={pos} />
                <p className="mag-line">{t(pos === 4 || pos === 5
                  ? "The arrow is the nose. Circles are the propellers. The line is the table."
                  : "Circles are the propellers. The line is the table.")}</p>
                <p className="mag-line">{t(FACE_ASK[pos - 1])}</p>
                <p className={holding ? "mag-line" : matched && accel?.still ? "mag-line fit-ok" : "mag-line fit-warn"}>{t(
                  holding
                    ? "Hold still. This face is being measured."
                    : !accel
                      ? "No accelerometer frame yet."
                      : matched && accel.still
                        ? "This is the asked face. Hold still, then capture it."
                        : matched
                          ? "This is the asked face. Hold it still."
                          : sensed
                            ? FACE_NOW[sensed - 1]
                            : "The board is between faces.",
                )}</p>
                <div className="wiz-apply">
                  <button
                    type="button"
                    className="wiz-go"
                    disabled={busy || holding || !matched || !accel?.still}
                    onClick={() => void send("pose")}
                  >
                    {busy ? t("Sending…") : t("Capture this face")}
                  </button>
                </div>
              </>
            ) : (
              <p className="mag-line">{t("The gyroscope is calibrated first. Keep the board level and still.")}</p>
            )}
          </>
        ) : null}
        {phase === "done" ? (
          <>
            <p className="mag-line fit-ok">{t("Accelerometer calibration succeeded.")}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-go" onClick={leave}>{t("Close")}</button>
            </div>
          </>
        ) : null}
        {phase === "fail" ? (
          <>
            <p className="mag-line fit-bad">{t("Accelerometer calibration failed.")}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-quiet" onClick={() => { sawFace.current = false; setPhase("prepare"); setMessage(""); setHolding(false); }}>{t("Measure again")}</button>
            </div>
          </>
        ) : null}
        {message || busy ? <p className="mag-line" role="status">{message ? t(message) : t("Sending…")}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
