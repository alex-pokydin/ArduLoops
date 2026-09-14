import { invoke, isTauri } from "@tauri-apps/api/core";
import { BRIDGE_HTTP } from "./link";
import type { Cmd } from "./types";

export function send(obj: Cmd): void {
  if (isTauri()) {
    void invoke("mav_cmd", { cmd: obj });
    return;
  }
  void fetch(`${BRIDGE_HTTP}/cmd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  }).catch(() => {
    /* bridge still starting */
  });
}

export async function waitBridge(signal?: AbortSignal): Promise<boolean> {
  while (!signal?.aborted) {
    try {
      const r = await fetch(`${BRIDGE_HTTP}/health`, { cache: "no-store", signal });
      if (r.ok) return true;
    } catch {
      /* compile / restart */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
