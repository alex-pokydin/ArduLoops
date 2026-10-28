import { useEffect } from "react";

/**
 * Where the user is in Setup, for the assistant's view chip: the step, the field they asked about,
 * and the edits they have not written yet. Small on purpose; the vehicle state comes from setup_status.
 */
export type ViewDraft = { param: string; from: number | null; to: number };

export type SetupView = {
  view: "setup";
  vehicle: string;
  /** Step id, as setup_status names it; "overview" for the Overview. */
  step: string;
  /** English step title; the chip translates it. */
  title: string;
  focus?: string;
  draft: ViewDraft[];
  warnings: string[];
};

let view: SetupView | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function getSetupView(): SetupView | null {
  return view;
}

export function subscribeSetupView(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** A new step replaces the chip: focus and draft belong to the step that set them. */
export function setSetupView(next: Pick<SetupView, "vehicle" | "step" | "title"> | null): void {
  if (!next) {
    if (view) {
      view = null;
      emit();
    }
    return;
  }
  if (view && view.step === next.step && view.vehicle === next.vehicle && view.title === next.title) return;
  view = { view: "setup", ...next, draft: [], warnings: [] };
  emit();
}

export function setViewFocus(param: string | undefined): void {
  if (!view || view.focus === param) return;
  view = { ...view, focus: param };
  emit();
}

function sameDraft(a: ViewDraft[], b: ViewDraft[]): boolean {
  return a.length === b.length && a.every((d, i) => d.param === b[i].param && d.from === b[i].from && d.to === b[i].to);
}

export function setViewDraft(draft: ViewDraft[]): void {
  if (!view || sameDraft(view.draft, draft)) return;
  view = { ...view, draft };
  emit();
}

/** Publishes a step's unwritten edits while it is on screen. */
export function useViewDraft(draft: ViewDraft[]): void {
  const key = JSON.stringify(draft);
  useEffect(() => {
    setViewDraft(JSON.parse(key) as ViewDraft[]);
  }, [key]);
  useEffect(() => () => setViewDraft([]), []);
}

// The chat side: the chip can be turned off for one chat (+ → Current view), and Ask leaves one-tap
// questions built from the step's state. Both reset with a new chat.
let off = false;
let starters: string[] = [];

export function getViewOff(): boolean {
  return off;
}

export function setViewOff(next: boolean): void {
  if (off === next) return;
  off = next;
  emit();
}

export function getAskStarters(): string[] {
  return starters;
}

export function setAskStarters(next: string[]): void {
  if (!next.length && !starters.length) return;
  starters = next;
  emit();
}

/** Assistant cards waiting for the user: a parameter change (`param`) or a wizard (`wizard` id). */
export type WaitingCard = { kind: "param" | "wizard"; name: string };
let waiting: WaitingCard[] = [];

export function getWaitingCards(): WaitingCard[] {
  return waiting;
}

export function setWaitingCards(next: WaitingCard[]): void {
  if (next.length === waiting.length && next.every((c, i) => c.kind === waiting[i].kind && c.name === waiting[i].name)) return;
  waiting = next;
  emit();
}

/** The chip as sent: null when there is no Setup view or it is off for this chat. */
export function sentView(): SetupView | null {
  return off ? null : view;
}

/** The chip text: step, focused field, and the draft in short. */
export function viewLabel(v: SetupView, t: (s: string, vars?: Record<string, string | number>) => string): string {
  const parts = [t("Setup"), t(v.title)];
  if (v.focus) parts.push(v.focus);
  const own = v.focus ? v.draft.find((d) => d.param === v.focus) : undefined;
  if (own) parts.push(t("draft {from} → {to}", { from: own.from ?? "—", to: own.to }));
  else if (v.draft.length) parts.push(v.draft.length === 1 ? t("1 unwritten change") : t("{n} unwritten changes", { n: v.draft.length }));
  return parts.join(" · ");
}
