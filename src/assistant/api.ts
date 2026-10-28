import type { LuaQuote } from "../luaQuote";
import { APP_HTTP } from "../mav/link";

export type AiAccount = {
  signed_in: boolean;
  email?: string;
  plan?: string;
  used?: number | null;
  limit?: number | null;
  models?: Record<string, string[]>;
};

export type AiStatus = {
  configured: boolean;
  own_key?: boolean;
  storage: string;
  active: { provider: string; model: string; status: string; storage?: string } | null;
  bench: { until_ms: number; left_s: number } | null;
  account?: AiAccount;
};

export type Chat = { id: string; title: string; updated_at: number; vehicle_key?: string };
export type Msg = { role: string; body: string; at: number };
export type SavedDocItem = { id?: string; title: string; format: string; url: string };
export type CloudDoc = { id?: string; title: string; format: string; body: string; shared?: boolean; views?: number; url?: string; updatedAt?: number };
export type LiveTurn = { active: boolean; tool?: string; input?: string; thought?: string; reply?: string; note?: string; holds?: number; docs?: SavedDocItem[]; started_ms?: number; step_ms?: number };
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
export type LocalLog = {
  id: string;
  bytes: number;
  saved_at?: string | null;
  flight_utc?: string | null;
  board?: string | null;
  vehicle?: string;
  original_name?: string;
};

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
  send: (chat: string, text: string, lang: string, model: string, reasoning: string, log = "", script: LuaQuote | null = null, signal?: AbortSignal, images: string[] = []) =>
    json<{ ok: boolean; status?: string; message?: string; proposal?: Proposal | null }>("/ai/send", {
      method: "POST",
      body: JSON.stringify({ chat, text, lang, model, reasoning, log, ...(script ? { script } : {}), ...(images.length ? { images } : {}) }),
      signal,
    }),
  /** Store one image on the bridge. The id goes into `send`. */
  uploadImage: async (image: Blob) => {
    const r = await fetch(`${APP_HTTP}/ai/image`, { method: "POST", headers: { "Content-Type": image.type }, body: image });
    const body = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!r.ok || !body.id) throw new Error(body.error || "Could not add the image");
    return body.id;
  },
  imageUrl: (id: string) => `${APP_HTTP}/ai/image?id=${encodeURIComponent(id)}`,
  stop: () => json("/ai/stop", { method: "POST", body: "{}" }),
  proposal: (id: string, decision: "approve" | "reject", lang: string, model: string, reasoning: string, log = "", batch = "", comment?: string) =>
    json<{ ok: boolean; status?: string; continued?: boolean }>("/ai/proposal", { method: "POST", body: JSON.stringify({ id, decision, lang, model, reasoning, log, batch, ...(comment != null ? { comment } : {}) }) }),
  wizard: (id: string, report: { outcome: string; measures: Record<string, number | string | null> }, lang: string, model: string, reasoning: string, log = "") =>
    json<{ ok: boolean; status?: string; continued?: boolean }>("/ai/wizard", {
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
  /** XHR, because fetch does not report upload progress. `sent` reaches `total` before the bridge checks the file. */
  importLog: (file: File, onProgress?: (sent: number, total: number) => void) =>
    new Promise<{ id: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${APP_HTTP}/logs/import?name=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (ev) => onProgress?.(ev.loaded, ev.lengthComputable ? ev.total : file.size);
      xhr.upload.onload = () => onProgress?.(file.size, file.size);
      xhr.onerror = () => reject(new Error("Could not load the log"));
      xhr.onload = () => {
        let body: { id?: string; error?: string; message?: string } = {};
        try {
          body = JSON.parse(xhr.responseText) as typeof body;
        } catch {
          // The message below covers a reply that is not JSON.
        }
        if (xhr.status < 200 || xhr.status >= 300 || !body.id) {
          reject(new Error(body.error || body.message || "Could not load the log"));
          return;
        }
        resolve({ id: body.id });
      };
      xhr.send(file);
    }),
  saveProvider: (provider: string, api_key: string, op: "save" | "check" | "remove" | "disable" | "hosted") =>
    json<AiStatus & { ok?: boolean; status?: string }>("/ai/provider", {
      method: "POST",
      body: JSON.stringify({ provider, api_key, op }),
    }),
  loginUrl: () => json<{ url: string }>("/ai/login", { method: "POST", body: "{}" }),
  cabinet: () => json<{ url: string }>("/ai/cabinet", { method: "POST", body: "{}" }),
  logout: () => json<AiStatus>("/ai/logout", { method: "POST", body: "{}" }),
  checkout: (plan: "start" | "plus") => json<{ url: string }>("/ai/checkout", { method: "POST", body: JSON.stringify({ plan }) }),
  portal: () => json<{ url: string }>("/ai/portal", { method: "POST", body: "{}" }),
  doc: (doc: { id?: string; url?: string }) => json<CloudDoc>("/ai/doc", { method: "POST", body: JSON.stringify(doc) }),
  shareDoc: (doc: { id?: string; url?: string }) => json<{ id: string; shared: boolean; views?: number; url?: string }>("/ai/doc/share", { method: "POST", body: JSON.stringify(doc) }),
  unshareDoc: (doc: { id?: string; url?: string }) => json<{ id: string; shared: boolean; views?: number }>("/ai/doc/unshare", { method: "POST", body: JSON.stringify(doc) }),
  bench: (minutes: number) =>
    json("/ai/bench", {
      method: "POST",
      body: JSON.stringify({ propellers: true, power: true, workspace: true, control: true, minutes }),
    }),
  benchStop: () => json("/ai/bench/stop", { method: "POST", body: "{}" }),
};
