import { startTransition, useState } from "react";
import { useT } from "../i18n/i18n";
import { ControllerBoard } from "./ControllerBoard";
import { FirmwareLibrary } from "./FirmwareLibrary";
import { HardwareSetup } from "./HardwareSetup";
import { ParameterLibrary } from "./ParameterLibrary";
import { VehicleLogs } from "./VehicleLogs";
import { WorkspaceTabs, type WorkspaceId } from "./WorkspaceTabs";

const PANES = ["calibration", "logs", "params", "firmware"] as const;
type Pane = (typeof PANES)[number];

const TAB_LABEL: Partial<Record<Pane, string>> = { calibration: "Setup" };

export function ControllerView({
  ids,
  onWorkspace,
}: {
  ids: WorkspaceId[];
  onWorkspace: (id: WorkspaceId) => void;
}) {
  const t = useT();
  const [pane, setPane] = useState<Pane>("calibration");
  const [body, setBody] = useState<Pane>("calibration");
  function choose(id: Pane) {
    if (id === pane) return;
    setPane(id);
    startTransition(() => setBody(id));
  }
  return (
    <section className="scope work">
      <div className="work-bar">
        <WorkspaceTabs current="firmware" ids={ids} onSelect={onWorkspace} />
      </div>
      <ControllerBoard />
      <div className="studio-tabs controller-tabs" role="tablist" aria-label={t("controller")}>
        {PANES.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={pane === id} onClick={() => choose(id)}>
            <span>{t(TAB_LABEL[id] ?? id)}</span>
          </button>
        ))}
      </div>
      {body === "params" ? (
        <div className="controller-pane">
          <ParameterLibrary />
        </div>
      ) : null}
      {body === "firmware" ? (
        <div className="controller-pane">
          <FirmwareLibrary />
        </div>
      ) : null}
      {body === "calibration" ? (
        <div className="controller-pane">
          <HardwareSetup />
        </div>
      ) : null}
      {body === "logs" ? (
        <div className="controller-pane">
          <VehicleLogs active />
        </div>
      ) : null}
    </section>
  );
}
