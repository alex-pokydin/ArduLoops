import { Fragment, memo, useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { getSetupSnapshot, subscribe } from "../mav/store";
import { useStorePicked, useVehicle } from "../mav/view";
import { BatteryWizard } from "./BatterySetup";
import { CalibrationPanel } from "./CalibrationPanel";
import { ParameterLibrary } from "./ParameterLibrary";
import { CompassPanel } from "./CompassPanel";
import { AirspeedWizard, FailsafeWizard, FrameWizard, ModeWizard, MotorWizard, RadioWizard, ServoWizard, stepGlance } from "./SetupWizards";

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

type Step = {
  id: string;
  title: string;
  body: string;
  kind: "frame" | "motors" | "radio" | "level" | "compass" | "modes" | "failsafe" | "battery" | "servos" | "airspeed";
};

const RADIO: Step = {
  id: "radio",
  title: "rc",
  body: "Watch every channel, save the stick ends, and reverse a stick that moves the wrong way. The receiver port stays as it is.",
  kind: "radio",
};

const BATTERY: Step = {
  id: "battery",
  title: "battery",
  body: "Set the sensor and the capacity, then match the voltage and zero the current if you want. What the vehicle does when the battery is low stays on the failsafe step.",
  kind: "battery",
};

const servoFocus = (name: string) => /^SERVO/.test(name);

const LEVEL: Step = {
  id: "level",
  title: "Level and sensors",
  body: "Propellers off. Pick a sensor, match the picture, then start.",
  kind: "level",
};

const COMPASS: Step = {
  id: "compass",
  title: "Compass setup",
  body: "Stored offsets are the last calibration. Start runs a new one: turn the vehicle until every compass fills.",
  kind: "compass",
};

const MODES: Step = {
  id: "modes",
  title: "Flight modes",
  body: "Find the switch channel, then give each position a mode you can fly.",
  kind: "modes",
};

const COPTER: Step[] = [
  { id: "frame", title: "Frame", body: "Pick the picture that matches the frame, then save it.", kind: "frame" },
  { id: "motors", title: "Motor numbering", body: "The numbers are the motors. The setup spins each output and you tap the arm that turned.", kind: "motors" },
  RADIO,
  LEVEL,
  COMPASS,
  MODES,
  { id: "failsafe", title: "Failsafe", body: "Choose what the vehicle does when the radio or the battery is lost, before the first flight.", kind: "failsafe" },
  BATTERY,
  { id: "servos", title: "servos", body: "Output channel settings. Motor names are the motor step.", kind: "servos" },
];

const PLANE: Step[] = [
  { id: "servos", title: "Servo outputs", body: "Name the four surfaces, and reverse one that moves the wrong way. ESC calibration stays in the wiki, with the propeller removed.", kind: "servos" },
  RADIO,
  LEVEL,
  COMPASS,
  MODES,
  { id: "failsafe", title: "Failsafe", body: "Choose what the plane does when the radio or the battery is lost. The EKF threshold stays in the wiki.", kind: "failsafe" },
  { id: "airspeed", title: "Airspeed", body: "If there is no airspeed sensor, say so. The usual default expects a sensor that may not be fitted.", kind: "airspeed" },
  BATTERY,
];

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
  }>(
    (s) => {
      const frame = vehicle;
      const steps = frame === "plane" ? PLANE : COPTER;
      const params = s.params || {};
      const rc = s.rc ?? [];
      return {
        frame,
        glances: steps.map((item) => stepGlance(item.kind, frame, params, rc)),
      };
    },
    (a, b) =>
      a.frame === b.frame &&
      a.glances.length === b.glances.length &&
      a.glances.every((g, i) => g.text === b.glances[i].text && g.live === b.glances[i].live),
  );
  const frame = face.frame;
  const steps = frame === "plane" ? PLANE : COPTER;
  const [open, setOpen] = useState(steps[0].id);
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
      <ol className="setup-list">
        {steps.map((item, index) => {
          const on = item.id === step.id;
          const glance = face.glances[index];
          const state = glance.text.includes(" · ")
            ? glance.text.split(" · ").map((part) => t(part)).join(" · ")
            : glance.text.includes("/") || /^\d/.test(glance.text) ? glance.text : t(glance.text);
          return (
            <li key={item.id}>
              <button
                type="button"
                className={on ? "setup-step on" : "setup-step"}
                aria-current={on ? "true" : undefined}
                onClick={() => setOpen(item.id)}
              >
                <span className="setup-ico"><StepIcon kind={item.kind} /></span>
                <span className="setup-copy">
                  <b>{t(item.title)}</b>
                  {state ? <span className={glance.live ? "setup-state live" : "setup-state"} title={state}>{state}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
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
