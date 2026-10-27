import { Fragment, memo, useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { getSetupSnapshot, subscribe } from "../mav/store";
import { useStorePicked, useVehicle } from "../mav/view";
import { BatteryWizard } from "./BatterySetup";
import { CalibrationPanel } from "./CalibrationPanel";
import { ParameterLibrary } from "./ParameterLibrary";
import { CompassPanel } from "./CompassPanel";
import { AirspeedWizard, FailsafeWizard, FrameWizard, ModeWizard, MotorWizard, RadioWizard, ServoWizard, stepGlance } from "./SetupWizards";
import { prearmStep, stepState, type StepState } from "../lib/setupSteps";
import { PREARM_FRESH_S } from "../lib/vehicleHeader";

const COPTER_GUIDE = "https://ardupilot.org/copter/docs/configuring-hardware.html";
const PLANE_GUIDE = "https://ardupilot.org/plane/docs/plane-configuration-landing-page.html";

const AXES = [
  { label: "roll", key: "RCMAP_ROLL", fallback: 1 },
  { label: "pitch", key: "RCMAP_PITCH", fallback: 2 },
  { label: "Thr", key: "RCMAP_THROTTLE", fallback: 3 },
  { label: "yaw", key: "RCMAP_YAW", fallback: 4 },
] as const;

function pwmShare(raw: number): number {
  return Math.min(1, Math.max(0, (raw - 1000) / 1000));
}

export function sticksLive(rc: number[] | undefined): boolean {
  return (rc ?? []).some((value) => value >= 800 && value <= 2200);
}

export function RcLive() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const rc = sample.rc ?? [];
  const live = sticksLive(rc);
  return (
    <div className="rc-live" aria-label={t("rc")}>
      {AXES.map((axis) => {
        const mapped = sample.params?.[axis.key];
        const index = (Number.isFinite(mapped) ? Math.round(mapped as number) : axis.fallback) - 1;
        const raw = rc[index] ?? 0;
        const known = raw >= 800 && raw <= 2200;
        return (
          <Fragment key={axis.key}>
            <span>{t(axis.label)}</span>
            <i><b style={{ width: known ? `${pwmShare(raw) * 100}%` : "0%" }} /></i>
            <span>{known ? raw : "—"}</span>
          </Fragment>
        );
      })}
      {live ? null : <p>{t("No RC frames yet.")}</p>}
    </div>
  );
}

type Group = "Airframe" | "Sensors" | "Control" | "Safety";

type Step = {
  id: string;
  title: string;
  body: string;
  kind: "frame" | "motors" | "radio" | "level" | "compass" | "modes" | "failsafe" | "battery" | "servos" | "airspeed";
  group: Group;
  /** Not needed to fly: hidden by the Required filter and not counted. */
  optional?: boolean;
};

const RADIO: Step = {
  id: "radio",
  title: "Radio",
  body: "Watch every channel, save the stick ends, and reverse a stick that moves the wrong way. The receiver port stays as it is.",
  kind: "radio",
  group: "Control",
};

const BATTERY: Step = {
  id: "battery",
  title: "Battery",
  body: "Set the sensor and the capacity, then match the voltage and zero the current if you want. What the vehicle does when the battery is low stays on the failsafe step.",
  kind: "battery",
  group: "Sensors",
};

const servoFocus = (name: string) => /^SERVO/.test(name);

const LEVEL: Step = {
  id: "level",
  title: "Accelerometer",
  body: "Propellers off. Pick a sensor, match the picture, then start.",
  kind: "level",
  group: "Sensors",
};

const COMPASS: Step = {
  id: "compass",
  title: "Compass",
  body: "Stored offsets are the last calibration. Start runs a new one: turn the vehicle until every compass fills.",
  kind: "compass",
  group: "Sensors",
};

const MODES: Step = {
  id: "modes",
  title: "Flight modes",
  body: "Find the switch channel, then give each position a mode you can fly.",
  kind: "modes",
  group: "Control",
};

const GROUPS: Group[] = ["Airframe", "Sensors", "Control", "Safety"];

const COPTER: Step[] = [
  { id: "frame", title: "Frame", body: "Pick the picture that matches the frame, then save it.", kind: "frame", group: "Airframe" },
  { id: "motors", title: "Motors", body: "The numbers are the motors. The setup spins each output and you tap the arm that turned.", kind: "motors", group: "Airframe" },
  { id: "servos", title: "Other outputs", body: "Output channel settings. Motor names are the motor step.", kind: "servos", group: "Airframe", optional: true },
  LEVEL,
  COMPASS,
  BATTERY,
  RADIO,
  MODES,
  { id: "failsafe", title: "Failsafes", body: "Choose what the vehicle does when the radio or the battery is lost, before the first flight.", kind: "failsafe", group: "Safety" },
];

const PLANE: Step[] = [
  { id: "servos", title: "Outputs", body: "Name the four surfaces, and reverse one that moves the wrong way. ESC calibration stays in the wiki, with the propeller removed.", kind: "servos", group: "Airframe" },
  LEVEL,
  COMPASS,
  { id: "airspeed", title: "Airspeed", body: "If there is no airspeed sensor, say so. The usual default expects a sensor that may not be fitted.", kind: "airspeed", group: "Sensors" },
  BATTERY,
  RADIO,
  MODES,
  { id: "failsafe", title: "Failsafes", body: "Choose what the plane does when the radio or the battery is lost. The EKF threshold stays in the wiki.", kind: "failsafe", group: "Safety" },
];

const STATE_LABEL: Record<StepState, string> = { done: "Done", warn: "Needs attention", fail: "Blocks arming", todo: "To do", opt: "Optional" };

function StateIcon({ state }: { state: StepState }) {
  if (state === "done") return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" className="si-ok" /><path d="M4.8 8.2l2.2 2.2 4.2-4.6" className="si-mark" /></svg>;
  if (state === "warn") return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" className="si-warn" /><path d="M8 4.4v4.4" className="si-mark" /><circle cx="8" cy="11.4" r="1" className="si-dot" /></svg>;
  if (state === "fail") return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" className="si-hot" /><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" className="si-mark" /></svg>;
  if (state === "opt") return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 8h6" className="si-dash" /></svg>;
  return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" className="si-todo" /></svg>;
}

function StepIcon({ kind }: { kind: Step["kind"] }) {
  const p = { viewBox: "0 0 16 16", "aria-hidden": true as const, fill: "none", stroke: "currentColor", strokeWidth: 1.4 };
  if (kind === "frame" || kind === "motors") {
    return (
      <svg {...p}>
        <polygon points="8,1.5 10,4.5 6,4.5" fill="currentColor" stroke="none" />
        <circle cx="4.5" cy="8" r="1.6" /><circle cx="11.5" cy="8" r="1.6" />
        <circle cx="6" cy="13" r="1.6" /><circle cx="10" cy="13" r="1.6" />
      </svg>
    );
  }
  if (kind === "radio") {
    return <svg {...p}><rect x="2" y="5" width="12" height="8" rx="1.5" /><path d="M6 5V3M10 5V3" /></svg>;
  }
  if (kind === "level") {
    return <svg {...p}><path d="M2 11h12" /><path d="M4 11l4-6 4 6" /></svg>;
  }
  if (kind === "compass") {
    return <svg {...p}><circle cx="8" cy="8" r="5.5" /><polygon points="8,3.5 9.2,8 6.8,8" fill="currentColor" stroke="none" /></svg>;
  }
  if (kind === "modes") {
    return <svg {...p}><path d="M3 12V4M8 12V7M13 12V2" /></svg>;
  }
  if (kind === "servos") {
    return <svg {...p}><path d="M2 10 L8 4 L14 10" /><path d="M5 10h6" /></svg>;
  }
  if (kind === "battery") {
    return <svg {...p}><rect x="3" y="4" width="10" height="9" rx="1" /><path d="M6 4V2.5h4V4" /><path d="M5.5 8.5h5" /></svg>;
  }
  if (kind === "airspeed") {
    return <svg {...p}><path d="M2 9h8l4-3v5H2z" /></svg>;
  }
  return <svg {...p}><path d="M8 2.5v6" /><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
}

export const HardwareSetup = memo(function HardwareSetup() {
  const t = useT();
  const vehicle = useVehicle();
  const face = useStorePicked<{
    frame: "copter" | "plane";
    glances: { text: string; live: boolean }[];
    prearm: string[][];
  }>(
    (s) => {
      const frame = vehicle;
      const steps = frame === "plane" ? PLANE : COPTER;
      const params = s.params || {};
      const rc = s.rc ?? [];
      // PreArm lines still being repeated by the vehicle, sorted onto the step that fixes them.
      const now = s.heartbeat_at ?? 0;
      const fresh = s.ok && !s.armed ? (s.prearm ?? []).filter((line) => now - line.at <= PREARM_FRESH_S) : [];
      return {
        frame,
        glances: steps.map((item) => stepGlance(item.kind, frame, params, rc)),
        prearm: steps.map((item) => fresh.filter((line) => prearmStep(line.text) === item.id).map((line) => line.text)),
      };
    },
    (a, b) =>
      a.frame === b.frame &&
      a.glances.length === b.glances.length &&
      a.glances.every((g, i) => g.text === b.glances[i].text && g.live === b.glances[i].live) &&
      a.prearm.every((p, i) => p.join("\n") === (b.prearm[i] ?? []).join("\n")),
  );
  const frame = face.frame;
  const steps = frame === "plane" ? PLANE : COPTER;
  const [open, setOpen] = useState(steps[0].id);
  const [requiredOnly, setRequiredOnly] = useState(false);
  const states = steps.map((item, i) => stepState(face.glances[i], face.prearm[i] ?? [], !!item.optional));
  const required = steps.filter((item) => !item.optional);
  const done = steps.filter((item, i) => !item.optional && states[i].state === "done").length;
  const attention = states.filter((st) => st.state === "warn" || st.state === "fail").length;
  useEffect(() => {
    if (!steps.some((step) => step.id === open)) setOpen(steps[0].id);
  }, [steps, open]);
  const step = steps.find((item) => item.id === open) ?? steps[0];
  const guide = frame === "plane" ? PLANE_GUIDE : COPTER_GUIDE;
  return (
    <div className="setup">
      <p className="setup-lead">
        {t("First setup for a {frame}.", { frame: t(frame) })}
        {" "}
        {t("This is the order of work, not a list of finished items.")}
        {" "}
        <a href={guide} target="_blank" rel="noreferrer">{t("ArduPilot mandatory hardware")}</a>
      </p>
      <nav className="setup-rail" aria-label={t("Setup steps")}>
        <div className="setup-rail-top">
          <div className="setup-rail-row">
            <b>{t("{done} of {total} required", { done, total: required.length })}</b>
            <span className="setup-seg" role="group" aria-label={t("Show steps")}>
              <button type="button" aria-pressed={requiredOnly} onClick={() => setRequiredOnly(true)}>{t("Required")}</button>
              <button type="button" aria-pressed={!requiredOnly} onClick={() => setRequiredOnly(false)}>{t("All")}</button>
            </span>
          </div>
          <span className={attention ? "setup-bar amber" : "setup-bar"}><i style={{ width: `${required.length ? Math.round((done / required.length) * 100) : 0}%` }} /></span>
        </div>
        {GROUPS.map((group) => {
          const members = steps.map((item, i) => ({ item, i })).filter(({ item }) => item.group === group && (!requiredOnly || !item.optional));
          if (!members.length) return null;
          const need = members.filter(({ item }) => !item.optional);
          const groupDone = need.filter(({ i }) => states[i].state === "done").length;
          return (
            <div className="setup-group" key={group}>
              <div className="setup-group-head"><span>{t(group)}</span><span>{need.length ? `${groupDone}/${need.length}` : t("optional")}</span></div>
              <ol className="setup-list">
                {members.map(({ item, i }) => {
                  const on = item.id === step.id;
                  const st = states[i];
                  const reason = st.reason.includes(" · ")
                    ? st.reason.split(" · ").map((part) => t(part)).join(" · ")
                    : st.reason.includes("/") || /^\d/.test(st.reason) || st.state === "fail" ? st.reason : t(st.reason);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`setup-step ${st.state}${on ? " on" : ""}`}
                        aria-current={on ? "true" : undefined}
                        onClick={() => setOpen(item.id)}
                      >
                        <span className="setup-ico"><StepIcon kind={item.kind} /></span>
                        <span className="setup-copy">
                          <b>{t(item.title)}</b>
                          {reason ? <span className="setup-state" title={reason}>{reason}</span> : null}
                        </span>
                        <span className="setup-mark" title={t(STATE_LABEL[st.state])} aria-label={t(STATE_LABEL[st.state])}><StateIcon state={st.state} /></span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </nav>
      <div className="setup-detail">
        <p>{t(step.body)}</p>
        {step.kind === "frame" ? <FrameWizard /> : null}
        {step.kind === "motors" ? <MotorWizard /> : null}
        {step.kind === "radio" ? <><RcLive /><RadioWizard /></> : null}
        {step.kind === "level" ? <CalibrationPanel /> : null}
        {step.kind === "compass" ? <CompassPanel /> : null}
        {step.kind === "modes" ? <ModeWizard frame={frame} /> : null}
        {step.kind === "failsafe" ? <FailsafeWizard frame={frame} /> : null}
        {step.kind === "battery" ? <BatteryWizard /> : null}
        {step.kind === "servos" ? (frame === "plane" ? <ServoWizard /> : <ParameterLibrary focus={servoFocus} />) : null}
        {step.kind === "airspeed" ? <AirspeedWizard /> : null}
      </div>
    </div>
  );
});
