import { APP_HTTP } from "./link";
import type { Cmd } from "./types";

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
