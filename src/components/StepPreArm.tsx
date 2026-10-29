import { useT } from "../i18n/i18n";
import { prearmStep } from "../lib/setupSteps";
import { PREARM_FRESH_S } from "../lib/vehicleHeader";
import { useStorePicked } from "../mav/view";
import { FixButton } from "./HardwareSetup";

/** The vehicle's own PreArm lines that this step fixes, as ArduPilot sent them, each with Fix. */
export function StepPreArm({ step }: { step: string }) {
  const t = useT();
  const lines = useStorePicked(
    (s) => {
      if (!s.ok || s.armed) return [];
      const now = s.heartbeat_at ?? 0;
      return (s.prearm ?? []).filter((line) => now - line.at <= PREARM_FRESH_S && prearmStep(line.text) === step).map((line) => line.text);
    },
    (a, b) => a.length === b.length && a.every((line, i) => line === b[i]),
  );
  return (
    <>
      {lines.map((line) => (
        <div key={line} className="frs-note err sst-prearm">
          <span>{line}</span>
          <FixButton small text={t("Fix: {line}", { line })} focus={line.slice(0, 32)} />
        </div>
      ))}
    </>
  );
}
