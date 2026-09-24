export const DEFAULT_LINK = "tcpout:127.0.0.1:5763";
/** In-app SITL `--serial0 tcp:5770` (no MAVProxy). */
export const SITL_LINK = "tcpout:127.0.0.1:5770";
/** Local MAVLink HTTP (browser and desktop). */
export const APP_HTTP = "http://127.0.0.1:8767";
const KEY = "arduloops.link";
const HIST_KEY = "arduloops.links";
const HIST_MAX = 12;

export type LinkKind = "tcp" | "udp" | "serial";

/** TCP is host:port. UDP is a listen port, or host:port to send to the vehicle. Serial is port@baud. */
export function parseLink(url: string): { kind: LinkKind; value: string } {
  const s = url.trim();
  if (/^serial:/i.test(s)) {
    const rest = s.slice("serial:".length);
    const cut = rest.lastIndexOf(":");
    if (cut <= 0) return { kind: "serial", value: rest || "" };
    return { kind: "serial", value: `${rest.slice(0, cut)}@${rest.slice(cut + 1)}` };
  }
  if (/^udp/i.test(s)) {
    const rest = s.replace(/^udp(?:in|out|bcast)?:/i, "").trim();
    if (!rest || /^(?:0\.0\.0\.0:)?\d+$/.test(rest)) {
      return { kind: "udp", value: rest.match(/(\d+)$/)?.[1] ?? "14550" };
    }
    return { kind: "udp", value: rest };
  }
  const host = s.replace(/^(tcpout|tcpin|tcp):/i, "").trim();
  return { kind: "tcp", value: host || "127.0.0.1:5760" };
}

export function formatLink(kind: LinkKind, value: string): string {
  const v = value.trim();
  if (kind === "serial") {
    const [port, baud] = v.split("@");
    const name = (port || "").trim();
    const rate = (baud || "115200").replace(/\D/g, "") || "115200";
    return name ? `serial:${name}:${rate}` : "serial::115200";
  }
  if (kind === "udp") {
    const raw = v.replace(/^udp(?:in|out|bcast)?:/i, "").trim();
    if (!raw || /^\d+$/.test(raw)) return `udpin:0.0.0.0:${raw || "14550"}`;
    return `udpout:${raw.includes(":") ? raw : `${raw}:14550`}`;
  }
  const host = v.replace(/^(tcpout|tcpin|tcp):/i, "").trim();
  if (!host) return "tcpout:127.0.0.1:5760";
  if (host.includes(":")) return `tcpout:${host}`;
  return `tcpout:127.0.0.1:${host}`;
}

export function linkLabel(url: string): string {
  const parsed = parseLink(url);
  if (parsed.kind === "udp") return `UDP ${parsed.value}`;
  if (parsed.kind === "serial") return `SER ${parsed.value.replace("@", " ")}`;
  return `TCP ${parsed.value}`;
}

export function canonicalLink(url: string): string {
  const parsed = parseLink(url);
  return formatLink(parsed.kind, parsed.value);
}

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
