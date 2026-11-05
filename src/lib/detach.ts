/**
 * Detached windows: a floating panel moved into its own OS window (Tauri) or browser popup (web),
 * so it can sit on another monitor.
 *
 * The new window loads the same frontend with `#detached=<kind>&label=<label>`; main.tsx renders only that panel.
 * Its payload goes through localStorage under the window label (webviews of one app share the origin and the
 * storage), and the window opens its own `/stream` from the bridge, so no app state crosses windows.
 * Pause and plot span follow the main window over a BroadcastChannel.
 */

export type DetachKind = "live" | "chart" | "doc" | "board" | "assistant";

export type Detached = { kind: DetachKind; label: string; payload: unknown };

const PAYLOAD_KEY = "arduloops.detach.";
const CHANNEL = "arduloops.windows";
/** Kinds with one window: opening again updates and raises it. The others get a new window per item. */
const SINGLE: Record<DetachKind, boolean> = { live: true, board: true, assistant: true, chart: false, doc: false };
const SIZE: Record<DetachKind, { width: number; height: number }> = {
  live: { width: 520, height: 860 },
  chart: { width: 900, height: 560 },
  doc: { width: 900, height: 720 },
  board: { width: 760, height: 780 },
  assistant: { width: 480, height: 780 },
};

/** The label `detachWindow` gives a single-window kind. */
export function detachedLabel(kind: DetachKind): string {
  return `detached-${kind}`;
}

/** Label of the main window: Tauri's config label, or the name the browser tab gives itself. */
export const MAIN_LABEL = "main";
const WEB_MAIN_NAME = "arduloops-main";

export type WindowMsg =
  | { type: "payload"; label: string }
  | { type: "paused"; on: boolean }
  | { type: "span"; n: number }
  /** A new window asks the others for pause and plot span. */
  | { type: "sync-req" }
  | { type: "main-hello" }
  | { type: "main-bye" }
  // The detached assistant (lib/assistantBridge.ts).
  | { type: "assistant-query" }
  | { type: "assistant-up" }
  | { type: "assistant-down" }
  | { type: "assistant-ask"; detail: unknown }
  | { type: "assistant-options" }
  | { type: "setup-view"; view: unknown };

let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  } catch {
    channel = null;
  }
  return channel;
}

export function postWindowMsg(msg: WindowMsg): void {
  try {
    getChannel()?.postMessage(msg);
  } catch {
    /* ignore closed channel */
  }
}

export function onWindowMsg(fn: (msg: WindowMsg) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (ev: MessageEvent) => {
    const data = ev.data as WindowMsg | null;
    if (data && typeof data === "object" && typeof data.type === "string") fn(data);
  };
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Desktop Tauri or a desktop browser. Phones and the Android app have one screen. */
export function canDetach(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.classList.contains("mobile")) return false;
  return true;
}

function readHash(): URLSearchParams | null {
  if (typeof location === "undefined") return null;
  const raw = location.hash.replace(/^#/, "");
  if (!raw.startsWith("detached=")) return null;
  return new URLSearchParams(raw);
}

/** This window's panel, when it is a detached window. */
export function detachedFromUrl(): Detached | null {
  const q = readHash();
  if (!q) return null;
  const kind = q.get("detached") as DetachKind | null;
  const label = q.get("label") || "";
  if (!kind || !(kind in SIZE) || !label) return null;
  return { kind, label, payload: readPayload(label) };
}

export function isDetachedWindow(): boolean {
  return readHash() !== null;
}

export function readPayload(label: string): unknown {
  try {
    const raw = localStorage.getItem(PAYLOAD_KEY + label);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePayload(label: string, payload: unknown): void {
  try {
    localStorage.setItem(PAYLOAD_KEY + label, JSON.stringify(payload ?? null));
  } catch {
    /* storage full or blocked: the window opens empty */
  }
}

function slug(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function pageUrl(kind: DetachKind, label: string): string {
  const path = typeof location === "undefined" ? "/" : location.pathname || "/";
  return `${path}#detached=${kind}&label=${encodeURIComponent(label)}`;
}

/**
 * Open `kind` in its own window. `key` tells items of a multi-window kind apart (a chart title, a doc id):
 * the same key raises the window it already has, so window-state finds its last place by label.
 */
export async function detachWindow(kind: DetachKind, payload: unknown, opts: { title: string; key?: string }): Promise<boolean> {
  const label = SINGLE[kind] ? detachedLabel(kind) : `detached-${kind}-${slug(opts.key || opts.title)}`;
  writePayload(label, payload);
  const size = SIZE[kind];
  const url = pageUrl(kind, label);
  if (isTauri()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        postWindowMsg({ type: "payload", label });
        await existing.unminimize().catch(() => {});
        await existing.setFocus().catch(() => {});
        return true;
      }
      const win = new WebviewWindow(label, {
        url,
        title: `${opts.title} — ArduLoops`,
        width: size.width,
        height: size.height,
        minWidth: 320,
        minHeight: 200,
        resizable: true,
        focus: true,
      });
      return await new Promise<boolean>((resolve) => {
        void win.once("tauri://created", () => resolve(true));
        void win.once("tauri://error", (ev) => {
          console.error("detach window", ev.payload);
          resolve(false);
        });
      });
    } catch (err) {
      console.error("detach window", err);
      return false;
    }
  }
  // Browser: a named popup. The same name reuses the window that is already open.
  const left = Math.max(0, (window.screenX || 0) + 60);
  const top = Math.max(0, (window.screenY || 0) + 60);
  const popup = window.open(url, label, `popup,width=${size.width},height=${size.height},left=${left},top=${top}`);
  if (!popup) return false;
  postWindowMsg({ type: "payload", label });
  try {
    popup.focus();
  } catch {
    /* cross-window focus can be refused */
  }
  return true;
}

/** Bring another window of the app to the front: a detached label, or MAIN_LABEL. */
export async function focusWindow(label: string): Promise<void> {
  if (isTauri()) {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const win = await WebviewWindow.getByLabel(label);
      await win?.unminimize().catch(() => {});
      await win?.setFocus().catch(() => {});
    } catch {
      /* the window is gone */
    }
    return;
  }
  // An empty URL returns the named window as it is, without loading it again.
  try {
    window.open("", label === MAIN_LABEL ? WEB_MAIN_NAME : label)?.focus();
  } catch {
    /* cross-window focus can be refused */
  }
}

/** Close this detached window. */
export async function closeSelf(): Promise<void> {
  if (isTauri()) {
    try {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      await getCurrentWebviewWindow().close();
      return;
    } catch {
      /* fall through */
    }
  }
  window.close();
}

/**
 * The main window side: tell browser popups when it goes away, so they close with it.
 * A reload says hello again within the grace period and the popups stay. Tauri closes them in Rust.
 */
export function announceMainWindow(): () => void {
  if (isTauri()) return () => {};
  if (!window.name) window.name = WEB_MAIN_NAME;
  postWindowMsg({ type: "main-hello" });
  const bye = () => postWindowMsg({ type: "main-bye" });
  window.addEventListener("pagehide", bye);
  return () => window.removeEventListener("pagehide", bye);
}

/** The popup side of announceMainWindow. */
export function followMainWindow(): () => void {
  if (isTauri()) return () => {};
  let timer = 0;
  const off = onWindowMsg((msg) => {
    if (msg.type === "main-bye") {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => window.close(), 2500);
    } else if (msg.type === "main-hello") {
      window.clearTimeout(timer);
    }
  });
  return () => {
    window.clearTimeout(timer);
    off();
  };
}
