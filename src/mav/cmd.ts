import { APP_HTTP } from "./link";
import type { Cmd } from "./types";

export type UiChange =
  | { kind: "param"; name: string; value: number; from: number | null }
  | { kind: "mode"; from: string; mode: string }
  | { kind: "arm"; on: boolean };

export function sameParam(left: number, right: number): boolean {
  return Math.round(left * 1e6) === Math.round(right * 1e6);
}

/** Record a settled interface change. The command itself was already sent. */
export function noteUi(changes: UiChange[]): void {
  const kept = changes.filter((change) => {
    if (change.kind === "param") return change.from == null || !sameParam(change.from, change.value);
    if (change.kind === "mode") return change.from !== change.mode && change.mode !== "";
    return true;
  });
  if (!kept.length) return;
  void fetch(`${APP_HTTP}/ai/note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes: kept }),
  }).catch(() => {
    /* audit is best-effort; the command was already sent */
  });
}

/** Write one parameter. Null means the vehicle was asked. A string is the refusal. */
export async function writeParam(name: string, value: number): Promise<string | null> {
  const response = await fetch(`${APP_HTTP}/cmd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "param", name, value }),
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({} as { error?: string }));
  return body.error || `HTTP ${response.status}`;
}

export function send(obj: Cmd): void {
  void fetch(`${APP_HTTP}/cmd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  }).catch(() => {
    /* HTTP still starting */
  });
}

export async function waitHttp(signal?: AbortSignal): Promise<boolean> {
  while (!signal?.aborted) {
    try {
      const r = await fetch(`${APP_HTTP}/health`, { cache: "no-store", signal });
      if (r.ok) return true;
    } catch {
      /* compile / restart */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
