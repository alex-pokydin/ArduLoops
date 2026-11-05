import { useEffect, useRef } from "react";
import { ASK_ASSISTANT, requestComposerFocus, type AskDetail } from "./assistantAsk";
import { detachedLabel, focusWindow, MAIN_LABEL, onWindowMsg, postWindowMsg } from "./detach";
import { getSetupView, replaceSetupView, subscribeSetupView, type SetupView } from "./setupView";

/**
 * The assistant moved into its own window keeps working with the main window:
 * Ask buttons in the app go to it, it sees the Setup step the main window shows, and its Options button opens
 * Options in the main window.
 */

/** Main window side. `remoteUp()` is true while a detached assistant window is open. */
export function useAssistantRemote(enabled: boolean, onOptions: () => void) {
  const up = useRef(false);
  const options = useRef(onOptions);
  options.current = onOptions;

  useEffect(() => {
    if (!enabled) return;
    const sendView = () => postWindowMsg({ type: "setup-view", view: getSetupView() });
    const off = onWindowMsg((msg) => {
      if (msg.type === "assistant-up") {
        up.current = true;
        sendView();
      } else if (msg.type === "assistant-down") {
        up.current = false;
      } else if (msg.type === "assistant-options") {
        options.current();
        void focusWindow(MAIN_LABEL);
      }
    });
    const offView = subscribeSetupView(() => {
      if (up.current) sendView();
    });
    postWindowMsg({ type: "assistant-query" });
    return () => {
      off();
      offView();
    };
  }, [enabled]);

  /** Asks the window if it is still there: a closed window does not always say goodbye. */
  const alive = () =>
    new Promise<boolean>((resolve) => {
      let done = false;
      const off = onWindowMsg((msg) => {
        if (msg.type !== "assistant-up" || done) return;
        done = true;
        off();
        resolve(true);
      });
      postWindowMsg({ type: "assistant-query" });
      window.setTimeout(() => {
        if (done) return;
        done = true;
        off();
        up.current = false;
        resolve(false);
      }, 400);
    });

  return {
    remoteUp: () => up.current,
    /** Raises the detached assistant; false when it is gone. */
    focusRemote: async () => {
      if (!(await alive())) return false;
      void focusWindow(detachedLabel("assistant"));
      return true;
    },
    /** Sends an Ask to the detached assistant; false when it is gone and the caller handles it here. */
    forwardAsk: async (detail: AskDetail) => {
      if (!(await alive())) return false;
      postWindowMsg({ type: "assistant-ask", detail });
      void focusWindow(detachedLabel("assistant"));
      return true;
    },
  };
}

/** Detached window side. */
export function useAssistantDetached(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const say = () => postWindowMsg({ type: "assistant-up" });
    const bye = () => postWindowMsg({ type: "assistant-down" });
    const off = onWindowMsg((msg) => {
      if (msg.type === "assistant-query") say();
      else if (msg.type === "setup-view") replaceSetupView((msg.view as SetupView | null) ?? null);
      else if (msg.type === "assistant-ask") {
        const detail = msg.detail as AskDetail;
        if (!detail.send && !detail.keep) requestComposerFocus();
        window.dispatchEvent(new CustomEvent<AskDetail>(ASK_ASSISTANT, { detail }));
      }
    });
    say();
    window.addEventListener("pagehide", bye);
    return () => {
      bye();
      off();
      window.removeEventListener("pagehide", bye);
    };
  }, [enabled]);
}

/** Detached window: Options live in the main window. */
export function openOptionsInMain(): void {
  postWindowMsg({ type: "assistant-options" });
}
