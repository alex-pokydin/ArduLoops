import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AccelWizard } from "./CalibrationPanel";
import { CompassMot } from "./CompassMot";
import { CompassCalWizard } from "./CompassPanel";
import { BatterySetup } from "./BatterySetup";
import { ModeSetup } from "./ModeSetup";
import { MotorSetup } from "./MotorSetup";
import { RcSetup } from "./RcSetup";
import { AirspeedWizard, FailsafeWizard, ServoWizard, motorFrame } from "./SetupWizards";
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

export type WizardAsk = { id: string; wizard: string };

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
  if (ask.wizard === "accel") return <AccelWizard ready={ready} onClose={finish} />;
  if (ask.wizard === "compass") return <CompassCalWizard onClose={finish} />;
  if (ask.wizard === "compass_mot") return <CompassMot onClose={finish} />;
  if (ask.wizard === "radio") return <RcSetup onClose={finish} />;
  if (ask.wizard === "modes") return <ModeSetup frame={sample.frame === "plane" ? "plane" : "copter"} onClose={finish} />;
  if (ask.wizard === "battery") return <BatterySetup onClose={finish} />;
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
  if (ask.wizard === "motors") {
    const frame = motorFrame(sample.params);
    if (frame) return <MotorSetup frame={frame.id} count={frame.count} onClose={finish} />;
    return createPortal(
      <div className="modal-back" role="presentation">
        <div className="modal orient-wizard" role="dialog" aria-modal="true">
          <div className="modal-head">
            <h2>{t("Motor setup wizard")}</h2>
            <button type="button" className="modal-x" onClick={() => finish()} aria-label={t("Close")} title={t("Close")}>×</button>
          </div>
          <p className="mag-line">{t("This frame has no motor setup wizard.")}</p>
          <div className="wiz-apply">
            <button type="button" className="wiz-go" onClick={() => finish()}>{t("Close")}</button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }
  return null;
}
