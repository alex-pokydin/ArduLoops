import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { send as sendCmd } from "../mav/cmd";
import { APP_HTTP } from "../mav/link";
import { getLatest, subscribe } from "../mav/store";
import type { WizardClose } from "../wizards/close";

type Phase = "prepare" | "run" | "gas" | "result" | "done";

type Live = { throttle: number; current: number; interference: number; x: number; y: number; z: number };

function num(params: Record<string, number>, name: string): number | null {
  const value = params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function liveOf(nums: Record<string, number> | undefined): Live | null {
  if (!nums) return null;
  const interference = nums["COMPASSMOT_STATUS.interference"];
  const current = nums["COMPASSMOT_STATUS.current"];
  const throttle = nums["COMPASSMOT_STATUS.throttle"];
  if (![interference, current, throttle].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return {
    throttle: throttle / 10,
    current,
    interference,
    x: nums["COMPASSMOT_STATUS.CompensationX"] ?? 0,
    y: nums["COMPASSMOT_STATUS.CompensationY"] ?? 0,
    z: nums["COMPASSMOT_STATUS.CompensationZ"] ?? 0,
  };
}

function tone(interference: number): string {
  if (interference < 30) return "fit-ok";
  if (interference <= 60) return "fit-warn";
  return "fit-bad";
}

export function CompassMot({ onClose }: { onClose: (report?: WizardClose) => void }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const params = sample.params ?? {};
  const [phase, setPhase] = useState<Phase>("prepare");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [last, setLast] = useState<Live | null>(null);
  const monitor = num(params, "BATT_MONITOR");
  const hasCurrent = monitor != null && monitor !== 0;
  const map = num(params, "RCMAP_THROTTLE");
  const channel = map != null && map >= 1 ? map : 3;
  const pwm = sample.rc?.[channel - 1];
  const throttleUp = typeof pwm === "number" && pwm > 1100;
  const texts = sample.texts ?? [];
  const modeLine = texts.find((text) => /INFO Current$/.test(text) || /INFO Throttle$/.test(text));
  const mode = modeLine && /Current$/.test(modeLine) ? "current" : modeLine ? "throttle" : "";
  const step = phase === "prepare" ? 0 : phase === "run" ? 1 : phase === "gas" ? 2 : phase === "result" ? 3 : 4;
  const shown = last;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const lastRef = useRef(last);
  lastRef.current = last;

  function leave() {
    const now = phaseRef.current;
    const live = lastRef.current;
    const current = getLatest().params ?? {};
    onClose({
      outcome: now === "done" || now === "result" ? "completed" : "cancelled",
      measures: {
        phase: now,
        COMPASS_MOTCT: num(current, "COMPASS_MOTCT"),
        COMPASS_MOT_X: num(current, "COMPASS_MOT_X"),
        COMPASS_MOT_Y: num(current, "COMPASS_MOT_Y"),
        COMPASS_MOT_Z: num(current, "COMPASS_MOT_Z"),
        interference: live ? live.interference : null,
        throttle: live ? live.throttle : null,
        current: live ? live.current : null,
      },
    });
  }

  useEffect(() => {
    const next = liveOf(sample.live_nums);
    if (phase === "gas" && next) setLast(next);
  }, [phase, sample.live_nums]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy && phase !== "gas") leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose, phase]);

  async function post(action: "start" | "finish"): Promise<string> {
    const response = await fetch(`${APP_HTTP}/compass-mot?action=${action}`, { method: "POST" });
    const body = await response.json() as { message?: string };
    return body.message || "Could not send calibration command";
  }

  async function start() {
    if (busy || !sample.ok || sample.armed || !hasCurrent) return;
    setBusy(true);
    setMessage("");
    try {
      const text = await post("start");
      setMessage(text);
      if (text === "CompassMot started") setPhase("gas");
    } catch {
      setMessage("Connection lost during calibration");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const text = await post("finish");
      setMessage(text);
      if (text === "CompassMot finish sent") {
        for (const name of ["COMPASS_MOTCT", "COMPASS_MOT_X", "COMPASS_MOT_Y", "COMPASS_MOT_Z"]) {
          sendCmd({ op: "param_read", name });
        }
        setPhase("result");
      }
    } catch {
      setMessage("Connection lost during calibration");
    } finally {
      setBusy(false);
    }
  }

  const names = ["Ready the vehicle", "Start", "Throttle", "The result", "Finished"] as const;
  const mot = num(params, "COMPASS_MOTCT");
  const vector = ["COMPASS_MOT_X", "COMPASS_MOT_Y", "COMPASS_MOT_Z"].map((name) => num(params, name));
  return createPortal(
    <div className="modal-back" role="presentation">
      <div className="modal orient-wizard" role="dialog" aria-modal="true" aria-labelledby="mot-title">
        <div className="modal-head">
          <h2 id="mot-title">{t("Compensate for motor current")}</h2>
          <button type="button" className="modal-x" disabled={busy || phase === "gas"} onClick={leave} aria-label={t("Close")} title={t("Close")}>×</button>
        </div>
        <ol className="orient-steps">
          {names.map((name, index) => (
            <li key={name} className={index === step ? "on" : index < step ? "done" : ""}>{t(name)}</li>
          ))}
        </ol>
        {phase === "prepare" ? (
          <>
            <p className="mag-line">{t("Flip the propellers and move each one position around the frame, so thrust pushes the vehicle into the ground. Tape it down.")}</p>
            <p className="mag-line">{t("Transmitter on, throttle stick at zero, battery connected. The stick raises the motors, not a slider here.")}</p>
            <p className="mag-line">{t("Skip this if yaw comes from GPS on firmware older than 4.5.2.")}</p>
            {!hasCurrent ? <p className="mag-line warn">{t("No current monitor. CompassMot needs current. Throttle compensation is not the one to run.")}</p> : null}
            {throttleUp ? <p className="mag-line warn">{t("The throttle stick is not at zero.")}</p> : null}
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={!sample.ok} onClick={() => { setMessage(""); setPhase("run"); }}>{t("Next")}</button>
            </div>
          </>
        ) : null}
        {phase === "run" ? (
          <>
            <p className="mag-line">{t("Start arms the motors and passes the throttle stick through. The ESCs beep. Old compensation is cleared for the run.")}</p>
            {!hasCurrent ? <p className="mag-line warn">{t("No current monitor. CompassMot needs current. Throttle compensation is not the one to run.")}</p> : null}
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={busy || !sample.ok || sample.armed || !hasCurrent} onClick={() => void start()}>{busy ? t("Sending…") : t("Start")}</button>
            </div>
          </>
        ) : null}
        {phase === "gas" ? (
          <>
            <p className="mag-line">{t("Raise the throttle stick slowly to 50–75% for 5–10 seconds, then back to zero. Then finish.")}</p>
            {mode === "current" ? <p className="mag-line">{t("The fit moves only once current reaches 3 A.")}</p> : null}
            {mode === "throttle" ? <p className="mag-line warn">{t("The vehicle is using throttle, not current.")}</p> : null}
            {shown ? (
              <>
                <p className={`mag-line ${tone(shown.interference)}`}>{t("Interference {n}%", { n: Math.round(shown.interference) })}</p>
                <p className="mag-line">{t("Throttle {thr}%. Current {amps} A.", { thr: Math.round(shown.throttle), amps: shown.current.toFixed(1) })}</p>
                <p className="mag-line">{t("Compensation {x}, {y}, {z}.", { x: shown.x.toFixed(1), y: shown.y.toFixed(1), z: shown.z.toFixed(1) })}</p>
              </>
            ) : <p className="mag-line">{t("Waiting for the vehicle.")}</p>}
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={busy} onClick={() => void finish()}>{busy ? t("Sending…") : t("Finish")}</button>
            </div>
          </>
        ) : null}
        {phase === "result" ? (
          <>
            {shown ? <p className={`mag-line ${tone(shown.interference)}`}>{t(shown.interference < 30 ? "Interference {n}%. Acceptable." : shown.interference <= 60 ? "Interference {n}%. Grey zone." : "Interference {n}%. Move the compass away from the power wires.", { n: Math.round(shown.interference) })}</p> : null}
            <p className="mag-line">{mot === 2 ? t("Saved from current.") : mot === 1 ? t("Saved from throttle.") : t("Compensation stayed off.")}</p>
            {vector.every((value) => value != null) ? <p className="mag-line">{t("Compensation {x}, {y}, {z}.", { x: (vector[0] as number).toFixed(1), y: (vector[1] as number).toFixed(1), z: (vector[2] as number).toFixed(1) })}</p> : null}
            <p className="mag-line">{t("This does not replace the compass offsets.")}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-go" onClick={() => setPhase("done")}>{t("Next")}</button>
            </div>
          </>
        ) : null}
        {phase === "done" ? (
          <>
            <p className="mag-line fit-ok">{mot != null && mot !== 0 ? t("Motor current compensation is stored.") : t("Motor current compensation stayed off.")}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-go" onClick={leave}>{t("Close")}</button>
            </div>
          </>
        ) : null}
        {message ? <p className="mag-line" role="status">{t(message)}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
