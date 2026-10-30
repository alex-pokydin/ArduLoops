import { useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { frameFromParams, motorOfFunction } from "../lib/motorFrames";
import { getSetupSnapshot, subscribe } from "../mav/store";
import { useStorePicked } from "../mav/view";
import { MotorDiagram } from "./MotorDiagram";
import { MotorSetup, type MotorScope } from "./MotorSetup";
import { OUTPUTS, OutputsTable, pnum, SelectField, StepFooter, StepNum, Switch, useLiveOutputs, useParamDraft } from "./OutputSetup";

const GUIDE = "https://ardupilot.org/copter/docs/connect-escs-and-motors.html";

/** MOT_PWM_TYPE, from AP_MotorsMulticopter.cpp @Values (8 and 9 are for special frames). */
export const PWM_TYPES: [number, string][] = [
  [0, "Normal PWM"], [1, "OneShot"], [2, "OneShot125"], [3, "Brushed"], [4, "DShot150"], [5, "DShot300"], [6, "DShot600"], [7, "DShot1200"],
];
/** SERVO_DSHOT_ESC, from SRV_Channels.cpp @Values. */
const DSHOT_ESC: [number, string][] = [
  [0, "None"], [1, "BLHeli32 / Kiss / AM32"], [2, "BLHeli_S / BlueJay"], [3, "BLHeli32 / AM32 / Kiss + EDT"], [4, "BLHeli_S / BlueJay + EDT"],
];
/** Take effect only after a reboot (@RebootRequired). */
const REBOOT = ["MOT_PWM_TYPE", "SERVO_BLH_BDMASK", "SERVO_BLH_RVMASK"];

export function isDshot(type: number | null): boolean {
  return type != null && Math.round(type) >= 4 && Math.round(type) <= 7;
}

/**
 * Copter Motors & outputs: the motors from the frame with the wizard's three parts, the ESC settings,
 * and one table of every output. Motor rows are set by the wizard and locked here.
 */
export function MotorsStep() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const armed = useStorePicked((s) => !!s.armed);
  const params = sample.params || {};
  const draft = useParamDraft(params);
  const live = useLiveOutputs();
  const [open, setOpen] = useState<MotorScope | null | false>(false);
  const frame = frameFromParams(params);

  const motorAt = new Map<number, number>();
  for (let o = 1; o <= OUTPUTS; o += 1) {
    const fn = pnum(params, `SERVO${o}_FUNCTION`);
    const m = fn == null ? null : motorOfFunction(fn);
    if (m != null) motorAt.set(m, o);
  }
  const matched = frame ? frame.spots.filter((s) => motorAt.has(s.n)).length : 0;
  const total = frame?.spots.length ?? 0;
  const rvmask = Math.round(pnum(params, "SERVO_BLH_RVMASK") ?? 0);
  const reversedOuts = Array.from({ length: OUTPUTS }, (_, i) => i + 1).filter((o) => rvmask & (1 << (o - 1)));
  const arm = pnum(params, "MOT_SPIN_ARM");
  const min = pnum(params, "MOT_SPIN_MIN");
  const safety = pnum(params, "BRD_SAFETY_DEFLT");
  const pwmType = draft.value("MOT_PWM_TYPE");
  const dshot = isDshot(pwmType);
  const bdmask = draft.value("SERVO_BLH_BDMASK");
  const motorOuts = [...motorAt.values()];
  const motorBits = motorOuts.reduce((m, o) => m | (1 << (o - 1)), 0);
  const rpmOn = bdmask != null && motorOuts.length > 0 && (Math.round(bdmask) & motorBits) === motorBits;
  const ready = sample.ok && !!frame;

  const wizRow = (n: number, state: "done" | "warn" | "todo", title: string, detail: string, label: string, scope: MotorScope) => (
    <div className="ms-wstep">
      <StepNum n={n} state={state} />
      <span className="ms-wstep-copy"><b>{t(title)}</b><span>{detail}</span></span>
      <button type="button" className="frs-btn quiet" disabled={!ready} onClick={() => setOpen(scope)}>{t(label)}</button>
    </div>
  );

  return (
    <div className="frs">
      {!sample.ok ? <div className="frs-note info">{t("Connect a vehicle to read its motors and outputs.")}</div> : null}
      {sample.ok && !frame ? <div className="frs-note warn">{t("Pick a frame first. This step follows the frame already on the vehicle.")}</div> : null}
      <div className="ms-top">
        {frame ? (
          <div className="ms-art">
            <MotorDiagram
              frame={frame}
              size={200}
              marks={Object.fromEntries(frame.spots.map((s) => [s.n, motorAt.has(s.n) ? "done" : "pending"]))}
              outs={Object.fromEntries(frame.spots.filter((s) => motorAt.has(s.n)).map((s) => [s.n, `OUT ${motorAt.get(s.n)}`]))}
              arrows
              label={(n) => t("Motor {n}", { n })}
              servoLabel={t("Servo")}
            />
            <span>{t("{frame} · from Frame", { frame: frame.title })}</span>
          </div>
        ) : null}
        <div className="ms-cards">
          <div className="ms-card">
            <div className="ms-card-head">
              <b>{t("Motor wizard")}</b>
              <button type="button" className="frs-btn primary sm" disabled={!ready} onClick={() => setOpen(null)}>{t("Open")}</button>
            </div>
            {wizRow(1, matched === total && total > 0 ? "done" : "warn", "Order", t("{n} of {total} outputs matched", { n: matched, total }), matched === total ? "Redo" : "Match", { steps: ["order"] })}
            {wizRow(
              2,
              "todo",
              "Direction",
              reversedOuts.length ? t("Reversed in the ESC: {list}", { list: reversedOuts.map((o) => `OUT ${o}`).join(", ") }) : t("Spin each motor and compare with the arrows."),
              "Check",
              { steps: ["direction"] },
            )}
            {wizRow(
              3,
              arm != null && arm > 0 && (min == null || min > arm) ? "done" : "warn",
              "Idle",
              arm != null ? t("Spin armed {arm} · min {min}", { arm: arm.toFixed(2), min: min != null ? min.toFixed(2) : "—" }) : "—",
              "Set",
              { steps: ["idle"] },
            )}
            <span className="ms-hint">
              {t("Props off. Each button opens the wizard on that part only.")}
              {safety != null && safety !== 0 ? ` ${t("The safety switch must be pressed before a motor spins.")}` : ""}
            </span>
          </div>
          <div className="ms-card">
            <div className="ms-card-head">
              <b>{t("ESC")}</b>
              <span className="ms-fix">
                {t("How a wrong direction is fixed:")} <b>{dshot ? t("reverse in software") : t("swap two motor wires")}</b>
              </span>
            </div>
            <SelectField draft={draft} name="MOT_PWM_TYPE" label="Protocol" options={PWM_TYPES} />
            {dshot ? <SelectField draft={draft} name="SERVO_DSHOT_ESC" label="ESC firmware" options={DSHOT_ESC} /> : null}
            {dshot && bdmask != null && motorOuts.length ? (
              <div className="ops-field">
                <span className="ops-field-copy">
                  <b>{t("RPM telemetry (bidirectional DShot)")}</b>
                  <span>SERVO_BLH_BDMASK · {motorOuts.sort((a, b) => a - b).map((o) => `OUT ${o}`).join(", ")}</span>
                </span>
                <Switch
                  on={rpmOn}
                  label={t("RPM telemetry (bidirectional DShot)")}
                  onChange={(on) => draft.set("SERVO_BLH_BDMASK", on ? Math.round(bdmask) | motorBits : Math.round(bdmask) & ~motorBits)}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <h4 className="sov-sect pas-sect">
        <span>{t("Outputs")}</span>
        <span className="pas-src">{t("motors from the wizard · the rest set here")}</span>
      </h4>
      <OutputsTable
        vehicle="copter"
        draft={draft}
        live={live}
        kind={(_, fn) => (motorOfFunction(fn) != null ? "locked" : "row")}
        locked={(o, fn) => {
          const n = motorOfFunction(fn) as number;
          const spot = frame?.spots.find((s) => s.n === n);
          const dir = spot?.yaw === 1 ? "CCW" : spot?.yaw === -1 ? "CW" : "";
          return {
            name: <><b>{t("Motor {n}", { n })}</b><svg className="ops-lock" viewBox="0 0 16 16" aria-label={t("Set by the motor wizard")}><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></svg></>,
            spin: <>{dir}{rvmask & (1 << (o - 1)) ? ` · ${t("reversed in ESC")}` : ""}</>,
          };
        }}
      />
      <span className="ms-hint">{t("Motor rows are set by the motor wizard. Other outputs are set here: function, range, reverse.")}</span>
      <details className="ms-fold">
        <summary>{t("PWM, OneShot and other ESCs")}<span>{t("calibration and wire swap")}</span></summary>
        <p>{t("PWM and OneShot ESCs need their throttle range calibrated once, propellers off, following the wiki steps. To reverse a motor on these ESCs, swap any two of its three wires.")}</p>
      </details>

      {open !== false ? <MotorSetup scope={open ?? undefined} onClose={() => setOpen(false)} /> : null}
      <StepFooter
        draft={draft}
        armed={armed}
        ok={sample.ok}
        guide={GUIDE}
        guideLabel="Connect ESCs and motors"
        rebootNames={REBOOT}
        why={t("Protocol changes need a reboot.")}
      />
    </div>
  );
}
