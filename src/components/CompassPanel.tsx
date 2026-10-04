import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { send as sendCmd } from "../mav/cmd";
import { APP_HTTP } from "../mav/link";
import { getLatest, subscribe } from "../mav/store";
import { paramNum, type WizardClose } from "../wizards/close";
import { orientLabel } from "./compass-orient";
import { CompassOrient, type OrientHandle } from "./CompassOrient";
import { CompassMot } from "./CompassMot";

type Axis = "X" | "Y" | "Z";
type Triple = [number | null, number | null, number | null];

const MAG_MSG = ["SCALED_IMU", "SCALED_IMU2", "SCALED_IMU3"] as const;
const trails: number[][] = [[], [], []];
const moved = [false, false, false];
const lastPose = { roll: Number.NaN, pitch: Number.NaN, yaw: Number.NaN, t: 0 };
let lastMag = [Number.NaN, Number.NaN, Number.NaN];

function num(params: Record<string, number>, name: string): number | null {
  const value = params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function indexed(stem: string, n: number): string {
  return n === 1 ? `COMPASS_${stem}` : `COMPASS_${stem}${n}`;
}

function axisName(stem: "OFS" | "DIA" | "ODI", n: number, axis: Axis): string {
  return n === 1 ? `COMPASS_${stem}_${axis}` : `COMPASS_${stem}${n}_${axis}`;
}

function triple(params: Record<string, number>, stem: "OFS" | "DIA" | "ODI", n: number): Triple {
  return [
    num(params, axisName(stem, n, "X")),
    num(params, axisName(stem, n, "Y")),
    num(params, axisName(stem, n, "Z")),
  ];
}

function near(value: number | null, target: number, tol: number): boolean {
  return value != null && Math.abs(value - target) <= tol;
}

function deviceStored(params: Record<string, number>, n: number): boolean {
  const ofs = triple(params, "OFS", n);
  const dia = triple(params, "DIA", n);
  const odi = triple(params, "ODI", n);
  if (ofs.some((value) => value != null && Math.abs(value) > 0.5)) return true;
  if (dia.some((value) => value != null && Math.abs(value - 1) > 0.02)) return true;
  if (odi.some((value) => value != null && Math.abs(value) > 0.02)) return true;
  return false;
}

function factoryDefaults(params: Record<string, number>, n: number): boolean {
  const ofs = triple(params, "OFS", n);
  const dia = triple(params, "DIA", n);
  const odi = triple(params, "ODI", n);
  return ofs.every((value) => near(value, 0, 0.5))
    && dia.every((value) => near(value, 1, 0.02))
    && odi.every((value) => near(value, 0, 0.02));
}

export function compassGlance(params: Record<string, number>): { text: string; live: boolean } {
  if (num(params, "COMPASS_DEV_ID") == null && num(params, "COMPASS_USE") == null) {
    return { text: "", live: false };
  }
  let any = false;
  let stored = false;
  for (const n of [1, 2, 3]) {
    const dev = num(params, indexed("DEV_ID", n));
    if (dev == null || dev === 0) continue;
    any = true;
    if (deviceStored(params, n)) stored = true;
  }
  if (!any) return { text: "No compass yet", live: false };
  if (stored) return { text: "Compass stored", live: true };
  return { text: "Compass defaults", live: false };
}

function fieldMag(live: Record<string, number> | undefined, message: string): number | null {
  if (!live) return null;
  const x = live[`${message}.xmag`];
  const y = live[`${message}.ymag`];
  const z = live[`${message}.zmag`];
  if (![x, y, z].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const length = Math.hypot(x, y, z);
  return length >= 1 ? length : null;
}

function resetFieldTrails() {
  for (let i = 0; i < 3; i++) {
    trails[i] = [];
    moved[i] = false;
    lastMag[i] = Number.NaN;
  }
  lastPose.roll = Number.NaN;
}

function poseMoving(roll: number, pitch: number, yaw: number, t: number, linked: boolean): boolean {
  if (!linked || !Number.isFinite(roll) || !Number.isFinite(pitch) || !Number.isFinite(yaw)) {
    lastPose.roll = Number.NaN;
    return false;
  }
  if (!Number.isFinite(lastPose.roll)) {
    lastPose.roll = roll;
    lastPose.pitch = pitch;
    lastPose.yaw = yaw;
    lastPose.t = t;
    return false;
  }
  const dt = t - lastPose.t;
  let dy = yaw - lastPose.yaw;
  if (dy > 180) dy -= 360;
  if (dy < -180) dy += 360;
  const rate = dt > 0 ? Math.hypot(roll - lastPose.roll, pitch - lastPose.pitch, dy) / dt : 0;
  lastPose.roll = roll;
  lastPose.pitch = pitch;
  lastPose.yaw = yaw;
  lastPose.t = t;
  return rate > 8;
}

function noteMags(mags: (number | null)[], moving: boolean, linked: boolean) {
  if (!linked) {
    resetFieldTrails();
    return;
  }
  mags.forEach((value, i) => {
    if (value == null) return;
    if (moving) moved[i] = true;
    if (value === lastMag[i]) return;
    lastMag[i] = value;
    trails[i].push(value);
    if (trails[i].length > 40) trails[i].shift();
  });
}

function fieldShape(index: number): "steady" | "changed" | "turn" | null {
  const row = trails[index];
  if (row.length < 8) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const value of row) {
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  const mean = sum / row.length;
  if (!(mean > 1)) return null;
  if (!moved[index]) return "turn";
  return (max - min) / mean < 0.1 ? "steady" : "changed";
}

function fmt(value: number | null, digits: number): string {
  return value == null ? "—" : value.toFixed(digits);
}

function fmtTriple(values: Triple, digits: number): string {
  return values.map((value) => fmt(value, digits)).join(", ");
}

function lengthOf(values: Triple): number | null {
  if (values.some((value) => value == null)) return null;
  return Math.hypot(values[0] as number, values[1] as number, values[2] as number);
}

function statusKey(status: number): string {
  switch (status) {
    case 0: return "Not started";
    case 1: return "Waiting to start";
    case 2: return "Collecting orientations";
    case 3: return "Fitting the sphere";
    case 4: return "Calibration succeeded";
    case 5: return "Calibration failed";
    case 6: return "Bad orientation";
    case 7: return "Bad radius";
    case 8: return "Offsets out of range";
    case 9: return "Diagonals out of range";
    case 10: return "Residuals too high";
    default: return "Status {n}";
  }
}

function maskBits(mask: number[] | undefined): boolean[] {
  const bits: boolean[] = [];
  for (let byte = 0; byte < 10; byte++) {
    const value = mask?.[byte] ?? 0;
    for (let bit = 0; bit < 8; bit++) bits.push(((value >> bit) & 1) === 1);
  }
  return bits;
}

type MagSlot = {
  id: number;
  status: number;
  attempt: number;
  pct: number;
  mask: number[];
  fitness: number | null;
  ofs: number[];
  diag: number[];
  offdiag: number[];
  autosaved: number | null;
};

export function CompassPanel() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const [calOpen, setCalOpen] = useState(false);
  const [motOpen, setMotOpen] = useState(false);
  const orientRef = useRef<OrientHandle>(null);
  const params = sample.params ?? {};
  const slots = (sample.mag_cal ?? []) as MagSlot[];
  const running = slots.some((slot) => slot.status === 1 || slot.status === 2 || slot.status === 3);
  const mags = MAG_MSG.map((message) => fieldMag(sample.live_nums, message));
  noteMags(mags, poseMoving(sample.roll, sample.pitch, sample.yaw, sample.t, sample.ok), sample.ok);
  const variance = sample.live_nums?.["EKF_STATUS_REPORT.compass_variance"];
  const loaded = Object.keys(params).length > 0;
  const compasses = [1, 2, 3].filter((n) => n === 1 || (num(params, indexed("DEV_ID", n)) ?? 0) !== 0);
  const orientTarget = compasses.find((n) => {
    const dev = num(params, indexed("DEV_ID", n));
    const external = num(params, indexed("EXTERNAL", n));
    return dev != null && dev !== 0 && external != null && external !== 0;
  }) ?? null;
  return (
    <div className="mag">
      <div className="mag-block">
        <b className="work-cal-label">{t("Stored calibration")}</b>
        {!loaded || num(params, "COMPASS_DEV_ID") == null ? (
          <p className="mag-line">{t(loaded ? "No compass parameters." : "Compass parameters have not arrived.")}</p>
        ) : compasses.map((n) => {
          const dev = num(params, indexed("DEV_ID", n));
          const use = num(params, indexed("USE", n));
          const external = num(params, indexed("EXTERNAL", n));
          const orient = num(params, indexed("ORIENT", n));
          const ofs = triple(params, "OFS", n);
          const dia = triple(params, "DIA", n);
          const odi = triple(params, "ODI", n);
          const scale = num(params, indexed("SCALE", n));
          const offsetLength = lengthOf(ofs);
          if (dev == null || dev === 0) {
            return <p key={n} className="mag-card"><b>{t("Compass {n}", { n })}</b>{t("Not detected")}</p>;
          }
          return (
            <div key={n} className="mag-card">
              <b>
                {t("Compass {n}", { n })}
                {" · "}
                {t(use === 1 ? "In use" : "Not in use")}
                {external == null ? "" : ` · ${t(external === 0 ? "Internal" : "External")}`}
                {orient == null ? "" : n === orientTarget ? (
                  <>
                    {" · "}
                    <button type="button" className="mag-orient" onClick={() => orientRef.current?.open()}>
                      {t("Orientation {n}", { n: orientLabel(Math.round(orient)) })}
                    </button>
                  </>
                ) : ` · ${t("Orientation {n}", { n: orientLabel(Math.round(orient)) })}`}
              </b>
              <p className="mag-line">
                <button type="button" className="mag-orient" onClick={() => setCalOpen(true)}>
                  {factoryDefaults(params, n)
                    ? t("Offsets, diagonals, and off-diagonals are still the factory defaults.")
                    : t("Offsets {x}. Length {length}.", { x: fmtTriple(ofs, 1), length: fmt(offsetLength, 0) })}
                </button>
              </p>
              {factoryDefaults(params, n) ? null : (
                <>
                  <p className="mag-line">{t("Diagonals {x}", { x: fmtTriple(dia, 3) })}</p>
                  <p className="mag-line">{t("Off-diagonals {x}", { x: fmtTriple(odi, 3) })}</p>
                  {scale != null && scale !== 0 && Math.abs(scale - 1) > 0.001
                    ? <p className="mag-line">{t("Scale {n}", { n: scale.toFixed(3) })}</p>
                    : null}
                </>
              )}
              {mags[n - 1] == null ? (
                <p className="mag-line">{t("No magnetometer frames yet.")}</p>
              ) : (
                <p className="mag-line">
                  {t("Field {n} mG", { n: Math.round(mags[n - 1] as number) })}
                  {fieldShape(n - 1) === "steady" ? ` · ${t("Field length stayed steady while the board moved.")}` : ""}
                  {fieldShape(n - 1) === "changed" ? ` · ${t("Field length changed while the board moved.")}` : ""}
                  {fieldShape(n - 1) === "turn" ? ` · ${t("Turn the board to see whether the field length stays steady.")}` : ""}
                </p>
              )}
            </div>
          );
        })}
        {typeof variance === "number" && Number.isFinite(variance) ? (
          <p className={variance >= 0.5 ? "mag-line warn" : "mag-line"}>
            {t(
              variance < 0.5
                ? "EKF compass variance {n}. Consistent."
                : variance < 0.8
                  ? "EKF compass variance {n}. Watch it."
                  : "EKF compass variance {n}. Inconsistent.",
              { n: variance.toFixed(2) },
            )}
          </p>
        ) : null}
        {num(params, "COMPASS_DEV_ID") == null ? null : (
          <>
            <p className="mag-line">{t(motorKey(num(params, "COMPASS_MOTCT")))}</p>
            <p className="mag-line">
              <button type="button" className="mag-orient" onClick={() => setMotOpen(true)}>{t("Compensate for motor current")}</button>
            </p>
            <p className="mag-line">{t(learnKey(num(params, "COMPASS_LEARN")))}</p>
          </>
        )}
      </div>

      <CompassOrient ref={orientRef} />
      {motOpen ? <CompassMot onClose={() => setMotOpen(false)} /> : null}

      {running && !calOpen ? (
        <p className="mag-line">
          <button type="button" className="mag-orient" onClick={() => setCalOpen(true)}>{t("Calibration is running")}</button>
        </p>
      ) : null}

      {calOpen ? <CompassCalWizard onClose={() => setCalOpen(false)} /> : null}
    </div>
  );
}

type CalPhase = "flow" | "reboot" | "wait" | "check" | "finish";

function compassClose(phase: CalPhase, slots: MagSlot[]): WizardClose {
  const sample = getLatest();
  const params = sample.params ?? {};
  const failed = phase !== "flow" && slots.some((slot) => slot.status >= 5);
  const primary = slots[0];
  const triple = (values: number[] | undefined) => values && values.length ? values.map((value) => value.toFixed(1)).join(", ") : null;
  return {
    outcome: phase === "finish" ? "completed" : failed ? "failed" : "cancelled",
    measures: {
      phase,
      fitness: primary?.fitness ?? null,
      offsets: triple(primary?.ofs),
      diagonals: triple(primary?.diag),
      off_diagonals: triple(primary?.offdiag),
      COMPASS_CAL_FIT: paramNum(params, "COMPASS_CAL_FIT"),
      ekf_variance: typeof sample.live_nums?.["EKF_STATUS_REPORT.compass_variance"] === "number"
        ? sample.live_nums["EKF_STATUS_REPORT.compass_variance"]
        : null,
    },
  };
}

export function CompassCalWizard({ onClose }: { onClose: (report?: WizardClose) => void }) {
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sawRun, setSawRun] = useState(false);
  const [phase, setPhase] = useState<CalPhase>("flow");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const params = sample.params ?? {};
  const fresh = typeof sample.heartbeat_at === "number" && Date.now() / 1000 - sample.heartbeat_at < 3;
  const ready = sample.ok && !sample.armed && fresh;
  const slots = (sample.mag_cal ?? []) as MagSlot[];
  const running = slots.some((slot) => slot.status === 1 || slot.status === 2 || slot.status === 3);
  useEffect(() => {
    if (running) setSawRun(true);
  }, [running]);
  const needsAccept = slots.some((slot) => slot.status === 4 && slot.autosaved === 0);
  const fitLimit = num(params, "COMPASS_CAL_FIT");
  const vehicleLine = (sample.texts ?? []).find((text) => /compass/i.test(text));

  function leave() {
    onClose(compassClose(phaseRef.current, (getLatest().mag_cal ?? []) as MagSlot[]));
  }

  async function send(action: "start" | "cancel" | "accept") {
    if (busy || !ready) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${APP_HTTP}/compass-cal?action=${action}`, { method: "POST" });
      const result = await response.json();
      setMessage(typeof result.message === "string" ? result.message : "Could not send compass calibration");
    } catch {
      setMessage("Connection lost during calibration");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CompassCalDialog
      phase={phase}
      onPhase={setPhase}
      step={calStep(phase, running, sawRun, slots)}
      ready={ready}
      busy={busy}
      running={running}
      needsAccept={needsAccept}
      fitLimit={fitLimit}
      slots={slots}
      message={message}
      vehicleLine={vehicleLine}
      onStart={() => { setSawRun(true); void send("start"); }}
      onCancel={() => void send("cancel")}
      onAccept={() => void send("accept")}
      onAgain={() => { setSawRun(false); setPhase("flow"); }}
      onClose={leave}
    />
  );
}

function calStep(phase: CalPhase, running: boolean, sawRun: boolean, slots: MagSlot[]): number {
  if (phase === "reboot" || phase === "wait") return 3;
  if (phase === "check") return 4;
  if (phase === "finish") return 5;
  if (running) return 1;
  if (sawRun && slots.some((slot) => slot.status >= 4)) return 2;
  return 0;
}

const CAL_STEPS = ["Ready the vehicle", "Fill every side", "Fitted offsets", "Reboot", "Check the fit", "Finished"] as const;

function CompassCalDialog({
  phase,
  onPhase,
  step,
  ready,
  busy,
  running,
  needsAccept,
  fitLimit,
  slots,
  message,
  vehicleLine,
  onStart,
  onCancel,
  onAccept,
  onAgain,
  onClose,
}: {
  phase: CalPhase;
  onPhase: (phase: CalPhase) => void;
  step: number;
  ready: boolean;
  busy: boolean;
  running: boolean;
  needsAccept: boolean;
  fitLimit: number | null;
  slots: MagSlot[];
  message: string;
  vehicleLine: string | undefined;
  onStart: () => void;
  onCancel: () => void;
  onAccept: () => void;
  onAgain: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const waitBag = useRef({ sawDrop: false, lastT: 0, still: 0, seen: -1 });
  const failed = slots.some((slot) => slot.status >= 5);
  const passed = slots.some((slot) => slot.status === 4) && !failed;
  const variance = sample.live_nums?.["EKF_STATUS_REPORT.compass_variance"];
  const shapes = [0, 1, 2].map((index) => fieldShape(index)).filter((shape) => shape != null);
  const field = shapes.includes("changed") ? "changed" : shapes.includes("steady") ? "steady" : shapes.includes("turn") ? "turn" : "none";
  const ekf = typeof variance !== "number" || !Number.isFinite(variance) ? "none" : variance < 0.5 ? "ok" : variance < 0.8 ? "watch" : "bad";

  useEffect(() => {
    if (phase !== "wait") return;
    if (!sample.ok) waitBag.current.sawDrop = true;
    const gap = waitBag.current.lastT > 0 ? sample.t - waitBag.current.lastT : 0;
    if (gap > 1.5) waitBag.current.sawDrop = true;
    waitBag.current.lastT = sample.t;
    if (waitBag.current.sawDrop && sample.ok) onPhase("check");
  }, [phase, sample, onPhase]);

  function reboot() {
    waitBag.current = { sawDrop: !sample.ok, lastT: 0, still: 0, seen: -1 };
    sendCmd({ op: "reboot" });
    onPhase("wait");
  }

  function goCheck() {
    resetFieldTrails();
    waitBag.current = { sawDrop: false, lastT: 0, still: 0, seen: -1 };
    onPhase("check");
  }
  return createPortal(
    <div className="modal-back" role="presentation">
      <div className="modal orient-wizard" role="dialog" aria-modal="true" aria-labelledby="cal-title">
        <div className="modal-head">
          <h2 id="cal-title">{t("Compass calibration")}</h2>
          <button type="button" className="modal-x" disabled={busy} onClick={onClose} aria-label={t("Close")} title={t("Close")}>×</button>
        </div>
        <ol className="orient-steps">
          {CAL_STEPS.map((name, index) => (
            <li key={name} className={index === step ? "on" : index < step ? "done" : ""}>{t(name)}</li>
          ))}
        </ol>
        {step === 0 ? (
          <>
            <ol className="sense-how">
              <li><b>1</b>{t("Propellers off. Disarm. Move away from metal, vehicles, and phones.")}</li>
              <li><b>2</b>{t("Start, then rotate the vehicle slowly through every side and every edge.")}</li>
              <li><b>3</b>{t("Each compass fills its sphere. Lower fitness is a tighter fit, and a pass is saved.")}</li>
            </ol>
            {fitLimit != null ? (
              <p className="mag-line">{t("The vehicle rejects a fit worse than {limit} mG.", { limit: fitLimit.toFixed(0) })}</p>
            ) : null}
            {!ready && !busy ? <p className="mag-line warn">{t("Calibration requires a fresh disarmed connection")}</p> : null}
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={!ready || busy || running} onClick={onStart}>
                {busy ? t("Sending…") : t("Start compass calibration")}
              </button>
              {/reboot/i.test(vehicleLine ?? "") ? (
                <button type="button" className="wiz-quiet" disabled={busy} onClick={reboot}>{t("Reboot the board")}</button>
              ) : null}
            </div>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <p className="mag-line">{t("Keep turning until every compass is full.")}</p>
            {slots.map((slot) => <CalSlot key={slot.id} slot={slot} fitLimit={fitLimit} showFit={false} />)}
            <div className="wiz-apply">
              <button type="button" className="wiz-quiet" disabled={!ready || busy} onClick={onCancel}>{t("Cancel calibration")}</button>
            </div>
          </>
        ) : null}
        {step === 2 ? (
          <>
            {slots.map((slot) => <CalSlot key={slot.id} slot={slot} fitLimit={fitLimit} showFit />)}
            <div className="wiz-apply">
              {needsAccept ? (
                <button type="button" className="wiz-go" disabled={!ready || busy} onClick={onAccept}>{t("Accept calibration")}</button>
              ) : null}
              {passed && !needsAccept ? (
                <button type="button" className="wiz-go" disabled={busy} onClick={reboot}>{t("Reboot the board")}</button>
              ) : null}
              {failed ? (
                <button type="button" className="wiz-quiet" disabled={busy} onClick={onAgain}>{t("Measure again")}</button>
              ) : null}
            </div>
          </>
        ) : null}
        {step === 3 ? (
          <>
            <p className="mag-line">{t(sample.ok
              ? "Waiting for the board to restart."
              : "The board dropped off. Open the link again when it is back.")}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-go" onClick={goCheck}>{t("Next")}</button>
            </div>
          </>
        ) : null}
        {step === 4 ? (
          <>
            {slots.map((slot) => <CalSlot key={slot.id} slot={slot} fitLimit={fitLimit} showFit />)}
            <p className="mag-line">{t("Turn the board slowly. The field length should stay steady, and the EKF should agree.")}</p>
            <p className={field === "steady" ? "mag-line ok" : "mag-line warn"}>{t(
              field === "steady"
                ? "Field length stayed steady while the board moved."
                : field === "changed"
                  ? "Field length changed while the board moved."
                  : "Turn the board to see whether the field length stays steady.",
            )}</p>
            <p className={ekf === "ok" ? "mag-line ok" : "mag-line warn"}>{t(
              ekf === "none"
                ? "No EKF compass variance yet."
                : ekf === "ok"
                  ? "EKF compass variance {n}. Consistent."
                  : ekf === "watch"
                    ? "EKF compass variance {n}. Watch it."
                    : "EKF compass variance {n}. Inconsistent.",
              { n: typeof variance === "number" ? variance.toFixed(2) : "" },
            )}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-go" onClick={() => onPhase("finish")}>{t("Next")}</button>
            </div>
          </>
        ) : null}
        {step === 5 ? (
          <>
            {slots.map((slot) => <CalSlot key={slot.id} slot={slot} fitLimit={fitLimit} showFit />)}
            <p className="mag-line ok">{t("The compass fit is in use. The field length stayed steady and the EKF agrees.")}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-go" onClick={onClose}>{t("Close")}</button>
            </div>
          </>
        ) : null}
        {message || busy ? <p className="mag-line" role="status">{message ? t(message) : t("Sending…")}</p> : null}
        {vehicleLine ? <p className="mag-line">{vehicleLine}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

function fitTone(status: number, fitness: number | null, limit: number | null): "ok" | "warn" | "bad" | null {
  if (status >= 5) return "bad";
  if (fitness == null) return null;
  if (limit != null && limit > 0) {
    if (fitness > limit) return "bad";
    if (fitness > limit / 2) return "warn";
    return "ok";
  }
  return status === 4 ? "ok" : null;
}

function CalSlot({ slot, fitLimit, showFit }: { slot: MagSlot; fitLimit: number | null; showFit: boolean }) {
  const t = useT();
  const bits = maskBits(slot.mask);
  const filled = bits.filter(Boolean).length;
  const above = slot.fitness != null && fitLimit != null && slot.fitness > fitLimit;
  const tone = showFit ? fitTone(slot.status, slot.fitness, fitLimit) : null;
  const card = tone ? `mag-card fit-${tone}` : slot.status >= 5 ? "mag-card bad" : slot.status === 4 || (slot.status >= 1 && slot.status <= 3) ? "mag-card on" : "mag-card";
  return (
    <div className={card}>
      <b>
        {t("Compass {n}", { n: slot.id + 1 })}
        {" · "}
        {t(statusKey(slot.status), { n: slot.status })}
        {slot.attempt > 1 ? ` · ${t("Attempt {n}", { n: slot.attempt })}` : ""}
      </b>
      <div className={slot.pct >= 100 ? "mag-meter full" : "mag-meter"} role="progressbar" aria-valuenow={slot.pct} aria-valuemin={0} aria-valuemax={100}>
        <i><b style={{ width: `${Math.max(0, Math.min(100, slot.pct))}%` }} /></i>
        <span>{t("{pct}% · {filled} of 80 sections", { pct: slot.pct, filled })}</span>
      </div>
      <div className="mag-bits" aria-hidden="true">
        {bits.map((on, index) => <i key={index} className={on ? "on" : ""} />)}
      </div>
      {showFit && slot.fitness != null ? (
        <>
          <p className={tone ? `mag-line fit-${tone}` : "mag-line"}>
            {t("Fitness {fitness} mG. Lower is a tighter fit.", { fitness: slot.fitness.toFixed(1) })}
            {above ? ` ${t("Above the vehicle limit.")}` : ""}
            {slot.autosaved === 1 ? ` ${t("Saved on the vehicle.")}` : ""}
            {slot.autosaved === 0 && slot.status === 4 ? ` ${t("The vehicle is waiting for accept.")}` : ""}
          </p>
          <p className="mag-line">
            {t("Offsets {x}. Length {length}.", {
              x: slot.ofs.map((value) => value.toFixed(1)).join(", "),
              length: Math.round(Math.hypot(slot.ofs[0] ?? 0, slot.ofs[1] ?? 0, slot.ofs[2] ?? 0)).toString(),
            })}
          </p>
          <p className="mag-line">{t("Diagonals {x}", { x: slot.diag.map((value) => value.toFixed(3)).join(", ") })}</p>
          <p className="mag-line">{t("Off-diagonals {x}", { x: slot.offdiag.map((value) => value.toFixed(3)).join(", ") })}</p>
        </>
      ) : null}
    </div>
  );
}

function motorKey(value: number | null): string {
  if (value == null || value === 0) return "Motor compensation is off. This calibration does not spin the motors.";
  return "Motor compensation is stored. This calibration does not spin the motors.";
}

function learnKey(value: number | null): string {
  if (value === 1) return "In-flight learning is internal.";
  if (value === 2) return "In-flight learning follows the EKF.";
  return "In-flight learning is off.";
}
