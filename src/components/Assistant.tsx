import { lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { ai, type AiStatus, type Chat, type CloudDoc, type LiveTurn, type LocalLog, type Msg, type Proposal } from "../assistant/api";
import { DEFAULT_MODELS, formatTokens, formatUsd, loadCachedModels, syncModelsDev } from "../assistant/models";
import { IMAGES_PER_MESSAGE, imageFiles, shrinkImage } from "../assistant/images";
import { Disconnected } from "./Disconnected";
import { ProfileCard } from "./ProfileForm";
import { WizardHost, wizardScope, type WizardAsk } from "./WizardHost";
import type { WizardClose } from "../wizards/close";
import { ChartStrip, chartsFromTools } from "./FindingCharts";
import { LiveHost, LiveView, liveSpecFromTools, type LiveSpec } from "./LivePlots";
import { getLang, useT } from "../i18n/i18n";
import { ASK_ASSISTANT, takeFocusRequest, type AskDetail } from "../lib/assistantAsk";
import { getAskStarters, getSetupView, getViewOff, sentView, setAskStarters, setViewOff, setWaitingCards, subscribeSetupView, viewLabel, type SetupView } from "../lib/setupView";
import { getLuaQuote, quoteLabel, setLuaQuote, subscribeLuaQuote, type LuaQuote } from "../luaQuote";
import { subscribe } from "../mav/store";
import { useVehicle, viewSample } from "../mav/view";
import { isSitl } from "../mav/sim";
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
  sitl?: boolean;
};

let linkFaceCache: LinkFace = { ok: false, frame: "", mode: "", armed: false, boot_uid: "", board_name: "", sitl: false };
let linkFaceVehicle = "";

type PendingOut = { role: "user" | "steer"; body: string; at: number; attach: string; quote: string; view: string; images: string[] };

function quotePayload(quoted: LuaQuote): string {
  return JSON.stringify({
    name: quoted.name,
    start: quoted.startLine,
    end: quoted.endLine,
    selection: quoted.selection,
    body: quoted.body,
    dirty: quoted.dirty,
  });
}

function outgoingLanded(list: Msg[], pending: PendingOut): boolean {
  for (let i = list.length - 1; i >= 0; i--) {
    const msg = list[i];
    if (msg.role === pending.role) return msg.body === pending.body;
    if (msg.role === "user" || msg.role === "steer") return false;
  }
  return false;
}

function mergeOutgoing(list: Msg[], pendingRef: { current: PendingOut | null }): Msg[] {
  const pending = pendingRef.current;
  if (!pending) return list;
  if (outgoingLanded(list, pending)) {
    pendingRef.current = null;
    return list;
  }
  const extra: Msg[] = [{ role: pending.role, body: pending.body, at: pending.at }];
  if (pending.attach) extra.push({ role: "attach", body: pending.attach, at: pending.at });
  for (const id of pending.images) extra.push({ role: "image", body: id, at: pending.at });
  if (pending.quote) extra.push({ role: "quote", body: pending.quote, at: pending.at });
  if (pending.view) extra.push({ role: "view", body: pending.view, at: pending.at });
  return [...list, ...extra];
}

function sameLive(a: LiveTurn | null, b: LiveTurn | null): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return a.active === b.active && a.tool === b.tool && a.input === b.input && a.thought === b.thought && a.reply === b.reply && a.note === b.note && a.started_ms === b.started_ms && a.step_ms === b.step_ms;
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
  const sitl = isSitl(sample.params) || !!sample.sitl_running;
  if (
    linkFaceVehicle === vehicle
    && linkFaceCache.ok === sample.ok
    && linkFaceCache.frame === frame
    && linkFaceCache.mode === mode
    && linkFaceCache.armed === armed
    && linkFaceCache.boot_uid === boot_uid
    && linkFaceCache.board_name === board_name
    && linkFaceCache.sitl === sitl
    && sameFlow(linkFaceCache.log_download, sample.log_download)
  ) {
    return linkFaceCache;
  }
  linkFaceVehicle = vehicle;
  linkFaceCache = { ok: sample.ok, frame, mode, armed, boot_uid, board_name, sitl, log_download: sample.log_download };
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
  if (name === "board_orientation") return tr("Detect board orientation");
  if (name === "compass") return tr("Compass offset wizard");
  if (name === "compass_mot") return tr("Motor current wizard");
  if (name === "motors") return tr("Motor setup wizard");
  if (name === "radio") return tr("Radio setup");
  if (name === "modes") return tr("Flight modes");
  if (name === "battery") return tr("Battery setup");
  if (name === "failsafe") return tr("Failsafe");
  if (name === "servos") return tr("Servo outputs");
  if (name === "airspeed") return tr("Airspeed");
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
  if (p.kind === "comment" || p.kind === "profile") return tr(p.param);
  return p.param;
}

function waitTitle(tr: typeof import("../i18n/i18n").t, p: Proposal): string {
  if (p.kind === "connect") return tr("Connecting");
  if (p.kind === "disconnect") return tr("Disconnecting");
  if (p.kind === "reboot") return tr("Rebooting");
  if (p.kind === "mav_cmd") return tr("Executing {name}", { name: p.param });
  if (p.kind === "stick") return tr("Setting sticks");
  if (p.kind === "wait") return tr("Waiting");
  return proposalTitle(tr, p);
}

function sameAddition(group: Proposal[], item: Proposal): boolean {
  const kind = item.kind || "param";
  const alone = (k: string) => k === "wizard" || k === "comment" || k === "profile";
  if (alone(kind) || alone(group[0].kind || "param")) return false;
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
  if (cardKind(items) === "mav_cmd") return tr("Execute commands");
  if (cardKind(items) === "stick") return tr("Virtual sticks");
  if (cardKind(items) === "wait") return live ? tr("Waiting") : tr("Wait");
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
  if (item.kind === "mode" || item.kind === "mav_cmd" || item.kind === "stick" || item.kind === "wait") return item.param;
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
  if (kind === "mav_cmd") {
    return <svg {...common}><path d="M2.5 7.5 13.5 2.5 8.5 13.5 7.2 8.8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" /></svg>;
  }
  if (kind === "stick") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 2.4v11.2M2.4 8h11.2" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" />
        <circle cx="8" cy="8" r="2.2" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "wait") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 4.6v3.4l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
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
  if (kind === "profile") {
    return <svg {...common}><path d="M3 3v10M8 3v10M13 3v10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><rect x="1.5" y="9" width="3" height="2" rx=".5" fill="none" stroke="currentColor" strokeWidth="1.3" /><rect x="6.5" y="5" width="3" height="2" rx=".5" fill="none" stroke="currentColor" strokeWidth="1.3" /><rect x="11.5" y="7" width="3" height="2" rx=".5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>;
  }
  if (kind === "comment") {
    return <svg {...common}><rect x="2.4" y="2.2" width="11.2" height="11.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M4.6 5.4h6.8M4.6 8h6.8M4.6 10.6h4.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>;
  }
  return <svg {...common}><path d="M3 4.4h10M3 8h10M3 11.6h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="6" cy="4.4" r="1.2" fill="currentColor" /><circle cx="10.2" cy="8" r="1.2" fill="currentColor" /><circle cx="7.2" cy="11.6" r="1.2" fill="currentColor" /></svg>;
}

/** Steps a scoped motors card will open: Safety → Direction · M3 → Done. */
function MotorFlow({ t, p }: { t: (k: string, vars?: Record<string, string | number>) => string; p?: Proposal }) {
  if (!p || p.param !== "motors") return null;
  const scope = wizardScope(p.payload);
  if (!scope) return null;
  const on = scope.motors?.length ? ` · ${scope.motors.map((n) => `M${n}`).join(", ")}` : "";
  const name = { order: t("Order"), direction: t("Direction"), idle: t("Idle") };
  const steps = scope.steps?.length ? scope.steps : (["order", "direction"] as const);
  const chips = [t("Safety check"), ...steps.map((s) => (s === "idle" ? name.idle : `${name[s]}${on}`)), t("Done")];
  return (
    <p className="proposal-flow">
      {chips.map((c, i) => <span key={i} className={i > 0 && i < chips.length - 1 ? "on" : ""}>{c}</span>)}
    </p>
  );
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
  const profile = kind === "profile";
  const [draft, setDraft] = useState(() => commentText(shown[0]));
  const expandable = kind === "script" || (!wizardNote && !comment && !profile && (shown.length > 1 || shown.some((item) => item.reason.trim().length > 0)));
  const ids = uniqueChanges(pending).map((item) => item.id);
  return (
    <article className={`proposal${waiting.length && !pending.length ? " wait" : ""}${outcome ? " done" : ""}${profile ? " profile" : ""}`}>
      <header className="proposal-head">
        <span className="proposal-icon"><ProposalIcon kind={kind} /></span>
        <b>{cardTitle(t, shown)}</b>
        <div className="proposal-actions">
          {pending.length ? (
            profile ? null : kind === "wizard" ? (
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
      {profile ? (
        <ProfileCard
          payload={shown[0]?.payload ?? ""}
          pending={pending.length > 0}
          busy={busy}
          onSave={(answer) => onDecision("approve", ids, answer)}
          onSkip={() => onDecision("reject", ids)}
        />
      ) : comment ? (
        pending.length ? (
          <textarea className="proposal-comment" value={draft} maxLength={2000} aria-label={t("Comment")} onChange={(ev) => setDraft(ev.target.value)} />
        ) : (
          <p className="proposal-note">{commentText(shown[0])}</p>
        )
      ) : wizardNote ? <><p className="proposal-note">{wizardNote}</p>{kind === "wizard" ? <MotorFlow t={t} p={shown[0]} /> : null}</> : more ? (
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

const MODELS = DEFAULT_MODELS;

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
  const [dynamicModels, setDynamicModels] = useState<Record<string, string[]>>(() => loadCachedModels());
  useEffect(() => {
    void syncModelsDev().then((updated) => {
      if (updated) setDynamicModels(updated);
    });
  }, []);
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [wizardAsk, setWizardAsk] = useState<WizardAsk | null>(null);
  const [docOpen, setDocOpen] = useState<SavedDoc | null>(null);
  useEffect(() => {
    activeDocOpener = setDocOpen;
    return () => {
      if (activeDocOpener === setDocOpen) activeDocOpener = null;
    };
  }, []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Ask buttons elsewhere in the app send a prepared message; without an account they open Options.
  const sendRef = useRef<typeof onSend | null>(null);
  sendRef.current = onSend;
  const configuredRef = useRef(false);
  configuredRef.current = !!status?.configured;
  const optionsRef = useRef(onOpenOptions);
  optionsRef.current = onOpenOptions;
  const busyRef = useRef(false);
  busyRef.current = busy;
  /** An empty conversation, as the New chat button starts; the view chip is back on for it. */
  function newThread() {
    threadGen.current += 1;
    pendingOut.current = null;
    setChatId("");
    setMessages([]);
    setProposals([]);
    messagesRef.current = [];
    setViewOff(false);
    setAskStarters([]);
  }
  const newThreadRef = useRef(newThread);
  newThreadRef.current = newThread;
  // Setup marks the step a waiting card belongs to.
  useEffect(() => {
    setWaitingCards(proposals
      .filter((p) => p.status === "pending" && (p.kind === "wizard" || !p.kind || p.kind === "param"))
      .map((p) => ({ kind: p.kind === "wizard" ? "wizard" : "param", name: p.param })));
  }, [proposals]);
  useEffect(() => {
    const ask = (ev: Event) => {
      const detail = (ev as CustomEvent<AskDetail>).detail;
      if (!configuredRef.current) {
        optionsRef.current();
        return;
      }
      setOpen(true);
      if (detail.send) {
        if (detail.text) void sendRef.current?.(undefined, detail.text, true);
        return;
      }
      if (detail.keep) return;
      // Ask: a new chat with the view chip on and nothing sent. A running turn is not cut.
      if (!busyRef.current) newThreadRef.current?.();
      setAskStarters(detail.starters ?? []);
    };
    window.addEventListener(ASK_ASSISTANT, ask);
    return () => window.removeEventListener(ASK_ASSISTANT, ask);
  }, []);
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
  const [images, setImages] = useState<string[]>([]);
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
  const pendingOut = useRef<PendingOut | null>(null);
  function openThread() {
    threadGen.current += 1;
    return threadGen.current;
  }
  function adoptThread(gen: number, thread: { messages: Msg[]; proposals: Proposal[] }) {
    if (gen !== threadGen.current) return false;
    const messages = mergeOutgoing(thread.messages, pendingOut);
    messagesRef.current = messages;
    proposalJson.current = JSON.stringify(thread.proposals);
    setMessages(messages);
    setProposals(thread.proposals);
    return true;
  }
  function paintOutgoing(role: "user" | "steer", text: string, attached: string, quoted: LuaQuote | null, viewed: SetupView | null, pics: string[] = []) {
    pendingOut.current = {
      role,
      body: text,
      at: Math.floor(Date.now() / 1000),
      attach: attached,
      quote: quoted ? quotePayload(quoted) : "",
      view: viewed ? JSON.stringify(viewed) : "",
      images: pics,
    };
    setMessages((prev) => {
      const next = mergeOutgoing(prev, pendingOut);
      messagesRef.current = next;
      return next;
    });
  }
  function releaseLive() {
    if (sending.current) return;
    setLive((prev) => {
      const reply = prev?.reply ?? "";
      if (reply.trim() && !replyLanded(messagesRef.current, reply)) return prev;
      return null;
    });
    setBusy(false);
  }
  const narrow = useNarrow();

  async function refreshStatus() {
    try {
      const s = await ai.status();
      setStatus((cur) => JSON.stringify(cur) === JSON.stringify(s) ? cur : s);
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
          const mark = `${row.tool ?? ""}\n${row.input ?? ""}\n${row.note ?? ""}\n${row.holds ?? 0}\n${(row.docs ?? []).map((doc) => doc.url).join("\n")}`;
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
        if (sending.current) return;
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

  /** `fresh` starts a new conversation for the message, as the New chat button does. */
  async function onSend(ev?: FormEvent, preset?: string, fresh = false, presetImages?: string[]) {
    ev?.preventDefault();
    const text = (preset ?? draft).trim();
    if (!text) return;
    if (fresh) {
      // Do not cut into a turn that is still running: leave the text ready to send.
      if (busy) {
        setDraft(text);
        setNote("The assistant is still answering. Send this when it finishes.");
        return;
      }
      newThread();
    }
    const attached = logId;
    const quoted = preset ? null : getLuaQuote();
    const viewed = sentView();
    if (!fresh) setAskStarters([]);
    if (busy) {
      if (!chatId) return;
      setDraft("");
      setLogId("");
      setLuaQuote(null);
      paintOutgoing("steer", text, "", quoted, viewed);
      try {
        const res = await ai.send(chatId, text, getLang(), model, reasoning, attached, quoted, undefined, viewed);
        if (!res.ok) setNote(res.status || "network unavailable");
        const gen = openThread();
        const thread = await ai.thread(chatId);
        adoptThread(gen, thread);
      } catch (err) {
        pendingOut.current = null;
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
    // Images go with a new turn. A note to a running turn leaves them in the composer.
    // A retry sends the images of the failed message and leaves the composer as it is.
    const pics = presetImages ?? images;
    setFollowUser(true);
    setBusy(true);
    setLive({ active: true });
    pulled.current = "";
    setNote("");
    setDraft("");
    setLogId("");
    if (!presetImages) setImages([]);
    setLuaQuote(null);
    paintOutgoing("user", text, attached, quoted, viewed, pics);
    const ctrl = new AbortController();
    sendAbort.current = ctrl;
    sending.current = true;
    let id = fresh ? "" : chatId;
    try {
      if (!id) {
        const created = await ai.create(droneKey);
        id = created.id;
        setChatId(id);
      }
      const res = await ai.send(id, text, getLang(), model, reasoning, attached, quoted, ctrl.signal, viewed, pics);
      if (!res.ok) setNote(res.status || "network unavailable");
      const gen = openThread();
      const thread = await ai.thread(id);
      adoptThread(gen, thread);
      const list = await ai.chats();
      setChats(list.chats);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      pendingOut.current = null;
      if (!preset) setDraft(text);
      setLogId(attached);
      if (!presetImages) setImages(pics);
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
      if (ctrl.signal.aborted) {
        pendingOut.current = null;
        setBusy(false);
        setLive(null);
      } else if (id) {
        void ai.live(id).then((row) => {
          if (row.active) {
            setBusy(true);
            setLive((prev) => (sameLive(prev, row) ? prev : row));
          } else {
            setBusy(false);
          }
        }).catch(() => setBusy(false));
      } else {
        setBusy(false);
      }
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
    const idSet = new Set(pending.map((item) => item.id));
    const nextStatus = decision === "approve" ? "applied" : pending.some((item) => item.kind === "wizard") ? "cancelled" : "rejected_by_user";
    setProposals((prev) => prev.map((item) => idSet.has(item.id) ? { ...item, status: nextStatus } : item));
    setNote("");
    setFollowUser(true);
    setBusy(true);
    setLive({ active: true });
    pulled.current = "";
    sending.current = true;
    try {
      const batch = pending.length > 1 ? crypto.randomUUID() : "";
      for (const item of pending) {
        await ai.proposal(item.id, decision, getLang(), model, reasoning, logId, batch, decision === "approve" ? comment : undefined);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : t("Could not apply the change"));
    } finally {
      sending.current = false;
      if (chatId) {
        const gen = openThread();
        void ai.thread(chatId).then((thread) => adoptThread(gen, thread)).catch(() => {});
        void ai.live(chatId).then((row) => {
          if (row.active) {
            setBusy(true);
            setLive((prev) => (sameLive(prev, row) ? prev : row));
          } else {
            setBusy(false);
          }
        }).catch(() => setBusy(false));
      } else {
        setBusy(false);
      }
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
    : (dynamicModels[provider] || MODELS[provider] || []);
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
  const source = status?.active?.storage === "hosted" ? t("Cloud") : (provider.toUpperCase() || "—");
  const linkLine = configured ? source : t("Not configured");

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
    setProposals((prev) => prev.map((item) => item.id === id ? { ...item, status: report.outcome } : item));
    setNote("");
    setFollowUser(true);
    setBusy(true);
    setLive({ active: true });
    pulled.current = "";
    sending.current = true;
    try {
      await ai.wizard(id, report, getLang(), model, reasoning, logId);
    } catch (err) {
      setNote(err instanceof Error ? err.message : t("Could not apply the change"));
    } finally {
      sending.current = false;
      if (chatId) {
        const gen = openThread();
        void ai.thread(chatId).then((thread) => adoptThread(gen, thread)).catch(() => {});
        void ai.live(chatId).then((row) => {
          if (row.active) {
            setBusy(true);
            setLive((prev) => (sameLive(prev, row) ? prev : row));
          } else {
            setBusy(false);
          }
        }).catch(() => setBusy(false));
      } else {
        setBusy(false);
      }
    }
  }

  return (
    <LiveHost chatId={chatId}>
      {wizardAsk ? <WizardHost ask={wizardAsk} onDone={(id, report) => void onWizardDone(id, report)} /> : null}
      {docOpen ? <DocWindow doc={docOpen} onClose={() => setDocOpen(null)} /> : null}
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
            onPick={(id) => { setViewOff(false); setAskStarters([]); setChatId(id); }}
            onDraft={setDraft}
            onModel={setModel}
            onSend={(preset) => void onSend(undefined, preset)}
            onRetry={(text, pics) => void onSend(undefined, text, false, pics)}
            onDecision={onDecision}
            onCancelWait={onCancelWait}
            onOpenWizard={(id, wizard) => setWizardAsk({ id, wizard, scope: wizardScope(proposals.find((p) => p.id === id)?.payload) })}
            wizardOpenId={wizardAsk?.id ?? ""}
            onNew={newThread}
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
            images={images}
            onImages={setImages}
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
              onPick={(id) => { setViewOff(false); setAskStarters([]); setChatId(id); }}
              onDraft={setDraft}
              onModel={setModel}
              onSend={(preset) => void onSend(undefined, preset)}
              onRetry={(text, pics) => void onSend(undefined, text, false, pics)}
              onDecision={onDecision}
              onCancelWait={onCancelWait}
              onOpenWizard={(id, wizard) => setWizardAsk({ id, wizard, scope: wizardScope(proposals.find((p) => p.id === id)?.payload) })}
              wizardOpenId={wizardAsk?.id ?? ""}
              onNew={newThread}
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
            images={images}
            onImages={setImages}
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
    </LiveHost>
  );
}

/** A loaded file is stored as `{sha256_16}_{its own name}.bin`; show its own name. */
function logName(id: string): string {
  const cut = Math.max(id.lastIndexOf("/"), id.lastIndexOf("\\"));
  const name = cut >= 0 ? id.slice(cut + 1) : id;
  const own = /^[0-9a-f]{16}_(.+)$/i.exec(name);
  return own && !/^\d{14}_\d+\.bin$/.test(own[1]) ? own[1] : name;
}

/** The name a person knows the log by: its own file name, the board, or where it came from. */
function logTitle(item: LocalLog, t: (k: string, vars?: Record<string, string | number>) => string): string {
  if (item.original_name) return item.original_name;
  if (item.board) return item.board;
  if (item.vehicle === "imported") return t("Loaded log");
  if (item.vehicle) return t("Board {id}", { id: item.vehicle.slice(0, 8) });
  return logName(item.id);
}

/** Flight time, or the time it was stored when the log has no GPS time. Local time. */
function logWhen(item: LocalLog): string {
  const raw = item.flight_utc || item.saved_at;
  if (!raw) return "";
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return "";
  const two = (n: number) => String(n).padStart(2, "0");
  const year = at.getFullYear() === new Date().getFullYear() ? "" : `.${at.getFullYear()}`;
  return `${two(at.getDate())}.${two(at.getMonth() + 1)}${year} ${two(at.getHours())}:${two(at.getMinutes())}`;
}

function boardKey(uid: string | undefined): string {
  return (uid || "").replace(/[^0-9a-z]/gi, "").toUpperCase();
}

const LOG_ROWS = 60;

function ChatPane({
  t, chats, chatId, messages, proposals, draft, busy, followUser, note, model, models, bench, quota, compact,
  onPick, onDraft, onModel, onSend, onRetry, onDecision, onCancelWait, onOpenWizard, wizardOpenId, onNew, onBench, onStop,
  query, onQuery, reasoning, onReasoning, provider, onRename, onCancel,
  logs, logId, onLog, images, onImages, onImported, onContinue, drone, live, flow,
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
  onRetry: (text: string, images: string[]) => void;
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
  images: string[];
  onImages: (update: (prev: string[]) => string[]) => void;
  onImported: (id: string) => void;
  onContinue: () => void;
  drone: LinkFace;
  live: LiveTurn | null;
  flow?: Sample["log_download"];
}) {
  const scriptQuote = useSyncExternalStore(subscribeLuaQuote, getLuaQuote, getLuaQuote);
  const setupView = useSyncExternalStore(subscribeSetupView, getSetupView, getSetupView);
  const viewOff = useSyncExternalStore(subscribeSetupView, getViewOff, getViewOff);
  const askStarters = useSyncExternalStore(subscribeSetupView, getAskStarters, getAskStarters);
  const viewOn = !!setupView && !viewOff;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const pinning = useRef(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const logFile = useRef<HTMLInputElement>(null);
  const imageFile = useRef<HTMLInputElement>(null);
  const [plus, setPlus] = useState(false);
  const next = useMemo(() => nextSteps(messages), [messages]);
  const nextButtons = !busy && (next.ask.length || next.offer.length) ? (
    <div className="ai-suggest">
      {next.ask.map((item) => (
        <button key={`a-${item.label}`} type="button" className="ask" title={item.prompt} onClick={() => { onDraft(item.prompt); box.current?.focus(); }}>
          {item.label}
        </button>
      ))}
      {next.offer.map((item) => (
        <button key={`o-${item.label}`} type="button" className="offer" title={item.prompt} onClick={() => { onDraft(item.prompt); box.current?.focus(); }}>
          {item.label}
        </button>
      ))}
    </div>
  ) : null;
  const lastAsk = useMemo(() => lastUserAsk(messages), [messages]);
  const [adding, setAdding] = useState(0);
  const [imageNote, setImageNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState("");
  const room = IMAGES_PER_MESSAGE - images.length - adding;
  function addImages(files: File[]) {
    if (!files.length) return;
    setImageNote(files.length > room ? "Up to 4 images per message." : "");
    for (const file of files.slice(0, Math.max(0, room))) {
      setAdding((n) => n + 1);
      void shrinkImage(file)
        .then((small) => ai.uploadImage(small))
        .then((id) => onImages((prev) => (prev.includes(id) || prev.length >= IMAGES_PER_MESSAGE ? prev : [...prev, id])))
        .catch((err: unknown) => setImageNote(err instanceof Error ? err.message : "Could not add the image"))
        .finally(() => setAdding((n) => n - 1));
    }
  }
  const [modelOpen, setModelOpen] = useState(false);
  // A saved model that left the list stays visible, so the user sees what the next turn uses.
  const shownModel = model || models[0] || "";
  const modelList = shownModel && !models.includes(shownModel) ? [shownModel, ...models] : models;
  const [importing, setImporting] = useState<{ name: string; sent: number; total: number } | null>(null);
  const [importNote, setImportNote] = useState("");
  const [importDone, setImportDone] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const thisBoard = boardKey(drone.boot_uid);
  const [logScope, setLogScope] = useState<"board" | "all">("board");
  const logRows = useMemo(() => {
    const words = logQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const scoped = logScope === "board" && thisBoard ? logs.filter((item) => boardKey(item.vehicle) === thisBoard) : logs;
    const found = scoped.filter((item) => {
      const hay = `${logTitle(item, t)} ${item.board || ""} ${item.vehicle || ""} ${logWhen(item)} ${item.id}`.toLowerCase();
      return words.every((word) => hay.includes(word));
    });
    return found.slice(0, LOG_ROWS);
  }, [logs, logQuery, logScope, thisBoard, t]);
  const pickedLog = logs.find((item) => item.id === logId);
  const [renaming, setRenaming] = useState("");
  const [scope, setScope] = useState<"all" | "drone">("drone");
  const [filterOpen, setFilterOpen] = useState(false);
  const narrow = useNarrow();
  const [chatsOpen, setChatsOpen] = useState(() => !window.matchMedia("(max-width: 768px)").matches);
  useEffect(() => {
    if (narrow) setChatsOpen(false);
  }, [narrow]);
  const thread = useMemo(() => placeProposals(groupMessages(messages), proposals), [messages, proposals]);
  const { chatCost, chatTokens, chatTurns } = useMemo(() => {
    let cost = 0;
    let tokens = 0;
    let turns = 0;
    for (const b of thread) {
      if (b.kind === "tools") {
        if (b.workedUsd) cost += b.workedUsd;
        if (b.workedTokens) tokens += b.workedTokens;
        turns += 1;
      } else if (b.kind === "msg" && (b.msg.role === "user" || b.msg.role === "steer")) {
        turns += 1;
      }
    }
    if (live?.cost) cost += live.cost;
    if (live?.tokens) tokens += live.tokens;
    return { chatCost: cost, chatTokens: tokens, chatTurns: turns };
  }, [thread, live?.cost, live?.tokens]);
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
  const [keptThoughts, setKeptThoughts] = useState<Record<string, string>>({});
  const liveTools = shownThread.reduce((found, block, index) => block.kind === "tools" ? index : found, -1);
  const lastProposal = shownThread.reduce((found, block, index) => block.kind === "proposal" ? index : found, -1);
  const lastUser = shownThread.reduce((found, block, index) => (
    block.kind === "msg" && (block.msg.role === "user" || block.msg.role === "steer") ? index : found
  ), -1);
  const liveOnTools = liveTools > lastProposal && liveTools > lastUser;
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
    const focus = () => {
      window.setTimeout(() => {
        if (takeFocusRequest()) box.current?.focus();
      }, 60);
    };
    focus();
    window.addEventListener(ASK_ASSISTANT, focus);
    return () => window.removeEventListener(ASK_ASSISTANT, focus);
  }, []);
  useEffect(() => {
    if (!plus) return;
    const close = (ev: PointerEvent) => {
      if (!(ev.target instanceof Element) || !ev.target.closest(".ai-plus-wrap")) setPlus(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [plus]);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setZoom("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  useEffect(() => {
    if (!modelOpen) return;
    const close = (ev: PointerEvent) => {
      if (!(ev.target instanceof Element) || !ev.target.closest(".ai-model-wrap")) setModelOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [modelOpen]);
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
      <div
        className={`ai-thread${dragging ? " dropping" : ""}`}
        onDragOver={(ev) => {
          if (!Array.from(ev.dataTransfer.types).includes("Files")) return;
          ev.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(ev) => {
          if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(ev) => {
          const files = imageFiles(ev.dataTransfer.files);
          setDragging(false);
          if (!files.length) return;
          ev.preventDefault();
          addImages(files);
        }}
      >
        {dragging ? <div className="ai-drop" aria-hidden>{t("Drop images here")}</div> : null}
        {zoom ? (
          <div className="ai-zoom" role="dialog" aria-label={t("Image")} onClick={() => setZoom("")}>
            <img src={ai.imageUrl(zoom)} alt="" />
            <button type="button" aria-label={t("Close")} onClick={() => setZoom("")}>×</button>
          </div>
        ) : null}
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
                {viewOn && askStarters.length && setupView ? (
                  <p className="ai-view-lead">
                    {setupView.draft.length
                      ? t("The assistant sees {step} and your unwritten changes.", { step: t(setupView.title) })
                      : t("The assistant sees {step}.", { step: t(setupView.title) })}
                  </p>
                ) : null}
                <div className="ai-prompts">
                  {(viewOn && askStarters.length ? askStarters : starterPrompts(drone.frame)).map((text) => (
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
              <ToolGroup key={block.key} t={t} items={block.items} workedMs={block.workedMs} workedUsd={block.workedUsd} note={block.note} flow={index === liveTools ? flow : undefined} thought={keptThoughts[block.key]} live={busy && liveOnTools && index === liveTools ? live : null} />
            ) : block.kind === "proposal" ? (
              <ProposalCard key={block.key} t={t} items={block.items} busy={busy} onDecision={onDecision} onCancelWait={onCancelWait} onOpenWizard={onOpenWizard} wizardOpenId={wizardOpenId} />
            ) : (
              block.attach || block.quote || block.view || block.images?.length ? (
                <div key={block.key} className="ai-user-block">
                  <article className={block.msg.role}>
                    {block.msg.role === "steer" ? <span className="ai-steer-label">{t("Note for later")}</span> : null}
                    {block.msg.body}
                  </article>
                  {block.images?.length ? (
                    <div className="ai-sent-images">
                      {block.images.map((id) => (
                        <button key={id} type="button" className="ai-thumb" aria-label={t("Image")} onClick={() => setZoom(id)}>
                          <img src={ai.imageUrl(id)} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {block.attach ? <span className="ai-chip ai-chip-sent" title={block.attach}>{logName(block.attach)}</span> : null}
                  {block.quote ? <span className="ai-chip ai-chip-line" title={block.quoteTitle}>{block.quote}</span> : null}
                  {block.view ? <ViewChip body={block.view} t={t} /> : null}
                </div>
              ) : block.docs?.length && !block.msg.body ? (
                <DocStrip key={block.key} docs={block.docs} />
              ) : (
              <article key={block.key} className={block.msg.role}>
                {block.msg.role === "steer" ? <span className="ai-steer-label">{t("Note for later")}</span> : null}
                {block.msg.role === "assistant" && block.msg.body === "This turn stopped before a reply." && index === thread.length - 1 ? (
                  <div className="ai-resume">
                    <AssistantMarkdown text={shownNotice(block.msg.body, t)} />
                    <button type="button" disabled={busy} onClick={() => onSend(t("The tools above already returned. Continue from those results and do not call them again."))}>{t("Continue")}</button>
                  </div>
                ) : block.msg.role === "assistant" ? (
                  <>
                    <FailureNotice
                      body={block.msg.body}
                      t={t}
                      onRetry={index === held.length - 1 && !busy && lastAsk ? () => onRetry(lastAsk.text, lastAsk.images) : undefined}
                    />
                    {block.msg.body && !failureParts(block.msg.body) && !TURN_NOTICES.includes(block.msg.body) ? (
                      <CopyReply t={t} text={block.msg.body} lead={index === held.length - 1 ? nextButtons : null} />
                    ) : null}
                  </>
                ) : block.msg.body}
                {block.msg.role === "assistant" && block.msg.at !== -1 ? <ChartStrip charts={chartsUnder(held, index)} /> : null}
                {block.msg.role === "assistant" && (block.msg.at !== -1 || block.docs?.length) ? <DocStrip docs={[...(block.docs ?? []), ...(block.msg.at === -1 ? [] : docsUnder(held, index))]} /> : null}
                {block.msg.role === "assistant" && block.msg.at !== -1 && liveView?.index === index ? <LiveView spec={liveView.spec} /> : null}
              </article>
              )
            ))}
            {busy && !live?.reply && !liveOnTools ? (
              <div className="ai-tools-live" role="status">
                <p className="ai-tools ai-tools-status ai-thinking">
                  <span className="ai-think-spin" aria-hidden />
                  <span className="ai-tools-names">{live?.tool ? liveTitle(live, flow) : t("Thinking…")}</span>
                  <LiveClock t={t} live={live} />
                </p>
                {live?.thought ? <ThoughtText text={live.thought} /> : null}
              </div>
            ) : null}
            {nextButtons && !replyCarries(held.at(-1)) ? nextButtons : null}
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
            ) : drone.sitl ? (
              <div className="ai-safe-top">
                <span className="ai-safe on">{t("Safe mode · SITL")}</span>
              </div>
            ) : null}
            {note ? (
              <p className="ai-error">
                {t(note)}
                {note === "paused_limit" ? <button type="button" onClick={onContinue}>{t("Continue")}</button> : null}
              </p>
            ) : null}
            {images.length || adding ? (
              <div className="ai-pending-images">
                {images.map((id) => (
                  <span key={id} className="ai-thumb">
                    <button type="button" className="ai-thumb-open" aria-label={t("Image")} onClick={() => setZoom(id)}>
                      <img src={ai.imageUrl(id)} alt="" />
                    </button>
                    <button type="button" className="ai-thumb-drop" aria-label={t("Remove image")} onClick={() => { setImageNote(""); onImages((prev) => prev.filter((item) => item !== id)); }}>×</button>
                  </span>
                ))}
                {Array.from({ length: adding }, (_, index) => (
                  <span key={`adding-${index}`} className="ai-thumb adding" role="status" aria-label={t("Adding the image…")}>
                    <span className="lua-spin" aria-hidden />
                  </span>
                ))}
              </div>
            ) : null}
            {imageNote ? <p className="ai-error">{t(imageNote)}</p> : null}
            {scriptQuote || logId || viewOn ? (
              <div className="ai-chips">
                {viewOn && setupView ? (
                  <span className="ai-chip ai-chip-view" title={t("Sent with your message: where you are in Setup and what you have not written yet.")}>
                    <span>{viewLabel(setupView, t)}</span>
                    <button type="button" aria-label={t("Remove")} onClick={() => setViewOff(true)}>×</button>
                  </span>
                ) : null}
                {scriptQuote ? (
                  <span className="ai-chip ai-chip-line" title={scriptQuote.selection}>
                    <span>{quoteLabel(scriptQuote)}</span>
                    <button type="button" aria-label={t("Remove")} onClick={() => setLuaQuote(null)}>×</button>
                  </span>
                ) : null}
                {logId ? (
                  <span className="ai-chip" title={logId}>{pickedLog ? logTitle(pickedLog, t) : logName(logId)}<button type="button" aria-label={t("Remove")} onClick={() => onLog("")}>×</button></span>
                ) : null}
              </div>
            ) : null}
            <textarea
              ref={box}
              value={draft}
              onChange={(ev) => onDraft(ev.target.value)}
              placeholder={waiting || busy ? t("Add a note for the next reply") : viewOn && setupView ? t("Ask about {step}…", { step: setupView.focus ?? t(setupView.title) }) : t("Ask about this vehicle")}
              aria-label={t("Message")}
              rows={1}
              onPaste={(ev) => {
                const files = imageFiles(ev.clipboardData.items);
                if (!files.length) return;
                ev.preventDefault();
                addImages(files);
              }}
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
                  className={`ai-icon${plus || logId || images.length ? " on" : ""}${importing ? " busy" : ""}`}
                  aria-label={t("Add context")}
                  aria-expanded={plus}
                  onClick={() => setPlus((v) => !v)}
                >
                  +
                </button>
                {plus ? (
                  <div className="ai-plus-menu">
                    {setupView ? (
                      <label className="ai-plus-check">
                        <input type="checkbox" checked={!viewOff} onChange={(ev) => setViewOff(!ev.target.checked)} />
                        <span>{t("Current view")}<small>{viewLabel(setupView, t)}</small></span>
                      </label>
                    ) : null}
                    <div className="ai-log-pick">
                      <span className="ai-log-head">{t("Local log")}</span>
                      <input
                        type="search"
                        value={logQuery}
                        placeholder={t("Search by name, board, or date")}
                        aria-label={t("Search logs")}
                        onChange={(ev) => setLogQuery(ev.target.value)}
                      />
                      {thisBoard ? (
                        <div className="ai-log-scope" role="radiogroup" aria-label={t("Logs")}>
                          <button type="button" role="radio" aria-checked={logScope === "board"} className={logScope === "board" ? "on" : ""} onClick={() => setLogScope("board")}>{t("This vehicle")}</button>
                          <button type="button" role="radio" aria-checked={logScope === "all"} className={logScope === "all" ? "on" : ""} onClick={() => setLogScope("all")}>{t("All")}</button>
                        </div>
                      ) : null}
                      <div className="ai-log-list" role="listbox" aria-label={t("Local log")}>
                        <button type="button" role="option" aria-selected={!logId} className={!logId ? "on" : ""} onClick={() => { onLog(""); setPlus(false); }}>
                          <b>{t("No downloaded log")}</b>
                        </button>
                        {pickedLog && !logRows.includes(pickedLog) ? (
                          <button type="button" role="option" aria-selected className="on" onClick={() => setPlus(false)}>
                            <b>{logTitle(pickedLog, t)}</b>
                            <span>{[logWhen(pickedLog), t("{n} MB", { n: (pickedLog.bytes / 1048576).toFixed(1) }), pickedLog.original_name ? "" : logName(pickedLog.id)].filter(Boolean).join(" · ")}</span>
                          </button>
                        ) : null}
                        {logRows.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            role="option"
                            aria-selected={item.id === logId}
                            className={item.id === logId ? "on" : ""}
                            title={item.id}
                            onClick={() => { onLog(item.id); setPlus(false); }}
                          >
                            <b>{logTitle(item, t)}</b>
                            <span>
                              {[
                                logWhen(item),
                                t("{n} MB", { n: (item.bytes / 1048576).toFixed(1) }),
                                item.original_name && item.board ? item.board : "",
                                item.vehicle === "imported" && item.original_name ? t("no board id") : "",
                                item.original_name ? "" : logName(item.id),
                              ].filter(Boolean).join(" · ")}
                            </span>
                          </button>
                        ))}
                        {!logRows.length ? <p>{logQuery ? t("No log matches this search.") : t("No logs from this vehicle.")}</p> : null}
                      </div>
                    </div>
                    {importing ? (
                      <div className="ai-log-progress" role="status" aria-live="polite">
                        <span className="ai-log-progress-head">
                          <span className="lua-spin" aria-hidden="true" />
                          <b title={importing.name}>{importing.name}</b>
                        </span>
                        {importing.sent < importing.total ? (
                          <>
                            <i><b style={{ width: `${Math.round((importing.sent / importing.total) * 100)}%` }} /></i>
                            <span>
                              {t("Sending {pct}% · {sent} of {total} MB", {
                                pct: Math.round((importing.sent / importing.total) * 100),
                                sent: (importing.sent / 1048576).toFixed(1),
                                total: (importing.total / 1048576).toFixed(1),
                              })}
                            </span>
                          </>
                        ) : (
                          <>
                            <i className="wait"><b /></i>
                            <span>{t("Reading the log…")}</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <button type="button" className="ai-log-load" onClick={() => logFile.current?.click()}>
                        {t("Load a log")}
                      </button>
                    )}
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
                        setImportDone("");
                        if (file.size > 512 * 1024 * 1024) {
                          setImportNote("This log is larger than 512 MB.");
                          return;
                        }
                        setImporting({ name: file.name, sent: 0, total: file.size || 1 });
                        void ai.importLog(file, (sent, total) => {
                          setImporting({ name: file.name, sent, total: total || 1 });
                        }).then((saved) => {
                          onImported(saved.id);
                          setImportDone(file.name);
                        }).catch((err: unknown) => {
                          setImportNote(err instanceof Error ? err.message : "Could not load the log");
                        }).finally(() => setImporting(null));
                      }}
                    />
                    <button type="button" className="ai-log-load" disabled={room <= 0} onClick={() => imageFile.current?.click()}>
                      {t("Add an image")}
                    </button>
                    <input
                      ref={imageFile}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      multiple
                      hidden
                      onChange={(ev) => {
                        const files = imageFiles(ev.target.files);
                        ev.target.value = "";
                        setPlus(false);
                        addImages(files);
                      }}
                    />
                    {importNote ? <p className="ai-log-note">{t(importNote)}</p> : null}
                    {importDone && !importing ? <p className="ai-log-done">{t("Loaded {name}. The chat now uses this log.", { name: importDone })}</p> : null}
                  </div>
                ) : null}
              </div>
              {bench || drone.sitl ? null : (
                <button type="button" className="ai-safe" onClick={onBench}>{t("Safe mode")}</button>
              )}
              {models.length ? (
                <div className="ai-model-wrap">
                  <button
                    type="button"
                    className={`ai-model${modelOpen ? " on" : ""}`}
                    aria-label={t("Model")}
                    aria-expanded={modelOpen}
                    onClick={() => setModelOpen((v) => !v)}
                  >
                    <span className="ai-model-name">{shownModel}</span>
                    {reasoning && provider === "gemini" ? <span className="ai-model-level">· {reasoning}</span> : null}
                    <span className="ai-model-cost">{`· ${formatUsd(chatCost) || "$0.00"}`}</span>
                    <span className="ai-model-caret" aria-hidden>▾</span>
                  </button>
                  {modelOpen ? (
                    <div className="ai-model-menu">
                      <div className="ai-chat-usage">
                        <span className="ai-chat-usage-label">{t("Chat usage")}</span>
                        <span className="ai-chat-usage-val">
                          {formatUsd(chatCost) || "$0.00"}
                          {` · ${t("{n} tokens", { n: chatTokens > 0 ? formatTokens(chatTokens) : "0" })}`}
                          {chatTurns > 0 ? ` · ${t("{n} turns", { n: chatTurns })}` : ""}
                        </span>
                      </div>
                      <span className="ai-model-head">{t("Model")}</span>
                      {modelList.map((id) => (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={id === shownModel}
                          className={id === shownModel ? "on" : ""}
                          onClick={() => { onModel(id); setModelOpen(false); }}
                        >
                          {id}
                        </button>
                      ))}
                      <span className="ai-model-head">{t("Reasoning")}</span>
                      {provider === "gemini" ? (
                        <div className="ai-model-levels" role="radiogroup" aria-label={t("Reasoning")}>
                          {["", "low", "medium", "high"].map((level) => (
                            <button
                              key={level || "default"}
                              type="button"
                              role="radio"
                              aria-checked={reasoning === level}
                              className={reasoning === level ? "on" : ""}
                              onClick={() => onReasoning(level)}
                            >
                              {level || t("Provider default")}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p>{t("This model does not take a reasoning level. The provider default is used.")}</p>
                      )}
                    </div>
                  ) : null}
                </div>
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
    const doc = href ? cloudDocFromHref(href, typeof children === "string" ? children : "") : null;
    return (
      <a
        href={href}
        {...(ext ? { target: "_blank", rel: "noreferrer" } : {})}
        onClick={(ev) => {
          if (!doc) return;
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
          ev.preventDefault();
          openDocPreview(doc);
        }}
      >
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
  "The provider account has no credit.",
  "Paused at the tool limit. Continue to give a new budget.",
  "Stopped.",
  "invalid key",
  "model unavailable",
  "quota exceeded",
  "network unavailable",
];

/** Provider failures. Saved as the notice, the provider's own sentence, a blank line, and the raw error. */
const FAILURES = new Set([
  "The model rejected this turn because the request was too long.",
  "The model did not answer in time.",
  "The model request failed.",
  "The provider account has no credit.",
  "invalid key",
  "model unavailable",
  "quota exceeded",
  "network unavailable",
]);

function failureParts(body: string): { kind: string; said: string; raw: string } | null {
  const cut = body.indexOf("\n");
  const kind = cut < 0 ? body : body.slice(0, cut);
  if (!FAILURES.has(kind)) return null;
  const rest = cut < 0 ? "" : body.slice(cut + 1);
  const gap = rest.indexOf("\n\n");
  if (gap >= 0) return { kind, said: rest.slice(0, gap).trim(), raw: rest.slice(gap + 2).trim() };
  // Older chats saved only the raw error, cut at 300 characters.
  const said = /"message"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(rest);
  const provider = /\(adapter: ([^)]+)\)/.exec(rest);
  if (!said) return { kind, said: rest.trim(), raw: "" };
  const closed = rest.charAt(said.index + said[0].length) === '"';
  const text = said[1].replace(/\\(.)/g, "$1") + (closed ? "" : "…");
  return { kind, said: provider ? `${provider[1]}: ${text}` : text, raw: rest.trim() };
}

function FailureNotice({ body, t, onRetry }: { body: string; t: (k: string) => string; onRetry?: () => void }) {
  const parts = failureParts(body);
  if (!parts) return <AssistantMarkdown text={shownNotice(body, t)} />;
  const kind = t(parts.kind);
  return (
    <>
      <div className="ai-fail" role="alert">
        <b>{kind.charAt(0).toUpperCase() + kind.slice(1)}</b>
        {parts.said ? <p>{parts.said}</p> : null}
        {parts.raw ? (
          <details>
            <summary>{t("Details")}</summary>
            <pre>{parts.raw}</pre>
          </details>
        ) : null}
      </div>
      {onRetry ? (
        <div className="ai-reply-tools lead">
          <button type="button" aria-label={t("Retry")} title={t("Retry")} onClick={onRetry}>
            <RetryIcon />
          </button>
        </div>
      ) : null}
    </>
  );
}

type NextStep = { label: string; prompt: string };

/** Buttons from the last suggest_next of the latest turn. */
function nextSteps(messages: Msg[]): { ask: NextStep[]; offer: NextStep[] } {
  const none = { ask: [], offer: [] };
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") return none;
    if (msg.role !== "tool") continue;
    const parsed = parseToolJson(msg.body.trim());
    if (parsed?.name !== "suggest_next") continue;
    try {
      const value = JSON.parse(parsed.output) as { ok?: boolean; ask?: NextStep[]; offer?: NextStep[] };
      if (!value.ok) continue;
      const keep = (list?: NextStep[]) => (list || []).filter((item) => item?.label && item?.prompt).slice(0, 4);
      return { ask: keep(value.ask), offer: keep(value.offer) };
    } catch {
      return none;
    }
  }
  return none;
}

/** The last message the user sent and the images that went with it, for a retry. */
function lastUserAsk(messages: Msg[]): { text: string; images: string[] } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const images: string[] = [];
    for (let j = i + 1; j < messages.length && messages[j].role !== "user"; j++) {
      if (messages[j].role === "image") images.push(messages[j].body);
    }
    return { text: messages[i].body, images };
  }
  return null;
}

/** The clipboard API needs a focused, permitted page; the older copy command covers the rest. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** Whether this block is a reply whose copy row shows the buttons. */
function replyCarries(block: ThreadBlock | undefined): boolean {
  if (!block || block.kind !== "msg" || block.msg.role !== "assistant" || !block.msg.body) return false;
  return !failureParts(block.msg.body) && !TURN_NOTICES.includes(block.msg.body);
}

function CopyReply({ t, text, lead }: { t: (k: string) => string; text: string; lead?: ReactNode }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(id);
  }, [done]);
  return (
    <div className={`ai-reply-tools${lead ? " lead" : ""}`}>
      {lead}
      <button
        type="button"
        className="ai-icon-btn"
        aria-label={done ? t("Copied") : t("Copy")}
        title={done ? t("Copied") : t("Copy")}
        onClick={() => void copyText(text).then((ok) => setDone(ok))}
      >
        {done ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

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

type ToolItem = { key: string; name: string; input?: string; output: string; usd?: number };
type ThreadBlock =
  | { kind: "msg"; key: string; msg: Msg; at: number; attach?: string; images?: string[]; quote?: string; quoteTitle?: string; view?: string; docs?: SavedDoc[] }
  | { kind: "tools"; key: string; items: ToolItem[]; workedMs?: number; workedUsd?: number; workedTokens?: number; note?: string; at: number }
  | { kind: "proposal"; key: string; items: Proposal[]; at: number };

/** The Setup view chip a sent message carried, as it was at send time. */
function ViewChip({ body, t }: { body: string; t: (k: string, vars?: Record<string, string | number>) => string }) {
  let label = "";
  try {
    label = viewLabel(JSON.parse(body) as SetupView, t);
  } catch {
    return null;
  }
  return <span className="ai-chip ai-chip-view" title={t("What the assistant saw: where you were in Setup and what you had not written yet.")}>{label}</span>;
}

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

function parseTool(body: string): { name: string; input?: string; output: string; usd?: number } {
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

function parseToolJson(trimmed: string): { name: string; input?: string; output: string; usd?: number } | null {
  if (!trimmed.startsWith("{")) return null;
  try {
    const value = JSON.parse(trimmed) as { name?: unknown; input?: unknown; output?: unknown; usd?: unknown };
    if (value && typeof value.name === "string" && "output" in value) {
      return {
        name: value.name,
        input: "input" in value ? JSON.stringify(value.input ?? {}, null, 2) : undefined,
        output: typeof value.output === "string" ? value.output : JSON.stringify(value.output ?? {}, null, 2),
        usd: typeof value.usd === "number" && Number.isFinite(value.usd) ? value.usd : undefined,
      };
    }
  } catch {
    /* a clipped row still has a name */
  }
  return null;
}

function workInfo(body: string): { ms?: number; usd?: number; tokens?: number } {
  try {
    const value = JSON.parse(body) as { ms?: unknown; usd?: unknown; tokens?: unknown };
    return {
      ms: typeof value.ms === "number" && Number.isFinite(value.ms) ? value.ms : undefined,
      usd: typeof value.usd === "number" && Number.isFinite(value.usd) ? value.usd : undefined,
      tokens: typeof value.tokens === "number" && Number.isFinite(value.tokens) ? value.tokens : undefined,
    };
  } catch {
    /* not a work record */
  }
  return {};
}

function workMs(body: string): number | undefined {
  return workInfo(body).ms;
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
  const pendingDocs: SavedDoc[] = [];
  let pendingAt = 0;
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
    if (msg.role === "image") {
      const prev = out.at(-1);
      if (prev?.kind === "msg" && prev.msg.role === "user") {
        out[out.length - 1] = { ...prev, images: [...(prev.images ?? []), msg.body] };
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
    if (msg.role === "view") {
      const prev = out.at(-1);
      if (prev?.kind === "msg" && (prev.msg.role === "user" || prev.msg.role === "steer") && !prev.view) {
        out[out.length - 1] = { ...prev, view: msg.body };
      }
      continue;
    }
    if (msg.role === "doc") {
      const doc = parseDoc(msg.body);
      if (doc) {
        pendingDocs.push(doc);
        pendingAt = msg.at;
      }
      continue;
    }
    if (msg.role !== "tool") {
      flushNote(msg.at);
      const docs = msg.role === "assistant" ? pendingDocs.splice(0) : undefined;
      out.push({ kind: "msg", key: `${msg.at}-${i}`, msg, at: msg.at, docs: docs?.length ? docs : undefined });
      continue;
    }
    const items: ToolItem[] = [];
    const start = i;
    const groupNote = note.trim();
    note = "";
    noteMs = undefined;
    while (i < messages.length && messages[i].role === "tool") {
      const parsed = parseTool(messages[i].body);
      // suggest_next is shown as buttons under the reply, not as a tool row.
      if (parsed.name !== "suggest_next") items.push({ key: `${messages[i].at}-${i}`, ...parsed });
      i += 1;
    }
    let workedInfo: { ms?: number; usd?: number; tokens?: number } = {};
    if (i < messages.length && messages[i].role === "work") {
      workedInfo = workInfo(messages[i].body);
      i += 1;
    } else if (start > 0 && i < messages.length && messages[i].role === "assistant") {
      const span = Math.max(1, messages[i].at - messages[start - 1].at);
      workedInfo = { ms: span * 1000 };
    }
    i -= 1;
    out.push({
      kind: "tools",
      key: `tools-${start}`,
      items,
      workedMs: workedInfo.ms,
      workedUsd: workedInfo.usd,
      workedTokens: workedInfo.tokens,
      note: groupNote || undefined,
      at: messages[start].at,
    });
  }
  flushNote(0);
  if (pendingDocs.length) {
    out.push({
      kind: "msg",
      key: `docs-${pendingAt}`,
      msg: { role: "assistant", body: "", at: pendingAt },
      at: pendingAt,
      docs: pendingDocs.splice(0),
    });
  }
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

function matrixSpan(values: unknown): { count: number; min: number | null; max: number | null } {
  if (!Array.isArray(values)) return { count: 0, min: null, max: null };
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const row of values) {
    if (!Array.isArray(row)) continue;
    for (const value of row) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      count += 1;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return count ? { count, min, max } : { count: 0, min: null, max: null };
}

function chartBrief(output: string): string {
  try {
    const value = JSON.parse(output) as {
      chart?: {
        axes?: Array<{ lines?: Array<Record<string, unknown>> }>;
        heatmap?: Record<string, unknown>;
      };
    };
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
    const heat = value.chart?.heatmap;
    if (heat) {
      const x = spanOf(heat.x);
      const y = spanOf(heat.y);
      const z = matrixSpan(heat.z);
      delete heat.x;
      delete heat.y;
      delete heat.z;
      heat.times = x.count;
      heat.bins = y.count;
      heat.cells = z.count;
      heat.x_min = x.min;
      heat.x_max = x.max;
      heat.y_min = y.min;
      heat.y_max = y.max;
      heat.db_min = z.min;
      heat.db_max = z.max;
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return formatTool(output);
  }
}

function shownOutput(item: ToolItem): string {
  return item.name === "show_chart" || item.name === "show_spectrum" || item.name === "show_spectrogram"
    ? chartBrief(item.output)
    : formatTool(item.output);
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

type SavedDoc = { id?: string; title: string; format: string; url: string };

let activeDocOpener: ((doc: SavedDoc) => void) | null = null;

function openDocPreview(doc: SavedDoc) {
  activeDocOpener?.(doc);
}

function cloudDocFromHref(href: string, label: string): SavedDoc | null {
  try {
    const url = new URL(href);
    const match = /^\/(d|s)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
    if (!match) return null;
    if (
      !url.hostname.includes("arduloops-api")
      && url.hostname !== "127.0.0.1"
      && url.hostname !== "localhost"
    ) {
      return null;
    }
    return {
      ...(match[1] === "d" ? { id: match[2] } : {}),
      title: label.trim() || "Document",
      format: "",
      url: href,
    };
  } catch {
    return null;
  }
}

function parseDoc(body: string): SavedDoc | null {
  try {
    const value = JSON.parse(body) as { id?: string; title?: string; format?: string; url?: string };
    if (!value?.url && !value?.id) return null;
    return {
      ...(value.id ? { id: value.id } : {}),
      title: value.title || "Document",
      format: value.format || "",
      url: value.url || "",
    };
  } catch {
    return null;
  }
}

function docsFromTools(items: { name: string; output: string }[]): SavedDoc[] {
  const docs: SavedDoc[] = [];
  for (const item of items) {
    if (item.name !== "save_document") continue;
    try {
      const value = JSON.parse(item.output) as { ok?: boolean; id?: string; title?: string; format?: string; url?: string };
      if (!value || value.ok === false || (!value.url && !value.id)) continue;
      docs.push({
        ...(value.id ? { id: value.id } : {}),
        title: value.title || "Document",
        format: value.format || "html",
        url: value.url || "",
      });
    } catch {
      /* skip */
    }
  }
  return docs;
}

function docsUnder(blocks: ThreadBlock[], index: number) {
  const prev = blocks[index - 1];
  return prev?.kind === "tools" ? docsFromTools(prev.items) : [];
}

function uniqueDocs(docs: SavedDoc[]): SavedDoc[] {
  const seen = new Set<string>();
  return docs.filter((doc) => {
    const key = doc.id || doc.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function DocStrip({ docs }: { docs: SavedDoc[] }) {
  const t = useT();
  const list = uniqueDocs(docs);
  if (!list.length) return null;
  return (
    <div className="ai-docs">
      {list.map((doc) => (
        <div key={doc.id || doc.url} className="ai-doc-card">
          <button type="button" className="ai-doc-open" onClick={() => openDocPreview(doc)}>
            <b>{doc.title}</b>
            <span>{doc.format ? `${doc.format} · ${t("Preview")}` : t("Preview")}</span>
          </button>
          {doc.url ? (
            <a
              className="ai-doc-ext"
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              aria-label={t("Open in browser")}
              title={t("Open in browser")}
            >
              <OpenPageIcon />
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function DocWindow({ doc, onClose }: { doc: SavedDoc; onClose: () => void }) {
  const t = useT();
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const placed = useRef<{ left: string; top: string; width: string; height: string } | null>(null);
  const [full, setFull] = useState(false);
  const [loaded, setLoaded] = useState<CloudDoc | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState("");

  useEffect(() => {
    let stop = false;
    setLoaded(null);
    setErr("");
    setShareUrl("");
    ai.doc({ id: doc.id, url: doc.url }).then((res) => {
      if (stop) return;
      setLoaded(res);
      if (res.url) setShareUrl(res.url);
    }).catch((error: unknown) => {
      if (stop) return;
      setErr(error instanceof Error ? error.message : t("Document not found."));
    });
    return () => { stop = true; };
  }, [doc.id, doc.url]);

  function placeFull(on: boolean) {
    const node = frame.current;
    if (!node) return;
    drag.current = null;
    if (on) {
      placed.current = { left: node.style.left, top: node.style.top, width: node.style.width, height: node.style.height };
      node.style.left = "";
      node.style.top = "";
      node.style.width = "";
      node.style.height = "";
      setFull(true);
      return;
    }
    const prev = placed.current;
    const topMin = Math.max(8, parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--status-top")) || 0);
    node.style.left = prev?.left ?? "";
    node.style.top = prev?.top ? `${Math.max(topMin, parseFloat(prev.top) || topMin)}px` : "";
    node.style.width = prev?.width ?? "";
    node.style.height = prev?.height ?? "";
    setFull(false);
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (full) placeFull(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, onClose]);

  function onDrag(ev: ReactPointerEvent<HTMLElement>) {
    if (full) return;
    if ((ev.target as HTMLElement).closest("button, a")) return;
    const node = frame.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    drag.current = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore invalid pointer id */
    }
  }

  function onMove(ev: ReactPointerEvent<HTMLElement>) {
    const start = drag.current;
    const node = frame.current;
    if (!start || !node) return;
    const topMin = Math.max(8, parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--status-top")) || 0);
    const maxLeft = Math.max(8, window.innerWidth - node.offsetWidth - 8);
    const maxTop = Math.max(topMin, window.innerHeight - 44);
    node.style.left = `${Math.min(maxLeft, Math.max(8, start.left + ev.clientX - start.x))}px`;
    node.style.top = `${Math.min(maxTop, Math.max(topMin, start.top + ev.clientY - start.y))}px`;
  }

  const ownerDocId = loaded?.id || doc.id || (doc.url.includes("/d/") ? doc.url.split("/d/")[1]?.split(/[/?#]/)[0] : "");
  const format = loaded?.format || doc.format || "html";
  const title = loaded?.title || doc.title || t("Document");
  const views = loaded?.views;
  const isShared = Boolean(loaded?.shared || shareUrl);
  const browserUrl = shareUrl || doc.url;

  async function onToggleShare() {
    if (!ownerDocId) return;
    setBusy(true);
    try {
      if (isShared) {
        const res = await ai.unshareDoc({ id: ownerDocId, url: doc.url });
        setShareUrl("");
        setLoaded((prev) => prev ? { ...prev, shared: res.shared, views: res.views ?? prev.views } : prev);
      } else {
        const res = await ai.shareDoc({ id: ownerDocId, url: doc.url });
        if (res.url) {
          setShareUrl(res.url);
          try { await navigator.clipboard.writeText(res.url); } catch { /* clipboard optional */ }
        }
        setLoaded((prev) => prev ? { ...prev, shared: res.shared, views: res.views ?? prev.views } : prev);
      }
    } catch (error) {
      setErr(error instanceof Error ? error.message : t("The request failed."));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="ai-chart-back" onClick={onClose} role="presentation">
      <div
        className={full ? "ai-chart-window ai-doc-window full" : "ai-chart-window ai-doc-window"}
        ref={frame}
        role="dialog"
        aria-label={title}
        onClick={(ev) => ev.stopPropagation()}
      >
        <header
          onPointerDown={onDrag}
          onPointerMove={onMove}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onLostPointerCapture={() => { drag.current = null; }}
        >
          <b>{title}</b>
          <span className="ai-doc-meta">
            {format}
            {views != null ? ` · ${t("{n} views", { n: views })}` : ""}
          </span>
          {ownerDocId ? (
            <button
              type="button"
              className={isShared ? "ai-doc-action" : "ai-doc-action cyan"}
              disabled={busy || !loaded}
              onClick={() => void onToggleShare()}
            >
              {isShared ? t("Stop sharing") : t("Share")}
            </button>
          ) : null}
          {browserUrl ? (
            <a
              className="ai-doc-link"
              href={browserUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={t("Open in browser")}
              title={t("Open in browser")}
            >
              <OpenPageIcon />
            </a>
          ) : null}
          <button
            type="button"
            aria-pressed={full}
            aria-label={full ? t("Exit full screen") : t("Full screen")}
            title={full ? t("Exit full screen") : t("Full screen")}
            onClick={() => placeFull(!full)}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              {full ? (
                <path d="M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
          <button type="button" aria-label={t("Close")} title={t("Close")} onClick={onClose}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M3.2 3.2 12.8 12.8M12.8 3.2 3.2 12.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {shareUrl ? (
          <div className="ai-doc-share-bar">
            <a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>
          </div>
        ) : null}
        <div className="ai-doc-body">
          {err ? (
            <p className="ai-live-empty">{t(err)}</p>
          ) : !loaded ? (
            <p className="ai-live-empty">{t("Loading…")}</p>
          ) : format === "html" || format === "svg" ? (
            <iframe sandbox="allow-scripts allow-forms" srcDoc={loaded.body} title={title} />
          ) : format === "md" ? (
            <div className="ai-doc-md">
              <AssistantMarkdown text={loaded.body} />
            </div>
          ) : (
            <pre>{loaded.body}</pre>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
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
    const tail = trailingAssistant(blocks);
    if (tail && book.landed.has(tail.msg.at) && sameReply(tail.msg.body, text)) {
      book.pending = null;
      return stampReply(blocks, book);
    }
    if (!book.pending) {
      book.seq += 1;
      book.pending = { key: `stream-${book.seq}`, body: text };
    } else {
      book.pending.body = text;
    }
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
    if (msg.role === "assistant" && sameReply(msg.body, text)) return true;
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

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** How long the current step and the whole turn have run. Ticks on its own, so the thread does not re-render. */
function LiveClock({ t, live }: { t: (k: string, vars?: Record<string, string | number>) => string; live: LiveTurn | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!live?.step_ms || !live.started_ms) return null;
  const step = now - live.step_ms;
  const total = now - live.started_ms;
  return (
    <span className="ai-clock" aria-hidden>
      {clock(step)}
      {total - step >= 1000 ? <span className="ai-clock-total">{t("{t} in total", { t: clock(total) })}</span> : null}
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
  t, items, workedMs, workedUsd, note, thought, live, flow,
}: {
  t: (k: string, vars?: Record<string, string | number>) => string;
  items: ToolItem[];
  workedMs?: number;
  workedUsd?: number;
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
        {live && !live.tool ? <span className="ai-think-spin" aria-hidden /> : null}
        <span className="ai-tools-names">
          {live ? running : workedMs != null ? workedLabel(t, workedMs) : t("Tools")}
          {!live && workedUsd ? <span className="ai-cost">{` · ${formatUsd(workedUsd)}`}</span> : null}
        </span>
        {live ? (
          <span className="ai-live-time-wrap">
            <LiveClock t={t} live={live} />
            {live.cost ? <span className="ai-cost-live">{` · ${formatUsd(live.cost)}`}</span> : null}
          </span>
        ) : null}
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
          {item.usd ? <span className="ai-tool-cost" title={`$${item.usd.toFixed(4)}`}>{` · ${formatUsd(item.usd)}`}</span> : null}
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

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="5.4" y="5.4" width="7.8" height="7.8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.6 5.4V4.2a1.4 1.4 0 0 0-1.4-1.4H4.2a1.4 1.4 0 0 0-1.4 1.4v5a1.4 1.4 0 0 0 1.4 1.4h1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3.4 8.4 6.6 11.4 12.6 4.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M12.8 8a4.8 4.8 0 1 1-1.4-3.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12.2 2.4v2.8H9.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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

function statusBarTop(): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--status-top").trim();
  const px = parseFloat(raw);
  return Number.isFinite(px) ? px : 0;
}

function clampFloat(x: number, y: number, w: number, _h: number): { x: number; y: number } {
  const topMin = Math.max(8, statusBarTop());
  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)),
    y: Math.min(Math.max(topMin, y), Math.max(topMin, window.innerHeight - 44)),
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
