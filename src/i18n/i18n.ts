import { useSyncExternalStore } from "react";
import { uk } from "./uk";

export type Lang = "en" | "uk";

const STORE = "arduloops.lang";
const TABLES: Record<Lang, Record<string, string> | null> = {
  en: null,
  uk,
};

const missing = new Set<string>();

function readLang(): Lang {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw === "en" || raw === "uk") return raw;
  } catch {
    /* ignore */
  }
  return "uk";
}

let lang: Lang = readLang();

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function getLang(): Lang {
  return lang;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function applyDocumentLang(next: Lang = lang): void {
  document.documentElement.lang = next === "uk" ? "uk" : "en";
}

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORE, next);
  } catch {
    /* ignore */
  }
  applyDocumentLang(next);
  notify();
}

function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (all, name: string) =>
    vars[name] != null ? String(vars[name]) : all,
  );
}

/** English phrase is the key. Missing uk entry → English + console warning. */
export function t(key: string, vars?: Record<string, string | number>): string {
  if (!key) return key;
  const table = TABLES[lang];
  let phrase = table ? table[key] : undefined;
  if (phrase == null) {
    if (lang !== "en" && !missing.has(key)) {
      missing.add(key);
      console.warn("[i18n] missing " + lang + ":", key);
    }
    phrase = key;
  }
  return fill(phrase, vars);
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

export function useT(): typeof t {
  useLang();
  return t;
}

const BRIDGE: Record<string, string> = {
  "немає лінку": "No link",
  "відключено": "Disconnected",
  "лінк обірвався": "Link dropped",
  "ребут…": "Rebooting…",
};

/** Map live Sample.detail (often still Ukrainian from the bridge) to a display string. */
export function tDetail(detail: string | undefined): string {
  if (!detail) return t("SITL not found");
  const mapped = BRIDGE[detail];
  if (mapped) return t(mapped);
  const mav = detail.match(/^немає MAVLink \((.+)\)$/i) || detail.match(/^No MAVLink \((.+)\)$/i);
  if (mav) return mav[1];
  if (detail.includes("ATTITUDE")) return t("No ATTITUDE, reconnect");
  return detail;
}
