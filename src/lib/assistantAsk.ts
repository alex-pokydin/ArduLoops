/** Fired by Ask buttons outside the chat: the assistant opens and sends the text as the user's message. */
export const ASK_ASSISTANT = "arduloops:assistant-ask";

export function askAssistant(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(ASK_ASSISTANT, { detail: text }));
}
