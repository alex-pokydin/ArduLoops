import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export function FirmwareLibrary() {
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
  const [firmwareComments, setFirmwareComments] = useState<Record<string, string>>({});
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentState, setCommentState] = useState<{ key: string; text: string } | null>(null);
  const [commentOpen, setCommentOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
        setFirmwareComments(Object.fromEntries(next.artifacts.map((artifact) => [artifact.artifact_id, artifact.comment ?? ""])));
      })
      .catch((reason: unknown) => {
        if ((reason as { name?: string }).name !== "AbortError") setError(tr("Could not read the local firmware library"));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => refresh(), [refresh]);

  useEffect(() => {
    if (!pick) return;
    const found = library.artifacts.find((artifact) => artifact.artifact_id === pick);
    if (!found) return;
    setSelectedFirmware(found);
    setPlan(null);
    setConfirmation("");
    setFlashState("");
    setPick(null);
  }, [library.artifacts, pick]);

  async function addFirmware(file: File) {
    if (file.size <= 0 || file.size > 16 * 1024 * 1024) {
      setImportNote(tr(file.size <= 0 ? "The file is empty." : "This firmware file is larger than 16 MB."));
      return;
    }
    const name = file.name.toLowerCase();
    const connected = library.controller?.vehicle_id === "plane" ? "plane" : "copter";
    const vehicle = name.includes("plane") ? "plane" : name.includes("copter") ? "copter" : connected;
    setImporting(true);
    setImportNote(tr("Adding…"));
    try {
      const response = await fetch(`${APP_HTTP}/firmware-library/import?vehicle=${vehicle}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: await file.arrayBuffer(),
      });
      const value = await response.json().catch(() => ({} as { error?: string; artifact_id?: string; request?: { board_id?: string }; board_id?: number }));
      if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
      const board = value.request?.board_id || (value.board_id ? `#${value.board_id}` : tr("unknown board"));
      setImportNote(tr("Added firmware for {board}", { board }));
      if (value.artifact_id) setPick(value.artifact_id);
      refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : tr("Could not add firmware");
      setImportNote(tr(message));
    } finally {
      setImporting(false);
    }
  }

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

  return (
      <>
        <div className="table-tools">
          <div className="firmware-filter">
            <button type="button" className={showAll ? undefined : "on"} onClick={() => setShowAll(false)}>{tr("compatible")}</button>
            <button type="button" className={showAll ? "on" : undefined} onClick={() => setShowAll(true)}>{tr("all local")}</button>
          </div>
          <span className="work-count">{artifacts.length}</span>
          <button type="button" className="firmware-refresh" onClick={() => refresh()} disabled={loading || importing}>
            {loading ? tr("Refreshing…") : tr("Refresh")}
          </button>
          <button type="button" className="firmware-refresh" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? tr("Adding…") : tr("Add firmware")}
          </button>
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            accept=".apj,application/json"
            aria-label={tr("Add firmware")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void addFirmware(file);
            }}
          />
        </div>
        {importNote ? <p className="param-job" role="status">{importNote}</p> : null}
        {error ? <p className="work-empty">{error}</p> : null}
        {!error && !loading && artifacts.length === 0 ? (
          <p className="work-empty">
            {showAll ? tr("The local library has no images yet.") : tr("There are no compatible local images.")}
            {" "}{tr("Download a successful build through MCP and it will appear here automatically.")}
          </p>
        ) : null}
        <div className="work-list">
          {artifacts.map((firmware) => (
            <article className={firmware.compatible ? "work-item match" : "work-item"} key={firmware.artifact_id}>
              <div className="work-row firmware-line">
                <div>
                  <b>Ardu{vehicleLabel(firmware.vehicle_id)} · {versionLabel(firmware.version_id)}</b>
                  <span>{firmware.board_name ?? tr("unknown board")} · #{firmware.board_id}{firmware.created_at ? ` · ${dateLabel(firmware.created_at)}` : ""}</span>
                </div>
                <div className="firmware-meta">
                  {firmware.features.includes("MODE_FLOWHOLD") ? <i>FlowHold</i> : null}
                  {showAll && firmware.compatible ? <i className="match">{tr("compatible")}</i> : null}
                  <small>{sizeLabel(firmware.image_size)}</small>
                </div>
                <button type="button" className="firmware-expand" aria-expanded={selectedFirmware?.artifact_id === firmware.artifact_id} aria-label={tr(selectedFirmware?.artifact_id === firmware.artifact_id ? "Collapse firmware" : "Expand firmware")} onClick={() => {
                  if (selectedFirmware?.artifact_id === firmware.artifact_id) {
                    setSelectedFirmware(null); setPlan(null); setConfirmation(""); setFlashState("");
                  } else {
                    setSelectedFirmware(firmware); setPlan(null); setConfirmation(""); setFlashState("");
                  }
                }} />
              </div>
              {selectedFirmware?.artifact_id === firmware.artifact_id ? (
                <section className="firmware-flash" aria-label={tr("Controller firmware")}>
                  <div className="firmware-build-details">
                    <p className="firmware-build-head">
                      <span>{tr("Build ID")} <code title={selectedFirmware.build_id ?? ""}>{selectedFirmware.build_id ?? tr("unknown")}</code></span>
                      <span>{tr("Artifact ID")} <code title={selectedFirmware.artifact_id}>{selectedFirmware.artifact_id}</code></span>
                      {selectedFirmware.git_identity ? <span>{tr("Git revision")} <code title={selectedFirmware.git_identity}>{selectedFirmware.git_identity}</code></span> : null}
                      <span>{tr("Build features ({count})", { count: selectedFirmware.features.length })}</span>
                      {selectedFirmware.description ? <span className="firmware-build-desc" title={selectedFirmware.description}>{selectedFirmware.description}</span> : null}
                    </p>
                    <div className="firmware-feature-list">{selectedFirmware.features.map((feature) => <code key={feature}>{feature}</code>)}</div>
                  </div>
                  <button type="button" className={commentOpen === selectedFirmware.artifact_id ? "work-mini on" : "work-mini"} onClick={() => setCommentOpen((open) => open === selectedFirmware.artifact_id ? null : selectedFirmware.artifact_id)}>{tr("Comment")}</button>
                  {commentOpen === selectedFirmware.artifact_id ? (
                    <form className="work-note" onSubmit={(event) => { event.preventDefault(); void saveComment({ artifact_id: selectedFirmware.artifact_id }, firmwareComments[selectedFirmware.artifact_id] ?? ""); }}>
                      <label className="sr-only" htmlFor={`firmware-comment-${selectedFirmware.artifact_id}`}>{tr("Comment")}</label>
                      <textarea id={`firmware-comment-${selectedFirmware.artifact_id}`} value={firmwareComments[selectedFirmware.artifact_id] ?? ""} onChange={(event) => setFirmwareComments((comments) => ({ ...comments, [selectedFirmware.artifact_id]: event.target.value }))} placeholder={tr("Add a comment")} maxLength={2000} />
                      <button type="submit" disabled={commentBusy}>{commentBusy ? tr("Saving…") : tr("Save comment")}</button>
                      {commentState?.key === selectedFirmware.artifact_id ? <span className="work-note-state" role="status">{commentState.text}</span> : null}
                    </form>
                  ) : null}
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
                </section>
              ) : null}
            </article>
          ))}
        </div>
      </>
  );
}
