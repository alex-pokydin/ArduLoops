export const DEFAULT_LINK = "tcpout:127.0.0.1:5763";
/** Local MAVLink HTTP bridge (browser / Vite). Tauri uses invoke instead. */
export const BRIDGE_HTTP = "http://127.0.0.1:8767";
const KEY = "arduloops.link";

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
