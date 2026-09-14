export const DEFAULT_LINK = "tcpout:127.0.0.1:5763";
/** Local MAVLink HTTP (browser and desktop). */
export const APP_HTTP = "http://127.0.0.1:8767";
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
