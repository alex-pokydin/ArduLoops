import { Fragment, memo, useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { getSetupSnapshot, subscribe } from "../mav/store";
import { useStorePicked, useVehicle } from "../mav/view";
import { BatteryWizard } from "./BatterySetup";
import { CalibrationPanel } from "./CalibrationPanel";
import { ParameterLibrary } from "./ParameterLibrary";
import { CompassPanel } from "./CompassPanel";
import { AirspeedWizard, FailsafeWizard, FrameWizard, ModeWizard, MotorWizard, RadioWizard, ServoWizard, stepGlance } from "./SetupWizards";
import { nextSteps, prearmStep, stepState, type StepState } from "../lib/setupSteps";
import { OPEN_SETUP_OVERVIEW } from "../lib/setupNav";
import { askAssistant } from "../lib/assistantAsk";
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
        <path fill="currentColor" d="M12 1.8c.35 3.1 1.55 5.2 3.7 7.35 2.15 2.15 4.25 3.35 7.35 3.7-3.1.35-5.2 1.55-7.35 3.7-2.15 2.15-3.35 4.25-3.7 7.35-.35-3.1-1.55-5.2-3.7-7.35-2.15-2.15-4.25-3.35-7.35-3.7 3.1-.35 5.2-1.55 7.35-3.7 2.15-2.15 3.35-4.25 3.7-7.35Z" />
      </svg>
      {label}
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
}: {
  steps: Step[];
  states: { state: StepState; reason: string }[];
  lines: string[];
  arm: ArmKind;
  done: number;
  total: number;
  reasonOf: (st: { state: StepState; reason: string }) => string;
  onOpen: (id: string) => void;
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

      <h4 className="sov-sect">{t("Pre-arm · live from the vehicle")}</h4>
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
                  <span className="sov-none">{t("No setup step")}</span>
                )}
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
            <button type="button" key={item.id} className={`sov-card ${st.state}`} onClick={() => onOpen(item.id)}>
              <span className="setup-mark"><StateIcon state={st.state} /></span>
              <span className="sov-card-copy">
                <b>{t(item.title)}</b>
                <span>{reasonOf(st) || t(item.body)}</span>
              </span>
              <Chevron />
            </button>
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
          const groupDone = members.filter(({ st }) => st.state === "done").length;
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
    </div>
  );
}

export const HardwareSetup = memo(function HardwareSetup() {
  const t = useT();
  const vehicle = useVehicle();
  const face = useStorePicked<{
    frame: "copter" | "plane";
    glances: { text: string; live: boolean }[];
    prearm: string[][];
    lines: string[];
    arm: ArmKind;
  }>(
    (s) => {
      const frame = vehicle;
      const steps = frame === "plane" ? PLANE : COPTER;
      const params = s.params || {};
      const rc = s.rc ?? [];
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
        glances: steps.map((item) => stepGlance(item.kind, frame, params, rc)),
        prearm: steps.map((item) => fresh.filter((line) => prearmStep(line.text) === item.id).map((line) => line.text)),
        lines: fresh.map((line) => line.text),
        arm,
      };
    },
    (a, b) =>
      a.frame === b.frame &&
      a.arm === b.arm &&
      a.lines.join("\n") === b.lines.join("\n") &&
      a.glances.length === b.glances.length &&
      a.glances.every((g, i) => g.text === b.glances[i].text && g.live === b.glances[i].live) &&
      a.prearm.every((p, i) => p.join("\n") === (b.prearm[i] ?? []).join("\n")),
  );
  const frame = face.frame;
  const steps = frame === "plane" ? PLANE : COPTER;
  const [open, setOpen] = useState(OVERVIEW);
  const [requiredOnly, setRequiredOnly] = useState(false);
  const states = steps.map((item, i) => stepState(face.glances[i], face.prearm[i] ?? [], !!item.optional));
  const required = steps.filter((item) => !item.optional);
  const done = steps.filter((item, i) => !item.optional && states[i].state === "done").length;
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
  const reasonOf = (st: { state: StepState; reason: string }) => stateReason(t, st);
  const openCount = required.length - done;
  const guide = frame === "plane" ? PLANE_GUIDE : COPTER_GUIDE;
  const labelOf = (st: { state: StepState; reason: string }) => reasonOf(st) || t(STATE_LABEL[st.state]);
  function walkMessage(): string {
    // No link: nothing read from a vehicle, so no counts (the same rule as the Overview).
    if (face.arm === "off") return t("Walk me through setup for this {frame}. No vehicle is linked yet.", { frame: t(frame) });
    const open = steps
      .map((item, i) => ({ item, st: states[i] }))
      .filter(({ item, st }) => !item.optional && st.state !== "done")
      .map(({ item, st }) => `${t(item.title)} (${labelOf(st)})`);
    const parts = [t("Walk me through setup for this {frame}. {done} of {total} required steps are done.", { frame: t(frame), done, total: required.length })];
    if (open.length) parts.push(t("Open steps: {list}.", { list: open.join("; ") }));
    if (face.lines.length) parts.push(t("Pre-arm: {lines}.", { lines: face.lines.join("; ") }));
    return parts.join(" ");
  }
  const stepIndex = steps.indexOf(step);
  return (
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
          const groupDone = need.filter(({ i }) => states[i].state === "done").length;
          return (
            <div className="setup-group" key={group}>
              <div className="setup-group-head"><span>{t(group)}</span><span>{need.length ? `${groupDone}/${need.length}` : t("optional")}</span></div>
              <ol className="setup-list">
                {members.map(({ item, i }) => {
                  const on = !overview && item.id === step.id;
                  const st = states[i];
                  const reason = reasonOf(st);
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
              onClick={() => askAssistant(t("Help me with the {step} setup step on this {frame}. It shows: {state}.", { step: t(step.title), frame: t(frame), state: labelOf(states[stepIndex]) }))}
            />
          )}
        </div>
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
          />
        </div>
      ) : (
      <div className="setup-pbody">
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
      )}
        {overview ? (
          <div className="setup-pfoot">
            <a href={guide} target="_blank" rel="noreferrer">{t("ArduPilot mandatory hardware")} ↗</a>
          </div>
        ) : null}
      </div>
    </div>
  );
});
