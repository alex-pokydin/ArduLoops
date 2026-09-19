export const DEFAULT_LINK = "tcpout:127.0.0.1:5763";
/** In-app SITL `--serial0 tcp:5770` (no MAVProxy). */
export const SITL_LINK = "tcpout:127.0.0.1:5770";
/** Local MAVLink HTTP (browser and desktop). */
export const APP_HTTP = "http://127.0.0.1:8767";
const KEY = "arduloops.link";
const HIST_KEY = "arduloops.links";
const HIST_MAX = 12;

export function loadLink(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_LINK;
  } catch {
    return DEFAULT_LINK;
  }
}

export function saveLink(url: string): void {
  try {
    localStorage.setItem(KEY, url);
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadLinkHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const u = item.trim();
      if (!u) continue;
      const k = u.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(u);
      if (out.length >= HIST_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Last-used URL plus a unique recents list. Call only after HEARTBEAT. */
export function rememberLink(url: string): string[] {
  const u = url.trim();
  if (!u) return loadLinkHistory();
  saveLink(u);
  const rest = loadLinkHistory().filter((x) => x.toLowerCase() !== u.toLowerCase());
  const next = [u, ...rest].slice(0, HIST_MAX);
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
  return next;
}
