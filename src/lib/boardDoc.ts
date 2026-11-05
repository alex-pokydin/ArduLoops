import { useEffect, useSyncExternalStore } from "react";
import { APP_HTTP } from "../mav/link";

/** `GET /board-doc`: the board's README.md and hwdef.dat from the ArduPilot tree, as saved by the bridge. */
export type BoardDocReply = {
  state: "off" | "saved" | "stale" | "never" | "none";
  board?: string;
  readme?: string | null;
  files?: { path: string; text: string }[];
  saved_at?: number;
  error?: string;
};

// One copy for the Overview card and the board window, loaded once per linked board.
let doc: BoardDocReply | null = null;
/** The last reply that had a board: the window keeps showing it while the link is down (a reboot, a cable). */
let last: BoardDocReply | null = null;
let loadedFor = "";
let loading: AbortController | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function load(identity: string, refresh: boolean, tries = 0) {
  loading?.abort();
  const ac = new AbortController();
  loading = ac;
  void fetch(`${APP_HTTP}/board-doc${refresh ? "?refresh=1" : ""}`, { cache: "no-store", signal: ac.signal })
    .then((response) => (response.ok ? response.json() : null))
    .then((value: BoardDocReply | null) => {
      if (!value || loading !== ac) return;
      doc = value;
      if (value.board && (value.state === "saved" || value.state === "stale")) last = value;
      emit();
      // AUTOPILOT_VERSION can arrive after the link: a board with no name and no id yet is asked again.
      if (value.state === "none" && !value.board && tries < 5) {
        window.setTimeout(() => {
          if (loadedFor === identity) load(identity, false, tries + 1);
        }, 4000);
      }
    })
    .catch(() => {});
}

/** The doc for the linked vehicle; `identity` changes when the link or the board changes. */
export function useBoardDoc(identity: string): BoardDocReply | null {
  useEffect(() => {
    if (loadedFor === identity) return;
    loadedFor = identity;
    doc = null;
    emit();
    load(identity, false);
  }, [identity]);
  return useSyncExternalStore(subscribe, () => doc);
}

/** A detached board window starts with the doc the main window showed, so it is not empty while the link is down. */
export function seedLastBoardDoc(value: BoardDocReply | null) {
  if (!value || last) return;
  last = value;
  emit();
}

export function useLastBoardDoc(): BoardDocReply | null {
  return useSyncExternalStore(subscribe, () => last);
}

/** Download the board's files again. */
export function refreshBoardDoc() {
  load(loadedFor, true);
}

export type BoardTab = "readme" | "hwdef" | "parm";
/** raise counts the asks to bring the window to the front. */
export type BoardWindowState = { open: boolean; tab: BoardTab; path: string; heading: string; raise: number };

let win: BoardWindowState = { open: false, tab: "readme", path: "", heading: "", raise: 0 };
const winListeners = new Set<() => void>();
const winSubscribe = (fn: () => void) => {
  winListeners.add(fn);
  return () => winListeners.delete(fn);
};

export function useBoardWindow(): BoardWindowState {
  return useSyncExternalStore(winSubscribe, () => win);
}

export function setBoardWindow(next: Partial<BoardWindowState>) {
  win = { ...win, ...next };
  winListeners.forEach((fn) => fn());
}

export function openBoardWindow(tab: BoardTab = "readme") {
  setBoardWindow({ open: true, tab, path: "", heading: "", raise: win.raise + 1 });
}

/** Bring the open window to the front. */
export function raiseBoardWindow() {
  setBoardWindow({ open: true, raise: win.raise + 1 });
}

export function closeBoardWindow() {
  setBoardWindow({ open: false });
}
