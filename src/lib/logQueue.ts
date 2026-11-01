import { useEffect, useSyncExternalStore } from "react";
import { APP_HTTP } from "../mav/link";

/**
 * Board log downloads, one at a time: the bridge runs one download only.
 * The Logs table, Download all, and "Download new logs on connect" all queue here,
 * so a second request never meets "A log download is already running".
 */
export type QueueItem = { id: number; size: number };
export type QueueState = { current: QueueItem | null; waiting: QueueItem[]; done: number; error: { id: number; text: string } | null; saved: { id: number; path: string } | null };

let state: QueueState = { current: null, waiting: [], done: 0, error: null, saved: null };
const listeners = new Set<() => void>();
let abort: AbortController | null = null;

function emit(next: Partial<QueueState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Seconds to wait for one log: about 6 kB/s over a slow link, at least three minutes. */
function downloadWait(size: number): number {
  return Math.min(3600, Math.max(180, Math.ceil(size / 6000) + 90));
}

async function pump() {
  if (state.current || !state.waiting.length) return;
  const [item, ...rest] = state.waiting;
  emit({ current: item, waiting: rest, error: null });
  const ac = new AbortController();
  abort = ac;
  try {
    const response = await fetch(`${APP_HTTP}/logs/download?id=${item.id}&timeout_s=${downloadWait(item.size)}`, { signal: ac.signal });
    const body = await response.json() as { error?: string; path?: string };
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    emit({ current: null, done: state.done + 1, saved: { id: item.id, path: body.path ?? "" } });
  } catch (reason) {
    const text = reason instanceof Error ? reason.message : "";
    const cancelled = ac.signal.aborted || text === "Download cancelled";
    emit({ current: null, error: cancelled ? null : { id: item.id, text } });
  } finally {
    if (abort === ac) abort = null;
    void pump();
  }
}

export function enqueueDownloads(items: QueueItem[]) {
  const known = new Set([state.current?.id, ...state.waiting.map((w) => w.id)]);
  const fresh = items.filter((item) => !known.has(item.id));
  if (!fresh.length) return;
  emit({ waiting: [...state.waiting, ...fresh] });
  void pump();
}

/** Cancels one log: out of the queue, or stops it on the board when it is the one running. */
export async function cancelDownload(id: number) {
  if (state.current?.id === id) {
    abort?.abort();
    await fetch(`${APP_HTTP}/logs/cancel`, { method: "POST" }).catch(() => {});
    return;
  }
  emit({ waiting: state.waiting.filter((w) => w.id !== id) });
}

export function useLogQueue(): QueueState {
  return useSyncExternalStore(subscribe, () => state);
}

const AUTO_KEY = "arduloops.logs.auto";
const SEEN_KEY = "arduloops.logs.seen";

function readMap(key: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function writeMap(key: string, map: Record<string, number>) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* private window */
  }
}

/** "Download new logs on connect" is per controller (board key). */
export function autoDownloadOn(board: string): boolean {
  return !!board && readMap(AUTO_KEY)[board] === 1;
}

/** Turning it on marks today's logs as seen, so only logs recorded after that download. */
export function setAutoDownload(board: string, on: boolean, newest: number) {
  const auto = readMap(AUTO_KEY);
  if (on) auto[board] = 1; else delete auto[board];
  writeMap(AUTO_KEY, auto);
  if (on) markSeen(board, newest);
}

export function markSeen(board: string, newest: number) {
  const seen = readMap(SEEN_KEY);
  if ((seen[board] ?? -1) < newest) {
    seen[board] = newest;
    writeMap(SEEN_KEY, seen);
  }
}

export function seenNewest(board: string): number {
  return readMap(SEEN_KEY)[board] ?? -1;
}

type BoardLog = { id: number; size: number };

/**
 * Mounted beside the Controller: on each new link to a disarmed board with the setting on,
 * lists the board's logs once and queues the ones newer than the newest seen.
 * Logs already on this computer are skipped by the bridge's own size match.
 */
export function useAutoDownload(board: string, linked: boolean, armed: boolean) {
  useEffect(() => {
    if (!board || !linked || armed || !autoDownloadOn(board)) return;
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      void Promise.all([
        fetch(`${APP_HTTP}/logs?refresh=1`, { signal: ac.signal }).then((r) => r.json() as Promise<{ logs?: BoardLog[] }>),
        fetch(`${APP_HTTP}/logs/local`, { signal: ac.signal }).then((r) => r.json() as Promise<{ logs?: { id: string; bytes: number; onboard_id?: number | null; vehicle?: string }[] }>),
      ]).then(([onBoard, local]) => {
        const logs = onBoard.logs ?? [];
        const have = local.logs ?? [];
        const newest = seenNewest(board);
        const fresh = logs.filter((log) => log.id > newest && log.size > 0 && !have.some((file) => file.vehicle === board && file.onboard_id === log.id && file.bytes === log.size));
        if (fresh.length) {
          window.dispatchEvent(new CustomEvent(AUTO_STARTED, { detail: fresh.length }));
          enqueueDownloads(fresh.sort((a, b) => a.id - b.id).map((log) => ({ id: log.id, size: log.size })));
        }
        markSeen(board, Math.max(newest, ...logs.map((log) => log.id)));
      }).catch(() => {});
    }, 3000);
    return () => {
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [board, linked, armed]);
}

/** Fired when the auto-download queued logs, with their count, for the Logs status slot. */
export const AUTO_STARTED = "arduloops:logs-auto";
