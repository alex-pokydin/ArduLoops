import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { send as sendCmd } from "../mav/cmd";
import { APP_HTTP } from "../mav/link";
import { getLatest, subscribe } from "../mav/store";
import type { WizardClose } from "../wizards/close";
import { Icon, Toggle } from "./MotorSetup";
import { InterferenceChart, SensorWizard } from "./SensorWizard";

type Phase = "prepare" | "gas" | "result";

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

/** ArduPilot's reading of the result: under 30% acceptable, up to 60% grey, above that move the compass. */
function band(interference: number): "ok" | "warn" | "bad" {
  if (interference < 30) return "ok";
  if (interference <= 60) return "warn";
  return "bad";
}

const PROPS_ON = (
  <svg width={44} height={44} viewBox="0 0 44 44" fill="none" aria-hidden="true">
    <ellipse cx="22" cy="22" rx="17" ry="4.5" transform="rotate(-25 22 22)" fill="#3b2812" stroke="var(--amber)" />
    <circle cx="22" cy="22" r="4" fill="var(--amber)" />
  </svg>
);

const TAPED = (
  <svg width={44} height={44} viewBox="0 0 44 44" fill="none" aria-hidden="true">
    <rect x="6" y="30" width="32" height="4" rx="2" fill="#3a4552" />
    <rect x="14" y="20" width="16" height="9" rx="3" fill="#2a3140" />
    <path d="M10 18h24" stroke="var(--amber)" strokeWidth="3" strokeLinecap="round" />
    <path d="M12 18v12M32 18v12" stroke="var(--amber)" strokeWidth="2" />
  </svg>
);

/**
 * Motor interference (CompassMot), copter only: with the props reversed and the vehicle taped down, the throttle stick
 * runs the motors while ArduPilot fits how the field moves with current. The chart is interference against throttle.
 */
export function CompassMot({ onClose, fromAssistant }: { onClose: (report?: WizardClose) => void; fromAssistant?: boolean }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const params = sample.params ?? {};
  const [phase, setPhase] = useState<Phase>("prepare");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [props, setProps] = useState(false);
  const [taped, setTaped] = useState(false);
  const [last, setLast] = useState<Live | null>(null);
  const [points, setPoints] = useState<{ throttle: number; interference: number }[]>([]);
  const monitor = num(params, "BATT_MONITOR");
  const hasCurrent = monitor != null && monitor !== 0;
  const map = num(params, "RCMAP_THROTTLE");
  const channel = map != null && map >= 1 ? map : 3;
  const pwm = sample.rc?.[channel - 1];
  const throttleUp = typeof pwm === "number" && pwm > 1100;
  const texts = sample.texts ?? [];
  const modeLine = texts.find((text) => /INFO Current$/.test(text) || /INFO Throttle$/.test(text));
  const mode = modeLine && /Current$/.test(modeLine) ? "current" : modeLine ? "throttle" : "";
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const lastRef = useRef(last);
  lastRef.current = last;
  const peak = points.reduce((m, p) => Math.max(m, p.interference), 0);

  function leave() {
    const now = phaseRef.current;
    const live = lastRef.current;
    const current = getLatest().params ?? {};
    onClose({
      outcome: now === "result" ? "completed" : "cancelled",
      measures: {
        phase: now,
        COMPASS_MOTCT: num(current, "COMPASS_MOTCT"),
        COMPASS_MOT_X: num(current, "COMPASS_MOT_X"),
        COMPASS_MOT_Y: num(current, "COMPASS_MOT_Y"),
        COMPASS_MOT_Z: num(current, "COMPASS_MOT_Z"),
        interference: live ? live.interference : null,
        peak_interference: peak || null,
        throttle: live ? live.throttle : null,
        current: live ? live.current : null,
      },
    });
  }

  useEffect(() => {
    const next = liveOf(sample.live_nums);
    if (phase !== "gas" || !next) return;
    setLast(next);
    setPoints((prev) => {
      const tail = prev[prev.length - 1];
      if (tail && Math.abs(tail.throttle - next.throttle) < 1 && Math.abs(tail.interference - next.interference) < 0.5) return prev;
      return [...prev, { throttle: next.throttle, interference: next.interference }].slice(-400);
    });
  }, [phase, sample.live_nums]);

  async function post(action: "start" | "finish"): Promise<string> {
    const response = await fetch(`${APP_HTTP}/compass-mot?action=${action}`, { method: "POST" });
    const body = (await response.json()) as { message?: string };
    return body.message || "Could not send calibration command";
  }

  async function start() {
    if (busy || !sample.ok || sample.armed || !hasCurrent) return;
    setBusy(true);
    setMessage("");
    try {
      const text = await post("start");
      if (text === "CompassMot started") {
        setPoints([]);
        setPhase("gas");
      } else setMessage(text);
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
      if (text === "CompassMot finish sent") {
        for (const name of ["COMPASS_MOTCT", "COMPASS_MOT_X", "COMPASS_MOT_Y", "COMPASS_MOT_Z"]) sendCmd({ op: "param_read", name });
        setPhase("result");
      } else setMessage(text);
    } catch {
      setMessage("Connection lost during calibration");
    } finally {
      setBusy(false);
    }
  }

  const mot = num(params, "COMPASS_MOTCT");
  const vector = ["COMPASS_MOT_X", "COMPASS_MOT_Y", "COMPASS_MOT_Z"].map((name) => num(params, name));
  let left = <InterferenceChart points={points} />;
  let body;
  let footer;
  if (phase === "prepare") {
    left = (
      <div className="mw-safety">
        <Toggle on={props} icon={PROPS_ON} label={t("Propellers on, reversed")} sub={t("Flipped and moved one position, so thrust pushes it down")} onToggle={() => setProps(!props)} />
        <Toggle on={taped} icon={TAPED} label={t("Taped down")} sub={t("To something heavy; everyone clear")} onToggle={() => setTaped(!taped)} />
      </div>
    );
    body = (
      <>
        <div className="mw-headline"><h3>{t("Props on, taped down")}</h3><p>{t("Start arms the motors; the throttle stick runs them. ArduPilot fits how the field moves with current.")}</p></div>
        <div className="mw-checks">
          <span className={sample.ok ? "ok" : "bad"}>{sample.ok ? Icon.check("var(--ok)", 12) : Icon.x("var(--hot)", 12)}{t(sample.ok ? "Connected" : "No link")}</span>
          <span className={sample.armed ? "bad" : "ok"}>{sample.armed ? Icon.x("var(--hot)", 12) : Icon.check("var(--ok)", 12)}{t(sample.armed ? "Armed" : "Disarmed")}</span>
          <span className={hasCurrent ? "ok" : "bad"}>{hasCurrent ? Icon.check("var(--ok)", 12) : Icon.x("var(--hot)", 12)}{t(hasCurrent ? "Current sensor" : "No current sensor")}</span>
          <span className={throttleUp ? "bad" : "ok"}>{throttleUp ? Icon.x("var(--hot)", 12) : Icon.check("var(--ok)", 12)}{t(throttleUp ? "Throttle stick up" : "Throttle at zero")}</span>
        </div>
        <div className="mw-note warn">{Icon.warn()}<span>{t("This spins the motors with propellers on. Stand clear before Start.")}</span></div>
        <span className="mw-dim mw-sm">{t("Skip this if yaw comes from GPS on firmware older than 4.5.2.")}</span>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={leave}>{t("Cancel")}</button>
        <button type="button" className="mw-btn primary" disabled={!props || !taped || !hasCurrent || throttleUp || busy || !sample.ok || sample.armed} onClick={() => void start()}>
          <span>{busy ? t("Starting…") : t("Start")}</span>{Icon.chevR()}
        </button>
      </>
    );
  } else if (phase === "gas") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Raise the throttle slowly")}</h3><p>{t("To 50–75% for 5–10 seconds, then back to zero. Then Finish.")}</p></div>
        <div className="mw-sums">
          <div className="mw-sum"><span className="mw-dim mw-sm">{t("Current")}</span><b>{last ? `${last.current.toFixed(1)} A` : "—"}</b><span className="mw-dim mw-sm">{last ? t("throttle {n}%", { n: Math.round(last.throttle) }) : t("Waiting for the vehicle.")}</span></div>
          <div className={`mw-sum${last && band(last.interference) !== "ok" ? " warn" : ""}`}><span className="mw-dim mw-sm">{t("Interference")}</span><b>{last ? `${Math.round(last.interference)}%` : "—"}</b><span className="mw-dim mw-sm">{t("under 30%: fine")}</span></div>
        </div>
        {mode === "current" ? <span className="mw-dim mw-sm">{t("The fit moves only once current reaches 3 A.")}</span> : null}
        {mode === "throttle" ? <div className="mw-note warn">{Icon.warn()}<span>{t("The vehicle is using throttle, not current.")}</span></div> : null}
      </>
    );
    footer = (
      <>
        <span />
        <button type="button" className="mw-btn primary" disabled={busy} onClick={() => void finish()}>{busy ? t("Sending…") : t("Finish")}</button>
      </>
    );
  } else {
    const verdict = band(peak);
    body = (
      <>
        <div className="mw-headline">
          <h3>{mot ? t("Compensation saved") : t("Compensation stayed off")}</h3>
          <p>{peak ? t(verdict === "ok" ? "Highest interference {n}%: acceptable." : verdict === "warn" ? "Highest interference {n}%: grey zone." : "Highest interference {n}%: move the compass away from the power wires.", { n: Math.round(peak) }) : t("No interference was measured.")}</p>
        </div>
        <span className="mw-dim mw-sm">{mot === 2 ? t("Saved from current.") : mot === 1 ? t("Saved from throttle.") : ""}{vector.every((v) => v != null) ? ` COMPASS_MOT ${vector.map((v) => (v as number).toFixed(1)).join(", ")}` : ""}</span>
        <span className="mw-dim mw-sm">{t("This does not replace the calibration; it removes the part of the field that follows the current.")}</span>
      </>
    );
    footer = (
      <>
        <span />
        <button type="button" className="mw-btn primary" onClick={leave}>{t("Close")}</button>
      </>
    );
  }

  return (
    <SensorWizard
      title={t("Motor interference")}
      fromAssistant={fromAssistant}
      steps={[t("Safety"), t("Measure"), t("Result")]}
      step={phase === "prepare" ? 0 : phase === "gas" ? 1 : 2}
      left={left}
      body={<>{body}{message ? <div className="mw-note warn">{Icon.warn()}<span>{t(message)}</span></div> : null}</>}
      footer={footer}
      blocker={phase === "gas" && !sample.ok ? "lost" : null}
      busy={busy || phase === "gas"}
      onClose={leave}
    />
  );
}
