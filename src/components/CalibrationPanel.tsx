import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { send as sendCmd } from "../mav/cmd";
import { APP_HTTP } from "../mav/link";
import { getLatest, subscribe } from "../mav/store";
import { paramNum, type WizardClose } from "../wizards/close";
import { Icon, Toggle } from "./MotorSetup";
import { FACES, FaceArt, FaceStrip, HoldRing, SensorWizard } from "./SensorWizard";

const ACCEL_SUCCESS = 16777215;
const ACCEL_FAILED = 16777216;
// At rest SCALED_IMU is specific force, opposite gravity. Level reads about (0, 0, −1 g).
const FACE_ACCEL: [number, number, number][] = [
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
  [-1, 0, 0],
  [1, 0, 0],
  [0, 0, 1],
];
/** Seconds the asked face must be held still before it is taken. */
const HOLD = 1;

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

type Phase = "ready" | "gyro" | "faces" | "done" | "fail";

/** IMUs with an id, and their offsets as stored now. */
function imuOffsets(params: Record<string, number> | undefined): { n: number; ofs: number[] }[] {
  return [1, 2, 3].flatMap((n) => {
    const base = n === 1 ? "INS_ACC" : `INS_ACC${n}`;
    if (!paramNum(params, `${base}_ID`)) return [];
    const ofs = ["X", "Y", "Z"].map((a) => paramNum(params, `${base}OFFS_${a}`));
    return ofs.every((v) => v != null) ? [{ n, ofs: ofs as number[] }] : [];
  });
}

function accelClose(phase: Phase, rebooted: boolean): WizardClose {
  const params = getLatest().params;
  return {
    outcome: phase === "done" ? "completed" : phase === "fail" ? "failed" : "cancelled",
    measures: {
      phase,
      rebooted: rebooted ? 1 : 0,
      INS_ACCOFFS_X: paramNum(params, "INS_ACCOFFS_X"),
      INS_ACCOFFS_Y: paramNum(params, "INS_ACCOFFS_Y"),
      INS_ACCOFFS_Z: paramNum(params, "INS_ACCOFFS_Z"),
      INS_ACCSCAL_X: paramNum(params, "INS_ACCSCAL_X"),
      INS_ACCSCAL_Y: paramNum(params, "INS_ACCSCAL_Y"),
      INS_ACCSCAL_Z: paramNum(params, "INS_ACCSCAL_Z"),
    },
  };
}

const TABLE_ICON = (
  <svg width={44} height={44} viewBox="0 0 44 44" fill="none" aria-hidden="true">
    <rect x="6" y="30" width="32" height="4" rx="2" fill="#3a4552" />
    <rect x="14" y="20" width="16" height="8" rx="3" fill="#2a3140" />
    <path d="M10 26h6M28 26h6" stroke="#3a4552" strokeWidth="3" strokeLinecap="round" />
    <path d="M8 14h28" stroke="var(--cyan)" strokeWidth="2" strokeDasharray="3 3" />
  </svg>
);

/**
 * Six-side accelerometer calibration. ArduPilot measures the gyros, then asks for each face in its order
 * (`accel_cal.pos`); a face is confirmed by itself once the vehicle has rested in it for a second.
 */
export function AccelWizard({ ready, onClose, fromAssistant }: { ready: boolean; onClose: (report?: WizardClose) => void; fromAssistant?: boolean }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const [phase, setPhase] = useState<Phase>("ready");
  const [props, setProps] = useState(false);
  const [flat, setFlat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sentFor, setSentFor] = useState(0);
  const [held, setHeld] = useState(0);
  const bag = useRef({ seen: -1, lastT: 0, held: 0, sawFace: false });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const pos = sample.accel_cal?.pos ?? 0;
  const accel = accelNow();
  const asked = pos >= 1 && pos <= 6;
  const matched = (faceDot(pos, accel) ?? 0) > 0.85;
  const sensed = sensedFace(accel);
  const taken = asked && sentFor === pos;
  const imus = imuOffsets(sample.params);
  const craft = sample.frame === "plane" ? "plane" : "copter";

  function leave(rebooted = false) {
    onClose(accelClose(phaseRef.current, rebooted));
  }

  // Follow the board: the first face ends the gyro wait; success or failure ends the faces.
  useEffect(() => {
    if (phase === "gyro" && asked) setPhase("faces");
    if (phase !== "faces" && phase !== "gyro") return;
    if (asked) bag.current.sawFace = true;
    if (!bag.current.sawFace) return;
    if (pos === ACCEL_SUCCESS) setPhase("done");
    if (pos === ACCEL_FAILED) setPhase("fail");
  }, [phase, pos, asked]);

  // The asked face, still, for HOLD seconds: then it is sent once.
  useEffect(() => {
    if (phase !== "faces" || !asked || taken || busy || bag.current.seen === sample.t) return;
    const b = bag.current;
    const dt = b.lastT > 0 ? Math.min(0.4, Math.max(0, sample.t - b.lastT)) : 0;
    b.seen = sample.t;
    b.lastT = sample.t;
    if (!matched || !accel?.still || dt <= 0) {
      b.held = 0;
      setHeld(0);
      return;
    }
    b.held += dt;
    setHeld(Math.min(1, b.held / HOLD));
    if (b.held >= HOLD) {
      b.held = 0;
      void send("pose", pos);
    }
  });

  async function send(action: "start" | "pose", face = 0) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${APP_HTTP}/accel-cal?action=${action}`, { method: "POST" });
      const result = (await response.json()) as { message?: string };
      const text = result.message || "Could not send calibration command";
      if (action === "start" && text === "Accelerometer calibration started") {
        bag.current = { seen: -1, lastT: 0, held: 0, sawFace: false };
        setSentFor(0);
        setPhase("gyro");
      } else if (action === "pose" && text === "Face accepted") {
        setSentFor(face);
      } else {
        setMessage(text);
      }
    } catch {
      setMessage("Connection lost during calibration");
    } finally {
      setBusy(false);
    }
  }

  function again() {
    bag.current = { seen: -1, lastT: 0, held: 0, sawFace: false };
    setSentFor(0);
    setMessage("");
    setPhase("ready");
  }

  const step = phase === "ready" ? 0 : phase === "done" ? 2 : 1;
  const running = phase === "gyro" || phase === "faces";
  const blocker = running ? (!sample.ok ? "lost" : sample.armed ? "armed" : null) : null;

  let left = <FaceArt i={0} craft={craft} />;
  let body;
  let footer = (
    <>
      <button type="button" className="mw-btn text" onClick={() => leave()}>{t("Cancel")}</button>
      <span />
    </>
  );
  if (phase === "ready") {
    left = (
      <div className="mw-safety">
        <Toggle on={props} icon={Icon.propOff} label={t("Propellers off")} sub={t("On every motor")} onToggle={() => setProps(!props)} />
        <Toggle on={flat} icon={TABLE_ICON} label={t("Flat surface")} sub={t("A table, with room to turn it over")} onToggle={() => setFlat(!flat)} />
      </div>
    );
    body = (
      <>
        <div className="mw-headline"><h3>{t("Teach the board which way is down")}</h3><p>{t("Six still poses, about a minute. Each one is taken by itself after a second.")}</p></div>
        <div className="mw-checks">
          <span className={sample.ok ? "ok" : "bad"}>{sample.ok ? Icon.check("var(--ok)", 12) : Icon.x("var(--hot)", 12)}{t(sample.ok ? "Connected" : "No link")}</span>
          <span className={sample.armed ? "bad" : "ok"}>{sample.armed ? Icon.x("var(--hot)", 12) : Icon.check("var(--ok)", 12)}{t(sample.armed ? "Armed" : "Disarmed")}</span>
          {imus.length ? <span className="ok">{Icon.check("var(--ok)", 12)}{imus.length === 1 ? t("1 IMU") : t("{n} IMUs", { n: imus.length })}</span> : null}
        </div>
        <FaceStrip done={0} on={null} />
        <span className="mw-dim mw-sm">{t("Do this once per board, and again after the board is moved or remounted.")}</span>
      </>
    );
    footer = (
      <>
        <span />
        <button type="button" className="mw-btn primary" disabled={!props || !flat || !ready || busy} onClick={() => void send("start")}>
          <span>{busy ? t("Starting…") : t("Start")}</span>{Icon.chevR()}
        </button>
      </>
    );
  } else if (phase === "gyro") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Keep it still")}</h3><p>{t("The gyroscopes are measured first, with the vehicle level.")}</p></div>
        <HoldRing pct={null} label={t("Measuring…")} tone="cyan" />
        <FaceStrip done={0} on={0} />
      </>
    );
  } else if (phase === "faces" && asked) {
    const face = FACES[pos - 1];
    left = <FaceArt i={pos - 1} craft={craft} />;
    const line = taken
      ? { tone: "ok", text: t("Taken. Waiting for the next face…") }
      : !accel
        ? { tone: "warn", text: t("No accelerometer frame yet.") }
        : matched
          ? { tone: accel.still ? "ok" : "warn", text: accel.still ? t("This is the face. Hold it still.") : t("This is the face. Let it rest.") }
          : sensed
            ? { tone: "warn", text: t("It is on “{now}” now. Turn it to “{want}”.", { now: t(FACES[sensed - 1].name), want: t(face.name) }) }
            : { tone: "warn", text: t("It is between faces.") };
    body = (
      <>
        <div className="mw-headline"><h3>{t(face.name)}</h3><p>{t(face.ask[craft], { n: pos })}</p></div>
        <div className={`mw-note ${line.tone}`}><i className="sw-dot" /><span>{line.text}</span></div>
        {matched && accel?.still && !taken ? <HoldRing pct={held * 100} label={t("Taking it…")} /> : null}
        <FaceStrip done={pos - 1} on={pos - 1} />
      </>
    );
  } else if (phase === "faces") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Checking the fit")}</h3><p>{t("The board is working out the offsets.")}</p></div>
        <HoldRing pct={null} label={t("Fitting…")} tone="cyan" />
        <FaceStrip done={6} on={null} />
      </>
    );
  } else if (phase === "done") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Calibrated")}</h3><p>{t("ArduPilot uses the new values after a reboot.")}</p></div>
        {imus.length ? (
          <div className="mw-sums">
            {imus.map((imu) => (
              <div key={imu.n} className="mw-sum">
                <span className="mw-dim mw-sm">{t("IMU {n} offsets", { n: imu.n })}</span>
                <b>{imu.ofs.map((v) => v.toFixed(2)).join(", ")}</b>
                <span className="mw-dim mw-sm">m/s²</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mw-note warn">{Icon.warn()}<span>{t("Reboot the board to use the new calibration.")}</span></div>
      </>
    );
    footer = (
      <>
        <span />
        <div className="mw-row">
          <button type="button" className="mw-btn text" onClick={() => leave()}>{t("Finish")}</button>
          <button type="button" className="mw-btn warn-solid" disabled={!sample.ok || sample.armed} onClick={() => { sendCmd({ op: "reboot" }); leave(true); }}>
            {Icon.power()}<span>{t("Reboot & finish")}</span>
          </button>
        </div>
      </>
    );
  } else {
    left = <FaceArt i={Math.max(0, Math.min(5, (sentFor || 1) - 1))} craft={craft} faded />;
    body = (
      <>
        <div className="mw-headline"><h3>{t("Calibration failed")}</h3><p>{t("The board rejected the fit.")}</p></div>
        <div className="sw-fail"><b>{t("Usually the vehicle moved during a face, or two faces were the same.")}</b><p>{t("Start again. Let each face rest on the table before it is taken.")}</p></div>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={() => leave()}>{t("Close")}</button>
        <button type="button" className="mw-btn primary" onClick={again}>{t("Measure again")}</button>
      </>
    );
  }

  return (
    <SensorWizard
      title={t("Accelerometer calibration")}
      fromAssistant={fromAssistant}
      steps={[t("Ready"), t("Six sides"), t("Done")]}
      step={step}
      left={left}
      body={<>{body}{message ? <div className="mw-note warn">{Icon.warn()}<span>{t(message)}</span></div> : null}</>}
      footer={footer}
      blocker={blocker}
      busy={busy}
      onClose={() => leave()}
    />
  );
}
