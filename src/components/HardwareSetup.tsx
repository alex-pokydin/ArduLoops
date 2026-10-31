import { Fragment, memo, useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { getSetupSnapshot, subscribe } from "../mav/store";
import { useStorePicked, useVehicle } from "../mav/view";
import { BatteryWizard } from "./BatterySetup";
import { AccelStep } from "./AccelStep";
import { CompassPanel } from "./CompassPanel";
import { FrameStep } from "./FrameStep";
import { PlaneAirframeStep } from "./PlaneAirframeStep";
import { AirspeedWizard, FailsafeWizard, ModeWizard, RadioWizard, stepGlance } from "./SetupWizards";
import { MotorsStep } from "./MotorsStep";
import { PlaneOutputsStep } from "./PlaneOutputsStep";
import { PreArmHead } from "./ArmingChecks";
import { nextSteps, prearmAsk, prearmStep, prearmTopic, stepOfParam, stepParamNames, stepState, type Glance, type StepState } from "../lib/setupSteps";

/** Done, or turned off on purpose: either way nothing is left to do on the step. */
const settled = (state: StepState) => state === "done" || state === "off";
import { OPEN_SETUP_OVERVIEW } from "../lib/setupNav";
import { askAssistant, openAssistant, showAssistant } from "../lib/assistantAsk";
import { getSetupView, getWaitingCards, setSetupView, setViewFocus, subscribeSetupView, type WaitingCard } from "../lib/setupView";
import { APP_HTTP } from "../mav/link";
import { PREARM_FRESH_S, preArmState } from "../lib/vehicleHeader";
import type { Sample } from "../mav/types";

function liveNum(sample: Sample, key: string): number | null {
  const value = sample.live_nums?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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
  kind: "frame" | "motors" | "radio" | "level" | "compass" | "modes" | "failsafe" | "battery" | "servos" | "airspeed" | "airframe";
  group: Group;
  /** Not needed to fly: hidden by the Required filter and not counted. */
  optional?: boolean;
  /** Parameters the step reads: exact names, or a prefix ending in `*`. setup_status lists them; an assistant card for one marks the step. */
  params: string[];
  /** The wizard_widget id that opens this step's wizard. */
  wizard?: string;
  /** Without this parameter on the board (a build without the feature) the step is hidden. */
  needs?: string;
};

const RADIO: Step = {
  id: "radio",
  title: "Radio",
  body: "Watch every channel, save the stick ends, and reverse a stick that moves the wrong way. The receiver port stays as it is.",
  kind: "radio",
  group: "Control",
  params: ["RCMAP_*", "RC*"],
  wizard: "radio",
};

const BATTERY: Step = {
  id: "battery",
  title: "Battery",
  body: "Set the sensor and the capacity, then match the voltage and zero the current if you want. What the vehicle does when the battery is low stays on the failsafe step.",
  kind: "battery",
  group: "Sensors",
  params: ["BATT_*"],
  wizard: "battery",
  needs: "BATT_MONITOR",
};


const LEVEL: Step = {
  id: "level",
  title: "Accelerometer",
  body: "Teach the board which way is down, then where level is on this frame.",
  kind: "level",
  group: "Sensors",
  params: ["AHRS_ORIENTATION", "AHRS_TRIM_*", "INS_ACC*", "INS_USE*", "INS_GYR_CAL", "ARMING_ACCTHRESH"],
  wizard: "accel",
};

const COMPASS: Step = {
  id: "compass",
  title: "Compass",
  body: "Which compasses to trust, which way they face, and their calibration.",
  kind: "compass",
  group: "Sensors",
  params: ["COMPASS_*"],
  wizard: "compass",
  needs: "COMPASS_USE",
};

const MODES: Step = {
  id: "modes",
  title: "Flight modes",
  body: "Find the switch channel, then give each position a mode you can fly.",
  kind: "modes",
  group: "Control",
  params: ["FLTMODE*", "MODE_CH", "MODE*"],
  wizard: "modes",
};

const GROUPS: Group[] = ["Airframe", "Sensors", "Control", "Safety"];

const COPTER_FS = ["FS_THR_ENABLE", "FS_THR_VALUE", "FS_GCS_ENABLE", "FS_EKF_ACTION", "FS_EKF_THRESH", "BATT_FS_LOW_ACT", "BATT_FS_CRT_ACT", "FS_*"];
const PLANE_FS = ["THR_FAILSAFE", "THR_FS_VALUE", "FS_SHORT_ACTN", "FS_SHORT_TIMEOUT", "FS_LONG_ACTN", "FS_LONG_TIMEOUT", "FS_GCS_ENABL", "BATT_FS_LOW_ACT", "BATT_FS_CRT_ACT", "FS_*"];

// Step ids are also the `setup_status` sections: keep the enum in src-tauri/src/agent/schema.rs the same.
const COPTER: Step[] = [
  { id: "frame", title: "Frame", body: "How many arms, and how the motors are laid out.", kind: "frame", group: "Airframe", params: ["FRAME_CLASS", "FRAME_TYPE"] },
  { id: "motors", title: "Motors & outputs", body: "What is on each output: which motor, which way it spins, and every servo or payload.", kind: "motors", group: "Airframe", params: ["MOT_*", "SERVO_DSHOT_ESC", "SERVO_BLH_*", "SERVO*"], wizard: "motors" },
  LEVEL,
  COMPASS,
  BATTERY,
  RADIO,
  MODES,
  { id: "failsafe", title: "Failsafes", body: "Choose what the vehicle does when the radio or the battery is lost, before the first flight.", kind: "failsafe", group: "Safety", params: COPTER_FS, wizard: "failsafe" },
];

const PLANE: Step[] = [
  { id: "airframe", title: "Airframe type", body: "Pick the surface layout. Outputs are matched on the next step.", kind: "airframe", group: "Airframe", params: ["Q_ENABLE", "Q_FRAME_CLASS", "Q_FRAME_TYPE", "Q_TILT_ENABLE", "Q_TAILSIT_ENABLE"] },
  { id: "servos", title: "Outputs", body: "Everything on an output: each surface, the throttle, the lift motors with QuadPlane, and anything else.", kind: "servos", group: "Airframe", params: ["SERVO*", "THR_MIN", "THR_MAX", "THR_SLEWRATE", "THR_PASS_STAB", "TRIM_THROTTLE", "Q_M_PWM_TYPE", "Q_TRANSITION_MS", "Q_TRANS_DECEL", "Q_ASSIST_SPEED", "MIXING_GAIN", "KFF_RDDRMIX", "DSPOILER_AILMTCH"], wizard: "servos" },
  LEVEL,
  COMPASS,
  { id: "airspeed", title: "Airspeed", body: "If there is no airspeed sensor, say so. The usual default expects a sensor that may not be fitted.", kind: "airspeed", group: "Sensors", params: ["ARSPD*"], wizard: "airspeed", needs: "ARSPD_TYPE" },
  BATTERY,
  RADIO,
  MODES,
  { id: "failsafe", title: "Failsafes", body: "Choose what the plane does when the radio or the battery is lost. The EKF threshold stays in the wiki.", kind: "failsafe", group: "Safety", params: PLANE_FS, wizard: "failsafe" },
];

const STATE_LABEL: Record<StepState, string> = { done: "Done", warn: "Needs attention", fail: "Blocks arming", todo: "To do", opt: "Optional", off: "Off" };

function StateIcon({ state }: { state: StepState }) {
  if (state === "done") return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" className="si-ok" /><path d="M4.8 8.2l2.2 2.2 4.2-4.6" className="si-mark" /></svg>;
  if (state === "warn") return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" className="si-warn" /><path d="M8 4.4v4.4" className="si-mark" /><circle cx="8" cy="11.4" r="1" className="si-dot" /></svg>;
  if (state === "fail") return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" className="si-hot" /><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" className="si-mark" /></svg>;
  if (state === "opt") return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 8h6" className="si-dash" /></svg>;
  if (state === "off") return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" className="si-todo" /><path d="M5 8h6" className="si-dash" /></svg>;
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
  if (kind === "airframe") {
    return <svg {...p}><path d="M8 1.5v13M1.5 7h13M5.5 13h5" /></svg>;
  }
  return <svg {...p}><path d="M8 2.5v6" /><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" /></svg>;
}

const OVERVIEW = "overview";

type ArmKind = ReturnType<typeof preArmState>["kind"] | "off";
type Translate = ReturnType<typeof useT>;

/** A step's short reason in the UI language. Numbers, slashes and ArduPilot's own PreArm text stay as they are. */
function stateReason(t: Translate, st: { state: StepState; reason: string }): string {
  if (st.reason.includes(" · ")) return st.reason.split(" · ").map((part) => t(part)).join(" · ");
  return st.reason.includes("/") || /^\d/.test(st.reason) || st.state === "fail" ? st.reason : t(st.reason);
}

/** English needs a singular; the Ukrainian strings use "label: n" and read the same either way. */
function counted(t: Translate, n: number, one: string, many: string): string {
  return n === 1 ? t(one) : t(many, { n });
}

function OverviewIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.4}>
      <rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}

function Chevron() {
  return <svg className="sov-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg>;
}

type Tone = "hot" | "amber" | "ok" | "";

function AskButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="setup-ask" onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d={SPARK} />
      </svg>
      {label}
    </button>
  );
}

const SPARK = "M12 1.8c.35 3.1 1.55 5.2 3.7 7.35 2.15 2.15 4.25 3.35 7.35 3.7-3.1.35-5.2 1.55-7.35 3.7-2.15 2.15-3.35 4.25-3.7 7.35-.35-3.1-1.55-5.2-3.7-7.35-2.15-2.15-4.25-3.35-7.35-3.7 3.1-.35 5.2-1.55 7.35-3.7 2.15-2.15 3.35-4.25 3.7-7.35Z";

/** Sends one sentence to the assistant at once, in a new chat; writes still stop on cards. */
export function FixButton({ text, focus, small, onSent }: { text: string; focus?: string; small?: boolean; onSent?: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className={`setup-fix${small ? " sm" : ""}`}
      title={t("Ask the assistant to fix this. Changes still wait for your approval.")}
      onClick={(ev) => {
        ev.stopPropagation();
        setViewFocus(focus);
        askAssistant(text);
        onSent?.();
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={SPARK} /></svg>
      {t("Fix")}
    </button>
  );
}

function Ring({ done, total, tone }: { done: number; total: number; tone: Tone }) {
  const r = 40;
  const arc = total ? (2 * Math.PI * r * done) / total : 0;
  return (
    <div className={`sov-ring ${tone}`}>
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <circle cx="48" cy="48" r={r} className="sov-ring-track" />
        {done ? <circle cx="48" cy="48" r={r} className="sov-ring-arc" strokeDasharray={`${arc} 999`} transform="rotate(-90 48 48)" /> : null}
      </svg>
      <span><b>{done}</b>/{total}</span>
    </div>
  );
}

/**
 * The Setup landing view: can this vehicle arm, which live PreArm checks fail and where each is fixed,
 * what to do next, and how far each group is.
 */
function SetupOverview({
  steps,
  states,
  lines,
  arm,
  done,
  total,
  reasonOf,
  onOpen,
  hidden,
  quadPlaneOff,
}: {
  steps: Step[];
  states: { state: StepState; reason: string }[];
  lines: string[];
  arm: ArmKind;
  done: number;
  total: number;
  reasonOf: (st: { state: StepState; reason: string }) => string;
  onOpen: (id: string) => void;
  /** Steps this firmware has no parameters for. */
  hidden: Step[];
  /** A plane with Q_ENABLE = 0. */
  quadPlaneOff: boolean;
}) {
  const t = useT();
  const rows = steps.map((item, i) => ({ item, st: states[i] })).filter(({ item }) => !item.optional);
  const count = (state: StepState) => rows.filter((row) => row.st.state === state).length;
  const fail = count("fail");
  const warn = count("warn");
  const todo = count("todo");
  const left = total - done;
  const tone: Tone = arm === "failing" || fail ? "hot" : warn ? "amber" : left === 0 && (arm === "ready" || arm === "armed") ? "ok" : "";

  let title: string;
  let line: string;
  if (arm === "off") {
    title = t("No vehicle linked");
    line = t("Connect a vehicle to read its pre-arm checks.");
  } else if (arm === "armed") {
    title = t("Armed");
    line = left
      ? counted(t, left, "The pre-arm checks passed when it armed. 1 required step is still open.", "The pre-arm checks passed when it armed. {n} required steps are still open.")
      : t("The pre-arm checks passed when it armed, and every required step is done.");
  } else if (arm === "failing") {
    title = t("Not ready to arm");
    line = counted(t, lines.length, "1 pre-arm check fails. Fix it first, then work down the steps.", "{n} pre-arm checks fail. Fix them first, then work down the steps.");
  } else if (arm === "ready") {
    title = t("Ready to arm");
    line = left
      ? counted(t, left, "The pre-arm checks pass. 1 required step is still open.", "The pre-arm checks pass. {n} required steps are still open.")
      : t("The pre-arm checks pass and every required step is done.");
  } else {
    title = t("No pre-arm report yet");
    line = t("The vehicle repeats a failing check about every 30 s. Nothing has arrived yet.");
  }

  const next = nextSteps(steps.map((item, i) => ({ item: { item, st: states[i] }, state: states[i].state, optional: !!item.optional })));
  const byId = new Map(steps.map((item) => [item.id, item]));

  // No link: like the header, nothing about any vehicle, so no counts, checks or next steps.
  if (arm === "off") {
    return (
      <div className="sov">
        <div className="sov-top">
          <Ring done={0} total={total} tone="" />
          <div className="sov-head"><h4>{title}</h4><p>{line}</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="sov">
      {hidden.length ? (
        <div className="frs-note info">
          {counted(t, hidden.length, "1 step is hidden: this firmware has no parameters for {list}.", "{n} steps are hidden: this firmware has no parameters for {list}.").replace("{list}", hidden.map((item) => t(item.title)).join(", "))}
        </div>
      ) : null}
      <div className={`sov-top ${tone}`}>
        <Ring done={done} total={total} tone={tone} />
        <div className="sov-head">
          <h4>{title}</h4>
          <p>{line}</p>
          <div className="sov-chips">
            {fail ? <span className="sov-chip hot">{counted(t, fail, "1 blocks arming", "{n} block arming")}</span> : null}
            {warn ? <span className="sov-chip amber">{counted(t, warn, "1 needs attention", "{n} need attention")}</span> : null}
            {todo ? <span className="sov-chip">{t("{n} to do", { n: todo })}</span> : null}
          </div>
        </div>
      </div>

      <PreArmHead failing={lines.length} />
      <div className="sov-pre">
        {lines.length ? (
          lines.map((text) => {
            const target = byId.get(prearmStep(text) ?? "");
            return (
              <div className="sov-prow fail" key={text}>
                <span className="setup-mark"><StateIcon state="fail" /></span>
                <span className="sov-msg">{text}</span>
                {target ? (
                  <button type="button" className="sov-goto" onClick={() => onOpen(target.id)}>
                    <span className="setup-ico"><StepIcon kind={target.kind} /></span>
                    {t(target.title)}
                    <Chevron />
                  </button>
                ) : (
                  <span className="sov-none">{t(prearmTopic(text)?.label ?? "No setup step")}</span>
                )}
                <FixButton text={t(prearmAsk(text), { line: text })} focus={text.slice(0, 32)} />
              </div>
            );
          })
        ) : (
          <div className={`sov-prow ${arm === "ready" || arm === "armed" ? "done" : ""}`}>
            {arm === "ready" || arm === "armed" ? <span className="setup-mark"><StateIcon state="done" /></span> : null}
            <span className="sov-empty">
              {arm === "armed"
                ? t("Checks passed at arming.")
                : arm === "ready"
                  ? t("All checks pass.")
                  : t("No PreArm messages in the last {s} s.", { s: PREARM_FRESH_S })}
            </span>
          </div>
        )}
      </div>

      <h4 className="sov-sect">{t("Next up")}</h4>
      {next.length ? (
        <div className="sov-next">
          {next.map(({ item, st }) => (
            <div key={item.id} className={`sov-card ${st.state}`}>
              <button type="button" className="sov-card-open" onClick={() => onOpen(item.id)}>
                <span className="setup-mark"><StateIcon state={st.state} /></span>
                <span className="sov-card-copy">
                  <b>{t(item.title)}</b>
                  <span>{reasonOf(st) || t(item.body)}</span>
                </span>
                <Chevron />
              </button>
              {st.state === "fail" || st.state === "warn" ? <FixButton small text={t("Fix: {step} — {reason}", { step: item.title, reason: st.reason })} /> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="sov-prow done"><span className="setup-mark"><StateIcon state="done" /></span><span className="sov-empty">{t("Every required step is done.")}</span></div>
      )}

      <h4 className="sov-sect">{t("Groups")}</h4>
      <div className="sov-groups">
        {GROUPS.map((group) => {
          const members = rows.filter(({ item }) => item.group === group);
          if (!members.length) return null;
          const groupDone = members.filter(({ st }) => settled(st.state)).length;
          const worst = members.find(({ st }) => st.state === "fail") ?? members.find(({ st }) => st.state === "warn") ?? members.find(({ st }) => st.state === "todo");
          const groupTone = worst?.st.state === "fail" ? "hot" : worst?.st.state === "warn" ? "amber" : worst ? "" : "ok";
          return (
            <button type="button" key={group} className={`sov-gtile${groupTone ? ` is-${groupTone}` : ""}`} onClick={() => onOpen((worst ?? members[0]).item.id)}>
              <span className="sov-gtile-row"><b>{t(group)}</b><span>{groupDone}/{members.length}</span></span>
              <span className={groupTone === "ok" || !groupTone ? "setup-bar" : `setup-bar ${groupTone}`}><i style={{ width: `${Math.round((groupDone / members.length) * 100)}%` }} /></span>
              <span className="sov-gtile-state">
                {worst ? `${t(worst.item.title)}: ${reasonOf(worst.st) || t(STATE_LABEL[worst.st.state])}` : t("All done")}
              </span>
            </button>
          );
        })}
      </div>
      {quadPlaneOff ? (
        <div className="sov-qnote">
          <span>{t("QuadPlane is off. Turning it on in Airframe type adds VTOL motors and a VTOL takeoff after a reboot.")}</span>
          <button type="button" className="sov-goto" onClick={() => onOpen("airframe")}>{t("Airframe type")}<Chevron /></button>
        </div>
      ) : null}
    </div>
  );
}

type StepFace = { state: StepState; reason: string };

type Face = {
  frame: "copter" | "plane";
  /** Step ids this firmware has no parameters for (only once the full list has arrived). */
  hidden: string[];
  glances: Glance[];
  prearm: string[][];
  lines: string[];
  arm: ArmKind;
  armed: boolean;
  quadPlaneOff: boolean;
};

/** Everything the step list decides from the vehicle: one copy for the screen and for setup_status. */
function setupFace(s: Sample, frame: "copter" | "plane"): Face {
  const all = frame === "plane" ? PLANE : COPTER;
  const params = s.params || {};
  const rc = s.rc ?? [];
  const complete = !!s.ok && (s.param_count ?? 0) > 0 && Object.keys(params).length >= (s.param_count ?? 0);
  const hidden = complete ? all.filter((item) => item.needs && !(item.needs in params)).map((item) => item.id) : [];
  const steps = all.filter((item) => !hidden.includes(item.id));
  // PreArm lines still being repeated by the vehicle, sorted onto the step that fixes them.
  const now = s.heartbeat_at ?? 0;
  const fresh = s.ok && !s.armed ? (s.prearm ?? []).filter((line) => now - line.at <= PREARM_FRESH_S) : [];
  const arm: ArmKind = s.ok
    ? preArmState({
      armed: s.armed,
      lines: s.prearm ?? [],
      now,
      present: liveNum(s, "SYS_STATUS.onboard_control_sensors_present"),
      health: liveNum(s, "SYS_STATUS.onboard_control_sensors_health"),
    }).kind
    : "off";
  return {
    frame,
    hidden,
    glances: steps.map((item) => stepGlance(item.kind, frame, params, rc)),
    prearm: steps.map((item) => fresh.filter((line) => prearmStep(line.text) === item.id).map((line) => line.text)),
    lines: fresh.map((line) => line.text),
    arm,
    armed: !!s.ok && !!s.armed,
    quadPlaneOff: frame === "plane" && !!s.ok && params.Q_ENABLE === 0,
  };
}

function sameFace(a: Face, b: Face): boolean {
  return (
    a.frame === b.frame &&
    a.arm === b.arm &&
    a.armed === b.armed &&
    a.quadPlaneOff === b.quadPlaneOff &&
    a.hidden.join() === b.hidden.join() &&
    a.lines.join("\n") === b.lines.join("\n") &&
    a.glances.length === b.glances.length &&
    a.glances.every((g, i) => g.text === b.glances[i].text && g.live === b.glances[i].live && g.off === b.glances[i].off) &&
    a.prearm.every((p, i) => p.join("\n") === (b.prearm[i] ?? []).join("\n"))
  );
}

function useSetupFace(): { face: Face; steps: Step[]; states: StepFace[] } {
  const vehicle = useVehicle();
  const face = useStorePicked<Face>((s) => setupFace(s, vehicle), sameFace);
  const steps = (face.frame === "plane" ? PLANE : COPTER).filter((item) => !face.hidden.includes(item.id));
  const states = steps.map((item, i) => stepState(face.glances[i], face.prearm[i] ?? [], !!item.optional));
  return { face, steps, states };
}

/** Steps an assistant card waits on: a wizard for that step, or a parameter change the step owns. */
function waitingOn(steps: Step[], cards: WaitingCard[]): Set<string> {
  const ids = new Set<string>();
  for (const card of cards) {
    if (card.kind === "wizard") {
      const wizard = card.name === "compass_mot" || card.name === "compass_orient" ? "compass" : card.name === "board_orientation" ? "accel" : card.name;
      const step = steps.find((item) => item.wizard === wizard);
      if (step) ids.add(step.id);
    } else {
      const step = stepOfParam(steps, card.name);
      if (step) ids.add(step.id);
    }
  }
  return ids;
}

/**
 * Keeps the bridge's copy of the Setup verdicts current, so setup_status answers what the screen shows
 * wherever the user is. Mounted once with the app.
 */
export function SetupStatusFeed() {
  const { face, steps, states } = useSetupFace();
  const params = useStorePicked((s) => s.params || {}, (a, b) => Object.keys(a).length === Object.keys(b).length);
  const required = steps.filter((item) => !item.optional);
  const done = steps.filter((item, i) => !item.optional && settled(states[i].state)).length;
  const all = face.frame === "plane" ? PLANE : COPTER;
  const body = JSON.stringify({
    vehicle: face.frame,
    ready_to_arm: face.arm === "off" ? "unknown" : face.arm,
    done,
    required: required.length,
    prearm: face.lines,
    hidden: all.filter((item) => face.hidden.includes(item.id)).map((item) => item.title),
    steps: steps.map((item, i) => ({
      id: item.id,
      title: item.title,
      group: item.group,
      state: states[i].state,
      reason: states[i].reason,
      optional: !!item.optional,
      prearm: face.prearm[i] ?? [],
      wizard: item.wizard ?? null,
      params: stepParamNames(item.params, params),
    })),
  });
  useEffect(() => {
    const post = () => void fetch(`${APP_HTTP}/ai/setup-status`, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
    const timer = window.setTimeout(post, 400);
    // The bridge keeps only the last copy in memory, so a restarted bridge gets it again.
    const again = window.setInterval(post, 20_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(again);
    };
  }, [body]);
  return null;
}

/** Questions offered when Ask opens the chat, from what the step shows now. */
function askStarters(t: Translate, title: string, frame: string, st: StepFace | undefined, drafted: boolean): string[] {
  const out: string[] = [];
  if (drafted) out.push(t("Are my unwritten changes right for this {frame}?", { frame: t(frame) }));
  if (st?.state === "fail") out.push(t("Why does “{reason}” stop arming, and how do I fix it?", { reason: st.reason }));
  else if (st?.state === "warn" && st.reason) out.push(t("What does “{reason}” mean here?", { reason: st.reason }));
  else if (st?.state === "todo") out.push(t("What do I need to do on {step}?", { step: t(title) }));
  out.push(t("Explain the {step} step for this {frame}.", { step: t(title), frame: t(frame) }));
  return out.slice(0, 3);
}

export const HardwareSetup = memo(function HardwareSetup() {
  const t = useT();
  const { face, steps, states } = useSetupFace();
  const frame = face.frame;
  const [open, setOpen] = useState(OVERVIEW);
  const [requiredOnly, setRequiredOnly] = useState(false);
  const waitingCards = useSyncExternalStore(subscribeSetupView, getWaitingCards, getWaitingCards);
  const waiting = waitingOn(steps, waitingCards);
  const required = steps.filter((item) => !item.optional);
  const done = steps.filter((item, i) => !item.optional && settled(states[i].state)).length;
  const attention = states.filter((st) => st.state === "warn" || st.state === "fail").length;
  const blocking = states.filter((st) => st.state === "fail").length;
  useEffect(() => {
    if (open !== OVERVIEW && !steps.some((step) => step.id === open)) setOpen(OVERVIEW);
  }, [steps, open]);
  useEffect(() => {
    const show = () => setOpen(OVERVIEW);
    window.addEventListener(OPEN_SETUP_OVERVIEW, show);
    return () => window.removeEventListener(OPEN_SETUP_OVERVIEW, show);
  }, []);
  const overview = open === OVERVIEW;
  const step = steps.find((item) => item.id === open) ?? steps[0];
  // The assistant's view chip follows the page on screen; leaving Setup removes it.
  useEffect(() => {
    setSetupView({ vehicle: frame, step: overview ? OVERVIEW : step.id, title: overview ? "Overview" : step.title });
  }, [frame, overview, step.id, step.title]);
  useEffect(() => () => setSetupView(null), []);
  const reasonOf = (st: StepFace) => stateReason(t, st);
  const openCount = required.length - done;
  const guide = frame === "plane" ? PLANE_GUIDE : COPTER_GUIDE;
  const labelOf = (st: StepFace) => reasonOf(st) || t(STATE_LABEL[st.state]);
  const all = frame === "plane" ? PLANE : COPTER;
  const hiddenSteps = all.filter((item) => face.hidden.includes(item.id));
  function walkMessage(): string {
    // No link: nothing read from a vehicle, so no counts (the same rule as the Overview).
    if (face.arm === "off") return t("Walk me through setup for this {frame}. No vehicle is linked yet.", { frame: t(frame) });
    const open = steps
      .map((item, i) => ({ item, st: states[i] }))
      .filter(({ item, st }) => !item.optional && !settled(st.state))
      .map(({ item, st }) => `${t(item.title)} (${labelOf(st)})`);
    const parts = [t("Walk me through setup for this {frame}. {done} of {total} required steps are done.", { frame: t(frame), done, total: required.length })];
    if (open.length) parts.push(t("Open steps: {list}.", { list: open.join("; ") }));
    if (face.lines.length) parts.push(t("Pre-arm: {lines}.", { lines: face.lines.join("; ") }));
    return parts.join(" ");
  }
  const stepIndex = steps.indexOf(step);
  const stepWaits = !overview && waiting.has(step.id);
  return (
    <div className="setup-wrap">
      {face.armed ? <div className="setup-armed" role="status">{t("Armed. Setup is read-only until the vehicle is disarmed.")}</div> : null}
      <div className="setup">
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
          <button
            type="button"
            className={`setup-step setup-ov ${face.arm === "off" ? "todo" : blocking ? "fail" : attention ? "warn" : openCount ? "todo" : "done"}${overview ? " on" : ""}`}
            aria-current={overview ? "true" : undefined}
            title={t("Overview")}
            onClick={() => setOpen(OVERVIEW)}
          >
            <span className="setup-ico"><OverviewIcon /></span>
            <span className="setup-copy">
              <b>{t("Overview")}</b>
              <span className="setup-state">
                {face.arm === "off" ? t("No link") : blocking ? counted(t, blocking, "1 blocks arming", "{n} block arming") : attention ? counted(t, attention, "1 needs attention", "{n} need attention") : openCount ? t("{n} to do", { n: openCount }) : t("Ready")}
              </span>
            </span>
          </button>
          {GROUPS.map((group) => {
            const members = steps.map((item, i) => ({ item, i })).filter(({ item }) => item.group === group && (!requiredOnly || !item.optional));
            if (!members.length) return null;
            const need = members.filter(({ item }) => !item.optional);
            const groupDone = need.filter(({ i }) => settled(states[i].state)).length;
            return (
              <div className="setup-group" key={group}>
                <div className="setup-group-head"><span>{t(group)}</span><span>{need.length ? `${groupDone}/${need.length}` : t("optional")}</span></div>
                <ol className="setup-list">
                  {members.map(({ item, i }) => {
                    const on = !overview && item.id === step.id;
                    const st = states[i];
                    const waits = waiting.has(item.id);
                    const reason = waits ? t("Waiting for you · open chat") : reasonOf(st);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`setup-step ${st.state}${on ? " on" : ""}${waits ? " waits" : ""}`}
                          aria-current={on ? "true" : undefined}
                          title={`${t(item.title)} · ${reason || t(STATE_LABEL[st.state])}`}
                          onClick={() => {
                            setOpen(item.id);
                            if (waits) showAssistant();
                          }}
                        >
                          <span className="setup-ico"><StepIcon kind={item.kind} /></span>
                          <span className="setup-copy">
                            <b>{t(item.title)}</b>
                            {reason ? <span className="setup-state">{reason}</span> : null}
                          </span>
                          <span className="setup-mark" aria-label={t(STATE_LABEL[st.state])}>
                            {waits ? <svg viewBox="0 0 24 24" className="setup-spark" aria-hidden="true"><path fill="currentColor" d={SPARK} /></svg> : <StateIcon state={st.state} />}
                          </span>
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
          <div className="setup-ph">
            <div className="setup-ph-copy">
              <h3>{overview ? t("Overview") : t(step.title)}</h3>
              <p>{overview ? t("First setup for a {frame}. Work top to bottom; the order matters.", { frame: t(frame) }) : t(step.body)}</p>
            </div>
            {overview ? (
              <AskButton label={t("Walk me through setup")} onClick={() => askAssistant(walkMessage())} />
            ) : (
              <AskButton
                label={t("Ask")}
                onClick={() => {
                  setViewFocus(undefined);
                  openAssistant(askStarters(t, step.title, frame, states[stepIndex], !!getSetupView()?.draft.length));
                }}
              />
            )}
          </div>
          {stepWaits ? (
            <div className="setup-waits">
              <span>{t("An assistant card for this step is waiting for you.")}</span>
              <button type="button" onClick={showAssistant}>{t("Open chat")}</button>
            </div>
          ) : null}
          {overview ? (
            <div className="setup-pbody">
              <SetupOverview
                steps={steps}
                states={states}
                lines={face.lines}
                arm={face.arm}
                done={done}
                total={required.length}
                reasonOf={reasonOf}
                onOpen={setOpen}
                hidden={hiddenSteps}
                quadPlaneOff={face.quadPlaneOff}
              />
            </div>
          ) : (
            <div className="setup-pbody">
              {step.kind === "frame" ? <FrameStep /> : null}
              {step.kind === "motors" ? <MotorsStep /> : null}
              {step.kind === "radio" ? <><RcLive /><RadioWizard /></> : null}
              {step.kind === "level" ? <AccelStep /> : null}
              {step.kind === "compass" ? <CompassPanel /> : null}
              {step.kind === "modes" ? <ModeWizard frame={frame} /> : null}
              {step.kind === "failsafe" ? <FailsafeWizard frame={frame} /> : null}
              {step.kind === "battery" ? <BatteryWizard /> : null}
              {step.kind === "servos" ? <PlaneOutputsStep /> : null}
              {step.kind === "airspeed" ? <AirspeedWizard /> : null}
              {step.kind === "airframe" ? <PlaneAirframeStep /> : null}
            </div>
          )}
          {overview ? (
            <div className="setup-pfoot">
              <a href={guide} target="_blank" rel="noreferrer">{t("ArduPilot mandatory hardware")} ↗</a>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
