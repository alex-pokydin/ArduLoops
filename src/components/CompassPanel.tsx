import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { send as sendCmd } from "../mav/cmd";
import { APP_HTTP } from "../mav/link";
import { getLatest, subscribe } from "../mav/store";
import { paramNum, type WizardClose } from "../wizards/close";
import { describeDevice } from "../lib/sensorIds";
import { ORIENT_IDS, orientLabel } from "./compass-orient";
import { NumField, SelectField, StepFooter, Switch, useParamDraft } from "./OutputSetup";
import { StepPreArm } from "./StepPreArm";
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

/** Tilt-compensated heading of one compass from its body-frame field, in degrees from magnetic north. */
function headingOf(field: [number, number, number], rollDeg: number, pitchDeg: number): number {
  const r = rollDeg * (Math.PI / 180);
  const p = pitchDeg * (Math.PI / 180);
  const [mx, my, mz] = field;
  const xh = mx * Math.cos(p) + my * Math.sin(r) * Math.sin(p) + mz * Math.cos(r) * Math.sin(p);
  const yh = my * Math.cos(r) - mz * Math.sin(r);
  return ((Math.atan2(-yh, xh) * 180) / Math.PI + 360) % 360;
}

function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function bodyField(live: Record<string, number> | undefined, message: string): [number, number, number] | null {
  if (!live) return null;
  const v = [live[`${message}.xmag`], live[`${message}.ymag`], live[`${message}.zmag`]];
  return v.every((x) => typeof x === "number" && Number.isFinite(x)) && Math.hypot(...v) >= 1 ? (v as [number, number, number]) : null;
}

const AUTO_ROT: [number, string][] = [[0, "Off"], [1, "Check only"], [2, "Check and fix"], [3, "Check and fix, 45° steps too"]];
const ORIENT_OPTIONS: [number, string][] = ORIENT_IDS.map((id) => [id, orientLabel(id)]);
const GUIDE = "https://ardupilot.org/copter/docs/common-compass-calibration-in-mission-planner.html";

/**
 * Compass: one row per compass in priority order (what it is, where, orientation, use, calibration, live field),
 * then the calibration with its live progress and the live headings checked against each other, the EKF and the GPS course.
 * Edits are a draft; calibrations open their wizards.
 */
export function CompassPanel() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const armed = !!sample.armed;
  const [calOpen, setCalOpen] = useState(false);
  const [motOpen, setMotOpen] = useState(false);
  const orientRef = useRef<OrientHandle>(null);
  const params = sample.params ?? {};
  const draft = useParamDraft(params);
  const fresh = typeof sample.heartbeat_at === "number" && Date.now() / 1000 - sample.heartbeat_at < 3;
  const ready = sample.ok && !sample.armed && fresh;
  const slots = (sample.mag_cal ?? []) as MagSlot[];
  const running = slots.some((slot) => slot.status === 1 || slot.status === 2 || slot.status === 3);
  const mags = MAG_MSG.map((message) => fieldMag(sample.live_nums, message));
  noteMags(mags, poseMoving(sample.roll, sample.pitch, sample.yaw, sample.t, sample.ok), sample.ok);
  const variance = sample.live_nums?.["EKF_STATUS_REPORT.compass_variance"];
  const loaded = Object.keys(params).length > 0;
  const offsMax = num(params, "COMPASS_OFFS_MAX");
  const compasses = [1, 2, 3].filter((n) => (num(params, indexed("DEV_ID", n)) ?? 0) !== 0);
  const orientTarget = compasses.find((n) => (num(params, indexed("EXTERNAL", n)) ?? 0) !== 0) ?? null;
  const used = compasses.filter((n) => draft.value(indexed("USE", n)) === 1);
  const allStored = used.length > 0 && used.every((n) => deviceStored(params, n));

  // Live headings: each compass tilt-compensated with the vehicle's roll and pitch. Magnetic, because automatic
  // declination is set in memory and not saved, so COMPASS_DEC as read can be stale; EKF and GPS course are true.
  const headings = compasses.map((n) => {
    const field = bodyField(sample.live_nums, MAG_MSG[n - 1]);
    return field && sample.ok ? headingOf(field, sample.roll, sample.pitch) : null;
  });
  const usedHeadings = compasses.flatMap((n, i) => (used.includes(n) && headings[i] != null ? [headings[i] as number] : []));
  const spread = usedHeadings.length > 1 ? Math.max(...usedHeadings.flatMap((a) => usedHeadings.map((b) => angleGap(a, b)))) : null;
  const ekfYaw = sample.ok && Number.isFinite(sample.yaw) ? (sample.yaw + 360) % 360 : null;
  const speed = sample.live_nums?.["GPS_RAW_INT.vel"];
  const cog = sample.live_nums?.["GPS_RAW_INT.cog"];
  const course = typeof speed === "number" && speed > 300 && typeof cog === "number" && cog !== 65535 ? cog / 100 : null;

  return (
    <div className="frs">
      <StepPreArm step="compass" />
      {!sample.ok ? <div className="frs-note info">{t("Connect a vehicle to read its compasses.")}</div> : null}
      {sample.ok && loaded && num(params, "COMPASS_DEV_ID") == null ? <div className="frs-note info">{t("No compass parameters.")}</div> : null}
      {sample.ok && !loaded ? <div className="frs-note info">{t("Compass parameters have not arrived.")}</div> : null}

      {compasses.length ? (
        <div className="cps-table" role="table">
          <div className="cps-tr head" role="row">
            <span>#</span><span>{t("Sensor")}</span><span>{t("Orientation")}</span><span>{t("Use")}</span><span>{t("Calibration")}</span><span>{t("Field")}</span>
          </div>
          {compasses.map((n) => {
            const dev = describeDevice(num(params, indexed("DEV_ID", n)), "compass");
            const external = (num(params, indexed("EXTERNAL", n)) ?? 0) !== 0;
            const use = draft.value(indexed("USE", n));
            const ofs = triple(params, "OFS", n);
            const length = lengthOf(ofs);
            const defaults = factoryDefaults(params, n);
            const tooBig = length != null && offsMax != null && length > offsMax;
            const shape = fieldShape(n - 1);
            const calState = defaults ? "todo" : tooBig ? "warn" : "done";
            return (
              <div key={n} className={`cps-tr${use === 0 ? " off" : ""}`} role="row">
                <span className="cps-n">{n}</span>
                <span className="cps-sensor">
                  <b>{dev?.name ?? t("Compass {n}", { n })}{n === used[0] ? <em>{t("primary")}</em> : null}</b>
                  <span>{t(external ? "External" : "Internal")}{dev?.where ? ` · ${dev.where}` : ""}</span>
                </span>
                <span className="cps-orient">
                  {external ? (
                    <>
                      <select
                        aria-label={t("Orientation of compass {n}", { n })}
                        value={Math.round(draft.value(indexed("ORIENT", n)) ?? 0)}
                        onChange={(e) => draft.set(indexed("ORIENT", n), Number(e.target.value))}
                      >
                        {ORIENT_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                      </select>
                      {n === orientTarget ? (
                        <button type="button" className="frs-btn link" disabled={!ready} onClick={() => orientRef.current?.open()}>{t("Detect")}</button>
                      ) : null}
                    </>
                  ) : <span className="cps-dim">{t("Follows the board")}</span>}
                </span>
                <span>{use != null ? <Switch on={use === 1} label={t("Use compass {n}", { n })} onChange={(on) => draft.set(indexed("USE", n), on ? 1 : 0)} /> : null}</span>
                <span className="cps-cal" title={defaults ? undefined : `${t("Offsets {x}. Length {length}.", { x: fmtTriple(ofs, 1), length: fmt(length, 0) })} ${t("Diagonals {x}", { x: fmtTriple(triple(params, "DIA", n), 3) })} · ${t("Off-diagonals {x}", { x: fmtTriple(triple(params, "ODI", n), 3) })}`}>
                  <span className={`ms-dot ${calState === "done" ? "done" : calState === "warn" ? "warn" : ""}`} />
                  <span>
                    {defaults
                      ? t("Not calibrated")
                      : tooBig
                        ? t("Offsets {n} · over the {max} limit", { n: fmt(length, 0), max: offsMax?.toFixed(0) ?? "" })
                        : t("Offsets {n}", { n: fmt(length, 0) })}
                  </span>
                </span>
                <span className="cps-field" title={shape === "steady" ? t("Field length stayed steady while the board moved.") : shape === "changed" ? t("Field length changed while the board moved.") : t("Turn the board to see whether the field length stays steady.")}>
                  {mags[n - 1] == null ? "—" : (
                    <>
                      <span className={`ms-dot ${shape === "steady" ? "done" : shape === "changed" ? "warn" : ""}`} />
                      {t("{n} mG", { n: Math.round(mags[n - 1] as number) })}
                      <span className="cps-dim">{shape === "steady" ? t("steady") : shape === "changed" ? t("changes as it turns") : t("turn it")}</span>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="acs-row">
        <div className="ms-card acs-grow">
          <div className="ms-card-head">
            <b>{t("Calibration")}</b>
            {compasses.length ? (
              <span className={`acs-pill ${running ? "cyan" : allStored ? "ok" : "hot"}`}><i />{t(running ? "Running" : allStored ? "Calibrated" : "Not calibrated")}</span>
            ) : null}
          </div>
          <span className="acs-text">{t("Outside, away from steel and cars. Turn the vehicle slowly on every side until all bars fill. About a minute.")}</span>
          {slots.length ? slots.map((slot) => (
            <div key={slot.id} className="cps-bar">
              <span>{t("Compass {n}", { n: slot.id + 1 })}</span>
              <i><b style={{ width: `${Math.max(0, Math.min(100, slot.pct))}%` }} className={slot.status >= 5 ? "bad" : slot.status === 4 ? "ok" : ""} /></i>
              <span className="cps-dim">{slot.status >= 4 ? t(statusKey(slot.status), { n: slot.status }) : `${slot.pct}%`}</span>
            </div>
          )) : null}
          <span className="acs-text">{t(motorKey(num(params, "COMPASS_MOTCT")))} {t(learnKey(num(params, "COMPASS_LEARN")))}</span>
          <div className="acs-actions">
            <button type="button" className={`frs-btn ${allStored ? "quiet" : "primary sm"}`} disabled={!ready && !running} onClick={() => setCalOpen(true)}>
              {t(running ? "Show calibration" : allStored ? "Recalibrate" : "Start calibration")}
            </button>
            <button type="button" className="frs-btn quiet" disabled={!ready} onClick={() => setMotOpen(true)}>{t("Motor interference")}</button>
          </div>
        </div>
        <div className="ms-card acs-grow">
          <b className="acs-title">{t("Live heading")}</b>
          <div className="cps-heads">
            {compasses.map((n, i) => (
              <div key={n} className={`cps-head${used.includes(n) ? "" : " off"}`}>
                <span>{t("Compass {n} · magnetic", { n })}</span>
                <b>{headings[i] == null ? "—" : `${Math.round(headings[i] as number)}°`}</b>
              </div>
            ))}
            <div className="cps-head ref">
              <span>{t("EKF · true")}</span>
              <b>{ekfYaw == null ? "—" : `${Math.round(ekfYaw)}°`}</b>
            </div>
            <div className="cps-head ref">
              <span>{t("GPS course")}</span>
              <b>{course == null ? "—" : `${Math.round(course)}°`}</b>
            </div>
          </div>
          {spread != null ? (
            <span className={`acs-text${spread > 15 ? " warn" : ""}`}>
              {spread > 15
                ? t("The compasses disagree by {n}°. Check the orientation of the external one.", { n: Math.round(spread) })
                : t("The compasses agree within {n}°.", { n: Math.max(1, Math.round(spread)) })}
            </span>
          ) : null}
          {course == null ? (
            <span className="acs-text">{t("GPS course needs more than 3 m/s.")}</span>
          ) : ekfYaw != null ? (
            <span className={`acs-text${angleGap(ekfYaw, course) > 30 ? " warn" : ""}`}>
              {t(angleGap(ekfYaw, course) > 30 ? "Moving straight, the EKF heading should match the GPS course." : "The EKF heading matches the GPS course.")}
            </span>
          ) : null}
          {typeof variance === "number" && Number.isFinite(variance) ? (
            <span className={`acs-text${variance >= 0.5 ? " warn" : ""}`}>
              {t(variance < 0.5 ? "EKF compass variance {n}. Consistent." : variance < 0.8 ? "EKF compass variance {n}. Watch it." : "EKF compass variance {n}. Inconsistent.", { n: variance.toFixed(2) })}
            </span>
          ) : null}
          <NumField draft={draft} name="COMPASS_OFFS_MAX" label="Max offsets" width={80} />
          <SelectField draft={draft} name="COMPASS_AUTO_ROT" label="Auto-rotate on calibration" options={AUTO_ROT} />
        </div>
      </div>

      <CompassOrient ref={orientRef} />
      {motOpen ? <CompassMot onClose={() => setMotOpen(false)} /> : null}
      {calOpen ? <CompassCalWizard onClose={() => setCalOpen(false)} /> : null}
      <StepFooter draft={draft} armed={armed} ok={sample.ok} guide={GUIDE} guideLabel="Compass calibration" rebootNames={[]} />
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
