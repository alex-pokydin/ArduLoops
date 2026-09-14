import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { send, waitBridge } from "./cmd";
import { BRIDGE_HTTP, loadLink } from "./link";
import { EMPTY, type Sample } from "./types";

export const MAX_T = 8;

type Listener = () => void;

const listeners = new Set<Listener>();
const buf: Sample[] = [];
let latest: Sample = EMPTY;
let paused = false;
let snapshot: Sample = EMPTY;
let lastEmit = 0;

function emit(): void {
  snapshot = latest;
  for (const fn of listeners) fn();
}

export function getBuffer(): Sample[] {
  return buf;
}

export function getLatest(): Sample {
  return latest;
}

export function isPaused(): boolean {
  return paused;
}

export function setPaused(on: boolean): void {
  paused = on;
  emit();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getSnapshot(): Sample {
  return snapshot;
}

function ingest(s: Sample): void {
  const next = { ...s };
  next.t = Date.now() / 1000;
  if (!next.params) next.params = {};
  latest = next;
  if (!paused) {
    buf.push(next);
    const cut = next.t - MAX_T;
    while (buf.length && buf[0].t < cut) buf.shift();
  }
  const now = performance.now();
  if (now - lastEmit > 80) {
    lastEmit = now;
    emit();
  }
}

export function startStream(): () => void {
  if (isTauri()) {
    send({ op: "connect", url: loadLink() });
    let unlisten: (() => void) | undefined;
    void listen<Sample>("sample", (ev) => ingest(ev.payload)).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }

  const ac = new AbortController();
  let es: EventSource | undefined;
  void (async () => {
    if (!(await waitBridge(ac.signal))) return;
    if (ac.signal.aborted) return;
    send({ op: "connect", url: loadLink() });
    es = new EventSource(`${BRIDGE_HTTP}/stream`);
    es.onmessage = (ev) => {
      try {
        ingest(JSON.parse(ev.data) as Sample);
      } catch {
        /* ignore malformed */
      }
    };
  })();
  return () => {
    ac.abort();
    es?.close();
  };
}
