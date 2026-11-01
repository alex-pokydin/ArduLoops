import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useT } from "../i18n/i18n";
import { openAssistant } from "../lib/assistantAsk";
import { pokeCloud, resumeUploads, uploadLog, useCloudSync, useCloudUploads } from "../lib/cloudSync";
import { AUTO_STARTED, autoDownloadOn, cancelDownload, enqueueDownloads, setAutoDownload, useAutoDownload, useLogQueue } from "../lib/logQueue";
import { APP_HTTP } from "../mav/link";
import { getLatest } from "../mav/store";
import { useStorePicked } from "../mav/view";

type Tr = (key: string, vars?: Record<string, string | number>) => string;

type OnboardLog = { id: number; size: number; time_utc: number; num_logs?: number; last_log_num?: number };
type LogBrief = { id: number; size: number; firmware: string; frame: string; start_utc: string; duration_us: number; error: string };
type FlagKind = "crash" | "err" | "fs" | "batt" | "clip";
type Flag = { kind: FlagKind; count: number; at_s: number; text: string };
type Scan = { firmware: string; frame: string; start_utc: string; duration_us: number; armed_s: number | null; flights: number | null; flags: Flag[] };
type Change = { since: string; since_onboard: number | null; count: number; params: { name: string; from: number; to: number }[]; firmware: { from: string; to: string } | null };
type LocalLog = {
  id: string;
  bytes: number;
  hash: string | null;
  vehicle: string;
  onboard_id?: number | null;
  saved_at?: string | null;
  flight_utc?: string | null;
  flight_stamp?: string;
  original_name?: string;
  scan: Scan | null;
  star: boolean;
  note: string;
  changes?: Change;
};
type CloudLog = { hash: string; name: string; board: string; onboard_id: number | null; bytes: number; stored_bytes: number; stored: boolean; uploaded_at: string | null; meta: { star: boolean; note: string; updated_at: number } };
type CloudState = { signed_in: boolean; mode: "off" | "starred" | "all"; used?: number; limit?: number; plan?: string; logs: CloudLog[]; error?: string };
type Row = {
  key: string;
  log?: OnboardLog;
  file?: LocalLog;
  cloud?: CloudLog;
  num: number | null;
  hash: string | null;
  at: Date | null;
  star: boolean;
  note: string;
  scan: Scan | null;
  brief?: LogBrief;
  changes?: Change;
  size: number;
  board: string;
  name: string;
};
type Filter = "all" | "star" | "board" | "pc" | "cloud" | "missing";
type SortKey = "log" | "date" | "armed" | "size";
type Status = { tone: "" | "ok" | "bad" | "amber"; text: string; action?: { label: string; run: () => void }; sticky?: boolean } | null;
type Dialog =
  | null
  | { kind: "erase" }
  | { kind: "share"; rows: Row[] }
  | { kind: "clean" }
  | { kind: "cloud" }
  | { kind: "delete"; rows: Row[] }
  | { kind: "uncloud"; row: Row };
type Menu = null | { kind: "row"; key: string; x: number; y: number } | { kind: "bar"; x: number; y: number };
type Pop = null | { kind: "flags" | "changes"; key: string; x: number; y: number };

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "star", label: "★ Starred" },
  { id: "board", label: "On board" },
  { id: "pc", label: "Saved" },
  { id: "cloud", label: "Cloud" },
  { id: "missing", label: "Not saved" },
];
const FLAG_LABEL: Record<FlagKind, string> = { crash: "Crash", err: "Errors", fs: "Failsafe", batt: "Low battery", clip: "Clipping" };
const HOT = new Set<FlagKind>(["crash", "err"]);
const LAST_BOARD = "arduloops.logs.lastBoard";
const STATUS_MS = 6000;

function sizeLabel(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function mbLabel(bytes: number): string {
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`;
}

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function dateOf(value: string | number | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stampDate(stamp: string | undefined): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp ?? "");
  return m ? dateOf(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : null;
}

function spanText(seconds: number, t: Tr): string {
  const total = Math.max(1, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return t("{h} h {m} min", { h, m });
  if (m && s) return t("{m} min {s} s", { m, s });
  if (m) return t("{m} min", { m });
  return t("{s} s", { s });
}

/** Armed time and flights, or never armed. Short: the time only. */
function armedText(row: Row, t: Tr, short: boolean): string {
  const scan = row.scan;
  if (!scan || scan.armed_s == null) return "";
  if (!scan.flights) return t("never armed");
  const time = spanText(scan.armed_s, t);
  return short ? time : `${time} · ${t(scan.flights === 1 ? "{n} flight" : "{n} flights", { n: scan.flights })}`;
}

function bootKey(uid: string): string {
  return uid.replace(/[^0-9A-Za-z]/g, "");
}

function shortUid(folder: string): string {
  return folder.length <= 10 ? folder : `${folder.slice(0, 4)}…${folder.slice(-4)}`;
}

function fileName(id: string): string {
  return id.split(/[/\\]/).pop() || id;
}

function newerTexts(curr: string[], prev: string[]): string[] {
  if (!curr.length) return [];
  for (let i = 0; i <= curr.length; i++) {
    const rest = curr.slice(i);
    if (rest.length <= prev.length && rest.every((value, index) => value === prev[index])) return curr.slice(0, i);
  }
  return curr;
}

function readLastBoard(): string {
  try {
    return localStorage.getItem(LAST_BOARD) || "";
  } catch {
    return "";
  }
}

async function getJson<R>(path: string, init?: RequestInit): Promise<R> {
  const response = await fetch(`${APP_HTTP}${path}`, init);
  const body = await response.json().catch(() => ({})) as R & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function postJson<R>(path: string, body: unknown): Promise<R> {
  return getJson<R>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const ICON = {
  board: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="8" height="8" rx="1.2" /><path d="M6 2v2M10 2v2M6 12v2M10 12v2M2 6h2M2 10h2M12 6h2M12 10h2" /></svg>,
  pc: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3" width="11" height="7.5" rx="1" /><path d="M1.5 13h13" /></svg>,
  cloud: <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4.6 12.5h6.9a2.9 2.9 0 0 0 .3-5.8A4 4 0 0 0 4.2 7.4a2.6 2.6 0 0 0 .4 5.1z" /></svg>,
};

/** Where the log is: board, this computer, cloud, each lit or dim. The cloud mark is dashed while it uploads. */
function Where({ row, up, other }: { row: Row; up: boolean; other: boolean }) {
  const t = useT();
  const places = [row.log ? t("the board") : "", row.file ? t("this computer") : "", row.cloud?.stored ? t("the cloud") : ""].filter(Boolean).join(", ");
  return (
    <span className="log-where" title={`${t("On {places}", { places })}${other ? ` · ${row.board}` : ""}`}>
      <i className={row.log ? "on board" : undefined}>{ICON.board}</i>
      <i className={row.file ? "on pc" : undefined}>{ICON.pc}</i>
      <i className={`${row.cloud?.stored ? "on cloud" : ""}${up ? " up" : ""}`}>{ICON.cloud}</i>
      {other ? <small>{shortUid(row.board)}</small> : null}
    </span>
  );
}

function Flags({ flags, compact }: { flags: Flag[]; compact: boolean }) {
  const t = useT();
  if (!flags.length) return <i className="log-nil">—</i>;
  if (compact) return <span className={`log-flag ${flags.some((f) => HOT.has(f.kind)) ? "hot" : "amber"}`}>{flags.length}</span>;
  return <>{flags.map((f) => <span key={f.kind} className={`log-flag ${HOT.has(f.kind) ? "hot" : "amber"}`}>{t(FLAG_LABEL[f.kind])}{f.count > 1 ? ` ${f.count}` : ""}</span>)}</>;
}

/** Percent of the board download in progress for this log, or -1 before the first byte. */
function useDownloadPct(id: number): number {
  return useStorePicked((s) => {
    const d = s.log_download;
    if (!d || d.id !== id || d.complete || !d.size) return -1;
    return Math.min(100, Math.round((d.received / d.size) * 100));
  });
}

function DownloadingAction({ id, onCancel }: { id: number; onCancel: () => void }) {
  const t = useT();
  const pct = useDownloadPct(id);
  return (
    <button type="button" className="log-act prog" title={t("Cancel")} onClick={onCancel}>
      {pct >= 0 ? `${pct}%` : "…"}<b aria-hidden="true">×</b>
    </button>
  );
}

function DownloadingLine({ id }: { id: number }) {
  const pct = useDownloadPct(id);
  return pct >= 0 ? <i className="log-progress" style={{ width: `${pct}%` }} /> : <i className="log-progress wait" />;
}

/** Mounted beside the Controller so new logs download on connect even with another tab open. */
export function LogAutoDownload() {
  const link = useStorePicked(
    (s) => ({ ok: s.ok, armed: !!s.armed, boot: s.log_dir || bootKey(s.boot_uid ?? "") }),
    (a, b) => a.ok === b.ok && a.armed === b.armed && a.boot === b.boot,
  );
  useAutoDownload(link.boot, link.ok, link.armed);
  useCloudSync();
  return null;
}

export function VehicleLogs({ active }: { active: boolean }) {
  const t = useT();
  const link = useStorePicked(
    (s) => ({ ok: s.ok, armed: !!s.armed, boot: s.log_dir || bootKey(s.boot_uid ?? "") }),
    (a, b) => a.ok === b.ok && a.armed === b.armed && a.boot === b.boot,
  );
  const texts = useStorePicked(
    (s) => s.texts ?? [],
    (a, b) => a.length === b.length && a.every((line, i) => line === b[i]),
  );
  const key = link.boot;
  const [lastBoard, setLastBoard] = useState(readLastBoard);
  const board = key || lastBoard;
  const queue = useLogQueue();
  const sync = useCloudUploads();
  const uploading = sync.uploading;

  const [logs, setLogs] = useState<OnboardLog[]>([]);
  const [local, setLocal] = useState<LocalLog[]>([]);
  const [cloud, setCloud] = useState<CloudState>({ signed_in: false, mode: "off", logs: [] });
  const [loading, setLoading] = useState(false);
  const [briefs, setBriefs] = useState<Record<number, LogBrief>>({});
  const [reading, setReading] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [scope, setScope] = useState<"this" | "all">("this");
  const [sort, setSort] = useState<{ key: SortKey; down: boolean }>({ key: "log", down: true });
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ key: string; draft: string } | null>(null);
  const [status, setStatusRaw] = useState<Status>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [pop, setPop] = useState<Pop>(null);
  const [erasing, setErasing] = useState(false);
  const [fetching, setFetching] = useState("");
  const [autoOn, setAutoOn] = useState(false);
  const textsAtErase = useRef<string[]>([]);
  const pendingMeta = useRef(new Map<string, { star?: boolean; note?: string }>());
  const statusTimer = useRef(0);
  const viewRef = useRef<HTMLDivElement>(null);

  const setStatus = useCallback((next: Status) => {
    window.clearTimeout(statusTimer.current);
    setStatusRaw(next);
    if (next && !next.sticky) statusTimer.current = window.setTimeout(() => setStatusRaw(null), STATUS_MS);
  }, []);

  useEffect(() => {
    if (!key) return;
    try {
      localStorage.setItem(LAST_BOARD, key);
    } catch {
      /* private window */
    }
    setLastBoard(key);
    setAutoOn(autoDownloadOn(key));
  }, [key]);

  // ---------- loading ----------

  const loadBoard = useCallback(() => {
    if (!link.ok || link.armed) return;
    setLoading(true);
    void getJson<{ logs?: OnboardLog[] }>("/logs?refresh=1")
      .then((body) => setLogs(Array.isArray(body.logs) ? body.logs : []))
      .catch((reason: Error) => {
        // While a download holds the link the list cannot be asked for again; the last list
        // the bridge streamed is still right, so the board's rows stay.
        const last = (getLatest() as { logs?: OnboardLog[] }).logs;
        if (Array.isArray(last) && last.length) setLogs(last);
        else setStatus({ tone: "bad", text: t(reason.message) });
      })
      .finally(() => setLoading(false));
  }, [link.ok, link.armed, setStatus, t]);

  const loadLocal = useCallback(() => {
    void getJson<{ logs?: LocalLog[] }>("/logs/local")
      .then((body) => setLocal(Array.isArray(body.logs) ? body.logs : []))
      .catch(() => {});
  }, []);

  const loadCloud = useCallback(() => {
    void getJson<CloudState>("/logs/cloud")
      .then((body) => setCloud({ ...body, logs: Array.isArray(body.logs) ? body.logs : [] }))
      .catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    loadBoard();
    loadLocal();
    loadCloud();
  }, [loadBoard, loadLocal, loadCloud]);

  useEffect(() => {
    if (!active) return;
    loadLocal();
    loadCloud();
  }, [active, loadLocal, loadCloud]);

  useEffect(() => {
    if (!active) return;
    if (!link.ok) setLogs([]);
    loadBoard();
  }, [active, link.ok, link.armed, key, loadBoard]);

  // The board's own headers, one log at a time, for logs not yet on this computer. A failed read is tried twice.
  const briefTries = useRef(new Map<string, number>());
  useEffect(() => {
    if (!active || !link.ok || link.armed || logs.length === 0 || erasing || queue.current) return;
    const ac = new AbortController();
    void (async () => {
      for (const log of logs) {
        if (ac.signal.aborted) return;
        const known = briefs[log.id];
        if (known && known.size === log.size && (!known.error || (briefTries.current.get(`${log.id}:${log.size}`) ?? 0) >= 2)) continue;
        if (local.some((file) => file.vehicle === key && file.onboard_id === log.id && file.bytes === log.size)) continue;
        setReading(log.id);
        briefTries.current.set(`${log.id}:${log.size}`, (briefTries.current.get(`${log.id}:${log.size}`) ?? 0) + 1);
        try {
          const body = await getJson<LogBrief>(`/logs/brief?id=${log.id}`, { signal: ac.signal });
          if (!ac.signal.aborted) setBriefs((all) => ({ ...all, [log.id]: body }));
        } catch (reason) {
          if (ac.signal.aborted) return;
          const message = reason instanceof Error ? reason.message : "Could not read the log header";
          setBriefs((all) => ({ ...all, [log.id]: { id: log.id, size: log.size, firmware: "", frame: "", start_utc: "", duration_us: 0, error: message } }));
        }
      }
      if (!ac.signal.aborted) setReading(0);
    })();
    return () => ac.abort();
  }, [active, link.ok, link.armed, logs, local, key, erasing, queue.current]);

  // Each stored log is scanned once (armed time, flags, parameters); the bridge caches it.
  const scanned = useRef(new Set<string>());
  useEffect(() => {
    if (!active) return;
    const todo = local.filter((file) => !file.scan && !scanned.current.has(file.id) && (scope === "all" || file.vehicle === board));
    if (!todo.length) return;
    let stop = false;
    void (async () => {
      for (const file of todo) {
        if (stop) return;
        scanned.current.add(file.id);
        try {
          const body = await getJson<{ scan: Scan }>(`/logs/scan?id=${encodeURIComponent(file.id)}`);
          if (!stop) setLocal((all) => all.map((item) => (item.id === file.id ? { ...item, scan: body.scan } : item)));
        } catch {
          /* unreadable: the row says so */
        }
      }
      // Changes need the scans of neighbouring logs, so read the list again once.
      if (!stop) loadLocal();
    })();
    return () => {
      stop = true;
    };
  }, [active, local, scope, board, loadLocal]);

  // ---------- downloads (queue) ----------

  const lastDone = useRef(queue.done);
  useEffect(() => {
    if (queue.done === lastDone.current) return;
    lastDone.current = queue.done;
    const saved = queue.saved;
    void getJson<{ logs?: LocalLog[] }>("/logs/local").then((body) => {
      const rows = Array.isArray(body.logs) ? body.logs : [];
      setLocal(rows);
      pokeCloud();
      if (!saved) return;
      const size = logs.find((l) => l.id === saved.id)?.size;
      const copy = rows.find((file) => file.vehicle === key && file.onboard_id === saved.id && (size == null || file.bytes === size));
      const pend = size != null ? pendingMeta.current.get(`${saved.id}:${size}`) : undefined;
      if (copy?.hash && pend) {
        pendingMeta.current.delete(`${saved.id}:${size}`);
        void saveMeta(copy, pend);
      }
      setStatus({ tone: "ok", text: t("Log {id} saved", { id: saved.id }), action: copy ? { label: t("Show"), run: () => void reveal(copy.id) } : undefined });
    }).catch(() => {});
    // saveMeta and reveal are stable enough for this one-shot reaction.
  }, [queue.done]);

  useEffect(() => {
    if (queue.error) setStatus({ tone: "bad", text: `${t("Log {id}", { id: queue.error.id })}: ${t(queue.error.text)}` });
  }, [queue.error, setStatus, t]);

  useEffect(() => {
    const started = (ev: Event) => setStatus({ tone: "", text: t("Found {n} new logs on the board", { n: Number((ev as CustomEvent<number>).detail) || 1 }) });
    window.addEventListener(AUTO_STARTED, started);
    return () => window.removeEventListener(AUTO_STARTED, started);
  }, [setStatus, t]);

  // ---------- erase ----------

  useEffect(() => {
    if (!erasing) return;
    if (!newerTexts(texts, textsAtErase.current).some((line) => line.includes("Chip erase complete"))) return;
    setErasing(false);
    setStatus({ tone: "ok", text: t("Board erased · parameters untouched") });
    loadBoard();
  }, [erasing, texts, loadBoard, setStatus, t]);

  useEffect(() => {
    if (!erasing) return;
    const timer = window.setTimeout(() => {
      setErasing(false);
      setStatus({ tone: "bad", text: t("The vehicle did not report that the erase finished.") });
      loadBoard();
    }, 90_000);
    return () => window.clearTimeout(timer);
  }, [erasing, loadBoard, setStatus, t]);

  async function erase() {
    setDialog(null);
    textsAtErase.current = getLatest().texts ?? [];
    setErasing(true);
    setStatus({ tone: "amber", text: t("Erasing the board…"), sticky: true });
    try {
      await postJson("/logs/erase", { confirm: true });
    } catch (reason) {
      setErasing(false);
      const message = reason instanceof Error ? reason.message : "";
      setStatus({
        tone: "bad",
        text: message === "A fresh disarmed vehicle heartbeat is required before erasing DataFlash logs" ? t(message) : t("Could not erase on-board logs"),
      });
    }
  }

  // ---------- star, note, reveal, delete, share ----------

  async function saveMeta(file: { hash: string | null; vehicle?: string; onboard_id?: number | null; bytes: number }, change: { star?: boolean; note?: string }) {
    if (!file.hash) return;
    try {
      const saved = await postJson<{ star: boolean; note: string }>("/logs/note", {
        hash: file.hash,
        board: file.vehicle ?? "",
        onboard_id: file.onboard_id ?? null,
        bytes: file.bytes,
        ...change,
      });
      setLocal((all) => all.map((item) => (item.hash === file.hash ? { ...item, star: saved.star, note: saved.note } : item)));
      if (change.star) pokeCloud();
      setCloud((c) => ({ ...c, logs: c.logs.map((item) => (item.hash === file.hash ? { ...item, meta: { ...item.meta, star: saved.star, note: saved.note } } : item)) }));
    } catch (reason) {
      setStatus({ tone: "bad", text: reason instanceof Error ? t(reason.message) : t("Could not save the note") });
    }
  }

  function setMeta(row: Row, change: { star?: boolean; note?: string }) {
    if (row.hash) {
      void saveMeta({ hash: row.hash, vehicle: row.board, onboard_id: row.num, bytes: row.size }, change);
      return;
    }
    // A board-only log: the star and note belong to a file, so download it first.
    if (row.log) {
      const k = `${row.log.id}:${row.log.size}`;
      pendingMeta.current.set(k, { ...pendingMeta.current.get(k), ...change });
      enqueueDownloads([{ id: row.log.id, size: row.log.size }]);
      setStatus({ tone: "", text: t("Downloading log {id} to keep the star and note", { id: row.log.id }) });
    }
  }

  async function reveal(id: string) {
    try {
      const response = await fetch(`${APP_HTTP}/logs/reveal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error();
    } catch {
      setStatus({ tone: "bad", text: t("Could not show that log in a folder") });
    }
  }

  async function deleteRows(rows: Row[], here: boolean, there: boolean) {
    setDialog(null);
    let removed = 0;
    let uncloud = 0;
    if (here) {
      const ids = rows.flatMap((row) => (row.file ? [row.file.id] : []));
      if (ids.length) {
        try {
          const out = await postJson<{ removed: string[]; failed: { error: string }[] }>("/logs/delete", { ids });
          removed = out.removed.length;
          if (out.failed.length) setStatus({ tone: "bad", text: t(out.failed[0].error) });
        } catch (reason) {
          setStatus({ tone: "bad", text: reason instanceof Error ? t(reason.message) : t("Could not delete") });
        }
      }
    }
    if (there) {
      for (const row of rows) {
        if (!row.cloud?.stored) continue;
        try {
          await postJson("/logs/cloud/remove", { hash: row.cloud.hash });
          uncloud++;
        } catch (reason) {
          setStatus({ tone: "bad", text: reason instanceof Error ? t(reason.message) : t("Could not remove from the cloud") });
        }
      }
    }
    setSel(new Set());
    loadLocal();
    loadCloud();
    if (there && sync.paused === "full") resumeUploads();
    if (removed || uncloud) {
      const parts = [removed ? t("{n} moved to the Recycle Bin", { n: removed }) : "", uncloud ? t("{n} removed from the cloud", { n: uncloud }) : ""].filter(Boolean);
      setStatus({ tone: "ok", text: parts.join(" · ") });
    }
  }

  async function share(rows: Row[], opts: Record<string, boolean>) {
    setDialog(null);
    const ids = rows.flatMap((row) => (row.file ? [row.file.id] : []));
    setStatus({ tone: "", text: t("Writing the shared copy…"), sticky: true });
    try {
      const out = await postJson<{ path: string }>("/logs/share", { ids, ...opts });
      setStatus({
        tone: "ok",
        text: t("Shared copy saved"),
        action: { label: t("Show"), run: () => void postJson("/logs/reveal-shared", { path: out.path }).catch(() => {}) },
      });
    } catch (reason) {
      setStatus({ tone: "bad", text: reason instanceof Error ? t(reason.message) : t("Could not write the shared copy") });
    }
  }

  // ---------- cloud ----------

  async function cloudMode(mode: CloudState["mode"]) {
    try {
      await postJson("/logs/cloud/settings", { mode });
      setCloud((c) => ({ ...c, mode }));
      resumeUploads();
    } catch (reason) {
      setStatus({ tone: "bad", text: reason instanceof Error ? t(reason.message) : t("Could not save") });
    }
  }

  function upload(file: LocalLog) {
    if (file.hash) void uploadLog(file.id, file.hash);
  }

  // Uploads run app-wide (useCloudSync); here they reload the cloud list and speak in the status slot.
  const lastUpload = useRef(sync.done);
  useEffect(() => {
    if (sync.done === lastUpload.current) return;
    lastUpload.current = sync.done;
    loadCloud();
    setStatus({ tone: "ok", text: t("Uploaded to the cloud") });
  }, [sync.done, loadCloud, setStatus, t]);
  useEffect(() => {
    if (sync.paused === "full") {
      setStatus({ tone: "amber", text: t("Cloud full. Uploads paused"), action: { label: t("Clean up"), run: () => setDialog({ kind: "clean" }) }, sticky: true });
    } else if (sync.paused === "error" && sync.error) {
      setStatus({ tone: "bad", text: t(sync.error), action: { label: t("Try again"), run: () => resumeUploads() } });
    }
  }, [sync.paused, sync.error, setStatus, t]);

  async function fetchCloud(row: Row) {
    if (!row.cloud) return;
    setFetching(row.cloud.hash);
    setStatus({ tone: "", text: t("Downloading log {id} from the cloud", { id: row.num ?? row.name }), sticky: true });
    try {
      await postJson("/logs/cloud/download", { hash: row.cloud.hash });
      setStatus({ tone: "ok", text: t("Downloaded from the cloud") });
      loadLocal();
    } catch (reason) {
      setStatus({ tone: "bad", text: reason instanceof Error ? t(reason.message) : t("Download failed") });
    } finally {
      setFetching("");
    }
  }

  function ask(row: Row) {
    const id = row.file ? row.file.id : row.cloud?.stored ? `cloud:${row.cloud.hash}` : "";
    if (!id) return;
    openAssistant([t("What happened in this flight?"), t("Is anything in this log worth fixing?")], id);
  }

  // ---------- rows ----------

  const rows = useMemo<Row[]>(() => {
    const cloudBy = new Map(cloud.logs.map((c) => [c.hash, c]));
    const usedFiles = new Set<string>();
    const usedCloud = new Set<string>();
    const fromFile = (file: LocalLog): Partial<Row> => ({
      file,
      hash: file.hash,
      star: file.star,
      note: file.note,
      scan: file.scan,
      changes: file.changes,
      size: file.bytes,
      board: file.vehicle,
      name: file.original_name || fileName(file.id),
      at: dateOf(file.scan?.start_utc) ?? dateOf(file.flight_utc) ?? stampDate(file.flight_stamp) ?? dateOf(file.saved_at),
    });
    const boardRows: Row[] = [...logs].sort((a, b) => b.id - a.id).map((log) => {
      const file = local.find((f) => f.vehicle === key && f.onboard_id === log.id && f.bytes === log.size);
      if (file) usedFiles.add(file.id);
      const cloudCopy = file?.hash ? cloudBy.get(file.hash) : cloud.logs.find((c) => c.board === key && c.onboard_id === log.id && c.bytes === log.size);
      if (cloudCopy) usedCloud.add(cloudCopy.hash);
      const brief = briefs[log.id]?.size === log.size ? briefs[log.id] : undefined;
      const base: Row = {
        key: `b${log.id}`,
        log,
        num: log.id,
        hash: cloudCopy?.hash ?? null,
        at: dateOf(brief?.start_utc) ?? dateOf(log.time_utc),
        star: cloudCopy?.meta.star ?? false,
        note: cloudCopy?.meta.note ?? "",
        scan: null,
        brief,
        size: log.size,
        board: key,
        name: "",
        cloud: cloudCopy,
      };
      return file ? { ...base, ...fromFile(file), key: `b${log.id}`, at: base.at ?? fromFile(file).at ?? null } as Row : base;
    });
    const fileRows: Row[] = local
      .filter((file) => !usedFiles.has(file.id) && (scope === "all" || file.vehicle === board))
      .map((file) => {
        const cloudCopy = file.hash ? cloudBy.get(file.hash) : undefined;
        if (cloudCopy) usedCloud.add(cloudCopy.hash);
        return { key: `f${file.id}`, num: file.onboard_id ?? null, cloud: cloudCopy, ...fromFile(file) } as Row;
      });
    const cloudRows: Row[] = cloud.logs
      .filter((c) => c.stored && !usedCloud.has(c.hash) && !local.some((f) => f.hash === c.hash) && (scope === "all" || c.board === board))
      .map((c) => ({
        key: `c${c.hash}`,
        cloud: c,
        num: c.onboard_id,
        hash: c.hash,
        at: stampDate(c.name.split("_")[1]) ?? dateOf(c.uploaded_at),
        star: c.meta.star,
        note: c.meta.note,
        scan: null,
        size: c.bytes,
        board: c.board,
        name: c.name,
      }));
    const rest = [...fileRows, ...cloudRows].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    return [...boardRows, ...rest];
  }, [logs, local, cloud.logs, briefs, key, board, scope]);

  const queuedIds = new Set(queue.waiting.map((w) => w.id));
  const missing = rows.filter((row) => row.log && !row.file);
  const groups: Record<Filter, Row[]> = {
    all: rows,
    star: rows.filter((row) => row.star),
    board: rows.filter((row) => row.log),
    pc: rows.filter((row) => row.file),
    cloud: rows.filter((row) => row.cloud?.stored),
    missing,
  };
  const needle = search.trim().toLowerCase();
  const visible = (() => {
    let list = groups[filter];
    if (needle) {
      list = list.filter((row) => [String(row.num ?? ""), row.note, row.scan?.frame, row.scan?.firmware, row.brief?.frame, row.brief?.firmware, row.name]
        .some((text) => (text ?? "").toLowerCase().includes(needle)));
    }
    if (sort.key !== "log" || !sort.down) {
      const value = (row: Row): number => sort.key === "date" ? row.at?.getTime() ?? 0
        : sort.key === "armed" ? row.scan?.armed_s ?? -1
        : sort.key === "size" ? row.size
        : row.log ? 1e9 + row.log.id : row.num ?? 0;
      list = [...list].sort((a, b) => (sort.down ? value(b) - value(a) : value(a) - value(b)));
    }
    return list;
  })();

  const selected = visible.filter((row) => sel.has(row.key));
  // The queue speaks for itself while it runs, unless something newer is in the slot.
  const shown: Status = status ?? (uploading
    ? { tone: "", text: t("Uploading log {id} to the cloud · {pct}%", { id: local.find((f) => f.hash === uploading.hash)?.onboard_id ?? fileName(uploading.id), pct: uploading.pct }) }
    : queue.current
    ? { tone: "", text: queue.waiting.length ? t("Downloading log {id} · {n} waiting", { id: queue.current.id, n: queue.waiting.length }) : t("Downloading log {id}", { id: queue.current.id }) }
    : null);
  const canErase = link.ok && !link.armed && logs.length > 0 && !erasing;
  const busyRow = queue.current?.id ?? 0;

  function toggleSort(k: SortKey) {
    setSort((s) => (s.key === k ? { key: k, down: !s.down } : { key: k, down: true }));
  }

  function openMenu(ev: ReactMouseEvent, next: { kind: "row"; key: string } | { kind: "bar" }) {
    const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const view = viewRef.current?.getBoundingClientRect();
    setMenu({ ...next, x: box.right - (view?.left ?? 0), y: box.bottom - (view?.top ?? 0) } as Menu);
  }

  function showPop(ev: ReactMouseEvent, kind: "flags" | "changes", row: Row) {
    const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const view = viewRef.current?.getBoundingClientRect();
    setPop({ kind, key: row.key, x: box.left - (view?.left ?? 0), y: box.bottom - (view?.top ?? 0) + 4 });
  }

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  const gap = !link.ok
    ? (board ? t("No board on the link. Copies of {board}, the last board seen.", { board: shortUid(board) }) : t("No board on the link."))
    : link.armed ? t("Armed. Downloads and erase wait until the vehicle is disarmed.") : "";

  const emptyText = needle ? t("No log matches this search.")
    : filter === "missing" && logs.length > 0 ? t("Every board log is on this computer.")
    : filter === "star" ? t("No starred logs yet.")
    : filter === "cloud" ? (cloud.signed_in ? t("No logs in the cloud yet.") : t("Sign in to keep logs in the cloud."))
    : filter === "board" || filter === "missing" ? t("No on-board logs yet.")
    : t("No logs yet.");

  const menuRow = menu?.kind === "row" ? rows.find((row) => row.key === menu.key) : undefined;
  const popRow = pop ? rows.find((row) => row.key === pop.key) : undefined;

  function rowAction(row: Row): ReactNode {
    if (row.log && !row.file && busyRow === row.log.id) {
      return <DownloadingAction id={row.log.id} onCancel={() => void cancelDownload(row.log!.id)} />;
    }
    if (row.log && !row.file && queuedIds.has(row.log.id)) {
      return <button type="button" className="log-act ghost dim" onClick={() => void cancelDownload(row.log!.id)}>{t("Queued")}<b aria-hidden="true">×</b></button>;
    }
    if (row.file) return <button type="button" className="log-act ghost" title={t("Show in folder")} onClick={() => void reveal(row.file!.id)}>{t("Show")}</button>;
    if (row.log) {
      return (
        <button type="button" className="log-act get" disabled={erasing || link.armed || !link.ok} onClick={() => enqueueDownloads([{ id: row.log!.id, size: row.log!.size }])}>
          {t("Download")}
        </button>
      );
    }
    if (row.cloud?.stored) {
      return (
        <button type="button" className="log-act get" disabled={!!fetching} onClick={() => void fetchCloud(row)}>
          {fetching === row.cloud.hash ? "…" : t("Download")}
        </button>
      );
    }
    return null;
  }

  function details(row: Row): ReactNode {
    if (editing?.key === row.key) {
      return (
        <input
          className="log-edit"
          autoFocus
          value={editing.draft}
          maxLength={2000}
          aria-label={t("Note")}
          placeholder={t("Add a note")}
          onChange={(ev) => setEditing({ key: row.key, draft: ev.target.value })}
          onBlur={() => setEditing(null)}
          onKeyDown={(ev) => {
            if (ev.key === "Escape") setEditing(null);
            if (ev.key === "Enter") {
              setMeta(row, { note: editing.draft.trim() });
              setEditing(null);
            }
          }}
        />
      );
    }
    const brief = row.brief;
    const what = row.scan ? [row.scan.frame, row.scan.firmware].filter(Boolean).join(" · ") : brief && !brief.error ? [brief.frame, brief.firmware].filter(Boolean).join(" · ") : "";
    const open = () => setEditing({ key: row.key, draft: row.note });
    if (row.note) return <button type="button" className="log-note" title={row.note} onClick={open}>{row.note}</button>;
    if (brief?.error && !row.scan) return <i className="log-bad" title={t(brief.error)}>{t("Header unreadable")}</i>;
    if (what) return <button type="button" className="log-fw" title={t("Add a note")} onClick={open}>{what}</button>;
    if (row.log && !brief && reading === row.log.id) return <i className="log-nil">{t("Reading the log header…")}</i>;
    if (!row.log && !row.scan && row.name) return <button type="button" className="log-fw mono" title={t("Add a note")} onClick={open}>{row.name}</button>;
    return <i className="log-nil">—</i>;
  }

  return (
    <div className="log-view" ref={viewRef}>
      {selected.length ? (
        <div className="log-bar log-selbar">
          <b>{t("{n} selected", { n: selected.length })}</b>
          <span className="log-dim">{sizeLabel(selected.reduce((sum, row) => sum + row.size, 0))}</span>
          <span className="log-grow" />
          <button type="button" className="log-act ghost" onClick={() => selected.forEach((row) => setMeta(row, { star: !selected.every((r) => r.star) }))}>★ {selected.every((r) => r.star) ? t("Unstar") : t("Star")}</button>
          <button type="button" className="log-act ghost" disabled={!selected.some((r) => r.file)} onClick={() => setDialog({ kind: "share", rows: selected.filter((r) => r.file) })}>{t("Share…")}</button>
          <button type="button" className="log-act ai" disabled={!selected.some((r) => r.file || r.cloud?.stored)} onClick={() => ask(selected.find((r) => r.file || r.cloud?.stored)!)}>✦ {t("Ask")}</button>
          <button type="button" className="log-act danger" disabled={!selected.some((r) => r.file || r.cloud?.stored)} onClick={() => setDialog({ kind: "delete", rows: selected })}>{t("Delete…")}</button>
          <button type="button" className="log-act ghost" onClick={() => setSel(new Set())}>{t("Clear")}</button>
        </div>
      ) : (
        <div className="log-bar">
          <div className="log-seg" role="tablist" aria-label={t("Log filters")}>
            {FILTERS.map(({ id, label }) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className={`${filter === id ? "on" : ""} f-${id}`} onClick={() => setFilter(id)}>
                {t(label)}<small>{groups[id].length}</small>
              </button>
            ))}
            <select className="log-more" aria-label={t("More")} value={filter} onChange={(ev) => setFilter(ev.target.value as Filter)}>
              {FILTERS.map(({ id, label }) => <option key={id} value={id}>{t(label)} · {groups[id].length}</option>)}
            </select>
          </div>
          <label className="log-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" value={search} placeholder={t("Search number, note, firmware")} aria-label={t("Search logs")} onChange={(ev) => setSearch(ev.target.value)} />
          </label>
          <select className="log-scope" aria-label={t("Controllers")} value={scope} onChange={(ev) => setScope(ev.target.value as "this" | "all")}>
            <option value="this">{t("This controller")}</option>
            <option value="all">{t("All controllers")}</option>
          </select>
          <span className={`log-status ${shown?.tone ?? ""}`} role="status">
            <span>
              {shown?.tone === "amber" && erasing ? <i className="log-spin" aria-hidden="true"><b /></i> : null}
              {shown?.text}
              {shown?.action ? <button type="button" className="log-link" onClick={shown.action.run}>{shown.action.label}</button> : null}
            </span>
          </span>
          <button
            type="button"
            className="log-act get wide"
            disabled={!missing.length || !link.ok || link.armed || erasing}
            onClick={() => enqueueDownloads([...missing].reverse().map((row) => ({ id: row.log!.id, size: row.log!.size })))}
          >
            {missing.length ? t("Download all · {n}", { n: missing.length }) : t("Download all")}
          </button>
          <button type="button" className="log-mini" aria-label={t("More actions")} onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => (menu?.kind === "bar" ? setMenu(null) : openMenu(ev, { kind: "bar" }))}>⋯</button>
        </div>
      )}

      <div className="log-table" role="table" aria-label={t("Logs")}>
        <div className="log-head" role="row">
          <span className="c-sel" role="columnheader">
            <input type="checkbox" aria-label={t("Select all")} checked={visible.length > 0 && visible.every((row) => sel.has(row.key))} onChange={(ev) => setSel(ev.target.checked ? new Set(visible.map((row) => row.key)) : new Set())} />
          </span>
          <span role="columnheader" aria-label={t("Starred")}>★</span>
          <button type="button" role="columnheader" className={sort.key === "log" ? "sorted" : ""} onClick={() => toggleSort("log")}>{t("Log")}{sort.key === "log" ? (sort.down ? " ▾" : " ▴") : ""}</button>
          <button type="button" role="columnheader" className={sort.key === "date" ? "sorted" : ""} onClick={() => toggleSort("date")}>{t("Date")}{sort.key === "date" ? (sort.down ? " ▾" : " ▴") : ""}</button>
          <button type="button" role="columnheader" className={`c-armed${sort.key === "armed" ? " sorted" : ""}`} onClick={() => toggleSort("armed")}>{t("Armed")}{sort.key === "armed" ? (sort.down ? " ▾" : " ▴") : ""}</button>
          <span role="columnheader" className="c-flags"><span className="wide-only">{t("Flags")}</span><span className="narrow-only" aria-label={t("Flags")}>⚑</span></span>
          <span role="columnheader" className="c-chg">{t("Changes")}</span>
          <span role="columnheader" className="c-det">{t("Note / frame, firmware")}</span>
          <button type="button" role="columnheader" className={`c-size r${sort.key === "size" ? " sorted" : ""}`} onClick={() => toggleSort("size")}>{t("Size")}{sort.key === "size" ? (sort.down ? " ▾" : " ▴") : ""}</button>
          <span role="columnheader">{t("Where")}</span>
          <span role="columnheader" aria-hidden="true" />
        </div>
        <div className="log-body">
          {gap ? <div className="log-gap">{ICON.board}<span>{gap}</span></div> : null}
          {visible.length === 0 ? <p className="log-empty">{loading && !logs.length ? t("Refreshing…") : emptyText}</p> : visible.map((row) => {
            const other = !!row.board && row.board !== board && scope === "all";
            const boardRow = !!row.log;
            const fading = erasing && boardRow;
            const armed = armedText(row, t, false);
            const armedShort = armedText(row, t, true);
            const newest = row.log && (row.log.num_logs ?? 0) > 1 && row.log.id === row.log.last_log_num;
            const up = uploading && uploading.hash === row.hash;
            return (
              <div className={`log-row${sel.has(row.key) ? " sel" : ""}${fading ? " fading" : ""}`} role="row" key={row.key}>
                <span className="c-sel" role="cell">
                  <input type="checkbox" aria-label={t("Select log {id}", { id: row.num ?? row.name })} checked={sel.has(row.key)} onChange={(ev) => setSel((s) => { const next = new Set(s); if (ev.target.checked) next.add(row.key); else next.delete(row.key); return next; })} />
                </span>
                <span role="cell">
                  <button type="button" className={`log-star${row.star ? " on" : ""}`} aria-pressed={row.star} aria-label={row.star ? t("Unstar") : t("Star")} onClick={() => setMeta(row, { star: !row.star })}>{row.star ? "★" : "☆"}</button>
                </span>
                <span className="c-id" role="cell">{row.num ?? "—"}{newest ? <em>{t("newest")}</em> : null}</span>
                <span role="cell">{row.at ? WHEN.format(row.at) : <i className="log-nil">—</i>}</span>
                <span className={`c-armed${armed === t("never armed") ? " log-nil" : ""}`} role="cell" title={armed || undefined}>
                  <span className="wide-only">{armed || <i className="log-nil">—</i>}</span><span className="narrow-only">{armedShort || <i className="log-nil">—</i>}</span>
                </span>
                <span className="c-flags" role="cell" onMouseEnter={(ev) => row.scan?.flags.length && showPop(ev, "flags", row)} onMouseLeave={() => setPop(null)}>
                  <span className="wide-only"><Flags flags={row.scan?.flags ?? []} compact={false} /></span>
                  <span className="narrow-only"><Flags flags={row.scan?.flags ?? []} compact /></span>
                </span>
                <span className="c-chg" role="cell" onMouseEnter={(ev) => row.changes && (row.changes.count || row.changes.firmware) && showPop(ev, "changes", row)} onMouseLeave={() => setPop(null)}>
                  {row.changes?.firmware ? <span className="log-chg">FW {row.changes.firmware.from} → {row.changes.firmware.to}</span>
                    : row.changes?.count ? <span className="log-chg">{t(row.changes.count === 1 ? "{n} param" : "{n} params", { n: row.changes.count })}</span>
                    : <i className="log-nil">—</i>}
                </span>
                <span className="c-det" role="cell">{details(row)}</span>
                <span className="c-size r" role="cell">{sizeLabel(row.size)}</span>
                <span role="cell"><Where row={row} up={!!up} other={other} /></span>
                <span className="c-act" role="cell">
                  {rowAction(row)}
                  <button type="button" className="log-kebab" aria-label={t("More actions")} onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => (menu?.kind === "row" && menu.key === row.key ? setMenu(null) : openMenu(ev, { kind: "row", key: row.key }))}>⋯</button>
                </span>
                {row.log && !row.file && busyRow === row.log.id ? <DownloadingLine id={row.log.id} /> : null}
                {up ? <i className="log-progress up" style={{ width: `${uploading.pct}%` }} /> : null}
              </div>
            );
          })}
        </div>
      </div>

      {menu?.kind === "bar" ? (
        <div className="log-menu" style={{ right: `calc(100% - ${menu.x}px)`, top: menu.y + 4 }} onPointerDown={(ev) => ev.stopPropagation()}>
          <button type="button" disabled={loading || erasing} onClick={() => { setMenu(null); refresh(); }}>{loading ? t("Refreshing…") : t("Refresh")}</button>
          <button type="button" disabled={!key} onClick={() => { const on = !autoOn; setAutoDownload(key, on, Math.max(-1, ...logs.map((l) => l.id))); setAutoOn(on); setMenu(null); }}>
            <span>{autoOn ? "✓ " : ""}{t("Download new logs on connect")}</span><small>{t("this controller")}</small>
          </button>
          <button type="button" onClick={() => { setMenu(null); setDialog({ kind: "cloud" }); }}>
            <span>{t("Cloud…")}</span>
            <small>{cloud.signed_in ? `${t(cloud.mode === "off" ? "Off" : cloud.mode === "starred" ? "Starred only" : "Every downloaded log")} · ${mbLabel(cloud.used ?? 0)} / ${mbLabel(cloud.limit ?? 0)}` : t("Not signed in")}</small>
          </button>
          <button type="button" onClick={() => { setMenu(null); setDialog({ kind: "clean" }); }}><span>{t("Clean up…")}</span><small>{t("this computer, cloud")}</small></button>
          <i className="log-menu-sep" />
          <button type="button" className="danger" disabled={!canErase} title={link.armed ? t("A fresh disarmed vehicle heartbeat is required before erasing DataFlash logs") : undefined} onClick={() => { setMenu(null); setDialog({ kind: "erase" }); }}>{t("Erase board…")}</button>
        </div>
      ) : null}

      {menu?.kind === "row" && menuRow ? (
        <div className="log-menu" style={{ right: `calc(100% - ${menu.x}px)`, top: menu.y + 4 }} onPointerDown={(ev) => ev.stopPropagation()}>
          <button type="button" className="ai" disabled={!menuRow.file && !menuRow.cloud?.stored} onClick={() => { setMenu(null); ask(menuRow); }}>✦ {t("Ask the assistant about this log")}</button>
          <button type="button" disabled={!menuRow.file} onClick={() => { setMenu(null); setDialog({ kind: "share", rows: [menuRow] }); }}><span>{t("Share…")}</span><small>{t("anonymised copy")}</small></button>
          <button type="button" onClick={() => { setMenu(null); setEditing({ key: menuRow.key, draft: menuRow.note }); }}>{t("Edit note")}</button>
          <button type="button" onClick={() => { setMenu(null); setMeta(menuRow, { star: !menuRow.star }); }}>★ {menuRow.star ? t("Unstar") : t("Star")}</button>
          <button type="button" disabled={!menuRow.file} onClick={() => { setMenu(null); if (menuRow.file) void reveal(menuRow.file.id); }}>{t("Show in folder")}</button>
          <i className="log-menu-sep" />
          <button type="button" disabled={!menuRow.file || !cloud.signed_in || !!menuRow.cloud?.stored || !!uploading} onClick={() => { setMenu(null); if (menuRow.file) void upload(menuRow.file); }}>
            <span>{t("Upload to the cloud")}</span><small>{cloud.signed_in ? sizeLabel(menuRow.size) : t("Not signed in")}</small>
          </button>
          <button type="button" className="danger" disabled={!menuRow.cloud?.stored} onClick={() => { setMenu(null); setDialog({ kind: "uncloud", row: menuRow }); }}>
            <span>{t("Remove from the cloud…")}</span><small>{t("keeps this computer's copy")}</small>
          </button>
          <button type="button" className="danger" disabled={!menuRow.file} onClick={() => { setMenu(null); setDialog({ kind: "delete", rows: [menuRow] }); }}>
            <span>{t("Delete from this computer…")}</span><small>{menuRow.cloud?.stored ? t("keeps the cloud copy") : t("Recycle Bin")}</small>
          </button>
        </div>
      ) : null}

      {pop && popRow ? (
        <div className="log-pop" style={{ left: pop.x, top: pop.y }}>
          {pop.kind === "flags" ? (
            <>
              <b>{t("Log {id} · flags", { id: popRow.num ?? popRow.name })}</b>
              {(popRow.scan?.flags ?? []).map((f) => (
                <div className="log-pop-line" key={f.kind}>
                  <span className={`log-flag ${HOT.has(f.kind) ? "hot" : "amber"}`}>{t(FLAG_LABEL[f.kind])}{f.count > 1 ? ` ${f.count}` : ""}</span>
                  <span>{f.at_s ? `${spanText(f.at_s, t)} · ` : ""}{f.text}</span>
                </div>
              ))}
            </>
          ) : (
            <>
              <b>{popRow.changes?.count
                ? t("Log {id} · {n} parameters changed since log {since}", { id: popRow.num ?? "", n: popRow.changes.count, since: popRow.changes.since_onboard ?? "—" })
                : t("Log {id} · firmware changed", { id: popRow.num ?? "" })}</b>
              {popRow.changes?.firmware ? <div className="log-pc"><span className="mono">{t("Firmware")}</span><span className="log-dim">{popRow.changes.firmware.from}</span><span className="cyan">→ {popRow.changes.firmware.to}</span></div> : null}
              {(popRow.changes?.params ?? []).slice(0, 14).map((p) => (
                <div className="log-pc" key={p.name}><span className="mono">{p.name}</span><span className="log-dim">{+p.from.toPrecision(6)}</span><span className="cyan">→ {+p.to.toPrecision(6)}</span></div>
              ))}
              {(popRow.changes?.params.length ?? 0) > 14 ? <span className="log-dim">{t("+ {n} more", { n: (popRow.changes?.params.length ?? 0) - 14 })}</span> : null}
            </>
          )}
        </div>
      ) : null}

      {dialog ? (
        <div className="log-scrim" onPointerDown={(ev) => { if (ev.target === ev.currentTarget) setDialog(null); }}>
          {dialog.kind === "erase" ? (
            <LogDialog title={t("Erase the board?")} onClose={() => setDialog(null)} foot={<>
              <span className="log-grow" />
              <button type="button" className="log-act ghost" onClick={() => setDialog(null)}>{t("Cancel")}</button>
              <button type="button" className="log-act danger" onClick={() => void erase()}>{t("Erase board")}</button>
            </>}>
              <p>{t("Deletes all {n} logs on the board. Your copies on this computer stay. Parameters are not touched.", { n: logs.length })}</p>
              {missing.length ? <p className="amber">{t(missing.length === 1 ? "Board log {list} is not saved yet." : "{n} board logs are not saved yet: {list}.", { n: missing.length, list: missing.map((r) => r.num).join(", ") })}</p> : null}
            </LogDialog>
          ) : null}
          {dialog.kind === "share" ? <ShareDialog rows={dialog.rows} onClose={() => setDialog(null)} onShare={(opts) => void share(dialog.rows, opts)} /> : null}
          {dialog.kind === "delete" ? <DeleteDialog rows={dialog.rows} onClose={() => setDialog(null)} onDelete={(here, there) => void deleteRows(dialog.rows, here, there)} /> : null}
          {dialog.kind === "uncloud" ? (
            <LogDialog title={t("Remove log {id} from the cloud?", { id: dialog.row.num ?? dialog.row.name })} onClose={() => setDialog(null)} foot={<>
              <span className="log-grow" />
              <button type="button" className="log-act ghost" onClick={() => setDialog(null)}>{t("Cancel")}</button>
              <button type="button" className="log-act danger" onClick={() => void deleteRows([dialog.row], false, true)}>{t("Remove from the cloud")}</button>
            </>}>
              <p>{t("It is deleted for every device. The copy on this computer stays, and so do its star and note.")}</p>
            </LogDialog>
          ) : null}
          {dialog.kind === "cloud" ? <CloudDialog cloud={cloud} onClose={() => setDialog(null)} onMode={(m) => void cloudMode(m)} /> : null}
          {dialog.kind === "clean" ? (
            <CleanDialog rows={rows.filter((r) => r.file || r.cloud?.stored)} allLocal={local} board={board} signedIn={cloud.signed_in} onClose={() => setDialog(null)} onClean={(list, here, there) => void deleteRows(list, here, there)} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LogDialog({ title, children, foot, onClose, wide = false }: { title: string; children: ReactNode; foot: ReactNode; onClose: () => void; wide?: boolean }) {
  const t = useT();
  useEffect(() => {
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className={`log-dlg${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="log-dlg-head"><b>{title}</b><button type="button" className="log-x" aria-label={t("Close")} onClick={onClose}>×</button></div>
      <div className="log-dlg-body">{children}</div>
      <div className="log-dlg-foot">{foot}</div>
    </div>
  );
}

function Opt({ on, onChange, title, sub, disabled = false }: { on: boolean; onChange: (on: boolean) => void; title: string; sub?: string; disabled?: boolean }) {
  return (
    <label className={`log-opt${disabled ? " off" : ""}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(ev) => onChange(ev.target.checked)} />
      <span><b>{title}</b>{sub ? <small>{sub}</small> : null}</span>
    </label>
  );
}

function ShareDialog({ rows, onClose, onShare }: { rows: Row[]; onClose: () => void; onShare: (opts: Record<string, boolean>) => void }) {
  const t = useT();
  const [opts, setOpts] = useState({ location: true, date: true, board: true, messages: false, note: false });
  const set = (k: keyof typeof opts) => (on: boolean) => setOpts((o) => ({ ...o, [k]: on }));
  const anyNote = rows.some((r) => r.note);
  return (
    <LogDialog title={rows.length === 1 ? t("Share log {id}", { id: rows[0].num ?? rows[0].name }) : t("Share {n} logs", { n: rows.length })} onClose={onClose} foot={<>
      <span className="log-dim log-grow">{t("The originals are not changed. The copy goes to Downloads as one .zip.")}</span>
      <button type="button" className="log-act ghost" onClick={onClose}>{t("Cancel")}</button>
      <button type="button" className="log-act get" onClick={() => onShare(opts)}>{t("Save copy")}</button>
    </>}>
      <div className="log-files">{rows.map((r) => <span key={r.key}>{t("Log {id}", { id: r.num ?? r.name })}{r.at ? ` · ${WHEN.format(r.at)}` : ""} · {sizeLabel(r.size)}</span>)}</div>
      <div className="log-sect">{t("Remove or change")}</div>
      <Opt on={opts.location} onChange={set("location")} title={t("Location")} sub={t("Move every position so home is at 0° N 0° E. Distances, heights and the track's shape stay.")} />
      <Opt on={opts.date} onChange={set("date")} title={t("Date and time")} sub={t("Start in the first week of 2000. Durations stay.")} />
      <Opt on={opts.board} onChange={set("board")} title={t("Board id")} sub={t("The board serial in the startup messages, and the file name.")} />
      <Opt on={opts.messages} onChange={set("messages")} title={t("Messages")} sub={t("Clear every status line except firmware and frame.")} />
      <div className="log-sect">{t("Keep")}</div>
      <Opt on title={t("Parameters")} sub={t("Whoever helps you needs them. They hold no position.")} disabled onChange={() => {}} />
      <Opt on={opts.note} onChange={set("note")} title={t("Note")} sub={anyNote ? t("Your note as a text file next to the log.") : t("These logs have no note.")} disabled={!anyNote} />
    </LogDialog>
  );
}

function DeleteDialog({ rows, onClose, onDelete }: { rows: Row[]; onClose: () => void; onDelete: (here: boolean, there: boolean) => void }) {
  const t = useT();
  const files = rows.filter((r) => r.file);
  const clouds = rows.filter((r) => r.cloud?.stored);
  const [here, setHere] = useState(files.length > 0);
  const [there, setThere] = useState(false);
  const bytes = (list: Row[], cloud: boolean) => sizeLabel(list.reduce((sum, r) => sum + (cloud ? r.cloud?.stored_bytes ?? 0 : r.size), 0));
  const label = here && there ? t("Delete from both") : there ? t("Remove from the cloud") : t("Delete from this computer");
  return (
    <LogDialog title={rows.length === 1 ? t("Delete log {id}", { id: rows[0].num ?? rows[0].name }) : t("Delete {n} logs", { n: rows.length })} onClose={onClose} foot={<>
      <span className="log-grow" />
      <button type="button" className="log-act ghost" onClick={onClose}>{t("Cancel")}</button>
      <button type="button" className="log-act danger" disabled={!here && !there} onClick={() => onDelete(here, there)}>{label}</button>
    </>}>
      <Opt on={here} onChange={setHere} disabled={!files.length} title={t("From this computer")} sub={files.length ? t(files.length === 1 ? "1 file, {size}, to the Recycle Bin" : "{n} files, {size}, to the Recycle Bin", { n: files.length, size: bytes(files, false) }) : t("None of these is on this computer.")} />
      <Opt on={there} onChange={setThere} disabled={!clouds.length} title={t("From the cloud")} sub={clouds.length ? t("{n} in the cloud, {size}. Deleted for every device; this cannot be undone.", { n: clouds.length, size: bytes(clouds, true) }) : t("None of these is in the cloud.")} />
      <p className="log-dim">{t("Logs on the board are not touched; the board has Erase board.")}</p>
    </LogDialog>
  );
}

function CloudDialog({ cloud, onClose, onMode }: { cloud: CloudState; onClose: () => void; onMode: (mode: CloudState["mode"]) => void }) {
  const t = useT();
  const used = cloud.used ?? 0;
  const limit = cloud.limit ?? 0;
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <LogDialog title={t("Cloud")} onClose={onClose} foot={<><span className="log-grow" /><button type="button" className="log-act ghost" onClick={onClose}>{t("Close")}</button></>}>
      {!cloud.signed_in ? (
        <p>{t("Sign in from Options to keep logs in your account and see them on your other devices.")}</p>
      ) : (
        <>
          <div className="log-sect">{t("Upload log files")}</div>
          <div className="log-seg">
            {(["off", "starred", "all"] as const).map((m) => (
              <button key={m} type="button" className={cloud.mode === m ? "on" : ""} onClick={() => onMode(m)}>{t(m === "off" ? "Off" : m === "starred" ? "Starred only" : "Every downloaded log")}</button>
            ))}
          </div>
          <p className="log-dim">{t("Stars and notes sync in every case. They are a few KB each.")}</p>
          <div className="log-sect">{t("Storage · {plan} plan", { plan: cloud.plan ?? "free" })}</div>
          <div className="log-quota"><div><span>{t("{used} of {limit}", { used: mbLabel(used), limit: mbLabel(limit) })}</span><span className="log-dim">{pct}%</span></div><i className={pct >= 95 ? "amber" : ""}><b style={{ width: `${pct}%` }} /></i></div>
          <p className="log-dim">{t("Files are compressed; the limit counts stored bytes. Over the limit uploads pause and nothing is deleted.")}</p>
          {cloud.error ? <p className="log-bad">{t(cloud.error)}</p> : null}
        </>
      )}
      <div className="log-sect">{t("Privacy")}</div>
      <p className="log-dim">{t("The cloud keeps the original log, with position, date and board serial, and only you can read it. Share writes an anonymised copy.")}</p>
    </LogDialog>
  );
}

type Age = "any" | "30" | "90";
function CleanDialog({ rows, allLocal, board, signedIn, onClose, onClean }: { rows: Row[]; allLocal: LocalLog[]; board: string; signedIn: boolean; onClose: () => void; onClean: (rows: Row[], here: boolean, there: boolean) => void }) {
  const t = useT();
  const [from, setFrom] = useState<"pc" | "cloud" | "both">("pc");
  const [starred, setStarred] = useState(false);
  const [boards, setBoards] = useState<"this" | "other" | "all">("this");
  const [age, setAge] = useState<Age>("30");
  const [never, setNever] = useState(true);
  const [short, setShort] = useState(true);
  const [shortS, setShortS] = useState(30);
  const [unreadable, setUnreadable] = useState(false);
  const [dupes, setDupes] = useState(true);
  const now = Date.now();
  const dupeIds = useMemo(() => {
    const seen = new Map<string, LocalLog>();
    const extra = new Set<string>();
    for (const file of [...allLocal].sort((a, b) => (b.saved_at ?? "").localeCompare(a.saved_at ?? ""))) {
      if (!file.hash) continue;
      if (seen.has(file.hash)) extra.add(file.id); else seen.set(file.hash, file);
    }
    return extra;
  }, [allLocal]);
  const picked = rows.flatMap((row) => {
    const inPlace = from === "pc" ? !!row.file : from === "cloud" ? !!row.cloud?.stored : true;
    if (!inPlace) return [];
    if (!starred && row.star) return [];
    if (boards === "this" && row.board !== board) return [];
    if (boards === "other" && row.board === board) return [];
    const why: string[] = [];
    const days = row.at ? (now - row.at.getTime()) / 86_400_000 : 0;
    if (age !== "any" && days > Number(age)) why.push(t("older than {n} days", { n: age }));
    if (never && row.scan && row.scan.armed_s != null && !row.scan.flights) why.push(t("never armed"));
    if (short && row.scan?.flights && (row.scan.armed_s ?? 0) < shortS) why.push(t("armed {s} s", { s: row.scan.armed_s ?? 0 }));
    if (unreadable && row.file && !row.scan) why.push(t("header unreadable"));
    if (dupes && row.file && dupeIds.has(row.file.id)) why.push(t("duplicate"));
    const anyRule = age !== "any" || never || short || unreadable || dupes;
    if (!why.length && anyRule) return [];
    return [{ row, why: why.join(" · ") || t("every log") }];
  });
  const kept = rows.filter((row) => row.star && !starred).length;
  const total = picked.reduce((sum, p) => sum + (from === "cloud" ? p.row.cloud?.stored_bytes ?? 0 : p.row.size), 0);
  const here = from !== "cloud";
  const there = from !== "pc";
  return (
    <LogDialog wide title={t("Clean up logs")} onClose={onClose} foot={<>
      <span className="log-dim log-grow">{t("Logs on the board are not touched.")}</span>
      <button type="button" className="log-act ghost" onClick={onClose}>{t("Cancel")}</button>
      <button type="button" className="log-act danger" disabled={!picked.length} onClick={() => onClean(picked.map((p) => p.row), here, there)}>
        {here && !there ? t(picked.length === 1 ? "Move 1 file to the Recycle Bin" : "Move {n} files to the Recycle Bin", { n: picked.length }) : t("Delete {n} logs", { n: picked.length })}
      </button>
    </>}>
      <div className="log-cgrid">
        <span>{t("From")}</span>
        <div className="log-seg">
          {(["pc", "cloud", "both"] as const).map((v) => <button key={v} type="button" disabled={v !== "pc" && !signedIn} className={from === v ? "on" : ""} onClick={() => setFrom(v)}>{t(v === "pc" ? "This computer" : v === "cloud" ? "Cloud" : "Both")}</button>)}
        </div>
        <span>{t("Logs")}</span>
        <div className="log-seg">
          <button type="button" className={!starred ? "on" : ""} onClick={() => setStarred(false)}>{t("Not starred")}</button>
          <button type="button" className={starred ? "on" : ""} onClick={() => setStarred(true)}>{t("Starred too")}</button>
        </div>
        <span>{t("Boards")}</span>
        <div className="log-seg">
          {(["this", "other", "all"] as const).map((v) => <button key={v} type="button" className={boards === v ? "on" : ""} onClick={() => setBoards(v)}>{t(v === "this" ? "This controller" : v === "other" ? "Other boards" : "All")}</button>)}
        </div>
        <span>{t("Age")}</span>
        <div className="log-seg">
          {(["any", "30", "90"] as const).map((v) => <button key={v} type="button" className={age === v ? "on" : ""} onClick={() => setAge(v)}>{v === "any" ? t("Any") : t("Older than {n} days", { n: v })}</button>)}
        </div>
        <span>{t("Also")}</span>
        <div className="log-also">
          <Opt on={never} onChange={setNever} title={t("Never armed")} />
          <Opt on={short} onChange={setShort} title={t("Armed under")} />
          <input type="number" min={1} max={3600} value={shortS} aria-label={t("Seconds")} onChange={(ev) => setShortS(Math.max(1, Number(ev.target.value) || 1))} /><span className="log-dim">s</span>
          <Opt on={unreadable} onChange={setUnreadable} title={t("Header unreadable")} />
          <Opt on={dupes} onChange={setDupes} title={t("Duplicates")} />
        </div>
      </div>
      <div className="log-ctotal"><b>{t(picked.length === 1 ? "1 log · {size}" : "{n} logs · {size}", { n: picked.length, size: sizeLabel(total) })}</b>{kept ? <span className="log-dim">{t(kept === 1 ? "1 starred log is kept" : "{n} starred logs are kept", { n: kept })}</span> : null}</div>
      <div className="log-clist">
        {picked.slice(0, 40).map((p) => (
          <div key={p.row.key}><b>{p.row.num ?? "—"}</b><span>{p.row.at ? WHEN.format(p.row.at) : "—"}</span><span className="log-dim">{p.why}</span><span className="r log-dim">{sizeLabel(from === "cloud" ? p.row.cloud?.stored_bytes ?? 0 : p.row.size)}</span></div>
        ))}
        {picked.length > 40 ? <div className="log-dim">{t("+ {n} more", { n: picked.length - 40 })}</div> : null}
        {!picked.length ? <div className="log-dim">{t("Nothing matches these filters.")}</div> : null}
      </div>
    </LogDialog>
  );
}
