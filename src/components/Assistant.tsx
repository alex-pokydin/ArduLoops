import { lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { ai, type AiStatus, type Chat, type LiveTurn, type LocalLog, type Msg, type Proposal } from "../assistant/api";
import { Disconnected } from "./Disconnected";
import { WizardHost, type WizardAsk } from "./WizardHost";
import type { WizardClose } from "../wizards/close";
import { ChartStrip, chartsFromTools } from "./FindingCharts";
import { LiveView, liveSpecFromTools, type LiveSpec } from "./LivePlots";
import { getLang, useT } from "../i18n/i18n";
import { getLuaQuote, quoteLabel, setLuaQuote, subscribeLuaQuote } from "../luaQuote";
import { subscribe } from "../mav/store";
import { useVehicle, viewSample } from "../mav/view";
import type { Sample } from "../mav/types";

const LuaSource = lazy(() => import("./LuaSource").then((mod) => ({ default: mod.LuaSource })));

function hostedQuota(status: AiStatus | null): { left: number; limit: number } | null {
  const account = status?.account;
  if (!account?.signed_in || status?.active?.storage !== "hosted") return null;
  if (account.limit == null || account.used == null) return null;
  return { left: Math.max(0, account.limit - account.used), limit: account.limit };
}

function sameDrone(chatKey: string | undefined, sample: { boot_uid?: string; board_name?: string; frame?: string }): boolean {
  const key = chatKey?.trim() ?? "";
  if (!key) return false;
  const uid = sample.boot_uid?.trim() ?? "";
  const board = sample.board_name?.trim() ?? "";
  if (uid && key === uid) return true;
  if (board && (key === board || key === `board:${board}`)) return true;
  if (!uid && !board && sample.frame && key === `frame:${sample.frame}`) return true;
  return false;
}

type LinkFace = {
  ok: boolean;
  frame: string;
  mode: string;
  armed: boolean;
  boot_uid: string;
  board_name: string;
  log_download?: Sample["log_download"];
};

let linkFaceCache: LinkFace = { ok: false, frame: "", mode: "", armed: false, boot_uid: "", board_name: "" };
let linkFaceVehicle = "";

function sameLive(a: LiveTurn | null, b: LiveTurn | null): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.active === b.active && a.tool === b.tool && a.input === b.input && a.thought === b.thought && a.reply === b.reply && a.note === b.note;
}

function sameFlow(a?: Sample["log_download"], b?: Sample["log_download"]): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.id === b.id && a.size === b.size && a.received === b.received && a.complete === b.complete && a.path === b.path && a.error === b.error;
}

function linkFace(vehicle: "copter" | "plane"): LinkFace {
  const sample = viewSample(vehicle);
  const frame = sample.frame || "";
  const mode = sample.mode || "";
  const boot_uid = sample.boot_uid || "";
  const board_name = sample.board_name || "";
  const armed = !!sample.armed;
  if (
    linkFaceVehicle === vehicle
    && linkFaceCache.ok === sample.ok
    && linkFaceCache.frame === frame
    && linkFaceCache.mode === mode
    && linkFaceCache.armed === armed
    && linkFaceCache.boot_uid === boot_uid
    && linkFaceCache.board_name === board_name
    && sameFlow(linkFaceCache.log_download, sample.log_download)
  ) {
    return linkFaceCache;
  }
  linkFaceVehicle = vehicle;
  linkFaceCache = { ok: sample.ok, frame, mode, armed, boot_uid, board_name, log_download: sample.log_download };
  return linkFaceCache;
}

function useLinkFace(): LinkFace {
  const vehicle = useVehicle();
  return useSyncExternalStore(subscribe, () => linkFace(vehicle), () => linkFace(vehicle));
}

function vehicleKey(sample: { boot_uid?: string; board_name?: string; frame?: string }): string {
  const uid = sample.boot_uid?.trim() ?? "";
  if (uid) return uid;
  const board = sample.board_name?.trim() ?? "";
  if (board) return `board:${board}`;
  if (sample.frame) return `frame:${sample.frame}`;
  return "";
}

function wizardTitle(tr: typeof import("../i18n/i18n").t, name: string): string {
  if (name === "accel") return tr("Accelerometer wizard");
  if (name === "compass") return tr("Compass offset wizard");
  if (name === "compass_mot") return tr("Motor current wizard");
  if (name === "motors") return tr("Motor setup wizard");
  if (name === "radio") return tr("Radio setup");
  if (name === "modes") return tr("Flight modes");
  if (name === "battery") return tr("Battery setup");
  return name;
}

function payloadTitle(item: Proposal): string {
  const raw = item.payload?.trim() ?? "";
  if (!raw.startsWith("{")) return "";
  try {
    const value = JSON.parse(raw) as { title?: unknown };
    return typeof value.title === "string" ? value.title.trim() : "";
  } catch {
    return "";
  }
}

function scriptPayload(item: Proposal): { op: string; body: string } {
  const raw = item.payload?.trim() ?? "";
  if (!raw.startsWith("{")) return { op: "", body: "" };
  try {
    const value = JSON.parse(raw) as { op?: unknown; body?: unknown };
    return {
      op: typeof value.op === "string" ? value.op : "",
      body: typeof value.body === "string" ? value.body : "",
    };
  } catch {
    return { op: "", body: "" };
  }
}

function proposalTitle(tr: typeof import("../i18n/i18n").t, p: Proposal): string {
  if (p.kind === "script") {
    const op = scriptPayload(p).op;
    if (op === "delete") return tr("Delete {name}", { name: p.param });
    if (op === "restart") return tr("Reload Lua scripting");
    return tr("Write {name}", { name: p.param });
  }
  if (p.kind === "wizard") return payloadTitle(p) || wizardTitle(tr, p.param);
  if (p.kind === "mode") return `${tr("Flight mode")} ${p.param}`;
  if (p.kind === "arm") return tr("Arm");
  if (p.kind === "disarm") return tr("Disarm");
  if (p.kind === "reboot") return tr("Reboot");
  if (p.kind === "connect") return tr("Connect");
  if (p.kind === "disconnect") return tr("Disconnect");
  if (p.kind === "erase_logs") return tr("Erase on-board logs");
  if (p.kind === "flash") return tr("Flash firmware");
  if (p.kind === "comment") return tr(p.param);
  return p.param;
}

function waitTitle(tr: typeof import("../i18n/i18n").t, p: Proposal): string {
  if (p.kind === "connect") return tr("Connecting");
  if (p.kind === "disconnect") return tr("Disconnecting");
  if (p.kind === "reboot") return tr("Rebooting");
  return proposalTitle(tr, p);
}

function sameAddition(group: Proposal[], item: Proposal): boolean {
  const kind = item.kind || "param";
  if (kind === "wizard" || kind === "comment" || (group[0].kind || "param") === "wizard" || (group[0].kind || "param") === "comment") return false;
  if (kind === (group[0].kind || "param") && item.at != null && item.at === group[0].at) return true;
  return group.some((have) => changeKey(have) === changeKey(item));
}

function splitAdditions(items: Proposal[]): Proposal[][] {
  const groups: Proposal[][] = [];
  for (const item of items) {
    const prev = groups[groups.length - 1];
    if (prev && sameAddition(prev, item)) prev.push(item);
    else groups.push([item]);
  }
  return groups;
}

function changeKey(item: Proposal): string {
  return [item.kind || "param", item.param, item.payload ?? "", String(item.old), String(item.new)].join("\0");
}

function uniqueChanges(items: Proposal[]): Proposal[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = changeKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cardKind(items: Proposal[]): string {
  const kinds = new Set(items.map((item) => item.kind || "param"));
  return kinds.size === 1 ? [...kinds][0] : "mixed";
}

function cardTitle(tr: typeof import("../i18n/i18n").t, items: Proposal[]): string {
  const live = items.find((item) => item.status === "waiting");
  if (items.length === 1) return live ? waitTitle(tr, items[0]) : proposalTitle(tr, items[0]);
  if (cardKind(items) !== "param" && cardKind(items) !== "mixed") return proposalTitle(tr, items[0]);
  return tr("Suggested changes");
}

function cardOutcome(tr: typeof import("../i18n/i18n").t, items: Proposal[]): string | null {
  if (items.some((item) => item.status === "pending" || item.status === "waiting")) return null;
  const statuses = new Set(items.map((item) => item.status));
  if (statuses.size === 1 && statuses.has("applied")) return tr("Applied");
  if (statuses.size === 1 && statuses.has("completed")) return tr("Finished");
  if (statuses.size === 1 && statuses.has("cancelled")) return tr("Cancelled");
  if (statuses.size === 1 && statuses.has("rejected_by_user")) return tr("Rejected");
  if (statuses.size === 1 && statuses.has("failed")) return tr("Failed");
  return null;
}

function fmt(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

function commentText(item: Proposal | undefined): string {
  const raw = item?.payload?.trim() ?? "";
  if (!raw.startsWith("{")) return "";
  try {
    const value = JSON.parse(raw) as { comment?: unknown };
    return typeof value.comment === "string" ? value.comment : "";
  } catch {
    return "";
  }
}

function changeLine(tr: typeof import("../i18n/i18n").t, item: Proposal): string {
  if (item.kind === "script") {
    const script = scriptPayload(item);
    if (script.op === "delete") return tr("Delete {name}", { name: item.param });
    if (script.op === "restart") return tr("Reload Lua scripting");
    return tr("Write {name} · {bytes} B", { name: item.param, bytes: script.body.length });
  }
  if (!item.kind || item.kind === "param") return `${item.param} = ${fmt(item.new)} (${tr("was {value}", { value: fmt(item.old) })})`;
  if (item.kind === "mode") return item.param;
  const payload = item.payload?.trim() ?? "";
  if (payload && !payload.startsWith("{")) return payload;
  if (payload.startsWith("{")) {
    try {
      const value = JSON.parse(payload) as { url?: unknown; artifact_id?: unknown };
      if (typeof value.url === "string" && value.url) return value.url;
      if (typeof value.artifact_id === "string" && value.artifact_id) return value.artifact_id;
    } catch {
      /* the title is enough */
    }
  }
  return proposalTitle(tr, item);
}

function ProposalIcon({ kind }: { kind: string }) {
  const common = { viewBox: "0 0 16 16", width: 16, height: 16, "aria-hidden": true as const };
  if (kind === "connect") {
    return <svg {...common}><path d="M6 2.4v3.2M10 2.4v3.2M4.8 5.6h6.4v2.1a3.2 3.2 0 0 1-6.4 0zM8 11v2.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (kind === "disconnect") {
    return <svg {...common}><path d="M6 2.2v2.6M10 2.2v2.6M4.8 4.8h6.4v1.8a3.2 3.2 0 0 1-1.6 2.8M8 10.2V13M3.2 12.2l9.6-6.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (kind === "reboot") {
    return <svg {...common}><path d="M12.6 6.2A4.6 4.6 0 1 1 11.4 3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><path d="M11.2 1.8v2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (kind === "arm") {
    return <svg {...common}><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /></svg>;
  }
  if (kind === "disarm") {
    return <svg {...common}><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>;
  }
  if (kind === "mode") {
    return <svg {...common}><path d="M8 2.2 10.4 10.2 8 8.6 5.6 10.2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
  }
  if (kind === "erase_logs") {
    return <svg {...common}><path d="M4 4.2h8M6.2 4.2V3h3.6v1.2M5.2 6v6.2h5.6V6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (kind === "flash") {
    return <svg {...common}><path d="M9 1.8 4.2 8.6h3.2L6.6 14.2 12 7H8.6z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
  }
  if (kind === "wizard") {
    return <svg {...common}><rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5 8h6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
  }
  if (kind === "script") {
    return <svg {...common}><path d="M5.2 4.2 2.4 8l2.8 3.8M10.8 4.2 13.6 8l-2.8 3.8M9 3.2 7 12.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (kind === "comment") {
    return <svg {...common}><rect x="2.4" y="2.2" width="11.2" height="11.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M4.6 5.4h6.8M4.6 8h6.8M4.6 10.6h4.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>;
  }
  return <svg {...common}><path d="M3 4.4h10M3 8h10M3 11.6h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="6" cy="4.4" r="1.2" fill="currentColor" /><circle cx="10.2" cy="8" r="1.2" fill="currentColor" /><circle cx="7.2" cy="11.6" r="1.2" fill="currentColor" /></svg>;
}

function ProposalCard({
  t, items, busy, onDecision, onCancelWait, onOpenWizard, wizardOpenId,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  items: Proposal[];
  busy: boolean;
  onDecision: (decision: "approve" | "reject", ids?: string[], comment?: string) => void;
  onCancelWait: (id: string) => void;
  onOpenWizard: (id: string, wizard: string) => void;
  wizardOpenId: string;
}) {
  const [more, setMore] = useState(false);
  const shown = uniqueChanges(items);
  const pending = items.filter((item) => item.status === "pending");
  const waiting = items.filter((item) => item.status === "waiting");
  const outcome = cardOutcome(t, items);
  const kind = cardKind(items);
  const wizardNote = kind === "wizard" ? shown[0]?.reason.trim() ?? "" : "";
  const comment = kind === "comment";
  const [draft, setDraft] = useState(() => commentText(shown[0]));
  const expandable = kind === "script" || (!wizardNote && !comment && (shown.length > 1 || shown.some((item) => item.reason.trim().length > 0)));
  const ids = uniqueChanges(pending).map((item) => item.id);
  return (
    <article className={`proposal${waiting.length && !pending.length ? " wait" : ""}${outcome ? " done" : ""}`}>
      <header className="proposal-head">
        <span className="proposal-icon"><ProposalIcon kind={kind} /></span>
        <b>{cardTitle(t, shown)}</b>
        <div className="proposal-actions">
          {pending.length ? (
            kind === "wizard" ? (
              <>
                <button type="button" disabled={busy} onClick={() => onDecision("reject", ids)}>{t("Cancel")}</button>
                <button
                  type="button"
                  className="cyan"
                  disabled={busy || (wizardOpenId !== "" && wizardOpenId !== pending[0].id)}
                  onClick={() => onOpenWizard(pending[0].id, pending[0].param)}
                >
                  {wizardOpenId === pending[0].id ? t("Wizard is open") : t("Open wizard")}
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => onDecision("reject", ids)}>{t("Reject")}</button>
                <button type="button" className="cyan" disabled={busy} onClick={() => onDecision("approve", ids, comment ? draft : undefined)}>{comment ? t("Save comment") : t("Approve")}</button>
              </>
            )
          ) : waiting.length ? (
            <button type="button" onClick={() => onCancelWait(waiting[0].id)}>{t("Reject")}</button>
          ) : outcome ? <span className="proposal-status">{outcome}</span> : null}
        </div>
      </header>
      {comment ? (
        pending.length ? (
          <textarea className="proposal-comment" value={draft} maxLength={2000} aria-label={t("Comment")} onChange={(ev) => setDraft(ev.target.value)} />
        ) : (
          <p className="proposal-note">{commentText(shown[0])}</p>
        )
      ) : wizardNote ? <p className="proposal-note">{wizardNote}</p> : more ? (
        <ul className="proposal-list">
          {shown.map((item) => (
            <li key={item.id}>
              <p className="delta">
                {!item.kind || item.kind === "param" ? (
                  <>
                    <b>{item.param}</b>
                    {` = ${fmt(item.new)}`}
                    <span className="was">({t("was {value}", { value: fmt(item.old) })})</span>
                  </>
                ) : <b>{changeLine(t, item)}</b>}
              </p>
              {item.reason ? <p className="reason">{item.reason === "Restore the audited value" ? t(item.reason) : item.reason}</p> : null}
              {item.kind === "script" && scriptPayload(item).op === "write" && scriptPayload(item).body ? (
                <Suspense fallback={null}>
                  <LuaSource value={scriptPayload(item).body} />
                </Suspense>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="proposal-fold">{changeLine(t, shown[0])}{shown.length > 1 ? `  +${shown.length - 1}` : ""}</p>}
      {expandable ? <button type="button" className="proposal-more" onClick={() => setMore((open) => !open)}>{more ? t("less") : t("more…")}</button> : null}
    </article>
  );
}

const EMPTY_CHECKS = { propellers: false, power: false, workspace: false, control: false };

const MODELS: Record<string, string[]> = {
  gemini: ["gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-3.5-flash-lite"],
  openai: ["gpt-6-sol", "gpt-6-luna", "gpt-6-astra"],
  anthropic: ["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5"],
  xai: ["grok-4.7", "grok-4.6", "grok-4.3"],
};

export function Assistant({
  home,
  onOpenOptions,
  onOpenHome,
}: {
  home: boolean;
  onOpenOptions: () => void;
  onOpenHome: () => void;
}) {
  const t = useT();
  const vehicle = useLinkFace();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [wizardAsk, setWizardAsk] = useState<WizardAsk | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [followUser, setFollowUser] = useState(false);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [note, setNote] = useState("");
  const [model, setModel] = useState("");
  const [benchOpen, setBenchOpen] = useState(false);
  const [checks, setChecks] = useState(EMPTY_CHECKS);
  const [minutes, setMinutes] = useState(10);
  const [reasoning, setReasoning] = useState("");
  const [query, setQuery] = useState("");
  const [logs, setLogs] = useState<LocalLog[]>([]);
  const [logId, setLogId] = useState("");
  const [pos, setPos] = useState(() => placeFloat(true));
  const drag = useRef<{ dx: number; dy: number; w: number; h: number } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const sendAbort = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const pulled = useRef("");
  const proposalWatch = useRef(0);
  const proposalJson = useRef("");
  const threadGen = useRef(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  function openThread() {
    threadGen.current += 1;
    return threadGen.current;
  }
  function adoptThread(gen: number, thread: { messages: Msg[]; proposals: Proposal[] }) {
    if (gen !== threadGen.current) return false;
    messagesRef.current = thread.messages;
    proposalJson.current = JSON.stringify(thread.proposals);
    setMessages(thread.messages);
    setProposals(thread.proposals);
    return true;
  }
  function releaseLive() {
    setLive((prev) => {
      const reply = prev?.reply ?? "";
      if (reply.trim() && !replyLanded(messagesRef.current, reply)) return prev;
      return null;
    });
    if (!sending.current) setBusy(false);
  }
  const narrow = useNarrow();

  async function refreshStatus() {
    try {
      const s = await ai.status();
      setStatus(s);
      if (!model && s.active?.model) setModel(s.active.model);
      setNote((current) => (current === "Failed to fetch" ? "" : current));
    } catch {
      setStatus(null);
    }
  }

  async function refreshChats(selectNew = false) {
    const list = await ai.chats();
    setChats(list.chats);
    const id = selectNew || !chatId ? list.chats[0]?.id || "" : chatId;
    if (!id && list.chats.length === 0) return;
    if (id && id !== chatId) setChatId(id);
    if (id) {
      const gen = openThread();
      const thread = await ai.thread(id);
      adoptThread(gen, thread);
    }
  }

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 4000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!status?.configured) return;
    void refreshChats().catch(() => {});
    void ai.logs().then((r) => setLogs(r.logs)).catch(() => setLogs([]));
  }, [status?.configured]);

  useEffect(() => {
    if (!chatId) return;
    const gen = openThread();
    let stop = false;
    void ai.thread(chatId).then((thread) => {
      if (stop) return;
      adoptThread(gen, thread);
    }).catch(() => {});
    return () => { stop = true; };
  }, [chatId]);

  useEffect(() => {
    if (!chatId || !status?.configured) return;
    let stop = false;
    let wasLive = false;
    let settling = false;
    const tick = () => {
      void ai.live(chatId).then((row) => {
        if (stop) return;
        if (row.active) {
          wasLive = true;
          settling = false;
          setBusy(true);
          setLive((prev) => (sameLive(prev, row) ? prev : row));
          const mark = `${row.tool ?? ""}\n${row.input ?? ""}\n${row.note ?? ""}`;
          if (pulled.current !== mark) {
            pulled.current = mark;
            const gen = openThread();
            void ai.thread(chatId).then((thread) => {
              if (stop) return;
              adoptThread(gen, thread);
            }).catch(() => {});
          }
          return;
        }
        if (settling) return;
        if (wasLive) {
          wasLive = false;
          settling = true;
          const gen = openThread();
          void ai.thread(chatId).then((thread) => {
            if (stop) return;
            if (adoptThread(gen, thread)) releaseLive();
            else wasLive = true;
          }).catch(() => {
            if (stop) return;
            wasLive = true;
          }).finally(() => {
            settling = false;
          });
          return;
        }
        releaseLive();
        const now = Date.now();
        if (now - proposalWatch.current > 2000) {
          proposalWatch.current = now;
          const gen = threadGen.current;
          void ai.thread(chatId).then((thread) => {
            if (stop || gen !== threadGen.current) return;
            const next = JSON.stringify(thread.proposals);
            if (next === proposalJson.current) return;
            proposalJson.current = next;
            setProposals(thread.proposals);
          }).catch(() => {});
        }
      }).catch(() => {});
    };
    pulled.current = "";
    tick();
    const timer = window.setInterval(tick, 400);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [chatId, status?.configured]);

  async function onSend(ev?: FormEvent, preset?: string) {
    ev?.preventDefault();
    const text = (preset ?? draft).trim();
    if (!text) return;
    const attached = logId;
    const quoted = preset ? null : getLuaQuote();
    if (busy) {
      if (!chatId) return;
      setDraft("");
      setLogId("");
      setLuaQuote(null);
      try {
        const res = await ai.send(chatId, text, getLang(), model, reasoning, attached, quoted);
        if (!res.ok) setNote(res.status || "network unavailable");
        const gen = openThread();
        const thread = await ai.thread(chatId);
        adoptThread(gen, thread);
      } catch (err) {
        setDraft(text);
        setLogId(attached);
        if (quoted) setLuaQuote(quoted);
        setNote(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "This turn stopped before a reply.");
        const gen = openThread();
        const thread = await ai.thread(chatId).catch(() => null);
        if (thread) adoptThread(gen, thread);
      }
      return;
    }
    setFollowUser(true);
    setBusy(true);
    setNote("");
    setDraft("");
    setLogId("");
    setLuaQuote(null);
    const ctrl = new AbortController();
    sendAbort.current = ctrl;
    sending.current = true;
    let id = chatId;
    try {
      if (!id) {
        const created = await ai.create(droneKey);
        id = created.id;
        setChatId(id);
      }
      const res = await ai.send(id, text, getLang(), model, reasoning, attached, quoted, ctrl.signal);
      if (!res.ok) setNote(res.status || "network unavailable");
      const gen = openThread();
      const thread = await ai.thread(id);
      adoptThread(gen, thread);
      const list = await ai.chats();
      setChats(list.chats);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (!preset) setDraft(text);
      setLogId(attached);
      if (quoted) setLuaQuote(quoted);
      setNote(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "This turn stopped before a reply.");
      if (id) {
        const gen = openThread();
        const thread = await ai.thread(id).catch(() => null);
        if (thread) adoptThread(gen, thread);
      }
    } finally {
      sending.current = false;
      if (sendAbort.current === ctrl) sendAbort.current = null;
      if (!ctrl.signal.aborted) setBusy(false);
      void refreshStatus();
    }
  }

  function stopTurn() {
    sendAbort.current?.abort();
    void ai.stop();
  }

  async function onDecision(decision: "approve" | "reject", ids?: string[], comment?: string) {
    const pending = proposals.filter((p) => p.status === "pending" && (!ids || ids.includes(p.id)));
    if (!pending.length) return;
    setNote("");
    setFollowUser(false);
    setBusy(true);
    try {
      const batch = pending.length > 1 ? crypto.randomUUID() : "";
      for (const item of pending) {
        await ai.proposal(item.id, decision, getLang(), model, reasoning, logId, batch, decision === "approve" ? comment : undefined);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : t("Could not apply the change"));
    } finally {
      if (chatId) {
        try {
          const gen = openThread();
          const thread = await ai.thread(chatId);
          adoptThread(gen, thread);
        } catch {
          /* the decision error stays on screen */
        }
      }
      setBusy(false);
    }
  }

  async function onCancelWait(id: string) {
    setNote("");
    try {
      await ai.proposal(id, "reject", getLang(), model, reasoning, logId);
    } catch (err) {
      setNote(err instanceof Error ? err.message : t("Could not apply the change"));
    }
    if (chatId) {
      try {
        const gen = openThread();
        const thread = await ai.thread(chatId);
        if (gen === threadGen.current) setProposals(thread.proposals);
      } catch {
        /* the decision error stays on screen */
      }
    }
  }

  function onDragStart(ev: ReactPointerEvent) {
    if (narrow) return;
    if ((ev.target as HTMLElement).closest("button")) return;
    const frame = panel.current?.getBoundingClientRect();
    if (!frame) return;
    drag.current = { dx: ev.clientX - frame.left, dy: ev.clientY - frame.top, w: frame.width, h: frame.height };
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  }
  function onDrag(ev: ReactPointerEvent) {
    const hold = drag.current;
    if (!hold) return;
    setPos(clampFloat(ev.clientX - hold.dx, ev.clientY - hold.dy, hold.w, hold.h));
  }
  function onDragEnd() {
    drag.current = null;
  }
  function openBench() {
    setChecks({ ...EMPTY_CHECKS });
    setBenchOpen(true);
  }

  function closeBench() {
    setChecks({ ...EMPTY_CHECKS });
    setBenchOpen(false);
  }

  useEffect(() => {
    if (!benchOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      setChecks({ ...EMPTY_CHECKS });
      setBenchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [benchOpen]);

  useEffect(() => {
    if (!status?.bench) return;
    const onKey = (ev: KeyboardEvent) => {
      const typing = ev.target instanceof HTMLElement && (ev.target.tagName === "TEXTAREA" || ev.target.tagName === "INPUT");
      if (typing) return;
      if (ev.altKey && ev.shiftKey && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        void ai.benchStop().then(() => refreshStatus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status?.bench]);

  const configured = !!status?.configured;
  const provider = status?.active?.provider || "";
  const models = (status?.account?.signed_in && status.active?.storage === "hosted" && status.account.models?.[provider])
    ? (status.account.models[provider] || [])
    : (MODELS[provider] || []);
  useEffect(() => {
    const node = panel.current;
    if (!node) return;
    if (narrow) {
      node.style.width = "";
      node.style.height = "";
      return;
    }
    const frame = node.getBoundingClientRect();
    setPos((p) => clampFloat(p.x, p.y, frame.width, frame.height));
  }, [configured, open, narrow]);

  const droneKey = vehicleKey(vehicle);
  const thinking = busy;
  const needs = proposals.some((p) => p.status === "pending");
  const showFloat = open && !(home && configured);
  const linkLine = configured
    ? `${provider.toUpperCase()} · ${vehicle.ok ? `${vehicle.frame || "—"} ${vehicle.mode} ${vehicle.armed ? "ARMED" : "DISARMED"}` : t("Disconnected")}`
    : t("Not configured");

  function takeLog(id: string) {
    setLogId(id);
    void ai.logs().then((r) => setLogs(r.logs)).catch(() => {});
  }

  useEffect(() => {
    if (!wizardAsk) return;
    const item = proposals.find((proposal) => proposal.id === wizardAsk.id);
    if (!item || item.status !== "pending") setWizardAsk(null);
  }, [proposals, wizardAsk]);

  async function onWizardDone(id: string, report: WizardClose) {
    setWizardAsk(null);
    setBusy(true);
    setNote("");
    try {
      await ai.wizard(id, report, getLang(), model, reasoning, logId);
    } catch (err) {
      setNote(err instanceof Error ? err.message : t("Could not apply the change"));
    } finally {
      if (chatId) {
        try {
          const gen = openThread();
          const thread = await ai.thread(chatId);
          adoptThread(gen, thread);
        } catch {
          /* the decision error stays on screen */
        }
      }
      setBusy(false);
    }
  }

  return (
    <>
      {wizardAsk ? <WizardHost ask={wizardAsk} onDone={(id, report) => void onWizardDone(id, report)} /> : null}
      {home && !configured ? <Disconnected /> : null}
      {home && configured ? (
        <main className="agent-home">
          <ChatPane
            t={t}
            chats={chats}
            chatId={chatId}
            messages={messages}
            proposals={proposals}
            draft={draft}
            busy={busy}
            followUser={followUser}
            note={note}
            model={model}
            models={models}
            bench={status?.bench || null}
            quota={hostedQuota(status)}
            onPick={setChatId}
            onDraft={setDraft}
            onModel={setModel}
            onSend={(preset) => void onSend(undefined, preset)}
            onDecision={onDecision}
            onCancelWait={onCancelWait}
            onOpenWizard={(id, wizard) => setWizardAsk({ id, wizard })}
            wizardOpenId={wizardAsk?.id ?? ""}
            onNew={() => { threadGen.current += 1; setChatId(""); setMessages([]); setProposals([]); }}
            onBench={openBench}
            onStop={() => void ai.benchStop().then(() => refreshStatus())}
            query={query}
            onQuery={setQuery}
            reasoning={reasoning}
            live={live}
            onReasoning={setReasoning}
            provider={provider}
            onRename={(id, title) => void ai.rename(id, title).then(() => refreshChats())}
            onCancel={stopTurn}
            logs={logs}
            logId={logId}
            onLog={setLogId}
            onImported={takeLog}
            onContinue={() => setDraft(t("Continue the investigation with a new tool budget."))}
            drone={vehicle}
            flow={vehicle.log_download}
          />
        </main>
      ) : null}
      {open || (home && configured) ? null : (
      <button
        type="button"
        className={`ai-fab${needs ? " needs" : ""}${thinking ? " busy" : ""}${status?.bench ? " bench" : ""}`}
        aria-label={t("Assistant")}
        title={t("Assistant")}
        onClick={() => setOpen(true)}
        onPointerEnter={(event) => rampMoteSpeed(event.currentTarget, 1.85)}
        onPointerLeave={(event) => rampMoteSpeed(event.currentTarget, 1)}
      >
        <span className="ai-mote" />
        <span className="ai-mote b" />
        <span className="ai-mote c" />
        <span className="ai-mote d" />
        <span className="ai-mote e" />
        <span className="ai-mote f" />
        <span className="ai-mote g" />
        <span className="ai-mote h" />
        <Sparkle />
      </button>
      )}
      {showFloat ? (
        <section
          ref={panel}
          className={`ai-float${narrow ? " sheet" : ""}${configured ? "" : " setup"}`}
          style={narrow ? undefined : { left: pos.x, top: pos.y }}
          role="dialog"
          aria-label={t("Assistant")}
        >
          <header
            className="ai-float-head"
            onPointerDown={onDragStart}
            onPointerMove={onDrag}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            {configured ? (
              <button
                type="button"
                className="ai-x"
                aria-label={t("New chat")}
                title={t("New chat")}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={() => { threadGen.current += 1; setChatId(""); setMessages([]); setProposals([]); }}
              >
                <NewChatIcon />
              </button>
            ) : null}
            <strong>{t("Assistant")}</strong>
            <span title={linkLine}>{linkLine}</span>
            {configured ? (
              <button
                type="button"
                className="ai-x"
                aria-label={t("Open the assistant")}
                title={t("Open the assistant")}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={() => { setOpen(false); onOpenHome(); }}
              >
                <OpenPageIcon />
              </button>
            ) : null}
            <button
              type="button"
              className="ai-x"
              aria-label={t("Close")}
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={() => setOpen(false)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3.2 3.2 12.8 12.8M12.8 3.2 3.2 12.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          {configured ? (
            <ChatPane
              t={t}
              chats={chats}
              chatId={chatId}
              messages={messages}
              proposals={proposals}
              draft={draft}
              busy={busy}
              followUser={followUser}
              note={note}
              model={model}
              models={models}
              bench={status?.bench || null}
              quota={hostedQuota(status)}
              compact
              onPick={setChatId}
              onDraft={setDraft}
              onModel={setModel}
              onSend={(preset) => void onSend(undefined, preset)}
              onDecision={onDecision}
              onCancelWait={onCancelWait}
              onOpenWizard={(id, wizard) => setWizardAsk({ id, wizard })}
              wizardOpenId={wizardAsk?.id ?? ""}
              onNew={() => { threadGen.current += 1; setChatId(""); setMessages([]); setProposals([]); }}
              onBench={openBench}
              onStop={() => void ai.benchStop().then(() => refreshStatus())}
              query={query}
              onQuery={setQuery}
              reasoning={reasoning}
              live={live}
              onReasoning={setReasoning}
              provider={provider}
              onRename={(id, title) => void ai.rename(id, title).then(() => refreshChats())}
              onCancel={stopTurn}
            logs={logs}
            logId={logId}
            onLog={setLogId}
            onImported={takeLog}
            onContinue={() => setDraft(t("Continue the investigation with a new tool budget."))}
            drone={vehicle}
            flow={vehicle.log_download}
            />
          ) : (
            <div className="ai-setup">
              <Sparkle />
              <p>{t("Sign in from Options to start the assistant. Your own key still works.")}</p>
              <button type="button" className="cyan" onClick={onOpenOptions}>{t("Options")}</button>
            </div>
          )}
        </section>
      ) : null}
      {benchOpen ? (
        <div className="modal-back" onClick={closeBench} role="presentation">
          <form
            className="modal ai-bench"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bench-title"
            onClick={(ev) => ev.stopPropagation()}
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!checks.propellers || !checks.power || !checks.workspace || !checks.control) return;
              void ai.bench(minutes).then(() => { closeBench(); void refreshStatus(); }).catch((err: Error) => setNote(err.message));
            }}
          >
            <div className="modal-head">
              <h2 id="bench-title">{t("Safe mode")}</h2>
              <button type="button" className="modal-x" onClick={closeBench} aria-label={t("Close")} title={t("Close")}>×</button>
            </div>
            <p>{t("While safe mode is on, the assistant starts changes on the connected vehicle without asking first: any parameter, flight mode, arming, reboot, connect, disconnect, on-board log erase, and firmware flash. Reboot, connect, and disconnect still show a wait you can reject. While safe mode is off, each change waits for your approval before it starts. Reading the vehicle does not need this mode. This is not a flight test.")}</p>
            <label><input type="checkbox" checked={checks.propellers} onChange={(ev) => setChecks({ ...checks, propellers: ev.target.checked })} /> {t("The propellers are off every motor")}</label>
            <label><input type="checkbox" checked={checks.power} onChange={(ev) => setChecks({ ...checks, power: ev.target.checked })} /> {t("I checked the power myself. No voltage on screen does not mean the ESCs are off.")}</label>
            <label><input type="checkbox" checked={checks.workspace} onChange={(ev) => setChecks({ ...checks, workspace: ev.target.checked })} /> {t("The vehicle is fixed, and hands, leads, and tools are clear of the motors")}</label>
            <label><input type="checkbox" checked={checks.control} onChange={(ev) => setChecks({ ...checks, control: ev.target.checked })} /> {t("I allow every change to this vehicle without a separate card for this session")}</label>
            <label>
              {t("Session length")}
              <select value={minutes} onChange={(ev) => setMinutes(Number(ev.target.value))} aria-label={t("Session length")}>
                <option value={5}>{t("{n} min", { n: 5 })}</option>
                <option value={10}>{t("{n} min", { n: 10 })}</option>
                <option value={15}>{t("{n} min", { n: 15 })}</option>
              </select>
            </label>
            <div className="ai-bench-actions">
              <button type="submit" disabled={!checks.propellers || !checks.power || !checks.workspace || !checks.control}>{t("Turn on safe mode")}</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

const LOG_MENU = 10;

function logName(id: string): string {
  const cut = Math.max(id.lastIndexOf("/"), id.lastIndexOf("\\"));
  return cut >= 0 ? id.slice(cut + 1) : id;
}

function logChoices(logs: LocalLog[], selected: string): LocalLog[] {
  const recent = logs.slice(0, LOG_MENU);
  if (!selected || recent.some((item) => item.id === selected)) return recent;
  const kept = logs.find((item) => item.id === selected);
  return kept ? [kept, ...recent] : recent;
}

function ChatPane({
  t, chats, chatId, messages, proposals, draft, busy, followUser, note, model, models, bench, quota, compact,
  onPick, onDraft, onModel, onSend, onDecision, onCancelWait, onOpenWizard, wizardOpenId, onNew, onBench, onStop,
  query, onQuery, reasoning, onReasoning, provider, onRename, onCancel,
  logs, logId, onLog, onImported, onContinue, drone, live, flow,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  chats: Chat[];
  chatId: string;
  messages: Msg[];
  proposals: Proposal[];
  draft: string;
  busy: boolean;
  followUser: boolean;
  note: string;
  model: string;
  models: string[];
  bench: { left_s: number } | null;
  quota: { left: number; limit: number } | null;
  compact?: boolean;
  onPick: (id: string) => void;
  onDraft: (v: string) => void;
  onModel: (v: string) => void;
  onSend: (preset?: string) => void;
  onDecision: (decision: "approve" | "reject", ids?: string[], comment?: string) => void;
  onCancelWait: (id: string) => void;
  onOpenWizard: (id: string, wizard: string) => void;
  wizardOpenId: string;
  onNew: () => void;
  onBench: () => void;
  onStop: () => void;
  query: string;
  onQuery: (v: string) => void;
  reasoning: string;
  onReasoning: (v: string) => void;
  provider: string;
  onRename: (id: string, title: string) => void;
  onCancel: () => void;
  logs: LocalLog[];
  logId: string;
  onLog: (id: string) => void;
  onImported: (id: string) => void;
  onContinue: () => void;
  drone: { boot_uid?: string; board_name?: string; frame?: string; ok?: boolean };
  live: LiveTurn | null;
  flow?: Sample["log_download"];
}) {
  const scriptQuote = useSyncExternalStore(subscribeLuaQuote, getLuaQuote, getLuaQuote);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const pinning = useRef(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const logFile = useRef<HTMLInputElement>(null);
  const [plus, setPlus] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState("");
  const logMenu = logChoices(logs, logId);
  const [renaming, setRenaming] = useState("");
  const [scope, setScope] = useState<"all" | "drone">("drone");
  const [filterOpen, setFilterOpen] = useState(false);
  const narrow = useNarrow();
  const [chatsOpen, setChatsOpen] = useState(() => !window.matchMedia("(max-width: 768px)").matches);
  useEffect(() => {
    if (narrow) setChatsOpen(false);
  }, [narrow]);
  const thread = useMemo(() => placeProposals(groupMessages(messages), proposals), [messages, proposals]);
  const [earlier, setEarlier] = useState(0);
  useEffect(() => { setEarlier(0); }, [chatId]);
  const shownThread = useMemo(() => tailTurns(thread, 6 + earlier), [thread, earlier]);
  const replyBook = useRef<ReplyBook>({ seq: 0, pending: null, landed: new Map() });
  const replyChat = useRef(chatId);
  if (replyChat.current !== chatId) {
    replyChat.current = chatId;
    replyBook.current = { seq: 0, pending: null, landed: new Map() };
  }
  const held = holdReply(shownThread, live?.reply, replyBook.current);
  const hidden = thread.length - shownThread.length;
  const liveView = useMemo(() => latestLive(shownThread), [shownThread]);
  const [liveOpen, setLiveOpen] = useState(false);
  useEffect(() => { setLiveOpen(false); }, [chatId]);
  const [keptThoughts, setKeptThoughts] = useState<Record<string, string>>({});
  const liveTools = shownThread.reduce((found, block, index) => block.kind === "tools" ? index : found, -1);
  const lastProposal = shownThread.reduce((found, block, index) => block.kind === "proposal" ? index : found, -1);
  const liveOnTools = liveTools > lastProposal;
  const seenChat = useRef(chatId);
  useEffect(() => { setKeptThoughts({}); }, [chatId]);
  useEffect(() => {
    if (!live?.reply || !live.thought?.trim() || !liveOnTools) return;
    const block = shownThread[liveTools];
    if (block?.kind !== "tools") return;
    const text = live.thought;
    const key = block.key;
    setKeptThoughts((prev) => prev[key] === text ? prev : { ...prev, [key]: text });
  }, [live?.reply, live?.thought, liveOnTools, liveTools, shownThread]);
  const followBottom = useRef(true);
  const wasBusy = useRef(false);
  const sawFollow = useRef(false);
  const place = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const switched = seenChat.current !== chatId;
    if (switched) {
      seenChat.current = chatId;
      stick.current = true;
      followBottom.current = true;
      place.current = null;
    }
    if (followUser && !sawFollow.current) stick.current = true;
    sawFollow.current = followUser;
    const ended = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (busy) followBottom.current = false;
    const holdTurn = !switched && followUser && stick.current && (busy || ended);
    if (holdTurn) {
      if (busy) pinTurn(el, pinning);
      else {
        const top = turnTop(el);
        const max = Math.max(0, el.scrollHeight - el.clientHeight);
        pinning.current = true;
        el.scrollTop = Math.min(top, max);
        requestAnimationFrame(() => { pinning.current = false; });
      }
      place.current = userOffset(el);
      return;
    }
    if (followBottom.current && stick.current) {
      followBottom.current = false;
      pinning.current = true;
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => { pinning.current = false; });
      place.current = userOffset(el);
      return;
    }
    const saved = place.current;
    const next = userOffset(el);
    if (saved != null && next != null && Math.abs(next - saved) > 1) {
      pinning.current = true;
      el.scrollTop += next - saved;
      requestAnimationFrame(() => { pinning.current = false; });
    }
    place.current = userOffset(el);
  }, [messages, proposals, busy, followUser, chatId, live?.thought, live?.tool, live?.reply, earlier]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(168, Math.max(24, el.scrollHeight))}px`;
  }, [draft]);
  useEffect(() => {
    if (!plus) return;
    const close = (ev: PointerEvent) => {
      if (!(ev.target instanceof Element) || !ev.target.closest(".ai-plus-wrap")) setPlus(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [plus]);
  useEffect(() => {
    if (!filterOpen) return;
    const close = (ev: PointerEvent) => {
      if (!(ev.target instanceof Element) || !ev.target.closest(".ai-filter-wrap")) setFilterOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [filterOpen]);
  const shown = chats.filter((chat) => {
    if (scope === "drone" && !sameDrone(chat.vehicle_key, drone)) return false;
    return chat.title.toLowerCase().includes(query.trim().toLowerCase());
  });
  const waiting = proposals.some((p) => p.status === "pending");

  return (
    <div className={`ai-pane${compact ? " compact" : ""}${!compact && !chatsOpen ? " chats-shut" : ""}`}>
      {compact || !chatsOpen ? null : (
      <aside className="ai-chats">
        <div className="ai-chat-bar">
          <button type="button" className="ai-chats-fold" aria-label={t("Hide chats")} aria-expanded={true} title={t("Hide chats")} onClick={() => setChatsOpen(false)}><ChatsIcon /></button>
          <button type="button" className="ai-new" aria-label={t("New chat")} title={t("New chat")} onClick={onNew}><NewChatIcon /></button>
          <input value={query} onChange={(ev) => onQuery(ev.target.value)} placeholder={t("Search chats")} aria-label={t("Search chats")} />
          <div className="ai-filter-wrap">
            <button type="button" className={scope === "drone" ? "ai-filter on" : "ai-filter"} aria-label={t("Filter chats")} aria-expanded={filterOpen} title={t("Filter chats")} onClick={() => setFilterOpen((open) => !open)}>
              <FilterIcon />
            </button>
            {filterOpen ? (
              <div className="ai-filter-menu" role="menu">
                <button type="button" role="menuitemradio" aria-checked={scope === "all"} className={scope === "all" ? "on" : ""} onClick={() => { setScope("all"); setFilterOpen(false); }}>{t("All chats")}</button>
                <button type="button" role="menuitemradio" aria-checked={scope === "drone"} className={scope === "drone" ? "on" : ""} onClick={() => { setScope("drone"); setFilterOpen(false); }}>{t("Current drone chats")}</button>
              </div>
            ) : null}
          </div>
        </div>
        <ul>
          {shown.map((chat) => (
            <li key={chat.id}>
              {renaming === chat.id ? (
                <input
                  aria-label={t("Rename")}
                  defaultValue={chat.title}
                  autoFocus
                  onBlur={(ev) => {
                    const title = ev.target.value.trim();
                    if (title && title !== chat.title) onRename(chat.id, title);
                    setRenaming("");
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") ev.currentTarget.blur();
                    if (ev.key === "Escape") setRenaming("");
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={chat.id === chatId ? "on" : ""}
                  title={chat.title}
                  onClick={() => { onPick(chat.id); if (narrow) setChatsOpen(false); }}
                  onDoubleClick={() => setRenaming(chat.id)}
                >
                  {chat.title}
                </button>
              )}
            </li>
          ))}
        </ul>
      </aside>
      )}
      {narrow && chatsOpen ? (
        <button type="button" className="ai-chats-back" aria-label={t("Hide chats")} onClick={() => setChatsOpen(false)} />
      ) : null}
      <div className="ai-thread">
        {!compact && !chatsOpen ? (
          <button type="button" className="ai-chats-toggle" aria-label={t("Show chats")} aria-expanded={false} title={t("Show chats")} onClick={() => setChatsOpen(true)}><ChatsIcon /></button>
        ) : null}
        <Mesh visible={messages.length === 0 && !busy} />
        <div
          className={`ai-msgs${messages.length ? " has" : ""}`}
          ref={scroller}
          onScroll={(ev) => {
            if (pinning.current) return;
            const el = ev.currentTarget;
            place.current = userOffset(el);
            if (busy) {
              stick.current = Math.abs(el.scrollTop - turnTop(el)) < 80;
              return;
            }
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          <div className="ai-stream">
            {messages.length === 0 ? (
              <div className="ai-empty">
                <Orb />
                <h2>ArduLoops <span>{t("Assistant")}</span></h2>
                <div className="ai-prompts">
                  {starterPrompts(drone.frame).map((text) => (
                    <button type="button" key={text} onClick={() => onSend(t(text))}>{t(text)}</button>
                  ))}
                </div>
              </div>
            ) : null}
            {hidden > 0 ? (
              <button type="button" className="ai-earlier" onClick={() => { stick.current = false; setEarlier((count) => count + 6); }}>
                {t("Show earlier")}
              </button>
            ) : null}
            {held.map((block, index) => block.kind === "tools" ? (
              <ToolGroup key={block.key} t={t} items={block.items} workedMs={block.workedMs} note={block.note} flow={index === liveTools ? flow : undefined} thought={keptThoughts[block.key]} live={busy && liveOnTools && index === liveTools ? live : null} />
            ) : block.kind === "proposal" ? (
              <ProposalCard key={block.key} t={t} items={block.items} busy={busy} onDecision={onDecision} onCancelWait={onCancelWait} onOpenWizard={onOpenWizard} wizardOpenId={wizardOpenId} />
            ) : (
              block.attach || block.quote ? (
                <div key={block.key} className="ai-user-block">
                  <article className={block.msg.role}>
                    {block.msg.role === "steer" ? <span className="ai-steer-label">{t("Note for later")}</span> : null}
                    {block.msg.body}
                  </article>
                  {block.attach ? <span className="ai-chip ai-chip-sent" title={block.attach}>{block.attach}</span> : null}
                  {block.quote ? <span className="ai-chip ai-chip-line" title={block.quoteTitle}>{block.quote}</span> : null}
                </div>
              ) : (
              <article key={block.key} className={block.msg.role}>
                {block.msg.role === "steer" ? <span className="ai-steer-label">{t("Note for later")}</span> : null}
                {block.msg.role === "assistant" && block.msg.body === "This turn stopped before a reply." && index === thread.length - 1 ? (
                  <div className="ai-resume">
                    <AssistantMarkdown text={shownNotice(block.msg.body, t)} />
                    <button type="button" disabled={busy} onClick={() => onSend(t("The tools above already returned. Continue from those results and do not call them again."))}>{t("Continue")}</button>
                  </div>
                ) : block.msg.role === "assistant" ? <AssistantMarkdown text={shownNotice(block.msg.body, t)} /> : block.msg.body}
                {block.msg.role === "assistant" && block.msg.at !== -1 ? <ChartStrip charts={chartsUnder(held, index)} /> : null}
                {block.msg.role === "assistant" && block.msg.at !== -1 && liveView?.index === index ? <LiveView spec={liveView.spec} open={liveOpen} onOpen={() => setLiveOpen(true)} onClose={() => setLiveOpen(false)} /> : null}
              </article>
              )
            ))}
            {busy && !live?.reply && !liveOnTools ? (
              <div className="ai-tools-live" role="status">
                <p className="ai-tools ai-tools-status"><span className="ai-tools-names">{live?.tool ? liveTitle(live, flow) : t("Thinking…")}</span></p>
                {live?.thought ? <ThoughtText text={live.thought} /> : null}
              </div>
            ) : null}
            {busy ? <div className="ai-run-pad" /> : null}
            {quota ? <p className="ai-quota">{t("{left} of {limit} requests left today.", quota)}</p> : null}
          </div>
        </div>
        <div className="ai-dock">
          <form className="ai-compose" onSubmit={(ev) => { ev.preventDefault(); onSend(); }}>
            {bench ? (
              <div className="ai-safe-top">
                <span className="ai-safe on">{t("Safe mode · {m}:{s}", { m: Math.floor(bench.left_s / 60), s: String(bench.left_s % 60).padStart(2, "0") })}</span>
                <button type="button" className="ai-estop" onClick={onStop}>{t("Emergency stop")}</button>
              </div>
            ) : null}
            {note ? (
              <p className="ai-error">
                {t(note)}
                {note === "paused_limit" ? <button type="button" onClick={onContinue}>{t("Continue")}</button> : null}
              </p>
            ) : null}
            {scriptQuote || logId || reasoning ? (
              <div className="ai-chips">
                {scriptQuote ? (
                  <span className="ai-chip ai-chip-line" title={scriptQuote.selection}>
                    <span>{quoteLabel(scriptQuote)}</span>
                    <button type="button" aria-label={t("Remove")} onClick={() => setLuaQuote(null)}>×</button>
                  </span>
                ) : null}
                {logId ? (
                  <span className="ai-chip">{logName(logId)}<button type="button" aria-label={t("Remove")} onClick={() => onLog("")}>×</button></span>
                ) : null}
                {reasoning ? (
                  <span className="ai-chip">{t("Reasoning")} · {reasoning}<button type="button" aria-label={t("Remove")} onClick={() => onReasoning("")}>×</button></span>
                ) : null}
              </div>
            ) : null}
            <textarea
              ref={box}
              value={draft}
              onChange={(ev) => onDraft(ev.target.value)}
              placeholder={waiting || busy ? t("Add a note for the next reply") : t("Ask about this vehicle")}
              aria-label={t("Message")}
              rows={1}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && !ev.shiftKey) {
                  ev.preventDefault();
                  ev.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="ai-compose-bar">
              <div className="ai-plus-wrap">
                <button
                  type="button"
                  className={`ai-icon${plus || logId || reasoning ? " on" : ""}`}
                  aria-label={t("Add context")}
                  aria-expanded={plus}
                  onClick={() => setPlus((v) => !v)}
                >
                  +
                </button>
                {plus ? (
                  <div className="ai-plus-menu">
                    <label>
                      {t("Local log")}
                      <select aria-label={t("Local log")} value={logId} onChange={(ev) => onLog(ev.target.value)}>
                        <option value="">{t("No downloaded log")}</option>
                        {logId && !logMenu.some((item) => item.id === logId) ? <option value={logId}>{logName(logId)}</option> : null}
                        {logMenu.map((item) => <option key={item.id} value={item.id}>{logName(item.id)}</option>)}
                      </select>
                    </label>
                    <button type="button" className="ai-log-load" disabled={importing} onClick={() => logFile.current?.click()}>
                      {t("Load a log")}
                    </button>
                    <input
                      ref={logFile}
                      type="file"
                      accept=".bin,application/octet-stream"
                      hidden
                      onChange={(ev) => {
                        const file = ev.target.files?.[0];
                        ev.target.value = "";
                        if (!file) return;
                        setImportNote("");
                        setImporting(true);
                        void ai.importLog(file).then((saved) => {
                          onImported(saved.id);
                        }).catch((err: unknown) => {
                          setImportNote(err instanceof Error ? err.message : t("Could not load the log"));
                        }).finally(() => setImporting(false));
                      }}
                    />
                    {importNote ? <p className="ai-log-note">{t(importNote)}</p> : null}
                    {provider === "gemini" ? (
                      <label>
                        {t("Reasoning")}
                        <select aria-label={t("Reasoning")} value={reasoning} onChange={(ev) => onReasoning(ev.target.value)}>
                          <option value="">{t("Provider default")}</option>
                          <option value="low">low</option>
                          <option value="medium">medium</option>
                          <option value="high">high</option>
                        </select>
                      </label>
                    ) : (
                      <p>{t("This model does not take a reasoning level. The provider default is used.")}</p>
                    )}
                  </div>
                ) : null}
              </div>
              {bench ? null : (
                <button type="button" className="ai-safe" onClick={onBench}>{t("Safe mode")}</button>
              )}
              {models.length ? (
                <select className="ai-model" aria-label={t("Model")} value={model || models[0]} onChange={(ev) => onModel(ev.target.value)}>
                  {models.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              ) : null}
              {busy ? (
                <>
                  <button type="submit" className="ai-send" aria-label={t("Send")} disabled={!draft.trim()}>
                    <SendIcon />
                  </button>
                  <button type="button" className="ai-send stop" aria-label={t("Stop")} onClick={onCancel}>
                    <StopIcon />
                  </button>
                </>
              ) : (
                <button type="submit" className="ai-send" aria-label={t("Send")} disabled={!draft.trim()}>
                  <SendIcon />
                </button>
              )}
            </div>
          </form>
          <p className="ai-disclaimer">{t("AI can make mistakes.")}</p>
        </div>
      </div>
    </div>
  );
}

const REMARK = [remarkGfm, remarkMath];
const REHYPE = [[rehypeKatex, { strict: "ignore" }]] as const;

const CHAT_MD: Components = {
  a({ href, children }) {
    const ext = !!href && /^https?:/i.test(href);
    return (
      <a href={href} {...(ext ? { target: "_blank", rel: "noreferrer" } : {})}>
        {children}
      </a>
    );
  },
};

const TURN_NOTICES = [
  "This turn stopped before a reply.",
  "The model returned no text.",
  "The model rejected this turn because the request was too long.",
  "The model did not answer in time.",
  "The model request failed.",
  "Paused at the tool limit. Continue to give a new budget.",
  "Stopped.",
  "invalid key",
  "model unavailable",
  "quota exceeded",
  "network unavailable",
];

function shownNotice(body: string, t: (k: string) => string): string {
  for (const key of TURN_NOTICES) {
    if (body === key) return t(key);
    const prefix = `${key}\n`;
    if (body.startsWith(prefix)) return `${t(key)}\n${body.slice(prefix.length)}`;
  }
  return body;
}

const AssistantMarkdown = memo(function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="ai-md">
      <Markdown remarkPlugins={REMARK} rehypePlugins={REHYPE as never} skipHtml components={CHAT_MD}>{text}</Markdown>
    </div>
  );
});

type ToolItem = { key: string; name: string; input?: string; output: string };
type ThreadBlock =
  | { kind: "msg"; key: string; msg: Msg; at: number; attach?: string; quote?: string; quoteTitle?: string }
  | { kind: "tools"; key: string; items: ToolItem[]; workedMs?: number; note?: string; at: number }
  | { kind: "proposal"; key: string; items: Proposal[]; at: number };

function quoteChip(body: string): { label: string; title: string } {
  try {
    const value = JSON.parse(body) as { name?: string; start?: number; end?: number; selection?: string };
    const name = value.name || "lua";
    const start = value.start || 0;
    const end = value.end || start;
    const label = start && end && end !== start ? `${name} · ${start}–${end}` : start ? `${name} · ${start}` : name;
    return { label, title: value.selection || label };
  } catch {
    const line = body.split("\n")[0]?.slice(0, 80) || "lua";
    return { label: line, title: line };
  }
}

function parseTool(body: string): { name: string; input?: string; output: string } {
  const trimmed = body.trim();
  const parsed = parseToolJson(trimmed);
  if (parsed) return parsed;
  const named = /"name"\s*:\s*"([A-Za-z0-9_]+)"/.exec(trimmed);
  if (named) return { name: named[1], output: trimmed };
  const cut = trimmed.indexOf(": ");
  return {
    name: cut > 0 ? trimmed.slice(0, cut) : "tool",
    output: cut > 0 ? trimmed.slice(cut + 2) : trimmed,
  };
}

function parseToolJson(trimmed: string): { name: string; input?: string; output: string } | null {
  if (!trimmed.startsWith("{")) return null;
  try {
    const value = JSON.parse(trimmed) as { name?: unknown; input?: unknown; output?: unknown };
    if (value && typeof value.name === "string" && "output" in value) {
      return {
        name: value.name,
        input: "input" in value ? JSON.stringify(value.input ?? {}, null, 2) : undefined,
        output: typeof value.output === "string" ? value.output : JSON.stringify(value.output ?? {}, null, 2),
      };
    }
  } catch {
    /* a clipped row still has a name */
  }
  return null;
}

function workMs(body: string): number | undefined {
  try {
    const value = JSON.parse(body) as { ms?: unknown };
    if (typeof value.ms === "number" && Number.isFinite(value.ms)) return value.ms;
  } catch {
    /* not a work record */
  }
  return undefined;
}

function turnStarts(blocks: ThreadBlock[]): number[] {
  const starts = blocks.flatMap((block, index) =>
    block.kind === "msg" && block.msg.role === "user" ? [index] : [],
  );
  if (starts.length === 0) return blocks.length ? [0] : [];
  if (starts[0] > 0) starts.unshift(0);
  return starts;
}

function tailTurns(blocks: ThreadBlock[], keep: number): ThreadBlock[] {
  const starts = turnStarts(blocks);
  if (!starts.length || starts.length <= keep) return blocks;
  return blocks.slice(starts[starts.length - keep]);
}

function groupMessages(messages: Msg[]): ThreadBlock[] {
  const out: ThreadBlock[] = [];
  let note = "";
  let noteAt = 0;
  let noteMs: number | undefined;
  const flushNote = (at: number) => {
    const text = note.trim();
    note = "";
    const workedMs = noteMs;
    noteMs = undefined;
    if (!text) return;
    out.push({ kind: "tools", key: `context-${noteAt || at}`, items: [], note: text, workedMs, at: noteAt || at });
  };
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "compact") continue;
    if (msg.role === "context") {
      flushNote(msg.at);
      note = msg.body;
      noteAt = msg.at;
      continue;
    }
    if (msg.role === "work") {
      if (note.trim()) noteMs = workMs(msg.body);
      continue;
    }
    if (msg.role === "attach") {
      const prev = out.at(-1);
      if (prev?.kind === "msg" && prev.msg.role === "user" && !prev.attach) {
        out[out.length - 1] = { ...prev, attach: msg.body };
      }
      continue;
    }
    if (msg.role === "quote") {
      const chip = quoteChip(msg.body);
      const prev = out.at(-1);
      if (prev?.kind === "msg" && (prev.msg.role === "user" || prev.msg.role === "steer") && !prev.quote) {
        out[out.length - 1] = { ...prev, quote: chip.label, quoteTitle: chip.title };
      }
      continue;
    }
    if (msg.role !== "tool") {
      flushNote(msg.at);
      out.push({ kind: "msg", key: `${msg.at}-${i}`, msg, at: msg.at });
      continue;
    }
    const items: ToolItem[] = [];
    const start = i;
    const groupNote = note.trim();
    note = "";
    noteMs = undefined;
    while (i < messages.length && messages[i].role === "tool") {
      const parsed = parseTool(messages[i].body);
      items.push({ key: `${messages[i].at}-${i}`, ...parsed });
      i += 1;
    }
    let workedMs: number | undefined;
    if (i < messages.length && messages[i].role === "work") {
      workedMs = workMs(messages[i].body);
      i += 1;
    } else if (start > 0 && i < messages.length && messages[i].role === "assistant") {
      const span = Math.max(1, messages[i].at - messages[start - 1].at);
      workedMs = span * 1000;
    }
    i -= 1;
    out.push({ kind: "tools", key: `tools-${start}`, items, workedMs, note: groupNote || undefined, at: messages[start].at });
  }
  flushNote(0);
  return out;
}

function mergeToolRuns(blocks: ThreadBlock[]): ThreadBlock[] {
  const merged: ThreadBlock[] = [];
  for (const block of blocks) {
    const prev = merged[merged.length - 1];
    if (block.kind === "tools" && prev?.kind === "tools") {
      merged[merged.length - 1] = {
        kind: "tools",
        key: prev.key,
        items: [...prev.items, ...block.items],
        at: prev.at,
        note: block.note || prev.note,
        workedMs: prev.workedMs == null && block.workedMs == null ? undefined : (prev.workedMs ?? 0) + (block.workedMs ?? 0),
      };
      continue;
    }
    merged.push(block);
  }
  return merged;
}

function placeProposals(blocks: ThreadBlock[], proposals: Proposal[]): ThreadBlock[] {
  const cards = proposals.filter((item) => item.status !== "held").sort((a, b) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER));
  const out: ThreadBlock[] = [];
  let index = 0;
  const take = (ready: Proposal[]) => {
    for (const group of splitAdditions(ready)) {
      out.push({ kind: "proposal", key: `proposal-${group[0].id}`, items: group, at: group[0].at ?? 0 });
    }
  };
  for (const block of blocks) {
    const batch: Proposal[] = [];
    while (index < cards.length && cards[index].at != null && (cards[index].at as number) < block.at) batch.push(cards[index++]);
    take(batch);
    out.push(block);
  }
  take(cards.slice(index));
  return mergeToolRuns(out);
}

function spanOf(values: unknown): { count: number; min: number | null; max: number | null } {
  if (!Array.isArray(values)) return { count: 0, min: null, max: null };
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    count += 1;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return count ? { count, min, max } : { count: 0, min: null, max: null };
}

function chartBrief(output: string): string {
  try {
    const value = JSON.parse(output) as { chart?: { axes?: Array<{ lines?: Array<Record<string, unknown>> }> } };
    for (const axis of value.chart?.axes ?? []) {
      for (const line of axis.lines ?? []) {
        const x = spanOf(line.x);
        const y = spanOf(line.y);
        delete line.x;
        delete line.y;
        line.points = x.count || y.count;
        line.x_min = x.min;
        line.x_max = x.max;
        line.y_min = y.min;
        line.y_max = y.max;
      }
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return formatTool(output);
  }
}

function shownOutput(item: ToolItem): string {
  return item.name === "show_chart" ? chartBrief(item.output) : formatTool(item.output);
}

function formatTool(detail: string): string {
  const trimmed = detail.trim();
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

function toolFailed(output: string): boolean {
  const text = output.trim();
  if (!text) return false;
  if (text.includes("<metadata>")) return metadataFailed(text);
  try {
    return jsonFailed(JSON.parse(text));
  } catch {
    return false;
  }
}

function metadataFailed(text: string): boolean {
  return text.split("<metadata>").slice(1).some((block) => {
    const body = block.split("</metadata>")[0] ?? "";
    return /^ok:\s*false\s*$/m.test(body) || /^error:\s*\S/m.test(body);
  });
}

function jsonFailed(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(jsonFailed);
  const row = value as Record<string, unknown>;
  if (row.ok === false || row.status === "failed") return true;
  if (typeof row.error === "string" && row.error.trim()) return true;
  if (row.truncated === true && typeof row.preview === "string") return toolFailed(row.preview);
  for (const key of ["results", "files", "params", "jobs"]) {
    const child = row[key];
    if (Array.isArray(child) && child.some(jsonFailed)) return true;
  }
  return false;
}

function chartsUnder(blocks: ThreadBlock[], index: number) {
  const prev = blocks[index - 1];
  return prev?.kind === "tools" ? chartsFromTools(prev.items) : [];
}

function latestLive(blocks: ThreadBlock[]): { index: number; spec: LiveSpec } | null {
  let hit: { index: number; spec: LiveSpec } | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind !== "tools") continue;
    const spec = liveSpecFromTools(block.items);
    if (!spec) continue;
    const next = blocks[i + 1];
    if (next?.kind === "msg" && next.msg.role === "assistant") hit = { index: i + 1, spec };
  }
  return hit;
}

function toolTitle(item: ToolItem): string {
  const hint = nameHint(item.input) || nameHint(item.output);
  return hint ? `${item.name} · ${hint}` : item.name;
}

function nameHint(raw?: string): string {
  if (!raw) return "";
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const bits = [
      fileBit(value.file) || idBit(value.log_id),
      textList(value.messages) || textBit(value.message),
      jobBit(value),
      textList(value.jobs),
      textList(value.names) || textList(value.lines),
      textBit(value.name),
      pathBit(value) || spanned(textBit(value.glob), value) || textBit(value.prefix) || textBit(value.query) || textBit(value.url) || textBit(value.title),
      textBit(value.slug),
      chartsBit(value.charts),
      paramBit(value.params) || changeBit(value.changes) || resultNames(value.results),
      textBit(value.mode),
      textBit(value.action) || textBit(value.resource),
    ].filter(Boolean);
    return bits.join(" · ");
  } catch {
    return "";
  }
}

function chartsBit(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const titles = value.map((row) => {
    if (!row || typeof row !== "object") return "";
    const title = (row as { title?: unknown }).title;
    return typeof title === "string" ? title.trim() : "";
  }).filter(Boolean);
  return titles.slice(0, 3).join(", ");
}

function textBit(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function idBit(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return textBit(value);
}

function lastUser(el: HTMLElement): HTMLElement | null {
  const users = el.querySelectorAll("article.user");
  return users.length ? users[users.length - 1] as HTMLElement : null;
}

type ReplyBook = {
  seq: number;
  pending: { key: string; body: string } | null;
  landed: Map<number, string>;
};

function holdReply(blocks: ThreadBlock[], reply: string | undefined, book: ReplyBook): ThreadBlock[] {
  const text = reply?.trim() ?? "";
  if (text && !exactReply(blocks, text)) {
    if (!book.pending) {
      book.seq += 1;
      book.pending = { key: `stream-${book.seq}`, body: text };
    } else {
      book.pending.body = text;
    }
    const tail = trailingAssistant(blocks);
    if (tail && sameReply(tail.msg.body, text)) {
      book.landed.set(tail.msg.at, book.pending.key);
      book.pending = null;
    } else {
      return stampReply(blocks, book).concat({
        kind: "msg",
        key: book.pending.key,
        msg: { role: "assistant", body: reply ?? "", at: -1 },
        at: -1,
      });
    }
  } else if (book.pending && text) {
    const tail = trailingAssistant(blocks);
    if (tail) book.landed.set(tail.msg.at, book.pending.key);
    book.pending = null;
  } else if (book.pending) {
    const tail = trailingAssistant(blocks);
    if (tail && sameReply(tail.msg.body, book.pending.body)) book.landed.set(tail.msg.at, book.pending.key);
    book.pending = null;
  }
  return stampReply(blocks, book);
}

function stampReply(blocks: ThreadBlock[], book: ReplyBook): ThreadBlock[] {
  if (!book.landed.size) return blocks;
  return blocks.map((block) => {
    if (block.kind !== "msg") return block;
    const key = book.landed.get(block.msg.at);
    return key ? { ...block, key } : block;
  });
}

function exactReply(blocks: ThreadBlock[], reply: string): boolean {
  const text = reply.trim();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.kind !== "msg") continue;
    if (block.msg.role === "user") return false;
    if (block.msg.role === "assistant" && block.msg.body.trim() === text) return true;
  }
  return false;
}

function trailingAssistant(blocks: ThreadBlock[]): Extract<ThreadBlock, { kind: "msg" }> | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.kind === "proposal") continue;
    if (block.kind === "tools") return null;
    if (block.msg.role === "user") return null;
    if (block.msg.role === "assistant" && block.msg.at !== -1) return block;
  }
  return null;
}

function sameReply(saved: string, live: string): boolean {
  const body = saved.trim();
  const text = live.trim();
  if (!body || !text) return false;
  return body === text || (text.length >= 80 && body.startsWith(text));
}

function replyLanded(messages: Msg[], reply: string): boolean {
  const text = reply.trim();
  if (!text) return true;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") return false;
    if (msg.role === "assistant" && msg.body.trim() === text) return true;
  }
  return false;
}

function userOffset(el: HTMLElement): number | null {
  const user = lastUser(el);
  if (!user) return null;
  return user.getBoundingClientRect().top - el.getBoundingClientRect().top;
}

function turnTop(el: HTMLElement): number {
  const user = lastUser(el);
  if (!user) return el.scrollTop;
  return Math.max(0, user.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12);
}

function pinTurn(el: HTMLElement, pinning: { current: boolean }) {
  const pad = el.querySelector(".ai-run-pad") as HTMLElement | null;
  if (pad) pad.style.height = "0px";
  const top = turnTop(el);
  const gap = Math.max(0, el.clientHeight - (el.scrollHeight - top));
  if (pad) pad.style.height = `${gap}px`;
  pinning.current = true;
  el.scrollTop = top;
  requestAnimationFrame(() => { pinning.current = false; });
}

function byteLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function liveLogId(input: string | undefined): number | null {
  if (!input) return null;
  try {
    const value = JSON.parse(input) as { log_id?: unknown };
    return typeof value.log_id === "number" && Number.isFinite(value.log_id) ? value.log_id : null;
  } catch {
    return null;
  }
}

function downloadProgress(live: LiveTurn, flow: Sample["log_download"]): string {
  if (live.tool !== "download_vehicle_log" || !flow || flow.complete || flow.size <= 0) return "";
  const asked = liveLogId(live.input);
  if (asked != null && asked !== flow.id) return "";
  const pct = Math.min(100, Math.round((flow.received / flow.size) * 100));
  return `${byteLabel(flow.received)} / ${byteLabel(flow.size)} · ${pct}%`;
}

function liveTitle(live: LiveTurn, flow?: Sample["log_download"]): string {
  const progress = downloadProgress(live, flow);
  const base = (() => {
    if (!live.tool) return "";
    if (!live.input) return live.tool;
    const titled = toolTitle({ key: "live", name: live.tool, input: live.input, output: "" });
    if (titled !== live.tool) return titled;
    if (live.input.startsWith("{")) return live.tool;
    return `${live.tool} · ${live.input}`;
  })();
  return progress ? `${base} · ${progress}` : base;
}

function textList(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") return jobBit(item as Record<string, unknown>);
    return "";
  }).filter(Boolean).slice(0, 6).join(", ");
}

function fileBit(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const name = value.split("/").pop() || value;
  return name.replace(/\.bin$/, "");
}

function jobBit(value: Record<string, unknown>): string {
  const field = textBit(value.field);
  const op = textBit(value.op);
  if (field && op) return `${field} ${op}`;
  return field || op;
}

function spanned(label: string, value: Record<string, unknown>): string {
  if (!label) return "";
  const span = lineSpan(value);
  return span ? `${label}:${span}` : label;
}

function lineSpan(value: Record<string, unknown>): string {
  const start = typeof value.start_line === "number" ? value.start_line : null;
  const end = typeof value.end_line === "number" ? value.end_line : null;
  if (start == null) return "";
  if (end != null && end !== start) return `${start}–${end}`;
  return String(start);
}

function pathBit(value: Record<string, unknown>): string {
  const own = textBit(value.path);
  const listed = Array.isArray(value.paths)
    ? value.paths.map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const row = item as Record<string, unknown>;
      const path = textBit(row.path);
      const span = lineSpan(row);
      return path && span ? `${path}:${span}` : path;
    }).filter(Boolean).slice(0, 4).join(", ")
    : "";
  const loc = own || listed;
  if (!loc) return "";
  const span = lineSpan(value);
  return span && !loc.includes(":") ? `${loc}:${span}` : loc;
}

function paramBit(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => item && typeof item === "object" && "name" in item && typeof item.name === "string" ? item.name : "")
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
}

function resultNames(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    if (!item || typeof item !== "object" || typeof (item as { name?: unknown }).name !== "string") return "";
    const row = item as { name: string; new?: unknown };
    return typeof row.new === "number" ? `${row.name}=${row.new}` : row.name;
  }).filter(Boolean).slice(0, 6).join(", ");
}

function changeBit(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    if (!item || typeof item !== "object" || typeof (item as { name?: unknown }).name !== "string") return "";
    const row = item as { name: string; value?: unknown };
    return typeof row.value === "number" ? `${row.name}=${row.value}` : row.name;
  }).filter(Boolean).slice(0, 6).join(", ");
}

function starterPrompts(frame: string | undefined): string[] {
  if (frame === "plane") {
    return [
      "Download the newest log and judge how well every loop is tuned: roll and pitch rate, roll and pitch angle, the yaw damper, ground steering, L1, and TECS. Use the log and the parameters already set. Do not write anything.",
      "Prepare the tuning steps for this plane from the parameters already on it and the current plane tuning guide. Say which step this plane is on, what to fly next, and the single next change. Do not write it.",
      "Calculate the notch and low-pass filters for this plane from the newest downloaded log and the filter parameters already set. Use only a frequency the tools return. Do not invent one, and do not write the parameters.",
      "Tune the roll and pitch PIDs on this plane from the parameters already on the vehicle and the current roll and pitch guide. Name the term to move and the size of the step. Do not write it.",
    ];
  }
  if (frame === "copter") {
    return [
      "Download the newest log and judge how well every loop is tuned: rate and angle on roll, pitch, and yaw; height position, velocity, and acceleration; and horizontal NE position, NE velocity, and lean. Use the log and the parameters already set. Do not write anything.",
      "Prepare the first-flight tuning steps for this copter from the parameters already on it and the current copter tuning process. Say which step this copter is on, what to fly, and the single next change. Do not write it.",
      "Calculate the harmonic-notch and low-pass filters for this copter from the newest downloaded log and the filter parameters already set. Use only a frequency the tools return. Do not invent one, and do not write the parameters.",
      "Tune the roll and pitch PIDs on this copter from the rate and angle parameters already on the vehicle and the current roll and pitch guide. Name the term to move and the size of the step. Do not write it.",
    ];
  }
  return [
    "Download the newest log and judge how well every loop on this airframe is tuned. Name each loop the log and the parameters show. Do not write anything.",
    "Prepare the first tuning steps from the saved parameters. Identify the airframe, open its current tuning process, and say the single next change. Do not write it.",
    "Calculate filter settings from the newest downloaded log. Use only a frequency the tools return. Do not invent one, and do not write the parameters.",
    "Tune the PIDs from the saved parameters and the current guide for that airframe. Name the term to move and the size of the step. Do not write it.",
  ];
}

const HEAVY_OUTPUT = 24_000;

function SizeWarn({ title }: { title: string }) {
  return (
    <span className="ai-tool-warn" title={title} aria-label={title}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M8 2.2 14.2 13.4H1.8z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M8 6.2v3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="8" cy="11.3" r="0.7" fill="currentColor" />
      </svg>
    </span>
  );
}

function workedLabel(t: (k: string, vars?: Record<string, string | number>) => string, ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const rem = total % 60;
  if (m === 0) return t("Worked {s} s", { s: rem });
  return t("Worked {m} m {s} s", { m, s: String(rem).padStart(2, "0") });
}

function PassedNote({ t, text }: { t: (k: string) => string; text: string }) {
  return (
    <li className="ai-passed">
      <details>
        <summary>{t("Summary")}</summary>
        <pre>{text.trim()}</pre>
      </details>
    </li>
  );
}

function ReasoningNote({ t, text }: { t: (k: string) => string; text: string }) {
  return (
    <li className="ai-passed">
      <details>
        <summary>{t("Reasoning")}</summary>
        <div className="ai-reason">
          <AssistantMarkdown text={text.trim()} />
        </div>
      </details>
    </li>
  );
}

const ToolGroup = memo(function ToolGroup({
  t, items, workedMs, note, thought, live, flow,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  items: ToolItem[];
  workedMs?: number;
  note?: string;
  thought?: string;
  live: LiveTurn | null;
  flow?: Sample["log_download"];
}) {
  const running = live?.tool ? liveTitle(live, flow) : t("Thinking…");
  const passed = note || (live?.note ?? "");
  const moved = thought && !(live && !live.reply) ? thought : "";
  const failed = useMemo(() => items.map((item) => toolFailed(item.output)), [items]);
  const heavyCount = useMemo(() => items.reduce((count, item) => count + (item.output.length > HEAVY_OUTPUT ? 1 : 0), 0), [items]);
  return (
    <div className="ai-tools-live">
    <details className={failed.some(Boolean) ? "ai-tools ai-has-fail" : "ai-tools"}>
      <summary>
        <span className="ai-tools-names">{live ? running : workedMs != null ? workedLabel(t, workedMs) : t("Tools")}</span>
        {heavyCount > 0 ? <SizeWarn title={t("Large results in this turn: {n}. They are kept whole.", { n: heavyCount })} /> : null}
      </summary>
      <ul>
        {moved ? <ReasoningNote t={t} text={moved} /> : null}
        {passed ? <PassedNote t={t} text={passed} /> : null}
        {items.map((item, index) => (
          <ToolRow key={item.key} t={t} item={item} failed={failed[index]} />
        ))}
      </ul>
    </details>
    {live && !live.reply && live.thought ? <ThoughtText text={live.thought} /> : null}
    </div>
  );
});

function ToolRow({
  t, item, failed,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  item: ToolItem;
  failed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hint = nameHint(item.input) || nameHint(item.output);
  const output = open ? shownOutput(item) : "";
  return (
    <li>
      <details className={failed ? "ai-tool-fail" : undefined} onToggle={(ev) => setOpen(ev.currentTarget.open)}>
        <summary>
          <span className="ai-tool-name">{item.name}</span>
          {item.output.length > HEAVY_OUTPUT ? (
            <SizeWarn title={t("Large result, kept whole. {n} characters.", { n: item.output.length })} />
          ) : null}
          {hint ? <span className="ai-tool-hint" title={hint}>{` · ${hint}`}</span> : null}
        </summary>
        {open && item.input !== undefined ? (
          <>
            <p className="ai-io">{t("Input")}</p>
            <pre>{formatTool(item.input)}</pre>
          </>
        ) : null}
        {open ? (
          <>
            <p className="ai-io">{t("Output")}</p>
            <pre>{output}</pre>
          </>
        ) : null}
      </details>
    </li>
  );
}

function ThoughtText({ text }: { text: string }) {
  const body = text.trim();
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [body]);
  return (
    <div className="ai-thought" ref={box}>
      <AssistantMarkdown text={body} />
    </div>
  );
}

function ChatsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M2.4 2.6h11.2v10.8H2.4z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.2 2.6v10.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M2.2 3.2h11.6l-4.2 5.1v4.1l-3.2-1.4V8.3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M2.8 3.2h7.2v6.2H7.2L4.6 12v-2.6H2.8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11.2 2.2v3.6M9.4 4h3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function OpenPageIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M6.2 3.2H3.4v9.4h9.4V9.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8.4 7.6 13 3M9.6 3H13v3.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M8 13.2V3.4M3.6 7.2 8 2.8l4.4 4.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.4" fill="currentColor" />
    </svg>
  );
}

function rampMoteSpeed(button: HTMLButtonElement, target: number) {
  const token = String(performance.now());
  button.dataset.moteRamp = token;
  const anims = [...button.querySelectorAll(".ai-mote")].flatMap((node) => node.getAnimations());
  if (!anims.length) return;
  const from = anims.map((anim) => anim.playbackRate);
  const started = performance.now();
  const step = (now: number) => {
    if (button.dataset.moteRamp !== token) return;
    const t = Math.min(1, (now - started) / 700);
    const eased = t * t * (3 - 2 * t);
    anims.forEach((anim, index) => {
      anim.playbackRate = from[index] + (target - from[index]) * eased;
    });
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function Mesh({ visible }: { visible: boolean }) {
  return (
    <div className={visible ? "ai-mesh on" : "ai-mesh"} aria-hidden="true">
      <div className="ai-mesh-layer">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="ai-mesh-veil" />
    </div>
  );
}

function Orb() {
  return (
    <div className="ai-orb" aria-hidden="true">
      <span className="ai-mote" />
      <span className="ai-mote b" />
      <span className="ai-mote c" />
      <span className="ai-mote d" />
      <span className="ai-mote e" />
      <span className="ai-mote f" />
      <span className="ai-mote g" />
      <span className="ai-mote h" />
      <Sparkle />
    </div>
  );
}

function Sparkle() {
  return (
    <svg className="ai-spark" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M12 1.8c.35 3.1 1.55 5.2 3.7 7.35 2.15 2.15 4.25 3.35 7.35 3.7-3.1.35-5.2 1.55-7.35 3.7-2.15 2.15-3.35 4.25-3.7 7.35-.35-3.1-1.55-5.2-3.7-7.35-2.15-2.15-4.25-3.35-7.35-3.7 3.1-.35 5.2-1.55 7.35-3.7 2.15-2.15 3.35-4.25 3.7-7.35Z" />
      <path className="ai-twinkle" fill="currentColor" d="M18.4 2.4c.15 1.15.6 1.95 1.45 2.8.85.85 1.65 1.3 2.8 1.45-1.15.15-1.95.6-2.8 1.45-.85.85-1.3 1.65-1.45 2.8-.15-1.15-.6-1.95-1.45-2.8-.85-.85-1.65-1.3-2.8-1.45 1.15-.15 1.95-.6 2.8-1.45.85-.85 1.3-1.65 1.45-2.8Z" />
    </svg>
  );
}

function placeFloat(setup: boolean): { x: number; y: number } {
  const w = Math.min(440, window.innerWidth - 24);
  const h = setup ? 188 : Math.min(560, window.innerHeight - 96);
  return clampFloat(window.innerWidth - w - 18, window.innerHeight - h - 78, w, h);
}

function clampFloat(x: number, y: number, w: number, h: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8)),
  };
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
