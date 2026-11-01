import { useEffect, useSyncExternalStore } from "react";
import { APP_HTTP } from "../mav/link";

/**
 * Log uploads to the account, one at a time, from any tab. The app root runs `useCloudSync`,
 * which uploads what the Cloud setting asks for (starred logs, or every log here);
 * the Logs table shows the state and can ask for one log with `uploadLog`.
 */
export type CloudSyncState = {
  uploading: { id: string; hash: string; pct: number } | null;
  /** full: the plan's storage is used up; error: the last upload failed. Cleared by resumeUploads. */
  paused: "full" | "error" | null;
  error: string;
  /** Counts finished uploads, so a view can reload after each. */
  done: number;
};

type LocalRow = { id: string; hash: string | null; star: boolean };
type CloudList = { signed_in: boolean; mode: "off" | "starred" | "all"; error?: string; logs: { hash: string; stored: boolean }[] };

let state: CloudSyncState = { uploading: null, paused: null, error: "", done: 0 };
const listeners = new Set<() => void>();
const POKE = "arduloops:cloud-sync";
const SWEEP_MS = 5 * 60_000;

function emit(next: Partial<CloudSyncState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function json<R>(path: string, init?: RequestInit): Promise<R> {
  const response = await fetch(`${APP_HTTP}${path}`, init);
  const body = await response.json().catch(() => ({})) as R & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

/** Uploads one stored log now, whatever the Cloud setting. */
export async function uploadLog(id: string, hash: string): Promise<boolean> {
  if (state.uploading) return false;
  emit({ uploading: { id, hash, pct: 0 }, error: "" });
  const poll = window.setInterval(() => {
    void json<{ progress: { sent: number; total: number } | null }>("/logs/cloud/progress").then((p) => {
      if (p.progress?.total && state.uploading?.hash === hash) emit({ uploading: { id, hash, pct: Math.round((p.progress.sent / p.progress.total) * 100) } });
    }).catch(() => {});
  }, 400);
  try {
    await json("/logs/cloud/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    emit({ done: state.done + 1 });
    return true;
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Upload failed";
    emit({ paused: message === "Cloud storage is full." ? "full" : "error", error: message });
    return false;
  } finally {
    window.clearInterval(poll);
    emit({ uploading: null });
  }
}

let sweeping = false;

/** Uploads every log the Cloud setting asks for and the cloud does not hold yet. */
async function sweep() {
  if (sweeping || state.uploading || state.paused) return;
  sweeping = true;
  try {
    for (;;) {
      const cloud = await json<CloudList>("/logs/cloud");
      if (!cloud.signed_in || cloud.mode === "off" || cloud.error) return;
      const stored = new Set(cloud.logs.filter((c) => c.stored).map((c) => c.hash));
      const local = await json<{ logs?: LocalRow[] }>("/logs/local");
      const next = (local.logs ?? []).find((file) => file.hash && !stored.has(file.hash) && (cloud.mode === "all" || file.star));
      if (!next?.hash || !(await uploadLog(next.id, next.hash))) return;
    }
  } catch {
    /* the bridge is restarting; the next sweep tries again */
  } finally {
    sweeping = false;
  }
}

/** Asks the sync to look again: after a star, a download, or a change of setting. */
export function pokeCloud() {
  window.dispatchEvent(new Event(POKE));
}

/** Lifts a pause (cloud full, or a failed upload) and looks again. */
export function resumeUploads() {
  emit({ paused: null, error: "" });
  pokeCloud();
}

export function useCloudUploads(): CloudSyncState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Mounted once at the app root. */
export function useCloudSync() {
  useEffect(() => {
    const run = () => void sweep();
    const first = window.setTimeout(run, 5_000);
    const timer = window.setInterval(run, SWEEP_MS);
    window.addEventListener(POKE, run);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener(POKE, run);
    };
  }, []);
}
