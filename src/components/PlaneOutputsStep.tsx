import { useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { motorFrame, motorOfFunction } from "../lib/motorFrames";
import { classifyLayout, surfacesFor } from "../lib/planeAirframe";
import { getSetupSnapshot, subscribe } from "../mav/store";
import { useStorePicked } from "../mav/view";
import { MotorDiagram } from "./MotorDiagram";
import { PWM_TYPES } from "./MotorsStep";
import { NumField, OUTPUTS, OutputPicker, OutputsTable, PwmBar, SelectField, StepFooter, Switch, SwitchField, pnum, useLiveOutputs, useParamDraft } from "./OutputSetup";

const GUIDE = "https://ardupilot.org/plane/docs/servo-functions.html";
const REBOOT = ["Q_M_PWM_TYPE"];

/** What each surface should do for the stick test, in MANUAL. */
const TEST: Record<string, string> = {
  aileron: "Roll right → right aileron up",
  elevator: "Pull back → elevator up",
  rudder: "Yaw right → rudder right",
  elevon_left: "Pull back → both elevons up; roll right → left elevon down",
  elevon_right: "Pull back → both elevons up; roll right → right elevon up",
  vtail_left: "Pull back → both up; yaw right → left one down",
  vtail_right: "Pull back → both up; yaw right → right one up",
};

/**
 * Plane Outputs: each surface with its live position against min/trim/max, the throttle, the VTOL motors when
 * QuadPlane is on, every other output, and mixing. Surfaces and throttle are placed by Airframe type.
 */
export function PlaneOutputsStep() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const armed = useStorePicked((s) => !!s.armed);
  // Only MANUAL passes the sticks straight to the surfaces; in other modes the autopilot moves them.
  const mode = useStorePicked((s) => (s.ok ? s.mode ?? "" : ""));
  const manual = mode === "MANUAL";
  const params = sample.params || {};
  const draft = useParamDraft(params);
  const live = useLiveOutputs();
  const layout = classifyLayout(params);
  const surfaces = surfacesFor(layout);
  const outOf = (fn: number) => {
    for (let o = 1; o <= OUTPUTS; o += 1) if (Math.round(draft.value(`SERVO${o}_FUNCTION`) ?? -1) === fn) return o;
    return null;
  };
  const val = (name: string) => {
    const v = draft.value(name);
    return v == null ? null : Math.round(v);
  };
  const placed = new Set(surfaces.map((s) => s.fn));
  /** Outputs after the first that carry the same function (ArduPilot drives them all, e.g. two aileron servos). */
  const extraOuts = (fn: number, first: number) => {
    const list: number[] = [];
    for (let o = 1; o <= OUTPUTS; o += 1) if (o !== first && Math.round(draft.value(`SERVO${o}_FUNCTION`) ?? -1) === fn) list.push(o);
    return list;
  };
  const throttleOut = outOf(70);

  const qOn = !!pnum(params, "Q_ENABLE");
  const qFrame = qOn ? motorFrame(pnum(params, "Q_FRAME_CLASS"), pnum(params, "Q_FRAME_TYPE")) : null;
  const liftAt = new Map<number, number>();
  for (let o = 1; o <= OUTPUTS; o += 1) {
    const m = motorOfFunction(pnum(params, `SERVO${o}_FUNCTION`) ?? 0);
    if (m != null) liftAt.set(m, o);
  }
  const lifted = qFrame ? qFrame.spots.filter((s) => liftAt.has(s.n)).length : 0;

  return (
    <div className="frs">
      {!sample.ok ? <div className="frs-note info">{t("Connect a vehicle to read its outputs.")}</div> : null}

      <h4 className="sov-sect pas-sect">
        <span>{t("Surfaces")}</span>
        <span className="pas-src">{t("move each stick in MANUAL; the live mark should move the way the line says")}</span>
      </h4>
      {sample.ok && mode && !manual ? (
        <div className="frs-note info">{t("In {mode} the autopilot moves the surfaces, so the live marks do not follow the sticks. Switch to MANUAL to test the surfaces and take trims.", { mode })}</div>
      ) : null}
      <div className="po-srvs">
        {surfaces.filter((s) => s.fn !== 70).map((s) => {
          const o = outOf(s.fn);
          if (o == null) {
            return (
              <div key={s.key} className="po-srv missing">
                <b>{t(s.title)}</b>
                <span className="po-dim">{t("Not on an output yet. Pick the layout on Airframe type.")}</span>
              </div>
            );
          }
          const mn = val(`SERVO${o}_MIN`), tr = val(`SERVO${o}_TRIM`), mx = val(`SERVO${o}_MAX`), rev = val(`SERVO${o}_REVERSED`);
          const pwm = live[o - 1];
          return (
            <div key={s.key} className="po-srv">
              <div className="po-srv-head">
                <span className="po-srv-name"><b>{t(s.title)}</b><OutputPicker vehicle="plane" draft={draft} out={o} label={t("Output of {name}", { name: t(s.title) })} /></span>
                <span className="po-live">{pwm != null ? `${pwm} µs` : "—"}</span>
              </div>
              <PwmBar min={mn} trim={tr} max={mx} live={pwm} />
              <div className="po-mtm"><span>{mn ?? "—"}</span><span>{t("trim {v}", { v: tr ?? "—" })}</span><span>{mx ?? "—"}</span></div>
              {extraOuts(s.fn, o).length ? <span className="po-also">{t("Also on {list}, listed under Other outputs.", { list: extraOuts(s.fn, o).map((n) => `OUT ${n}`).join(", ") })}</span> : null}
              <span className="po-dim">{t(TEST[s.key] ?? "")}</span>
              <div className="po-srv-foot">
                <span className="po-rev">
                  {rev != null ? <Switch on={rev === 1} label={t("Reverse {name}", { name: t(s.title) })} onChange={(on) => draft.set(`SERVO${o}_REVERSED`, on ? 1 : 0)} /> : null}
                  {t("Reverse")}
                </span>
                <button
                  type="button"
                  className="frs-btn link"
                  disabled={pwm == null || !manual}
                  title={manual ? t("Sets SERVO{n}_TRIM to the live output, with the stick centred.", { n: o }) : t("Switch to MANUAL first: in other modes the output is not the stick.")}
                  onClick={() => pwm != null && draft.set(`SERVO${o}_TRIM`, pwm)}
                >
                  {t("Trim from stick")}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <h4 className="sov-sect pas-sect">
        <span>{t("Throttle")}</span>
        <span className="pas-src po-thr-out">{throttleOut != null ? <><OutputPicker vehicle="plane" draft={draft} out={throttleOut} label={t("Output of {name}", { name: t("Throttle") })} />{` ${live[throttleOut - 1] ?? "—"} µs`}</> : t("Not on an output yet.")}</span>
      </h4>
      <div className="po-grid2">
        <div className="ms-card">
          <NumField draft={draft} name="THR_MIN" label="Minimum" unit="%" />
          <NumField draft={draft} name="THR_MAX" label="Maximum" unit="%" />
          <NumField draft={draft} name="THR_SLEWRATE" label="Slew rate" unit="%/s" width={80} />
        </div>
        <div className="ms-card">
          <SwitchField draft={draft} name="THR_PASS_STAB" label="Throttle in FBWA follows stick" />
          <NumField draft={draft} name="TRIM_THROTTLE" label="Cruise throttle" unit="%" />
        </div>
      </div>
      <details className="ms-fold">
        <summary>{t("PWM ESC: calibrate once, propeller off")}<span>{t("wiki steps · 1000–2000 µs")}</span></summary>
        <p>{t("A PWM ESC learns its throttle range once. Remove the propeller and follow the wiki steps for your ESC.")}</p>
      </details>

      {qOn ? (
        <>
          <h4 className="sov-sect pas-sect"><span>{t("VTOL motors · QuadPlane")}</span><span className="pas-src">Q_ENABLE = 1</span></h4>
          {qFrame ? (
            <div className="ms-top">
              <div className="ms-art">
                <MotorDiagram
                  frame={qFrame}
                  size={180}
                  marks={Object.fromEntries(qFrame.spots.map((s) => [s.n, liftAt.has(s.n) ? "done" : "pending"]))}
                  outs={Object.fromEntries(qFrame.spots.filter((s) => liftAt.has(s.n)).map((s) => [s.n, `OUT ${liftAt.get(s.n)}`]))}
                  arrows
                  label={(n) => t("Motor {n}", { n })}
                  servoLabel={t("Servo")}
                />
                <span>{qFrame.title}</span>
              </div>
              <div className="ms-cards">
                <div className={`frs-note ${lifted === qFrame.spots.length ? "ok" : "warn"}`}>
                  {t("{n} of {total} lift motors matched.", { n: lifted, total: qFrame.spots.length })} {t("Lift motors are set in the table below (Motor 1, Motor 2…). The motor wizard does not drive QuadPlane motors yet.")}
                </div>
                <div className="ms-card">
                  <SelectField draft={draft} name="Q_M_PWM_TYPE" label="ESC protocol" options={PWM_TYPES} />
                  <NumField draft={draft} name="Q_TRANSITION_MS" label="Time to forward flight" unit="s" scale={1000} step={0.5} />
                  <NumField draft={draft} name="Q_TRANS_DECEL" label="Back-transition braking" unit="m/s²" width={80} />
                  <NumField draft={draft} name="Q_ASSIST_SPEED" label="Lift motors help below" unit="m/s" width={80} />
                </div>
              </div>
            </div>
          ) : (
            <div className="frs-note warn">{t("QuadPlane is on. Reboot the board so the Q_ parameters appear.")}</div>
          )}
        </>
      ) : null}

      <h4 className="sov-sect pas-sect">
        <span>{t("Other outputs")}</span>
        <span className="pas-src">{t("surfaces and throttle come from Airframe type")}</span>
      </h4>
      <OutputsTable vehicle="plane" draft={draft} live={live} kind={(o, fn) => ((placed.has(fn) || fn === 70) && outOf(fn) === o ? "skip" : "row")} />

      <h4 className="sov-sect">{t("Mixing")}</h4>
      <div className="po-grid2">
        <div className="ms-card">
          {layout === "wing" || layout === "vtail" ? <NumField draft={draft} name="MIXING_GAIN" label="Mixing gain" step={0.05} /> : null}
          <NumField draft={draft} name="KFF_RDDRMIX" label="Rudder in aileron turns" step={0.05} />
        </div>
        <div className="ms-card">
          <NumField draft={draft} name="DSPOILER_AILMTCH" label="Crow flaps: aileron matching" unit="%" />
        </div>
      </div>

      <StepFooter draft={draft} armed={armed} ok={sample.ok} guide={GUIDE} guideLabel="Servo functions and reversing" rebootNames={REBOOT} />
    </div>
  );
}
