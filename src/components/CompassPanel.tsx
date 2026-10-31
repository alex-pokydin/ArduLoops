import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Glance } from "../lib/setupSteps";
import { useT } from "../i18n/i18n";
import { noteUi, send as sendCmd, writeParam } from "../mav/cmd";
import { APP_HTTP } from "../mav/link";
import { getLatest, subscribe } from "../mav/store";
import { paramNum, type WizardClose } from "../wizards/close";
import { askAssistant } from "../lib/assistantAsk";
import { COMPASS_DRIVER_BITS, compassDriverBit, describeDevice } from "../lib/sensorIds";
import { setViewFocus } from "../lib/setupView";
import { customAngles, orientChoices, orientLabel } from "./compass-orient";
import { Icon, Toggle } from "./MotorSetup";
import { NumField, SelectField, StepFooter, StepNum, Switch, SwitchField, useParamDraft } from "./OutputSetup";
import { CoverageSphere, FACES, FaceArt, HoldRing, PoseCoverageGrid, SensorWizard, nextPose, poseCoverage, poseNow } from "./SensorWizard";
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

export function compassGlance(params: Record<string, number>): Glance {
  if (num(params, "COMPASS_DEV_ID") == null && num(params, "COMPASS_USE") == null) {
    return { text: "", live: false };
  }
  // Turned off on purpose. Settled only when the EKF takes its yaw from elsewhere: not the compass (1, 3) and not
  // None (0), where the heading has no source and drifts.
  if (num(params, "COMPASS_ENABLE") === 0) {
    const yaw = num(params, "EK3_SRC1_YAW");
    if (yaw === 1 || yaw === 3) return { text: "Off · the EKF still expects a compass", live: false };
    if (yaw === 0) return { text: "Off · no heading source", live: false };
    return { text: "Off", live: false, off: true };
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
const LEARN: [number, string][] = [[0, "Off"], [2, "From the EKF"], [3, "In flight"]];
const CAL_FIT: [number, string][] = [[4, "Very strict · 4"], [8, "Strict · 8"], [16, "Default · 16"], [32, "Relaxed · 32"]];
const YAW_SOURCE: [number, string][] = [[1, "Compass"], [2, "GPS (dual antenna)"], [3, "GPS, compass fallback"], [8, "GSF · GPS and motion"]];
const PIN = ["#4fc3f7", "#81c784", "#ce93d8"];
const GUIDE = "https://ardupilot.org/copter/docs/common-compass-calibration-in-mission-planner.html";
/** Parameters ArduPilot reads only at boot. */
const REBOOT = ["COMPASS_PRIO1_ID", "COMPASS_PRIO2_ID", "COMPASS_PRIO3_ID", "COMPASS_DISBLMSK", "COMPASS_ENABLE"];

function motorKey(value: number | null): string {
  if (value === 2) return "Compensation stored from current";
  if (value === 1) return "Compensation stored from throttle";
  return "Not measured";
}

/** Heading dial: north up, the vehicle turned to the EKF heading, a numbered pin per compass at its magnetic heading. */
function HeadingDial({ heading, pins, off }: { heading: number | null; pins: { n: number; deg: number; color: string }[]; off: boolean }) {
  const P = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return [100 + Math.sin(a) * r, 100 - Math.cos(a) * r];
  };
  return (
    <svg className="cps-dial" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="88" className="cps-dial-face" />
      {Array.from({ length: 36 }, (_, i) => {
        const [x1, y1] = P(i * 10, 86);
        const [x2, y2] = P(i * 10, i % 3 ? 81 : 76);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={i % 9 ? "cps-tick" : "cps-tick major"} />;
      })}
      {([["N", 0], ["E", 90], ["S", 180], ["W", 270]] as const).map(([l, d]) => {
        const [x, y] = P(d, 66);
        return <text key={l} x={x} y={y + 4} textAnchor="middle" className={l === "N" ? "cps-cardinal n" : "cps-cardinal"}>{l}</text>;
      })}
      <g transform={`translate(100 100) rotate(${heading ?? 0}) scale(0.55)`} className={off || heading == null ? "cps-dim-craft" : ""}>
        {[45, 135, 225, 315].map((a) => {
          const [x, y] = [Math.sin((a * Math.PI) / 180) * 48, -Math.cos((a * Math.PI) / 180) * 48];
          return <line key={a} x1="0" y1="0" x2={x} y2={y} className="sw-arm" />;
        })}
        <rect x="-15" y="-21" width="30" height="42" rx="8" className="sw-body" />
        {[45, 135, 225, 315].map((a) => <circle key={a} cx={Math.sin((a * Math.PI) / 180) * 48} cy={-Math.cos((a * Math.PI) / 180) * 48} r="13" className="sw-motor" />)}
        <path d="M0 -66l8 11h-16z" className="sw-nose" />
      </g>
      {off ? null : pins.map((p, i) => {
        const [x, y] = P(p.deg, i % 2 ? 74 : 95);
        return (
          <g key={p.n}>
            <circle cx={x} cy={y} r="7" fill={p.color} />
            <text x={x} y={y + 3.5} textAnchor="middle" className="cps-pin-n">{p.n}</text>
          </g>
        );
      })}
    </svg>
  );
}

type Row = {
  pos: number;
  id: number;
  /** The slot the compass sits in on this boot (1–3), or 0 when it is not detected now. */
  cur: number;
  extra: boolean;
};

/**
 * Compass, laid out like Accelerometer: the heading dial, the jobs (calibration, orientation, motor interference),
 * settings, then the compasses in priority order. Priority (COMPASS_PRIOn_ID), ignored sensor types
 * (COMPASS_DISBLMSK) and turning the compass off (COMPASS_ENABLE) take effect after a reboot; all edits are a draft.
 */
export function CompassPanel() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const armed = !!sample.armed;
  const [calOpen, setCalOpen] = useState(false);
  const [motOpen, setMotOpen] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
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
  const plane = sample.frame === "plane";
  const enabled = draft.value("COMPASS_ENABLE");
  const off = enabled === 0;

  // Priority: the stored list (ArduPilot fills it at boot), or the slots as they are when the firmware has none.
  const curIds = [1, 2, 3].map((n) => num(params, indexed("DEV_ID", n)) ?? 0);
  const extraIds = [4, 5, 6, 7, 8].map((n) => num(params, `COMPASS_DEV_ID${n}`) ?? 0).filter((id) => id !== 0);
  const prioNames = [1, 2, 3].map((n) => `COMPASS_PRIO${n}_ID`);
  const hasPrio = prioNames.every((name) => num(params, name) != null);
  const order = hasPrio ? prioNames.map((name) => Math.round(draft.value(name) ?? 0)) : curIds;
  const rows: Row[] = order.flatMap((id, i) => (id ? [{ pos: i + 1, id, cur: curIds.indexOf(id) + 1, extra: false }] : []));
  const spare: Row[] = extraIds.filter((id) => !order.includes(id)).map((id) => ({ pos: 0, id, cur: 0, extra: true }));
  const reordered = hasPrio && prioNames.some((name) => Math.round(num(params, name) ?? 0) !== Math.round(draft.value(name) ?? 0));
  const used = rows.filter((r) => r.cur && draft.value(indexed("USE", r.pos)) === 1);
  const allStored = used.length > 0 && used.every((r) => deviceStored(params, r.cur));
  const orientTarget = [1, 2, 3].find((n) => curIds[n - 1] && (num(params, indexed("EXTERNAL", n)) ?? 0) !== 0) ?? null;
  const mask = Math.round(draft.value("COMPASS_DISBLMSK") ?? 0);
  // Nothing detected while ArduPilot still expects a compass: it reports "Compass 1 not healthy" and will not arm.
  const missing = loaded && !off && curIds.every((id) => !id) && extraIds.length === 0;
  const ignored = Object.entries(COMPASS_DRIVER_BITS).filter(([bit]) => mask & (1 << Number(bit)));

  // Live headings: each compass tilt-compensated with the vehicle's roll and pitch. Magnetic, because automatic
  // declination is set in memory and not saved, so COMPASS_DEC as read can be stale; EKF and GPS course are true.
  const headings = [1, 2, 3].map((n) => {
    const field = bodyField(sample.live_nums, MAG_MSG[n - 1]);
    return field && sample.ok && curIds[n - 1] ? headingOf(field, sample.roll, sample.pitch) : null;
  });
  const usedHeadings = used.flatMap((r) => (headings[r.cur - 1] != null ? [headings[r.cur - 1] as number] : []));
  const spread = usedHeadings.length > 1 ? Math.max(...usedHeadings.flatMap((a) => usedHeadings.map((b) => angleGap(a, b)))) : null;
  const ekfYaw = sample.ok && Number.isFinite(sample.yaw) ? (sample.yaw + 360) % 360 : null;
  const speed = sample.live_nums?.["GPS_RAW_INT.vel"];
  const cog = sample.live_nums?.["GPS_RAW_INT.cog"];
  const course = typeof speed === "number" && speed > 300 && typeof cog === "number" && cog !== 65535 ? cog / 100 : null;
  const pins = rows.flatMap((r) => (r.cur && headings[r.cur - 1] != null ? [{ n: r.pos, deg: headings[r.cur - 1] as number, color: PIN[r.pos - 1] }] : []));

  /** Swap priority positions a and b; Use stays with the compass, so it is swapped too. */
  function swap(a: number, b: number) {
    const ida = draft.value(`COMPASS_PRIO${a}_ID`) ?? 0;
    const idb = draft.value(`COMPASS_PRIO${b}_ID`) ?? 0;
    const ua = draft.value(indexed("USE", a));
    const ub = draft.value(indexed("USE", b));
    draft.set(`COMPASS_PRIO${a}_ID`, idb);
    draft.set(`COMPASS_PRIO${b}_ID`, ida);
    if (ua != null && ub != null) {
      draft.set(indexed("USE", a), ub);
      draft.set(indexed("USE", b), ua);
    }
  }

  function promote(id: number) {
    const free = prioNames.findIndex((name) => !(draft.value(name) ?? 0));
    const pos = free >= 0 ? free + 1 : 3;
    draft.set(`COMPASS_PRIO${pos}_ID`, id);
    draft.set(indexed("USE", pos), 1);
  }

  function setEnabled(on: boolean) {
    draft.set("COMPASS_ENABLE", on ? 1 : 0);
    const yaw = num(params, "EK3_SRC1_YAW");
    if (yaw == null) return;
    // The EKF needs a yaw source that is not the compass, or ArduPilot refuses to arm (Check EK3_SRC1_YAW).
    if (!on && (yaw === 1 || yaw === 3)) draft.set("EK3_SRC1_YAW", 8);
    if (on) draft.set("EK3_SRC1_YAW", yaw);
  }

  const job = (n: number, state: "done" | "warn" | "todo", title: string, detail: string, label: string, onClick: (() => void) | null, primary = false, extra: ReactNode = null) => (
    <div className="ms-wstep">
      <StepNum n={n} state={state} />
      <span className="ms-wstep-copy"><b>{t(title)}</b><span>{detail}</span></span>
      {extra}
      {onClick ? <button type="button" className={`frs-btn ${primary ? "primary sm" : "quiet"}`} disabled={!ready && !running} onClick={onClick}>{label}</button> : null}
    </div>
  );

  // MAGFit (log_magfit) fits motor interference from a real flight, with the props as they fly; the bench test
  // (CompassMot) needs them reversed and the vehicle taped down, so it stays for before the first flight.
  const magfit = (
    <button
      type="button"
      className="setup-fix"
      title={t("Ask the assistant to fit it from your latest flight log with MAGFit. Changes still wait for your approval.")}
      onClick={() => {
        setViewFocus("COMPASS_MOT_X");
        askAssistant(t("Fit the compass motor interference from my latest flight log with MAGFit, and propose the parameters."));
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.8c.35 3.1 1.55 5.2 3.7 7.35 2.15 2.15 4.25 3.35 7.35 3.7-3.1.35-5.2 1.55-7.35 3.7-2.15 2.15-3.35 4.25-3.7 7.35-.35-3.1-1.55-5.2-3.7-7.35-2.15-2.15-4.25-3.35-7.35-3.7 3.1-.35 5.2-1.55 7.35-3.7 2.15-2.15 3.35-4.25 3.7-7.35Z" /></svg>
      {t("From a flight")}
    </button>
  );

  const settings = (
    <div className="ms-card">
      <div className="ms-card-head"><b>{t("Settings")}</b></div>
      {enabled != null ? (
        <div className="ops-field">
          <span className="ops-field-copy"><b>{t("Compass")}</b><span>COMPASS_ENABLE · {t("reboot to change")}</span></span>
          <Switch on={!off} label={t("Compass")} onChange={setEnabled} />
        </div>
      ) : null}
      {off ? null : (
        <>
          <SelectField draft={draft} name="COMPASS_LEARN" label="Learn offsets" options={LEARN} />
          <SwitchField draft={draft} name="COMPASS_AUTODEC" label="Automatic declination" />
          <NumField draft={draft} name="COMPASS_OFFS_MAX" label="Max offsets" width={80} />
          <SelectField draft={draft} name="COMPASS_CAL_FIT" label="Calibration fit" options={CAL_FIT} />
          <SelectField draft={draft} name="COMPASS_AUTO_ROT" label="Auto-rotate on calibration" options={AUTO_ROT} />
        </>
      )}
    </div>
  );

  return (
    <div className="frs">
      <StepPreArm step="compass" />
      {!sample.ok ? <div className="frs-note info">{t("Connect a vehicle to read its compasses.")}</div> : null}
      {sample.ok && !loaded ? <div className="frs-note info">{t("Compass parameters have not arrived.")}</div> : null}
      {missing ? (
        <div className="frs-note warn cps-missing">
          <span>{t("No compass found on this boot, but the compass is still on (COMPASS_ENABLE 1). Connect one, or fly without a compass: turn it off and let the EKF take the heading from GPS.")}</span>
          {enabled != null ? <button type="button" className="frs-btn quiet" onClick={() => setEnabled(false)}>{t("Fly without a compass")}</button> : null}
        </div>
      ) : null}

      <div className="ms-top">
        <div className="ms-art acs-art">
          <HeadingDial heading={ekfYaw} pins={pins} off={off} />
          <span className={spread != null && spread > 15 ? "warn" : ""}>
            {off
              ? t("No compass · heading from the EKF")
              : usedHeadings.length
                ? `${Math.round(usedHeadings[0])}° ${t("magnetic")}${spread != null ? ` · ${spread > 15 ? t("compasses disagree by {n}°", { n: Math.round(spread) }) : t("compasses agree within {n}°", { n: Math.max(1, Math.round(spread)) })}` : ""}`
                : t("Live heading")}
          </span>
        </div>
        <div className="ms-cards">
          {off ? (
            <div className="ms-card">
              <div className="ms-card-head"><b>{t("Heading without a compass")}</b></div>
              <SelectField draft={draft} name="EK3_SRC1_YAW" label="Yaw source" options={YAW_SOURCE} />
              <span className="ms-hint">{t("GSF learns the heading from GPS velocity once the vehicle moves. A copter takes off in a mode that does not need it (Stabilize, Alt Hold) and has a heading after a short flight; a plane has it after the takeoff run. With a dual-antenna GPS, pick GPS.")}</span>
            </div>
          ) : (
            <div className="ms-card">
              <div className="ms-card-head">
                <b>{t("Calibration")}</b>
                <span className="ms-fix">{t("Outside, away from steel and cars")}</span>
              </div>
              {job(
                1,
                orientTarget ? "done" : "todo",
                "Orientation",
                orientTarget
                  ? [t("Compass {n} external", { n: orientTarget }), orientLabel(Math.round(num(params, indexed("ORIENT", orientTarget)) ?? 0)), customAngles(params, Math.round(num(params, indexed("ORIENT", orientTarget)) ?? 0))].filter(Boolean).join(" · ")
                  : t("Internal compasses follow the board orientation."),
                t("Detect"),
                orientTarget ? () => orientRef.current?.open() : null,
              )}
              {job(
                orientTarget ? 2 : 1,
                running ? "todo" : allStored ? "done" : "warn",
                "Calibration",
                running ? t("Running") : missing ? t("No compass found") : t("{n} of {m} in use calibrated", { n: used.filter((r) => deviceStored(params, r.cur)).length, m: used.length }),
                running ? t("Show") : t(allStored ? "Recalibrate" : "Calibrate"),
                missing ? null : () => setCalOpen(true),
                !allStored && !running,
              )}
              {missing ? null : job(
                orientTarget ? 3 : 2,
                num(params, "COMPASS_MOTCT") ? "done" : "todo",
                "Motor interference",
                t(motorKey(num(params, "COMPASS_MOTCT"))),
                t("Bench test"),
                plane ? null : () => setMotOpen(true),
                false,
                magfit,
              )}
              {typeof variance === "number" && Number.isFinite(variance) ? (
                <span className={`ms-hint${variance >= 0.5 ? " warn" : ""}`}>
                  {t(variance < 0.5 ? "EKF compass variance {n}. Consistent." : variance < 0.8 ? "EKF compass variance {n}. Watch it." : "EKF compass variance {n}. Inconsistent.", { n: variance.toFixed(2) })}
                  {" "}
                  {course == null ? t("GPS course needs more than 3 m/s.") : ekfYaw != null && angleGap(ekfYaw, course) > 30 ? t("Moving straight, the EKF heading should match the GPS course.") : t("The EKF heading matches the GPS course.")}
                </span>
              ) : null}
            </div>
          )}
          {settings}
        </div>
      </div>

      {off ? null : (
        <>
          <h4 className="sov-sect pas-sect">
            <span>{t("Compasses")}</span>
            <span className="pas-src">{t("priority order · the first one in use is primary")}</span>
          </h4>
          {rows.length || spare.length ? (
            <div className="cps-table" role="table">
              <div className="cps-tr head" role="row">
                <span /><span>#</span><span>{t("Sensor")}</span><span>{t("Orientation")}</span><span>{t("Use")}</span><span>{t("Calibration")}</span><span>{t("Field")}</span><span />
              </div>
              {rows.map((r, i) => {
                const dev = describeDevice(r.id, "compass");
                const external = r.cur ? (num(params, indexed("EXTERNAL", r.cur)) ?? 0) !== 0 : false;
                const use = draft.value(indexed("USE", r.pos));
                const length = r.cur ? lengthOf(triple(params, "OFS", r.cur)) : null;
                const defaults = r.cur ? factoryDefaults(params, r.cur) : false;
                const tooBig = length != null && offsMax != null && length > offsMax;
                const shape = r.cur ? fieldShape(r.cur - 1) : null;
                const bit = compassDriverBit(r.id);
                const primary = used[0]?.pos === r.pos;
                return (
                  <div key={r.id} className={`cps-tr${use === 0 || !r.cur ? " off" : ""}`} role="row">
                    <span className="cps-prio">
                      <button type="button" aria-label={t("Move up")} disabled={!hasPrio || i === 0} onClick={() => swap(r.pos - 1, r.pos)}>▲</button>
                      <button type="button" aria-label={t("Move down")} disabled={!hasPrio || i === rows.length - 1} onClick={() => swap(r.pos, r.pos + 1)}>▼</button>
                    </span>
                    <span className="sw-pin" style={{ background: use === 1 && r.cur ? PIN[r.pos - 1] : "#2a333c" }}>{r.pos}</span>
                    <span className="cps-sensor">
                      <b>{dev?.name ?? t("Compass {n}", { n: r.pos })}{primary ? <em>{t("primary")}</em> : null}</b>
                      <span>{r.cur ? `${t(external ? "External" : "Internal")}${dev?.where ? ` · ${dev.where}` : ""}` : t("Not detected on this boot")}</span>
                    </span>
                    <span className="cps-orient">
                      {r.cur && external ? (() => {
                        const value = Math.round(draft.value(indexed("ORIENT", r.cur)) ?? 0);
                        const angles = customAngles(params, value);
                        return (
                          <>
                            <select aria-label={t("Orientation of compass {n}", { n: r.pos })} value={value} title={angles || undefined} onChange={(e) => draft.set(indexed("ORIENT", r.cur), Number(e.target.value))}>
                              {orientChoices(params, value).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                            </select>
                            {angles ? <span className="cps-dim">{angles}</span> : null}
                          </>
                        );
                      })() : r.cur ? <span className="cps-dim">{t("Follows the board")}</span> : null}
                    </span>
                    <span>{use != null ? <Switch on={use === 1} label={t("Use compass {n}", { n: r.pos })} onChange={(on) => draft.set(indexed("USE", r.pos), on ? 1 : 0)} /> : null}</span>
                    <span className="cps-cal" title={r.cur && !defaults ? `${t("Offsets {x}. Length {length}.", { x: fmtTriple(triple(params, "OFS", r.cur), 1), length: fmt(length, 0) })} ${t("Diagonals {x}", { x: fmtTriple(triple(params, "DIA", r.cur), 3) })} · ${t("Off-diagonals {x}", { x: fmtTriple(triple(params, "ODI", r.cur), 3) })}` : undefined}>
                      {r.cur ? (
                        <>
                          <span className={`ms-dot ${defaults ? "" : tooBig ? "warn" : "done"}`} />
                          {defaults ? t("Not calibrated") : tooBig ? t("Offsets {n} · over the {max} limit", { n: fmt(length, 0), max: offsMax?.toFixed(0) ?? "" }) : t("Offsets {n}", { n: fmt(length, 0) })}
                        </>
                      ) : "—"}
                    </span>
                    <span className="cps-field" title={shape === "steady" ? t("Field length stayed steady while the board moved.") : shape === "changed" ? t("Field length changed while the board moved.") : t("Turn the board to see whether the field length stays steady.")}>
                      {r.cur && mags[r.cur - 1] != null ? (
                        <>
                          <span className={`ms-dot ${shape === "steady" ? "done" : shape === "changed" ? "warn" : ""}`} />
                          {t("{n} mG", { n: Math.round(mags[r.cur - 1] as number) })}
                          <span className="cps-dim">{shape === "steady" ? t("steady") : shape === "changed" ? t("changes as it turns") : t("turn it")}</span>
                        </>
                      ) : "—"}
                    </span>
                    <span className="cps-more">
                      <button type="button" aria-label={t("More")} aria-expanded={menu === r.id} onClick={() => setMenu(menu === r.id ? null : r.id)}>⋯</button>
                      {menu === r.id ? (
                        <span className="cps-menu" role="menu">
                          {hasPrio && i > 0 ? <button type="button" role="menuitem" onClick={() => { for (let k = r.pos; k > 1; k -= 1) swap(k - 1, k); setMenu(null); }}>{t("Move to 1st")}</button> : null}
                          {bit != null ? (
                            <button type="button" role="menuitem" className="warn" onClick={() => { draft.set("COMPASS_DISBLMSK", mask | (1 << bit)); setMenu(null); }}>
                              {t("Ignore every {name}", { name: COMPASS_DRIVER_BITS[bit] ?? dev?.name ?? "" })}
                              <small>{t("COMPASS_DISBLMSK · after a reboot this sensor type, internal or external, is not searched for")}</small>
                            </button>
                          ) : <span className="cps-dim">{t("This sensor type cannot be ignored.")}</span>}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
              {spare.map((r) => {
                const dev = describeDevice(r.id, "compass");
                return (
                  <div key={r.id} className="cps-tr off" role="row">
                    <span /><span className="sw-pin" style={{ background: "#2a333c" }}>·</span>
                    <span className="cps-sensor"><b>{dev?.name ?? "—"}</b><span>{dev?.where ?? ""}</span></span>
                    <span className="cps-dim">{t("Detected, not used")}</span>
                    <span /><span className="cps-dim">{t("Only the first three are used")}</span><span />
                    <span>{hasPrio ? <button type="button" className="frs-btn link" onClick={() => promote(r.id)}>{rows.length >= 3 ? t("Use instead of 3") : t("Use")}</button> : null}</span>
                  </div>
                );
              })}
            </div>
          ) : loaded ? <span className="ms-hint">{t("No compass detected.")}</span> : null}
          {reordered ? <div className="frs-note warn">{t("Order changed. It applies after a reboot; calibration moves with each compass, and Use is moved with it.")}</div> : null}
          {ignored.length ? (
            <div className="cps-ignored">
              <span className="ms-hint">{t("Ignored sensor types")}</span>
              {ignored.map(([bit, name]) => (
                <button key={bit} type="button" className="frs-pill" title={t("Search for it again after a reboot")} onClick={() => draft.set("COMPASS_DISBLMSK", mask & ~(1 << Number(bit)))}>{name} ×</button>
              ))}
              <span className="ms-hint">COMPASS_DISBLMSK</span>
            </div>
          ) : null}
        </>
      )}

      <CompassOrient ref={orientRef} />
      {motOpen ? <CompassMot onClose={() => setMotOpen(false)} /> : null}
      {calOpen ? <CompassCalWizard onClose={() => setCalOpen(false)} /> : null}
      <StepFooter draft={draft} armed={armed} ok={sample.ok} guide={GUIDE} guideLabel="Compass calibration" rebootNames={REBOOT} why={t("Order, ignored types and turning the compass off apply after a reboot.")} />
    </div>
  );
}

type CalPhase = "ready" | "run" | "result";

function compassClose(phase: CalPhase, slots: MagSlot[], rebooted: boolean): WizardClose {
  const sample = getLatest();
  const params = sample.params ?? {};
  const failed = slots.some((slot) => slot.status >= 5);
  const passed = slots.length > 0 && slots.every((slot) => slot.status === 4);
  const primary = slots[0];
  const fmt3 = (values: number[] | undefined) => values && values.length ? values.map((value) => value.toFixed(1)).join(", ") : null;
  return {
    outcome: phase === "result" && passed ? "completed" : phase === "result" && failed ? "failed" : "cancelled",
    measures: {
      phase,
      rebooted: rebooted ? 1 : 0,
      fitness: primary?.fitness ?? null,
      offsets: fmt3(primary?.ofs),
      diagonals: fmt3(primary?.diag),
      off_diagonals: fmt3(primary?.offdiag),
      compasses: slots.map((slot) => `${slot.id + 1}:${slot.status === 4 ? "ok" : slot.status >= 5 ? "failed" : "running"}${slot.fitness != null ? `:${slot.fitness.toFixed(1)}` : ""}`).join(" "),
      COMPASS_CAL_FIT: paramNum(params, "COMPASS_CAL_FIT"),
      ekf_variance: typeof sample.live_nums?.["EKF_STATUS_REPORT.compass_variance"] === "number"
        ? sample.live_nums["EKF_STATUS_REPORT.compass_variance"]
        : null,
    },
  };
}

const COMPASS_ICON = (
  <svg width={44} height={44} viewBox="0 0 44 44" fill="none" aria-hidden="true">
    <circle cx="22" cy="22" r="15" stroke="var(--ok)" strokeWidth="2" />
    <path d="M22 10l4 12-4 12-4-12z" fill="var(--hot)" opacity="0.85" />
  </svg>
);

/**
 * ArduPilot's onboard compass calibration: every compass at once, each filling its own sphere of 80 sections.
 * The result is per compass, with its fitness against COMPASS_CAL_FIT (doubled for all but the first).
 */
export function CompassCalWizard({ onClose, fromAssistant }: { onClose: (report?: WizardClose) => void; fromAssistant?: boolean }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // `started` is set by Start, `seen` once the board reports a run after it: so the screen does not fall back to
  // Ready while the first progress is on its way, and results left over from an earlier run are not shown.
  const runningAtOpen = () => ((getLatest().mag_cal ?? []) as MagSlot[]).some((slot) => slot.status >= 1 && slot.status <= 3);
  const [started, setStarted] = useState(runningAtOpen);
  const [seen, setSeen] = useState(runningAtOpen);
  /** The pose being asked for, kept until it is mostly seen. */
  const target = useRef<number | null>(null);
  const [outside, setOutside] = useState(false);
  const [props, setProps] = useState(false);
  const params = sample.params ?? {};
  const fresh = typeof sample.heartbeat_at === "number" && Date.now() / 1000 - sample.heartbeat_at < 3;
  const ready = sample.ok && !sample.armed && fresh;
  const slots = (sample.mag_cal ?? []) as MagSlot[];
  const running = slots.some((slot) => slot.status === 1 || slot.status === 2 || slot.status === 3);
  const finished = slots.length > 0 && slots.every((slot) => slot.status >= 4);
  useEffect(() => {
    if (started && running) setSeen(true);
    // Stopped without a result (cancelled on the board, or by another app): back to Ready.
    if (started && seen && !running && !finished) {
      setStarted(false);
      setSeen(false);
      setMessage("The board stopped the calibration.");
    }
  }, [started, seen, running, finished]);
  const phase: CalPhase = !started ? "ready" : seen && !running && finished ? "result" : "run";
  const waiting = phase === "run" && !(seen && running);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const needsAccept = slots.some((slot) => slot.status === 4 && slot.autosaved === 0);
  const fitLimit = num(params, "COMPASS_CAL_FIT");
  const failed = slots.filter((slot) => slot.status >= 5);
  const passed = slots.filter((slot) => slot.status === 4);
  const craft = sample.frame === "plane" ? "plane" : "copter";
  const vehicleLine = (sample.texts ?? []).find((text) => /compass/i.test(text));

  function leave(rebooted = false) {
    onClose(compassClose(phaseRef.current, (getLatest().mag_cal ?? []) as MagSlot[], rebooted));
  }

  async function send(action: "start" | "cancel" | "accept") {
    if (busy || !ready) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${APP_HTTP}/compass-cal?action=${action}`, { method: "POST" });
      const result = await response.json();
      const text = typeof result.message === "string" ? result.message : "Could not send compass calibration";
      const ok = /started|sent|accepted|cancel/i.test(text);
      if (!ok) setMessage(text);
      if (action === "start" && !ok) setStarted(false);
      if (action === "cancel") {
        setStarted(false);
        setSeen(false);
      }
    } catch {
      setMessage("Connection lost during calibration");
    } finally {
      setBusy(false);
    }
  }

  async function stopUsing(slot: MagSlot) {
    const name = indexed("USE", slot.id + 1);
    const from = num(params, name);
    const err = await writeParam(name, 0);
    if (err) setMessage(err);
    else noteUi([{ kind: "param", name, value: 0, from }]);
  }

  const limitOf = (slot: MagSlot) => (fitLimit == null ? null : slot.id === 0 ? fitLimit : fitLimit * 2);
  const first = slots[0];
  let left = <FaceArt i={3} craft={craft} />;
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
        <Toggle on={outside} icon={COMPASS_ICON} label={t("Outside, away from steel")} sub={t("Cars, desks with steel frames, rebar floors")} onToggle={() => setOutside(!outside)} />
        <Toggle on={props} icon={Icon.propOff} label={t("Propellers off")} sub={t("Easier to turn, safer to hold")} onToggle={() => setProps(!props)} />
      </div>
    );
    body = (
      <>
        <div className="mw-headline"><h3>{t("Turn it through every side")}</h3><p>{t("About a minute. Each compass fills its own sphere; slow turns fill it faster than quick ones.")}</p></div>
        <div className="mw-checks">
          <span className={sample.ok ? "ok" : "bad"}>{sample.ok ? Icon.check("var(--ok)", 12) : Icon.x("var(--hot)", 12)}{t(sample.ok ? "Connected" : "No link")}</span>
          <span className={sample.armed ? "bad" : "ok"}>{sample.armed ? Icon.x("var(--hot)", 12) : Icon.check("var(--ok)", 12)}{t(sample.armed ? "Armed" : "Disarmed")}</span>
        </div>
        <div className="sw-tiny"><FaceArt i={3} craft={craft} /><FaceArt i={1} craft={craft} /><FaceArt i={5} craft={craft} /></div>
        <span className="mw-dim mw-sm">{t("Nose down, then each side, then upside down: in each, turn it a full circle.")}</span>
        {fitLimit != null ? <span className="mw-dim mw-sm">{t("A fit must be under {n} mG for the first compass, double for the others (COMPASS_CAL_FIT).", { n: fitLimit.toFixed(0) })}</span> : null}
      </>
    );
    footer = (
      <>
        <span />
        <button type="button" className="mw-btn primary" disabled={!outside || !props || !ready || busy} onClick={() => { target.current = null; setSeen(false); setStarted(true); void send("start"); }}>
          <span>{busy ? t("Starting…") : t("Start")}</span>{Icon.chevR()}
        </button>
      </>
    );
  } else if (waiting) {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Starting")}</h3><p>{t("Waiting for the board to start the calibration.")}</p></div>
        <HoldRing pct={null} label={t("Waiting for the board…")} tone="cyan" />
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" disabled={busy} onClick={() => void send("cancel")}>{t("Cancel calibration")}</button>
        <span />
      </>
    );
  } else if (phase === "run") {
    // Guide by the compass that is furthest behind: its emptiest pose is the one to turn to next.
    const behind = slots.reduce<MagSlot | null>((m, s) => (!m || s.pct < m.pct ? s : m), null);
    const cover = behind ? poseCoverage(maskBits(behind.mask)) : [];
    const next = nextPose(cover, target.current);
    target.current = next;
    const now = poseNow(sample.live_nums);
    left = behind ? (
      <div className="sw-art sw-next">
        <CoverageSphere bits={maskBits(behind.mask)} craft={craft} />
        <b>{next != null ? t("Next: {pose}", { pose: t(FACES[next].name) }) : t("Compass {n}: {pct}%", { n: behind.id + 1, pct: behind.pct })}</b>
      </div>
    ) : left;
    body = (
      <>
        <div className="mw-headline">
          <h3>{t("Keep turning")}</h3>
          <p>{next == null
            ? t("Almost there: keep turning slowly through every side.")
            : now === next
              ? t("It is on this side now. Turn it slowly a full circle, keeping it there.")
              : t(FACES[next].ask[craft], { n: next + 1 }).replace(/^[^.]*\. /, "") + " " + t("Then turn it slowly a full circle.")}</p>
        </div>
        {slots.map((slot) => (
          <div key={slot.id} className="sw-mag">
            <span className="sw-pin" style={{ background: PIN[slot.id] ?? "#2a333c" }}>{slot.id + 1}</span>
            <div className="mw-grow">
              <div className="mw-row-between"><b className="mw-sm">{t("Compass {n}", { n: slot.id + 1 })}</b><span className="mw-dim mw-sm">{slot.pct}%</span></div>
              <i><b style={{ width: `${Math.max(0, Math.min(100, slot.pct))}%` }} /></i>
            </div>
          </div>
        ))}
        {behind ? <PoseCoverageGrid cover={cover} craft={craft} next={next} now={now} /> : null}
        {behind && slots.length > 1 ? <span className="mw-dim mw-sm">{t("Poses shown for compass {n}, the one furthest behind.", { n: behind.id + 1 })}</span> : null}
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" disabled={busy} onClick={() => void send("cancel")}>{t("Cancel calibration")}</button>
        <span />
      </>
    );
  } else {
    left = first ? <div className="sw-art"><CoverageSphere bits={maskBits(first.mask)} craft={craft} tone={failed.length ? "amber" : "ok"} /></div> : left;
    body = (
      <>
        <div className="mw-headline">
          <h3>{failed.length === 0 ? t("Every compass fits") : passed.length ? t("{n} did not fit", { n: failed.map((s) => t("Compass {n}", { n: s.id + 1 })).join(", ") }) : t("Calibration failed")}</h3>
          <p>{needsAccept ? t("The board is waiting for you to accept the fit.") : failed.length === 0 ? t("ArduPilot saved the new offsets. It uses them after a reboot.") : t("The compasses that fit are saved.")}</p>
        </div>
        <div className="mw-sums">
          {slots.map((slot) => {
            const limit = limitOf(slot);
            return (
              <div key={slot.id} className={`mw-sum${slot.status >= 5 ? " warn" : ""}`}>
                <span className="mw-dim mw-sm">{t("Compass {n} · fit", { n: slot.id + 1 })}</span>
                <b>{slot.fitness != null ? `${slot.fitness.toFixed(1)} mG` : t(statusKey(slot.status), { n: slot.status })}</b>
                <span className="mw-dim mw-sm">{limit != null ? t("limit {n}", { n: limit.toFixed(0) }) : ""}{slot.ofs?.length ? ` · ${t("offsets {n}", { n: Math.round(Math.hypot(slot.ofs[0] ?? 0, slot.ofs[1] ?? 0, slot.ofs[2] ?? 0)) })}` : ""}</span>
              </div>
            );
          })}
        </div>
        {failed.length ? (
          <div className="sw-fail">
            <b>{t("Usually steel nearby, a power lead next to the compass, or turns too fast.")}</b>
            <p>{t("An internal compass close to the ESCs often never fits.")}</p>
          </div>
        ) : null}
        {failed.length && passed.length ? failed.map((slot) => (
          <div key={slot.id} className="mw-note info"><span>{t("Or stop using compass {n}: the others are enough.", { n: slot.id + 1 })}</span><button type="button" className="mw-link" onClick={() => void stopUsing(slot)}>{t("Don't use compass {n}", { n: slot.id + 1 })}</button></div>
        )) : null}
        {!failed.length && !needsAccept ? <div className="mw-note warn">{Icon.warn()}<span>{t("Reboot the board to use the new calibration.")}</span></div> : null}
      </>
    );
    footer = needsAccept ? (
      <>
        <button type="button" className="mw-btn text" onClick={() => { setStarted(false); setSeen(false); }}>{t("Measure again")}</button>
        <button type="button" className="mw-btn primary" disabled={busy || !ready} onClick={() => void send("accept")}>{t("Accept calibration")}</button>
      </>
    ) : failed.length ? (
      <>
        <button type="button" className="mw-btn text" onClick={() => leave()}>{t("Finish")}</button>
        <button type="button" className="mw-btn primary" onClick={() => { setStarted(false); setSeen(false); }}>{t("Measure again")}</button>
      </>
    ) : (
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
  }

  return (
    <SensorWizard
      title={t("Compass calibration")}
      fromAssistant={fromAssistant}
      steps={[t("Ready"), t("Turn it"), t("Result")]}
      step={phase === "ready" ? 0 : phase === "run" ? 1 : 2}
      left={left}
      body={<>{body}{message ? <div className="mw-note warn">{Icon.warn()}<span>{t(message)}</span></div> : null}{vehicleLine && phase !== "ready" ? <span className="mw-dim mw-sm">{vehicleLine}</span> : null}</>}
      footer={footer}
      blocker={phase === "run" ? (!sample.ok ? "lost" : sample.armed ? "armed" : null) : null}
      busy={busy}
      onClose={() => leave()}
    />
  );
}
