import { APP_HTTP } from "../mav/link";

export type AiStatus = {
  configured: boolean;
  storage: string;
  active: { provider: string; model: string; status: string } | null;
  bench: { until_ms: number; left_s: number } | null;
};

export type Chat = { id: string; title: string; updated_at: number; vehicle_key?: string };
export type Msg = { role: string; body: string; at: number };
export type LiveTurn = { active: boolean; tool?: string; input?: string; thought?: string; reply?: string; note?: string };
export type Proposal = {
  id: string;
  status: string;
  param: string;
  old: number | null;
  new: number;
  reason: string;
  kind?: string;
  payload?: string;
  at?: number;
};
export type AuditEvent = {
  at: number;
  action: string;
  reason: string;
  result: string;
  source: string;
  detail?: string;
};
export type LocalLog = { id: string; bytes: number };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${APP_HTTP}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = (await r.json()) as T & { message?: string };
  if (!r.ok) throw new Error(body.message || `HTTP ${r.status}`);
  return body;
}

export const ai = {
  status: () => json<AiStatus>("/ai/status"),
  chats: () => json<{ chats: Chat[] }>("/ai/chats"),
  create: (vehicle_key = "") => json<Chat>("/ai/chats", { method: "POST", body: JSON.stringify({ vehicle_key }) }),
  rename: (id: string, title: string) =>
    json("/ai/chats/rename", { method: "POST", body: JSON.stringify({ id, title }) }),
  thread: (chat: string) => json<{ messages: Msg[]; proposals: Proposal[] }>(`/ai/messages?chat=${encodeURIComponent(chat)}`),
  live: (chat: string) => json<LiveTurn>(`/ai/live?chat=${encodeURIComponent(chat)}`),
  send: (chat: string, text: string, lang: string, model: string, reasoning: string, log = "", signal?: AbortSignal) =>
    json<{ ok: boolean; status?: string; message?: string; proposal?: Proposal | null }>("/ai/send", {
      method: "POST",
      body: JSON.stringify({ chat, text, lang, model, reasoning, log }),
      signal,
    }),
  stop: () => json("/ai/stop", { method: "POST", body: "{}" }),
  proposal: (id: string, decision: "approve" | "reject", lang: string, model: string, reasoning: string, log = "", batch = "", comment?: string) =>
    json("/ai/proposal", { method: "POST", body: JSON.stringify({ id, decision, lang, model, reasoning, log, batch, ...(comment != null ? { comment } : {}) }) }),
  wizard: (id: string, report: { outcome: string; measures: Record<string, number | string | null> }, lang: string, model: string, reasoning: string, log = "") =>
    json("/ai/wizard", {
      method: "POST",
      body: JSON.stringify({ id, outcome: report.outcome, report, lang, model, reasoning, log }),
    }),
  audit: () => json<{ events: AuditEvent[] }>("/ai/audit"),
  revert: (changes: { name: string; value: number; from: number | null }[]) =>
    json<{ ok: boolean; hold?: boolean; chat?: string; applied?: number; count?: number }>("/ai/revert", {
      method: "POST",
      body: JSON.stringify({ changes }),
    }),
  logs: () => json<{ logs: LocalLog[] }>("/ai/logs"),
  importLog: async (file: Blob) => {
    const r = await fetch(`${APP_HTTP}/logs/import`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    const body = (await r.json()) as { id?: string; error?: string; message?: string };
    if (!r.ok || !body.id) throw new Error(body.error || body.message || "Could not load the log");
    return { id: body.id };
  },
  saveProvider: (provider: string, api_key: string, op: "save" | "check" | "remove" | "disable") =>
    json<AiStatus & { ok?: boolean; status?: string }>("/ai/provider", {
      method: "POST",
      body: JSON.stringify({ provider, api_key, op }),
    }),
  bench: (minutes: number) =>
    json("/ai/bench", {
      method: "POST",
      body: JSON.stringify({ propellers: true, power: true, workspace: true, control: true, minutes }),
    }),
  benchStop: () => json("/ai/bench/stop", { method: "POST", body: "{}" }),
};
