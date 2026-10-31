import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AccelOrient } from "./AccelOrient";
import { AccelWizard } from "./CalibrationPanel";
import { CompassMot } from "./CompassMot";
import { CompassOrient } from "./CompassOrient";
import { CompassCalWizard } from "./CompassPanel";
import { BatteryCurrentWizard, BatterySensorWizard, BatteryVoltageWizard } from "./BatteryStep";
import { ModeSetup } from "./ModeSetup";
import { MotorSetup, type MotorScope, type MotorStep } from "./MotorSetup";
import { RcSetup } from "./RcSetup";
import { AirspeedWizard, FailsafeWizard, ServoWizard } from "./SetupWizards";
import { useT } from "../i18n/i18n";
import { getLatest, subscribe } from "../mav/store";
import type { WizardClose } from "../wizards/close";

function WizardFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-back" role="presentation">
      <div className="modal orient-wizard" role="dialog" aria-modal="true" aria-labelledby="hosted-wiz-title">
        <div className="modal-head">
          <h2 id="hosted-wiz-title">{title}</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label={t("Close")} title={t("Close")}>×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export type WizardAsk = { id: string; wizard: string; scope?: MotorScope };

/** `steps` and `motors` from a motors wizard card. */
export function wizardScope(payload: string | undefined): MotorScope | undefined {
  if (!payload) return undefined;
  try {
    const raw = JSON.parse(payload) as { steps?: unknown; motors?: unknown };
    const steps = Array.isArray(raw.steps) ? raw.steps.filter((s): s is MotorStep => s === "order" || s === "direction" || s === "idle") : [];
    const motors = Array.isArray(raw.motors) ? raw.motors.filter((n): n is number => typeof n === "number" && n >= 1 && n <= 12) : [];
    return steps.length || motors.length ? { steps, motors } : undefined;
  } catch {
    return undefined;
  }
}

export function WizardHost({
  ask,
  onDone,
}: {
  ask: WizardAsk;
  onDone: (id: string, report: WizardClose) => void;
}) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const sent = useRef(false);

  function finish(report?: WizardClose) {
    if (sent.current) return;
    sent.current = true;
    const base = report ?? { outcome: "cancelled" as const, measures: {} };
    onDone(ask.id, {
      outcome: base.outcome,
      measures: {
        ...base.measures,
        linked: sample.ok ? 1 : 0,
        armed: sample.armed ? 1 : 0,
      },
    });
  }

  const fresh = typeof sample.heartbeat_at === "number" && Date.now() / 1000 - sample.heartbeat_at < 3;
  const ready = sample.ok && !sample.armed && fresh;
  if (ask.wizard === "accel") return <AccelWizard ready={ready} onClose={finish} fromAssistant />;
  if (ask.wizard === "board_orientation") {
    const orient = sample.params?.AHRS_ORIENTATION;
    return <AccelOrient current={typeof orient === "number" ? Math.round(orient) : 0} onClose={finish} fromAssistant />;
  }
  if (ask.wizard === "compass") return <CompassCalWizard onClose={finish} fromAssistant />;
  if (ask.wizard === "compass_orient") return <CompassOrient autoOpen fromAssistant onClose={(report) => finish(report)} />;
  if (ask.wizard === "compass_mot") return <CompassMot onClose={finish} fromAssistant />;
  if (ask.wizard === "radio") return <RcSetup onClose={finish} />;
  if (ask.wizard === "modes") return <ModeSetup frame={sample.frame === "plane" ? "plane" : "copter"} onClose={finish} />;
  if (ask.wizard === "battery_sensor") return <BatterySensorWizard onClose={finish} fromAssistant />;
  if (ask.wizard === "battery_voltage") return <BatteryVoltageWizard onClose={finish} fromAssistant />;
  if (ask.wizard === "battery_current") return <BatteryCurrentWizard onClose={finish} fromAssistant />;
  if (ask.wizard === "failsafe") {
    const frame = sample.frame === "plane" ? "plane" : "copter";
    return (
      <WizardFrame title={t("Failsafe")} onClose={() => finish()}>
        <FailsafeWizard frame={frame} onDone={(measures) => finish({ outcome: "completed", measures })} />
      </WizardFrame>
    );
  }
  if (ask.wizard === "servos") {
    return (
      <WizardFrame title={t("Servo outputs")} onClose={() => finish()}>
        <ServoWizard onDone={(measures) => finish({ outcome: "completed", measures })} />
      </WizardFrame>
    );
  }
  if (ask.wizard === "airspeed") {
    return (
      <WizardFrame title={t("Airspeed")} onClose={() => finish()}>
        <AirspeedWizard onDone={(measures) => finish({ outcome: "completed", measures })} />
      </WizardFrame>
    );
  }
  if (ask.wizard === "motors") return <MotorSetup onClose={finish} scope={ask.scope} fromAssistant />;
  return null;
}
