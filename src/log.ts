type Kind = "cmd" | "ok" | "bad" | "dim";
type Handler = (msg: string, kind?: Kind) => void;

let handler: Handler = () => {};

export function setLogHandler(fn: Handler): void {
  handler = fn;
}

export function addLog(msg: string, kind?: Kind): void {
  handler(msg, kind);
}
