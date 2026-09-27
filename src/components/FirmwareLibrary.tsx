import { CalibrationPanel } from "./CalibrationPanel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_HTTP } from "../mav/link";
import { t, useT } from "../i18n/i18n";

type Controller = {
  board_id: number;
  vehicle_id: string;
  git_identity?: string | null;
  system_id: number;
  component_id?: number;
  board_name?: string | null;
  uid?: string | null;
  key?: string | null;
  comment?: string;
};

type Firmware = {
  artifact_id: string;
  build_id?: string | null;
  vehicle_id: string;
  board_name?: string | null;
  board_id: number;
  version_id?: string | null;
  git_identity?: string | null;
  image_size?: number | null;
  description?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
  comment?: string;
  features: string[];
  compatible: boolean;
};

type Library = { controller?: Controller | null; artifacts: Firmware[] };
type UsbPort = { port: string; description?: string | null; serial_number?: string | null };
type FlashPlan = { plan_id: string; confirmation: string; backup?: string; expires_at?: number };

const EMPTY: Library = { artifacts: [] };

function versionLabel(value?: string | null): string {
  const stable = value?.match(/(?:^|-)v?(\d+\.\d+(?:\.\d+)?)(?:-|$)/)?.[1];
  return stable ?? t("custom");
}

function vehicleLabel(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : t("ArduPilot");
}

function sizeLabel(bytes?: number | null): string {
  return typeof bytes === "number" ? `${Math.ceil(bytes / 1024)} KB` : "";
}

function dateLabel(value?: number | null): string {
  return typeof value === "number" && value > 0
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value * 1000))
    : "";
}

export function FirmwareLibrary({ onBack, onParams }: { onBack: () => void; onParams: () => void }) {
  const tr = useT();
  const [library, setLibrary] = useState<Library>(EMPTY);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedFirmware, setSelectedFirmware] = useState<Firmware | null>(null);
  const [ports, setPorts] = useState<UsbPort[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [plan, setPlan] = useState<FlashPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [flashBusy, setFlashBusy] = useState(false);
  const [flashState, setFlashState] = useState("");
  const [controllerComment, setControllerComment] = useState("");
  const [firmwareComments, setFirmwareComments] = useState<Record<string, string>>({});
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentState, setCommentState] = useState<{ key: string; text: string } | null>(null);

  const refresh = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(`${APP_HTTP}/firmware-library`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((value: unknown) => {
        if (!value || typeof value !== "object" || !Array.isArray((value as Library).artifacts)) throw new Error(tr("Invalid firmware library response"));
        const next = value as Library;
        setLibrary(next);
        setControllerComment(next.controller?.comment ?? "");
        setFirmwareComments(Object.fromEntries(next.artifacts.map((artifact) => [artifact.artifact_id, artifact.comment ?? ""])));
      })
      .catch((reason: unknown) => {
        if ((reason as { name?: string }).name !== "AbortError") setError(tr("Could not read the local firmware library"));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => refresh(), [refresh]);

  const flashRequest = useCallback(async (payload: Record<string, string>) => {
    setFlashBusy(true);
    setFlashState("");
    try {
      const response = await fetch(`${APP_HTTP}/firmware/flash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const value: unknown = await response.json();
      if (!response.ok || !value || typeof value !== "object") {
        throw new Error((value as { error?: string })?.error ?? `HTTP ${response.status}`);
      }
      return value as Record<string, unknown>;
    } catch (reason) {
      setFlashState(reason instanceof Error ? reason.message : tr("Could not complete the firmware operation"));
      return null;
    } finally {
      setFlashBusy(false);
    }
  }, []);

  async function loadPorts() {
    const value = await flashRequest({ action: "ports" });
    const listed = Array.isArray(value?.ports) ? value.ports as UsbPort[] : [];
    setPorts(listed);
    setSelectedPort((current) => listed.some((port) => port.port === current) ? current : (listed[0]?.port ?? ""));
  }

  async function prepareFlash() {
    if (!selectedFirmware || !selectedPort) return;
    const value = await flashRequest({ action: "prepare", artifact_id: selectedFirmware.artifact_id, port: selectedPort });
    if (value?.plan_id && value.confirmation) {
      setPlan(value as unknown as FlashPlan);
      setConfirmation("");
      setFlashState(tr("Parameters are backed up. Review the image, port, and backup before starting."));
    }
  }

  async function startBootloader() {
    if (!plan || confirmation !== plan.confirmation) return;
    const value = await flashRequest({ action: "start_bootloader", plan_id: plan.plan_id, confirmation });
    if (value) setFlashState(tr("The uploader is waiting and the vehicle was asked to reboot into bootloader. Check status in a few seconds."));
  }

  async function checkFlashStatus() {
    if (!plan) return;
    const value = await flashRequest({ action: "status", plan_id: plan.plan_id });
    if (value?.state) setFlashState(tr("Status: {state}{error}", { state: String(value.state), error: value.error ? ` — ${String(value.error)}` : "" }));
  }

  async function saveComment(target: Record<string, string>, comment: string) {
    const key = target.controller_key ?? target.artifact_id ?? "";
    setCommentBusy(true);
    setCommentState(null);
    try {
      const response = await fetch(`${APP_HTTP}/firmware-library/comment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...target, comment }),
      });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error((value as { error?: string })?.error ?? `HTTP ${response.status}`);
      setCommentState({ key, text: tr("Comment saved") });
      refresh();
    } catch (reason) {
      setCommentState({ key, text: reason instanceof Error ? reason.message : tr("Could not save comment") });
    } finally {
      setCommentBusy(false);
    }
  }

  const artifacts = useMemo(
    () => showAll ? library.artifacts : library.artifacts.filter((artifact) => artifact.compatible),
    [library.artifacts, showAll],
  );
  const controller = library.controller;

  return (
      <section className="scope firmware-library">
        <div className="firmware-head">
          <div className="firmware-tabs" role="tablist" aria-label={tr("Workspace")}>
            <button type="button" role="tab" aria-selected={false} onClick={onBack}>{tr("loops")}</button>
            <button type="button" role="tab" aria-selected>{tr("controller")}</button>
            <button type="button" role="tab" aria-selected={false} onClick={onParams}>{tr("params")}</button>
          </div>
          <button type="button" className="firmware-refresh" onClick={() => refresh()} disabled={loading}>
            {loading ? tr("Refreshing…") : tr("Refresh")}
          </button>
        </div>
        <div className="firmware-summary">
          {controller ? (
            <>
              <b>{controller.board_name ?? tr("unknown board")} · {controller.vehicle_id} · board #{controller.board_id}</b>
              <span>{tr("System ID {id}", { id: controller.system_id })}{controller.git_identity ? ` · ${controller.git_identity}` : ""}</span>
              {(controller.uid || controller.key) ? <details className="controller-identity"><summary>{tr("Identity")}</summary><code>{controller.uid ?? controller.key}</code></details> : null}
              <details className="catalog-comment" open={Boolean(controllerComment)}>
                <summary>{tr("Comment")}</summary>
                <label className="sr-only" htmlFor="controller-comment">{tr("Comment")}</label>
                <textarea id="controller-comment" value={controllerComment} onChange={(event) => setControllerComment(event.target.value)} placeholder={tr("Add a comment")} maxLength={2000} />
                <button type="button" onClick={() => controller.key && void saveComment({ controller_key: controller.key }, controllerComment)} disabled={commentBusy || !controller.key}>{commentBusy ? tr("Saving…") : tr("Save comment")}</button>
                {commentState?.key === controller.key ? <p className="catalog-comment-state" role="status">{commentState?.text}</p> : null}
              </details>
            </>
          ) : <span>{tr("Vehicle identity is loading. The library will filter images by board and vehicle type.")}</span>}
        </div>
        <CalibrationPanel />
        <div className="firmware-filter">
          <button type="button" className={showAll ? undefined : "on"} onClick={() => setShowAll(false)}>{tr("compatible")}</button>
          <button type="button" className={showAll ? "on" : undefined} onClick={() => setShowAll(true)}>{tr("all local")}</button>
        </div>
        {error ? <p className="firmware-empty">{error}</p> : null}
        {!error && !loading && artifacts.length === 0 ? (
          <p className="firmware-empty">
            {showAll ? tr("The local library has no images yet.") : tr("There are no compatible local images.")}
            {" "}{tr("Download a successful build through MCP and it will appear here automatically.")}
          </p>
        ) : null}
        <div className="firmware-list">
          {artifacts.map((firmware) => (
            <article className={firmware.compatible ? "firmware-card compatible" : "firmware-card"} key={firmware.artifact_id}>
              <div>
                <b>Ardu{vehicleLabel(firmware.vehicle_id)} · {versionLabel(firmware.version_id)}</b>
                <span>{firmware.board_name ?? tr("unknown board")} · #{firmware.board_id}{firmware.created_at ? ` · ${tr("Built {time}", { time: dateLabel(firmware.created_at) })}` : ""}</span>
              </div>
              <div className="firmware-meta">
                {firmware.features.includes("MODE_FLOWHOLD") ? <i>FlowHold</i> : null}
                {firmware.compatible ? <i className="match">{tr("compatible")}</i> : null}
                <small>{sizeLabel(firmware.image_size)}</small>
                <button type="button" className="firmware-expand" aria-expanded={selectedFirmware?.artifact_id === firmware.artifact_id} aria-label={tr(selectedFirmware?.artifact_id === firmware.artifact_id ? "Collapse firmware" : "Expand firmware")} onClick={() => {
                  if (selectedFirmware?.artifact_id === firmware.artifact_id) {
                    setSelectedFirmware(null); setPlan(null); setConfirmation(""); setFlashState("");
                  } else {
                    setSelectedFirmware(firmware); setPlan(null); setConfirmation(""); setFlashState("");
                  }
                }}>{selectedFirmware?.artifact_id === firmware.artifact_id ? "⌃" : "⌄"}</button>
              </div>
              {selectedFirmware?.artifact_id === firmware.artifact_id ? (
                <section className="firmware-flash" aria-label={tr("Controller firmware")}>
                  <div className="firmware-build-details">
                    <span>{tr("Build ID")}: <code>{selectedFirmware.build_id ?? tr("unknown")}</code></span>
                    <span>{tr("Artifact ID")}: <code>{selectedFirmware.artifact_id}</code></span>
                    {selectedFirmware.git_identity ? <span>{tr("Git revision")}: <code>{selectedFirmware.git_identity}</code></span> : null}
                    {selectedFirmware.description ? <span>{selectedFirmware.description}</span> : null}
                    <span>{tr("Build features ({count})", { count: selectedFirmware.features.length })}</span>
                    <div className="firmware-feature-list">{selectedFirmware.features.map((feature) => <code key={feature}>{feature}</code>)}</div>
                  </div>
                  <details className="catalog-comment" open={Boolean(firmwareComments[selectedFirmware.artifact_id])}>
                    <summary>{tr("Comment")}</summary>
                    <label className="sr-only" htmlFor={`firmware-comment-${selectedFirmware.artifact_id}`}>{tr("Comment")}</label>
                    <textarea id={`firmware-comment-${selectedFirmware.artifact_id}`} value={firmwareComments[selectedFirmware.artifact_id] ?? ""} onChange={(event) => setFirmwareComments((comments) => ({ ...comments, [selectedFirmware.artifact_id]: event.target.value }))} placeholder={tr("Add a comment")} maxLength={2000} />
                    <button type="button" onClick={() => void saveComment({ artifact_id: selectedFirmware.artifact_id }, firmwareComments[selectedFirmware.artifact_id] ?? "")} disabled={commentBusy}>{commentBusy ? tr("Saving…") : tr("Save comment")}</button>
                  </details>
                  <p>{tr("A separate UDP telemetry link is used. USB is reserved for the uploader only after vehicle checks and parameter backup.")}</p>
                  <div className="firmware-flash-controls">
                    <button type="button" onClick={() => void loadPorts()} disabled={flashBusy}>{tr("Refresh USB ports")}</button>
                    <select value={selectedPort} onChange={(event) => setSelectedPort(event.target.value)} aria-label={tr("Controller USB port")}>
                      <option value="">{tr("Select a USB port")}</option>
                      {ports.map((port) => <option key={port.port} value={port.port}>{port.port} · {port.description ?? "USB"}</option>)}
                    </select>
                    <button type="button" onClick={() => void prepareFlash()} disabled={flashBusy || !selectedPort}>{flashBusy ? tr("Checking…") : tr("Prepare")}</button>
                  </div>
                  {plan ? (
                    <div className="firmware-confirm">
                      <span>{tr("Parameter backup: {path}", { path: plan.backup ?? tr("saved") })}</span>
                      <label>{tr("To write, enter")} <code>{plan.confirmation}</code>
                        <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
                      </label>
                      <div className="firmware-flash-controls">
                        <button type="button" className="firmware-write" onClick={() => void startBootloader()} disabled={flashBusy || confirmation !== plan.confirmation}>{tr("Start flashing")}</button>
                        <button type="button" onClick={() => void checkFlashStatus()} disabled={flashBusy}>{tr("Check status")}</button>
                      </div>
                    </div>
                  ) : null}
                  {flashState ? <p className="firmware-flash-state">{flashState}</p> : null}
                  {commentState?.key === selectedFirmware.artifact_id ? <p className="catalog-comment-state" role="status">{commentState?.text}</p> : null}
                </section>
              ) : null}
            </article>
          ))}
        </div>
      </section>
  );
}
