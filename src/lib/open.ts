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
  // In normal browser mode, open directly via window.open synchronously to avoid popup blockers
  if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

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
