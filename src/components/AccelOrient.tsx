import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { getLatest, subscribe } from "../mav/store";
import type { WizardClose } from "../wizards/close";
import { currentMatrix, fitBoard, mean, namedMatrix, orientLabel, toEuler, vlen, type BoardFit, type V3 } from "./compass-orient";
import { Icon } from "./MotorSetup";
import { BoardTop, HoldRing, PoseArt, SensorWizard, TiltGauge } from "./SensorWizard";

/** `ready` waits for Start, so the vehicle can be placed before anything is measured. */
type Phase = "ready" | "level" | "nose" | "done";

/** Seconds a pose must be held still before it is taken. */
const HOLD = 1;
/** Smallest tilt between the two poses that still tells the yaw apart. */
const MIN_TILT = 20;
/** Cosine a fit must reach on both poses: about 18° of error. */
const GOOD = 0.95;

/** SCALED_IMU accel in mG and whether the gyros say the vehicle is still. */
function accelNow(live: Record<string, number> | undefined): { acc: V3; still: boolean } | null {
  if (!live) return null;
  const acc = ["xacc", "yacc", "zacc"].map((k) => live[`SCALED_IMU.${k}`]);
  const gyro = ["xgyro", "ygyro", "zgyro"].map((k) => live[`SCALED_IMU.${k}`]);
  if (!acc.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const length = vlen(acc as V3);
  if (length < 600 || length > 1600) return null;
  const still = gyro.every((v) => typeof v === "number" && Number.isFinite(v)) && Math.hypot(...gyro) < 120;
  return { acc: acc as V3, still };
}

function angle(a: V3, b: V3): number {
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (vlen(a) * vlen(b));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

const deg = (cos: number) => Math.round((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);

/** Yaw of a named orientation, for the board drawn from above. */
function yawOf(id: number): number {
  const m = namedMatrix(id);
  return m ? toEuler(m).yaw : 0;
}

/**
 * Finds AHRS_ORIENTATION from the accelerometer: the vehicle held level, then nose down. Each pose is taken by itself
 * once it is held still for a second. From the step page the result goes into the draft (`onPick`); from the
 * assistant it is reported back and nothing is written either way.
 */
export function AccelOrient({ current, onPick, onClose, fromAssistant }: {
  current: number;
  onPick?: (id: number) => void;
  onClose: (report?: WizardClose) => void;
  fromAssistant?: boolean;
}) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const [phase, setPhase] = useState<Phase>("ready");
  const [fit, setFit] = useState<BoardFit | null>(null);
  const [held, setHeld] = useState(0);
  const bag = useRef({ seen: -1, lastT: 0, held: 0, points: [] as V3[], level: null as V3 | null });
  const now = accelNow(sample.live_nums);
  const tilt = now && bag.current.level ? angle(now.acc, bag.current.level) : 0;
  const good = fit != null && fit.level >= GOOD && fit.nose >= GOOD;
  const craft = sample.frame === "plane" ? "plane" : "copter";

  function report(used: boolean): WizardClose {
    return {
      outcome: phase === "done" ? (good ? "completed" : "failed") : "cancelled",
      measures: {
        current,
        current_name: orientLabel(current),
        detected: good && fit ? fit.id : null,
        detected_name: good && fit ? orientLabel(fit.id) : null,
        closest: fit ? fit.id : null,
        fit_level_deg: fit ? deg(fit.level) : null,
        fit_nose_deg: fit ? deg(fit.nose) : null,
        used: used ? 1 : 0,
      },
    };
  }

  useEffect(() => {
    if (phase === "ready" || phase === "done" || bag.current.seen === sample.t) return;
    const b = bag.current;
    const dt = b.lastT > 0 ? Math.min(0.4, Math.max(0, sample.t - b.lastT)) : 0;
    b.seen = sample.t;
    b.lastT = sample.t;
    const ready = now && now.still && (phase === "level" || (b.level != null && angle(now.acc, b.level) >= MIN_TILT));
    if (!ready || dt <= 0) {
      b.held = 0;
      b.points = [];
      setHeld(0);
      return;
    }
    b.held += dt;
    b.points.push(now.acc);
    setHeld(Math.min(1, b.held / HOLD));
    if (b.held < HOLD) return;
    const taken = mean(b.points);
    b.held = 0;
    b.points = [];
    setHeld(0);
    if (phase === "level") {
      b.level = taken;
      setPhase("nose");
      return;
    }
    setFit(b.level ? fitBoard(b.level, taken, currentMatrix(current, null)) : null);
    setPhase("done");
  });

  function again() {
    bag.current = { seen: -1, lastT: 0, held: 0, points: [], level: null };
    setFit(null);
    setPhase("ready");
  }

  const holding = held > 0;
  let left = <PoseArt tilt={0} craft={craft} />;
  let body;
  let footer = (
    <>
      <button type="button" className="mw-btn text" onClick={() => onClose(report(false))}>{t("Cancel")}</button>
      <span />
    </>
  );
  if (phase === "ready") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Two still poses")}</h3><p>{t("Level on a flat surface, then nose down about 30°. After Start, each pose is taken once it has been held still for a second.")}</p></div>
        {!sample.ok ? <div className="mw-note warn">{Icon.warn()}<span>{t("Connect a vehicle first.")}</span></div> : null}
        <span className="mw-dim mw-sm">{t("Nothing is written. The result goes into the step's draft.")}</span>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={() => onClose(report(false))}>{t("Cancel")}</button>
        <button type="button" className="mw-btn primary" disabled={!sample.ok} onClick={() => setPhase("level")}><span>{t("Start")}</span>{Icon.chevR()}</button>
      </>
    );
  } else if (phase === "level") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Set it level")}</h3><p>{t(craft === "plane" ? "On its wheels or belly, on a flat surface. It is taken by itself after a second." : "On its legs, on a flat surface. It is taken by itself after a second.")}</p></div>
        {!sample.ok ? <div className="mw-note warn">{Icon.warn()}<span>{t("Connect a vehicle first.")}</span></div> : (
          <div className={`mw-note ${now?.still ? "ok" : "warn"}`}><i className="sw-dot" /><span>{t(!now ? "No accelerometer frame yet." : now.still ? "Still. Hold it…" : "The vehicle is moving.")}</span></div>
        )}
        {holding ? <HoldRing pct={held * 100} label={t("Taking it…")} /> : null}
        <span className="mw-dim mw-sm">{t("Nothing is written. The result goes into the step's draft.")}</span>
      </>
    );
  } else if (phase === "nose") {
    left = <PoseArt tilt={Math.round(tilt)} craft={craft} ghost />;
    body = (
      <>
        <div className="mw-headline"><h3>{t("Tip the nose down")}</h3><p>{t("Lift the tail about 30° and hold it; the front stays on the table.")}</p></div>
        <div className="sw-pair">
          <TiltGauge deg={tilt} min={MIN_TILT} />
          {holding ? <HoldRing pct={held * 100} label={t("Taking it…")} /> : (
            <div className={`mw-note ${tilt >= MIN_TILT ? "ok" : "warn"}`}><i className="sw-dot" /><span>{t(tilt < MIN_TILT ? "Tip the nose further down." : "Hold it still.")}</span></div>
          )}
        </div>
      </>
    );
  } else if (good && fit) {
    const same = fit.id === current;
    left = same ? (
      <BoardTop yaw={yawOf(fit.id)} tone="ok" label={t("Detected")} value={orientLabel(fit.id)} />
    ) : (
      <div className="sw-pair">
        <BoardTop yaw={yawOf(current)} tone="dim" label={t("Set now")} value={orientLabel(current)} />
        {Icon.chevR("var(--dim)", 20)}
        <BoardTop yaw={yawOf(fit.id)} tone="warn" label={t("Detected")} value={orientLabel(fit.id)} />
      </div>
    );
    body = (
      <>
        <div className="mw-headline">
          <h3>{same ? t("The orientation is right") : t("The board is mounted {name}", { name: orientLabel(fit.id) })}</h3>
          <p>{same ? t("AHRS_ORIENTATION {name} matches how the board sits.", { name: orientLabel(current) }) : t("AHRS_ORIENTATION is {name}.", { name: orientLabel(current) })}</p>
        </div>
        {same ? <div className="mw-note ok">{Icon.check("var(--ok)", 14)}<span>{t("Nothing to change.")}</span></div> : (
          <div className="mw-note info"><span>{fromAssistant ? t("The assistant gets the result. A change still waits for your approval.") : t("Use puts it in the draft. Write, reboot, then set level again.")}</span></div>
        )}
        <span className="mw-dim mw-sm">{t("Fit: level {a}°, nose {b}°.", { a: deg(fit.level), b: deg(fit.nose) })}</span>
      </>
    );
    footer = same || fromAssistant ? (
      <>
        <button type="button" className="mw-btn text" onClick={again}>{t("Measure again")}</button>
        <button type="button" className="mw-btn primary" onClick={() => onClose(report(false))}>{t(fromAssistant && !same ? "Send to assistant" : "Close")}</button>
      </>
    ) : (
      <>
        <button type="button" className="mw-btn text" onClick={again}>{t("Measure again")}</button>
        <button type="button" className="mw-btn primary" onClick={() => { onPick?.(fit.id); onClose(report(true)); }}>{t("Use {name}", { name: orientLabel(fit.id) })}</button>
      </>
    );
  } else {
    left = <PoseArt tilt={30} craft={craft} />;
    body = (
      <>
        <div className="mw-headline">
          <h3>{t("No standard orientation fits")}</h3>
          <p>{fit ? t("The closest is {name}, {n}° off.", { name: orientLabel(fit.id), n: Math.max(deg(fit.level), deg(fit.nose)) }) : t("The two poses were too alike.")}</p>
        </div>
        <div className="sw-fail"><b>{t("The board may sit at an angle, or the vehicle moved.")}</b><p>{t("Measure again, or set a custom rotation in Params (AHRS_ORIENTATION Custom 1 with CUST_ROT1_ROLL, _PIT, _YAW).")}</p></div>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={() => onClose(report(false))}>{t("Close")}</button>
        <button type="button" className="mw-btn primary" onClick={again}>{t("Measure again")}</button>
      </>
    );
  }

  return (
    <SensorWizard
      title={t("Detect board orientation")}
      fromAssistant={fromAssistant}
      steps={[t("Level"), t("Nose down"), t("Result")]}
      step={phase === "ready" || phase === "level" ? 0 : phase === "nose" ? 1 : 2}
      left={left}
      body={body}
      footer={footer}
      blocker={phase !== "done" && !sample.ok ? "lost" : phase !== "done" && sample.armed ? "armed" : null}
      onClose={() => onClose(report(false))}
    />
  );
}
