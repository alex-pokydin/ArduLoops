import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/i18n";
import { APP_HTTP } from "../mav/link";
import { getLatest } from "../mav/store";
import { useStorePicked } from "../mav/view";

type OnboardLog = { id: number; size: number; time_utc: number; num_logs?: number; last_log_num?: number };
type LogBrief = {
  id: number;
  size: number;
  firmware: string;
  frame: string;
  start_utc: string;
  duration_us: number;
  error: string;
};
type SavedLog = {
  id: string;
  bytes: number;
  onboard_id?: number | null;
  saved_at?: string | null;
  flight_utc?: string | null;
};
type Place = "board" | "saved";
type Scope = "this" | "all";
type Copy = "any" | "missing";

function sizeLabel(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function when(utc: number): string {
  if (!utc) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(utc * 1000));
}

function whenIso(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function durationText(us: number, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (!us) return "";
  const total = Math.max(1, Math.round(us / 1_000_000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return t("{h} h {m} min", { h, m });
  if (m && s) return t("{m} min {s} s", { m, s });
  if (m) return t("{m} min", { m });
  return t("{s} s", { s });
}

function bootKey(uid: string): string {
  return uid.replace(/[^0-9A-Za-z]/g, "");
}

function vehicleOf(id: string): string {
  return id.split(/[/\\]/)[0] ?? "";
}

function shortUid(folder: string): string {
  if (folder.length <= 10) return folder;
  return `${folder.slice(0, 4)}…${folder.slice(-4)}`;
}

function fileName(id: string): string {
  return id.split(/[/\\]/).pop() || id;
}

function fileStamp(id: string): Date | null {
  const match = /^[0-9a-f]{16}_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/i.exec(fileName(id));
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function downloadWait(size: number): number {
  return Math.min(3600, Math.max(180, Math.ceil(size / 6000) + 90));
}

function isCopy(file: SavedLog, log: OnboardLog, key: string): boolean {
  return key.length > 0 && vehicleOf(file.id) === key && file.onboard_id === log.id && file.bytes === log.size;
}

function newerTexts(curr: string[], prev: string[]): string[] {
  if (!curr.length) return [];
  for (let i = 0; i <= curr.length; i++) {
    const rest = curr.slice(i);
    if (rest.length <= prev.length && rest.every((value, index) => value === prev[index])) return curr.slice(0, i);
  }
  return curr;
}

function LogMeter({ id, busy }: { id: number; busy: boolean }) {
  const t = useT();
  const flow = useStorePicked((s) => {
    const d = s.log_download;
    if (!d || d.id !== id || d.complete) return "";
    return `${d.received}|${d.size}`;
  });
  if (!busy && !flow) return null;
  const [received, size] = flow ? flow.split("|").map(Number) : [0, 0];
  const pct = size > 0 ? Math.min(100, Math.round((received / size) * 100)) : 0;
  return (
    <span className="log-meter">
      <i aria-hidden="true"><b style={{ width: `${pct}%` }} /></i>
      {flow ? `${sizeLabel(received)} / ${sizeLabel(size)}` : t("Downloading…")}
    </span>
  );
}

function LogAction({
  id,
  busy,
  erasing,
  onDownload,
  onCancel,
}: {
  id: number;
  busy: boolean;
  erasing: boolean;
  onDownload: (id: number) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const flow = useStorePicked((s) => {
    const d = s.log_download;
    return !!(d && d.id === id && !d.complete);
  });
  if (busy || flow) return <button type="button" onClick={onCancel}>{t("Cancel")}</button>;
  return <button type="button" disabled={erasing} onClick={() => onDownload(id)}>{t("Download")}</button>;
}

export function VehicleLogs({ active }: { active: boolean }) {
  const t = useT();
  const link = useStorePicked(
    (s) => ({ ok: s.ok, armed: !!s.armed, boot: s.boot_uid ?? "" }),
    (a, b) => a.ok === b.ok && a.armed === b.armed && a.boot === b.boot,
  );
  const texts = useStorePicked(
    (s) => s.texts ?? [],
    (a, b) => a.length === b.length && a.every((line, i) => line === b[i]),
  );
  const key = bootKey(link.boot);
  const [logs, setLogs] = useState<OnboardLog[]>([]);
  const [saved, setSaved] = useState<SavedLog[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(0);
  const [note, setNote] = useState("");
  const [briefs, setBriefs] = useState<Record<number, LogBrief>>({});
  const [reading, setReading] = useState(0);
  const [place, setPlace] = useState<Place>("board");
  const [scope, setScope] = useState<Scope>("this");
  const [copy, setCopy] = useState<Copy>("any");
  const [askErase, setAskErase] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseNote, setEraseNote] = useState("");
  const textsAtErase = useRef<string[]>([]);
  const downloadAbort = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    const ac = new AbortController();
    setLoading(true);
    setErr("");
    void fetch(`${APP_HTTP}/logs?refresh=1`, { signal: ac.signal })
      .then(async (response) => {
        const body = await response.json() as { logs?: OnboardLog[]; error?: string };
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        setLogs(Array.isArray(body.logs) ? body.logs : []);
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setErr(reason.message);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

  const loadSaved = useCallback(() => {
    const ac = new AbortController();
    void fetch(`${APP_HTTP}/ai/logs`, { signal: ac.signal })
      .then(async (response) => {
        const body = await response.json() as { logs?: SavedLog[]; message?: string };
        if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
        setSaved(Array.isArray(body.logs) ? body.logs : []);
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setErr(reason.message);
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!active) return;
    const stopBoard = load();
    const stopSaved = loadSaved();
    return () => {
      stopBoard();
      stopSaved();
    };
  }, [active, load, loadSaved]);

  useEffect(() => {
    if (!active || place !== "board" || logs.length === 0 || erasing) return;
    const ac = new AbortController();
    const rows = logs;
    void (async () => {
      for (const log of rows) {
        if (ac.signal.aborted) return;
        const known = briefs[log.id];
        if (known && known.size === log.size && !known.error) continue;
        setReading(log.id);
        try {
          const response = await fetch(`${APP_HTTP}/logs/brief?id=${log.id}`, { signal: ac.signal });
          const body = await response.json() as LogBrief & { error?: string };
          if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
          if (!ac.signal.aborted) setBriefs((all) => ({ ...all, [log.id]: body }));
        } catch (reason) {
          if (ac.signal.aborted || (reason instanceof Error && reason.name === "AbortError")) return;
          const message = reason instanceof Error ? reason.message : t("Could not read the log header");
          setBriefs((all) => ({
            ...all,
            [log.id]: { id: log.id, size: log.size, firmware: "", frame: "", start_utc: "", duration_us: 0, error: message },
          }));
        }
      }
      if (!ac.signal.aborted) setReading(0);
    })();
    return () => ac.abort();
  }, [active, place, logs, erasing, t]);

  useEffect(() => {
    if (!erasing) return;
    const fresh = newerTexts(texts, textsAtErase.current);
    if (!fresh.some((line) => line.includes("Chip erase complete"))) return;
    setErasing(false);
    setEraseNote(t("On-board logs erased."));
    load();
  }, [erasing, texts, load, t]);

  useEffect(() => {
    if (!erasing) return;
    const timer = window.setTimeout(() => {
      setErasing(false);
      setEraseNote(t("The vehicle did not report that the erase finished."));
      load();
    }, 90_000);
    return () => window.clearTimeout(timer);
  }, [erasing, load, t]);

  async function erase() {
    setAskErase(false);
    setEraseNote("");
    textsAtErase.current = getLatest().texts ?? [];
    setErasing(true);
    try {
      const response = await fetch(`${APP_HTTP}/logs/erase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    } catch (reason) {
      setErasing(false);
      const message = reason instanceof Error ? reason.message : "";
      setEraseNote(message === "A fresh disarmed vehicle heartbeat is required before erasing DataFlash logs"
        ? t(message)
        : t("Could not erase on-board logs"));
    }
  }

  async function download(id: number) {
    downloadAbort.current?.abort();
    const ac = new AbortController();
    downloadAbort.current = ac;
    setBusy(id);
    setNote("");
    const size = logs.find((log) => log.id === id)?.size ?? 0;
    try {
      const response = await fetch(`${APP_HTTP}/logs/download?id=${id}&timeout_s=${downloadWait(size)}`, { signal: ac.signal });
      const body = await response.json() as { error?: string; path?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setNote(body.path ? body.path : t("Downloaded"));
      loadSaved();
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      const message = reason instanceof Error ? reason.message : "";
      setNote(message && message !== "Download cancelled" ? t(message) : "");
    } finally {
      if (downloadAbort.current === ac) {
        downloadAbort.current = null;
        setBusy(0);
      }
    }
  }

  async function cancelDownload() {
    downloadAbort.current?.abort();
    setBusy(0);
    setNote("");
    await fetch(`${APP_HTTP}/logs/cancel`, { method: "POST" }).catch(() => {});
  }

  async function reveal(id: string) {
    setNote("");
    try {
      const response = await fetch(`${APP_HTTP}/logs/reveal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) setNote(t("Could not show that log in a folder"));
    } catch {
      setNote(t("Could not show that log in a folder"));
    }
  }

  const savedHere = saved.filter((file) => vehicleOf(file.id) === key);
  const missing = logs.filter((log) => !saved.some((file) => isCopy(file, log, key)));
  const boardRows = copy === "missing" ? missing : logs;
  const savedRows = scope === "this" ? savedHere : saved;
  const boardCount = boardRows.length;
  const savedCount = savedRows.length;

  return (
    <div className="split log-layout">
      <div className="table-tools">
        <span className="work-count">{place === "board" ? boardCount : savedCount}</span>
        <button type="button" className="firmware-refresh" onClick={() => { setEraseNote(""); load(); loadSaved(); }} disabled={loading || erasing}>{loading ? t("Refreshing…") : t("Refresh")}</button>
        {place === "board" ? (
          <button
            type="button"
            className="work-mini"
            disabled={erasing || logs.length === 0 || !link.ok || link.armed}
            title={link.armed ? t("A fresh disarmed vehicle heartbeat is required before erasing DataFlash logs") : t("Erase on-board logs")}
            onClick={() => { setEraseNote(""); setAskErase(true); }}
          >{erasing ? t("Erasing logs…") : t("Erase")}</button>
        ) : null}
        {place === "board" && askErase && !erasing ? (
          <div className="log-erase-ask">
            {t("This erases every on-board log. Downloaded copies stay on this computer.")}
            <button type="button" className="hot" onClick={() => void erase()}>{t("Erase")}</button>
            <button type="button" onClick={() => setAskErase(false)}>{t("Cancel")}</button>
          </div>
        ) : null}
        {place === "board" && erasing ? (
          <div className="log-erase-wait" role="status">
            <i aria-hidden="true"><b /></i>
            {t("Erasing on-board logs…")}
          </div>
        ) : null}
        {place === "board" && eraseNote && !erasing ? <p className="log-erase-ask" role="status">{eraseNote}</p> : null}
      </div>
      <div className="log-main">
        <div className="work-list">
          {err ? <p className="work-empty">{t(err)}</p> : null}
          {place === "board" && !err && !loading && logs.length === 0 ? <p className="work-empty">{t("No on-board logs yet.")}</p> : null}
          {place === "board" && !err && logs.length > 0 && boardRows.length === 0 ? <p className="work-empty">{t("Every on-board log is already on this computer.")}</p> : null}
          {place === "saved" && savedRows.length === 0 ? <p className="work-empty">{t(scope === "this" ? "No logs for this controller yet." : "No downloaded logs yet.")}</p> : null}
          {note ? <p className="work-empty">{note}</p> : null}
          {place === "board" ? boardRows.map((log) => {
            const brief = briefs[log.id]?.size === log.size ? briefs[log.id] : undefined;
            const count = log.num_logs ?? 0;
            const title = count > 1 ? t("Log {id} of {count}", { id: log.id, count }) : t("Log {id}", { id: log.id });
            const date = brief?.start_utc ? whenIso(brief.start_utc) : when(log.time_utc);
            const copyFile = saved.find((file) => isCopy(file, log, key));
            const detail = [
              count > 1 && log.id === log.last_log_num ? t("newest") : "",
              date,
              brief && !brief.error ? durationText(brief.duration_us, t) : "",
              brief?.frame ?? "",
              brief?.firmware ?? "",
              brief?.error ? t(brief.error) : "",
              !brief && reading === log.id ? t("Reading the log header…") : "",
            ].filter(Boolean).join(" · ");
            return (
              <div className="work-row log-line" key={log.id}>
                <div>
                  <p>
                    <b>{title}</b>
                    <span>{sizeLabel(log.size)}</span>
                    {copyFile ? (
                      <button type="button" className="log-file" title={t("Show in folder")} onClick={() => void reveal(copyFile.id)}>
                        {fileName(copyFile.id)}
                      </button>
                    ) : null}
                  </p>
                  {detail ? <span>{detail}</span> : null}
                  <LogMeter id={log.id} busy={busy === log.id} />
                </div>
                <LogAction
                  id={log.id}
                  busy={busy === log.id}
                  erasing={erasing}
                  onDownload={(logId) => void download(logId)}
                  onCancel={() => void cancelDownload()}
                />
              </div>
            );
          }) : savedRows.map((file) => {
            const folder = vehicleOf(file.id);
            const title = file.onboard_id ? t("Log {id}", { id: file.onboard_id }) : fileName(file.id);
            const flightDate = file.flight_utc ? new Date(file.flight_utc) : fileStamp(file.id);
            const savedDate = file.saved_at ? new Date(file.saved_at) : null;
            const flightKnown = flightDate != null && !Number.isNaN(flightDate.getTime());
            const savedKnown = savedDate != null && !Number.isNaN(savedDate.getTime());
            const sameMoment = flightKnown && savedKnown && Math.abs(flightDate.getTime() - savedDate.getTime()) < 120_000;
            const flight = flightKnown && !sameMoment ? formatWhen(flightDate) : "";
            const savedWhen = savedKnown ? t("Downloaded {when}", { when: formatWhen(savedDate) }) : "";
            const detail = [flight, savedWhen, scope === "all" ? shortUid(folder) : ""].filter(Boolean).join(" · ");
            return (
              <div className="work-row log-line" key={file.id}>
                <div>
                  <p><b>{title}</b><span>{sizeLabel(file.bytes)}</span></p>
                  <span>
                    {detail}
                    {detail ? " · " : null}
                    <button type="button" className="log-file" title={t("Show in folder")} onClick={() => void reveal(file.id)}>
                      {fileName(file.id)}
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <nav className="side-nav" aria-label={t("Log filters")}>
        <b>{t("source")}</b>
        <button type="button" className={place === "board" ? "on" : undefined} onClick={() => setPlace("board")}>
          <span>{t("on the controller")}</span><small>{boardCount}</small>
        </button>
        <button type="button" className={place === "saved" ? "on" : undefined} onClick={() => setPlace("saved")}>
          <span>{t("downloaded")}</span><small>{savedCount}</small>
        </button>
        <b>{t("controller")}</b>
        <button type="button" className={scope === "this" ? "on" : undefined} onClick={() => setScope("this")}>
          <span>{t("this controller")}</span><small>{place === "board" ? boardCount : savedHere.length}</small>
        </button>
        <button type="button" className={scope === "all" ? "on" : undefined} onClick={() => setScope("all")}>
          <span>{t("all controllers")}</span><small>{place === "board" ? boardCount : saved.length}</small>
        </button>
        {place === "board" ? (
          <>
            <b>{t("copy")}</b>
            <button type="button" className={copy === "any" ? "on" : undefined} onClick={() => setCopy("any")}>
              <span>{t("any copy")}</span><small>{logs.length}</small>
            </button>
            <button type="button" className={copy === "missing" ? "on" : undefined} onClick={() => setCopy("missing")}>
              <span>{t("not saved yet")}</span><small>{missing.length}</small>
            </button>
          </>
        ) : null}
      </nav>
    </div>
  );
}
