type Listener = () => void;

export type LuaQuote = {
  name: string;
  startLine: number;
  endLine: number;
  selection: string;
  body: string;
  dirty: boolean;
};

let quote: LuaQuote | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function getLuaQuote(): LuaQuote | null {
  return quote;
}

export function setLuaQuote(next: LuaQuote | null): void {
  quote = next;
  emit();
}

export function subscribeLuaQuote(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function quoteLabel(quote: { name: string; startLine: number; endLine: number }): string {
  if (quote.startLine > 0 && quote.endLine > quote.startLine) {
    return `${quote.name} · ${quote.startLine}–${quote.endLine}`;
  }
  if (quote.startLine > 0) return `${quote.name} · ${quote.startLine}`;
  return quote.name;
}
