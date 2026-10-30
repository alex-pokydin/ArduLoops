/**
 * Global application network and environment configuration.
 * Centralizes local bridge ports, cloud origins, and OAuth callback schemes.
 */

/** Local MAVLink HTTP bridge port */
export const APP_HTTP_PORT = 8767;

/** Local MAVLink HTTP bridge (browser and desktop) */
export const APP_HTTP = `http://127.0.0.1:${APP_HTTP_PORT}`;

/** Cloud & Auth hosting origin (Firebase Hosting or custom domain) */
export const CLOUD_AUTH_ORIGIN =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_AUTH_ORIGIN) ||
  "https://arduloops-api.firebaseapp.com";

/** Cloud cabinet / account page */
export const CLOUD_ACCOUNT_URL = `${CLOUD_AUTH_ORIGIN}/account`;

/** Mobile custom-scheme callback for OAuth */
export const AUTH_CALLBACK_MOBILE = "arduloops://auth";

/** Desktop HTTP callback for OAuth */
export const AUTH_CALLBACK_DESKTOP = `${APP_HTTP}/auth/callback`;

/** Platform-aware login URL generation with safe fallback */
export function defaultLoginUrl(): string {
  const isMobile =
    typeof navigator !== "undefined" &&
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const ret = isMobile ? AUTH_CALLBACK_MOBILE : AUTH_CALLBACK_DESKTOP;
  return `${CLOUD_AUTH_ORIGIN}/login?return=${encodeURIComponent(ret)}`;
}
