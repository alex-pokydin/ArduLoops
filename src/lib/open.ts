import { APP_HTTP } from "../mav/link";

export function externalPage(href: string): boolean {
  try {
    const url = new URL(href, window.location.href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return false;
    return true;
  } catch {
    return false;
  }
}

export function openExternal(url: string) {
  void fetch(`${APP_HTTP}/open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  }).then((res) => {
    if (!res.ok) window.open(url, "_blank", "noopener");
  }).catch(() => {
    window.open(url, "_blank", "noopener");
  });
}
