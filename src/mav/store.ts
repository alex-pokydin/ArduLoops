import { send, waitHttp } from "./cmd";
import { APP_HTTP, canonicalLink, loadLink } from "./link";
import { EMPTY, type Sample } from "./types";

/** Keep this many seconds of samples so a longer plot window has history waiting. */
export const BUF_SPAN = 60;
export const PLOT_SPANS = [8, 15, 30, 60] as const;
export type PlotSpan = (typeof PLOT_SPANS)[number];

const SPAN_KEY = "arduloops.plot-span";

function loadSpan(): PlotSpan {
  try {
    const n = Number(localStorage.getItem(SPAN_KEY));
    if ((PLOT_SPANS as readonly number[]).includes(n)) return n as PlotSpan;
  } catch {
    /* ignore */
  }
  return 8;
}

type Listener = () => void;

const listeners = new Set<Listener>();
const buf: Sample[] = [];
let latest: Sample = EMPTY;
let paused = false;
let snapshot: Sample = EMPTY;
let frozenBuf: Sample[] | null = null;
let plotSpan: PlotSpan = loadSpan();
let lastEmit = 0;

function emit(): void {
  if (!paused) snapshot = latest;
  for (const fn of listeners) fn();
}

export function getBuffer(): Sample[] {
  return frozenBuf ?? buf;
}

export function getLatest(): Sample {
  return latest;
}

export function isPaused(): boolean {
  return paused;
}

export function getPlotSpan(): PlotSpan {
  return plotSpan;
}

export function setPlotSpan(n: PlotSpan): void {
  if (plotSpan === n) return;
  plotSpan = n;
  try {
    localStorage.setItem(SPAN_KEY, String(n));
  } catch {
    /* ignore */
  }
  emit();
}

export function setPaused(on: boolean): void {
  paused = on;
  if (on) frozenBuf = buf.slice();
  else frozenBuf = null;
  if (!on) snapshot = latest;
  emit();
}

/** Link / SITL / STATUSTEXT keep moving while attitude and plots stay frozen. */
function overlayWhilePaused(frozen: Sample, live: Sample): Sample {
  if (
    frozen.ok === live.ok &&
    frozen.detail === live.detail &&
    frozen.sitl_phase === live.sitl_phase &&
    frozen.sitl_detail === live.sitl_detail &&
    frozen.sitl_vehicle === live.sitl_vehicle &&
    frozen.sitl_running === live.sitl_running &&
    frozen.sitl_cpu === live.sitl_cpu &&
    frozen.sitl_rss_mb === live.sitl_rss_mb &&
    frozen.init_done === live.init_done &&
    frozen.init_total === live.init_total &&
    frozen.texts === live.texts
  ) {
    return frozen;
  }
  return {
    ...frozen,
    ok: live.ok,
    detail: live.detail,
    texts: live.texts,
    sitl_phase: live.sitl_phase,
    sitl_detail: live.sitl_detail,
    sitl_vehicle: live.sitl_vehicle,
    sitl_running: live.sitl_running,
    sitl_cpu: live.sitl_cpu,
    sitl_rss_mb: live.sitl_rss_mb,
    init_done: live.init_done,
    init_total: live.init_total,
  };
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

function sameRecord(a: Record<string, number>, b: Record<string, number>): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (let i = 0; i < keys.length; i++) {
    if (a[keys[i]] !== b[keys[i]]) return false;
  }
  return true;
}

let paramsSnap: Record<string, number> = EMPTY.params;

/** Same reference while parameter values are unchanged, so a 12 Hz attitude tick does not rebuild the table. */
export function getParamsSnapshot(): Record<string, number> {
  const next = snapshot.params ?? EMPTY.params;
  if (sameRecord(paramsSnap, next)) return paramsSnap;
  paramsSnap = next;
  return paramsSnap;
}

type LinkBits = { ok: boolean; frame: Sample["frame"] };
let linkBits: LinkBits = { ok: false, frame: "" };

export function getLinkBits(): LinkBits {
  if (linkBits.ok === snapshot.ok && linkBits.frame === snapshot.frame) return linkBits;
  linkBits = { ok: snapshot.ok, frame: snapshot.frame };
  return linkBits;
}

export type SetupSnap = {
  ok: boolean;
  frame: Sample["frame"];
  params: Record<string, number>;
  rc: number[];
};

let setupSnap: SetupSnap = { ok: false, frame: "", params: EMPTY.params, rc: [] };

function sameList(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Attitude and PID fields stay out. Radio bars still move when PWM changes. */
export function getSetupSnapshot(): SetupSnap {
  const params = getParamsSnapshot();
  const rc = snapshot.rc ?? [];
  if (
    setupSnap.ok === snapshot.ok
    && setupSnap.frame === snapshot.frame
    && setupSnap.params === params
    && sameList(setupSnap.rc, rc)
  ) {
    return setupSnap;
  }
  setupSnap = { ok: snapshot.ok, frame: snapshot.frame, params, rc: rc.slice() };
  return setupSnap;
}

function ingest(s: Sample): void {
  const next = { ...s };
  next.t = Date.now() / 1000;
  if (!next.params) next.params = {};
  latest = next;
  buf.push(next);
  const cut = next.t - BUF_SPAN;
  while (buf.length && buf[0].t < cut) buf.shift();
  if (!paused) {
    snapshot = next;
  } else {
    const kept = overlayWhilePaused(snapshot, next);
    if (kept === snapshot) return;
    snapshot = kept;
  }
  const now = performance.now();
  if ((next.init_total || 0) > 0 || next.sitl_phase === "download" || next.sitl_phase === "start" || next.sitl_running || paused || now - lastEmit > 80) {
    lastEmit = now;
    emit();
  }
}

export function startStream(): () => void {
  const ac = new AbortController();
  let es: EventSource | undefined;
  let lastMsg = 0;
  let generation = 0;
  let timer = 0;

  const open = (mode: "start" | "again") => {
    if (ac.signal.aborted) return;
    const mine = ++generation;
    es?.close();
    const next = new EventSource(`${APP_HTTP}/stream`);
    es = next;
    lastMsg = performance.now();
    let first = true;
    next.onmessage = (ev) => {
      if (mine !== generation) return;
      lastMsg = performance.now();
      try {
        const sample = JSON.parse(ev.data) as Sample;
        if (first) {
          first = false;
          if (!sample.ok) {
            const url = canonicalLink(loadLink());
            const serial = /^serial:/i.test(url);
            // A COM port stays down until the link form is submitted again.
            // Retrying it occupies the bootloader.
            if (!(mode === "again" && serial)) {
              const detail = sample.detail || "";
              const already = detail.includes(`(${url})`) || detail === url;
              if (!already) send({ op: "connect", url });
            }
          }
        }
        ingest(sample);
      } catch {
        /* ignore malformed */
      }
    };
    next.onerror = () => {
      if (mine !== generation) return;
      next.close();
      if (es === next) es = undefined;
      window.setTimeout(() => {
        if (mine === generation) open("again");
      }, 500);
    };
  };

  const watch = () => {
    if (ac.signal.aborted) return;
    if (es && performance.now() - lastMsg > 2000) open("again");
    timer = window.setTimeout(watch, 1000);
  };

  void (async () => {
    if (!(await waitHttp(ac.signal))) return;
    if (ac.signal.aborted) return;
    open("start");
    watch();
  })();
  return () => {
    ac.abort();
    window.clearTimeout(timer);
    es?.close();
  };
}
