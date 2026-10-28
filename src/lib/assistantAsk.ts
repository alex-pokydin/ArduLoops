/**
 * Fired by buttons outside the chat. Each starts a new conversation.
 * `send`: the text is sent at once as the user's message (Fix, Walk me through setup).
 * Otherwise the chat opens with the composer focused and nothing is sent (Ask); `starters` are offered as one-tap questions.
 */
export const ASK_ASSISTANT = "arduloops:assistant-ask";

export type AskDetail = { text: string; send: boolean; starters?: string[]; keep?: boolean };

export function askAssistant(text: string): void {
  window.dispatchEvent(new CustomEvent<AskDetail>(ASK_ASSISTANT, { detail: { text, send: true } }));
}

let focusWanted = false;

/** True once after Ask: the composer takes focus when the chat pane is ready, even if it mounts after the event. */
export function takeFocusRequest(): boolean {
  const wanted = focusWanted;
  focusWanted = false;
  return wanted;
}

export function openAssistant(starters: string[] = []): void {
  focusWanted = true;
  window.dispatchEvent(new CustomEvent<AskDetail>(ASK_ASSISTANT, { detail: { text: "", send: false, starters } }));
}

/** Opens the chat on the conversation already there, e.g. where an assistant card waits. */
export function showAssistant(): void {
  window.dispatchEvent(new CustomEvent<AskDetail>(ASK_ASSISTANT, { detail: { text: "", send: false, keep: true } }));
}
