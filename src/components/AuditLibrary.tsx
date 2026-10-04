import { useCallback, useEffect, useMemo, useState } from "react";
import { ai, type AuditEvent } from "../assistant/api";
import { useT } from "../i18n/i18n";
import { WorkspaceTabs, type WorkspaceId } from "./WorkspaceTabs";

function when(at: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(at * 1000));
}

function tone(result: string): string {
  if (result === "applied" || result === "active" || result === "ready") return "match";
  if (result === "failed" || result === "revoked" || result === "rejected" || result === "rejected_by_user" || result === "network unavailable") return "warn";
  return "";
}

function ResultMark({ result, label }: { result: string; label: string }) {
  if (!result) return null;
  const kind = tone(result);
  return (
    <svg className={`audit-mark${kind ? ` ${kind}` : ""}`} viewBox="0 0 16 16" width="14" height="14" role="img" aria-label={label}>
      <title>{label}</title>
      {kind === "match" ? (
        <path d="M3.2 8.2 6.3 11.3 12.8 4.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : kind === "warn" ? (
        <path d="M4 4 12 12M12 4 4 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      )}
    </svg>
  );
}

function SourceMark({ source, label }: { source: string; label: string }) {
  if (!source) return null;
  const assistant = source.startsWith("agent");
  return (
    <svg className="audit-mark" viewBox="0 0 16 16" width="14" height="14" role="img" aria-label={label}>
      <title>{label}</title>
      {assistant ? (
        <path d="M8 1.8 9.2 6.1 13.6 7.2 9.2 8.3 8 12.6 6.8 8.3 2.4 7.2 6.8 6.1z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      ) : (
        <rect x="3" y="3.2" width="10" height="9.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      )}
    </svg>
  );
}

function phrase(text: string, tr: (k: string) => string): string {
  if (text === "Restore the audited value" || text === "armed" || text === "disarmed") return tr(text);
  return text;
}

function fmt(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value * 1e6) / 1e6);
}

type Change = { name: string; old: number | null; next: number | null; batch: string };

function readChange(row: AuditEvent): Change | null {
  if (!row.action.startsWith("param ")) return null;
  const name = row.action.slice("param ".length);
  const detail = row.detail || "";
  try {
    const parsed = JSON.parse(detail) as { old?: unknown; requested?: unknown; batch?: unknown };
    if (typeof parsed.requested === "number") {
      return {
        name,
        old: typeof parsed.old === "number" ? parsed.old : null,
        next: parsed.requested,
        batch: typeof parsed.batch === "string" ? parsed.batch : "",
      };
    }
  } catch {
    /* older rows stored a debug print, not JSON */
  }
  const oldMatch = detail.match(/"old":(?:None|Some\(([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\))/);
  const nextMatch = detail.match(/"requested":([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
  if (!nextMatch) return { name, old: null, next: null, batch: "" };
  return {
    name,
    old: oldMatch?.[1] ? Number(oldMatch[1]) : null,
    next: Number(nextMatch[1]),
    batch: "",
  };
}

const KINDS = new Set(["param", "connect", "disconnect", "reboot", "mode", "arm", "disarm", "erase_logs", "flash", "bench", "firmware"]);

function kindOf(action: string): string {
  const word = action.split(" ")[0]?.toLowerCase() || "other";
  if (word === "erase") return "erase_logs";
  return KINDS.has(word) ? word : "other";
}

function linkPlace(url: string): string {
  const serial = url.match(/^serial:([^:]+)/i);
  if (serial) return serial[1];
  return url.replace(/^(tcpout|udpout|udpin):/i, "");
}

function compactDetail(detail: string, tr: (k: string) => string): string {
  const text = detail.trim();
  if (!text) return "";
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return text;
    const parts: string[] = [];
    const url = typeof value.detail === "string" ? value.detail : "";
    if (url) parts.push(linkPlace(url));
    if (typeof value.frame === "string" && value.frame) parts.push(value.frame);
    if (typeof value.mode === "string" && value.mode) parts.push(value.mode);
    if (typeof value.armed === "boolean") parts.push(tr(value.armed ? "armed" : "disarmed"));
    if (value.linked === false) parts.push(tr("not linked"));
    if (value.already_linked === true) parts.push(tr("again"));
    const used = new Set(["detail", "frame", "mode", "armed", "linked", "already_linked", "note", "action", "status"]);
    for (const [key, item] of Object.entries(value)) {
      if (used.has(key) || item == null || item === "") continue;
      parts.push(`${key} ${typeof item === "object" ? JSON.stringify(item) : String(item)}`);
    }
    return parts.join(" · ");
  } catch {
    return text;
  }
}

type Pack = { rows: AuditEvent[] };

const PACK_GAP_S = 4;

function packEvents(rows: AuditEvent[]): Pack[] {
  const packs: Pack[] = [];
  let i = 0;
  while (i < rows.length) {
    const change = readChange(rows[i]);
    if (change?.batch) {
      const batch = change.batch;
      const members = [rows[i]];
      let j = i + 1;
      while (j < rows.length && readChange(rows[j])?.batch === batch) {
        members.push(rows[j]);
        j += 1;
      }
      packs.push({ rows: members });
      i = j;
      continue;
    }
    if (change) {
      const members = [rows[i]];
      let j = i + 1;
      while (j < rows.length) {
        const next = readChange(rows[j]);
        const prev = members[members.length - 1];
        if (!next || next.batch || rows[j].source !== rows[i].source || prev.at - rows[j].at > PACK_GAP_S) break;
        members.push(rows[j]);
        j += 1;
      }
      packs.push({ rows: members });
      i = j;
      continue;
    }
    packs.push({ rows: [rows[i]] });
    i += 1;
  }
  return packs;
}

function RevertDialog({
  items, busy, note, onCancel, onConfirm, t,
}: {
  items: { name: string; from: number | null; value: number }[];
  busy: boolean;
  note: string;
  onCancel: () => void;
  onConfirm: () => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  return (
    <div className="modal-back" onClick={() => { if (!busy) onCancel(); }} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="revert-title" onClick={(ev) => ev.stopPropagation()}>
        <div className="modal-head">
          <h2 id="revert-title">{t("Restore the audited value")}</h2>
          <button type="button" className="modal-x" onClick={onCancel} disabled={busy} aria-label={t("Close")} title={t("Close")}>×</button>
        </div>
        <ul className="audit-changes">
          {items.map((item) => (
            <li key={item.name}>
              <b>{item.name}</b>
              <span>{`${fmt(item.from)} → ${fmt(item.value)}`}</span>
            </li>
          ))}
        </ul>
        {note ? <p className="audit-facts">{note}</p> : null}
        <div className="ai-bench-actions">
          <button type="button" disabled={busy} onClick={onCancel}>{t("Cancel")}</button>
          <button type="button" className="cyan" disabled={busy} onClick={onConfirm}>{t("Confirm")}</button>
        </div>
      </div>
    </div>
  );
}

function AuditPack({
  pack, t, onRevert,
}: {
  pack: Pack;
  t: (k: string, vars?: Record<string, string | number>) => string;
  onRevert: (items: { name: string; from: number | null; value: number }[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const chronological = [...pack.rows].reverse();
  const changes = chronological.map((row) => ({ row, change: readChange(row) }));
  const many = chronological.length > 1;
  const head = pack.rows[0];
  const kind = kindOf(head.action);
  const results = new Set(pack.rows.map((row) => row.result));
  const result = results.size === 1 ? head.result : "";
  const sources = new Set(pack.rows.map((row) => row.source));
  const source = sources.size === 1 ? head.source : "";
  const first = changes[0]?.change;
  const facts = first ? "" : compactDetail(head.detail || "", t);
  const revertable = changes.filter((item) => item.change && item.change.old != null && item.row.result === "applied");
  const title = first
    ? `${first.name}  ${fmt(first.old)} → ${fmt(first.next)}${many ? `  +${changes.length - 1}` : ""}`
    : head.reason;
  return (
    <article className={`work-item kind-${kind}`}>
      <div className="work-row audit-line">
        <span className="audit-marks">
          <ResultMark result={result} label={result ? t(result) : ""} />
          <SourceMark source={source} label={source ? t(source) : ""} />
        </span>
        <time>{when(head.at)}</time>
        <div>
          {title ? <b>{phrase(title, t)}</b> : null}
          {first && !many && head.reason ? <span>{phrase(head.reason, t)}</span> : null}
          {facts ? <span className="audit-facts" title={head.detail || undefined}>{facts}</span> : null}
        </div>
        {revertable.length ? (
          <button type="button" className="audit-revert" onClick={() => onRevert(revertable.map((item) => ({
            name: item.change!.name,
            from: item.change!.next,
            value: item.change!.old as number,
          })))}>{t("Revert")}</button>
        ) : <span className="audit-gap" />}
        {many ? (
          <button
            type="button"
            className="audit-chevron"
            aria-expanded={open}
            aria-label={open ? t("Collapse the audit entry") : t("Expand the audit entry")}
            onClick={() => setOpen((value) => !value)}
          />
        ) : <span className="audit-gap" />}
      </div>
      {many && open ? (
        <ul className="audit-changes">
          {changes.map(({ row, change }, index) => (
            <li key={`${row.at}-${index}`}>
              <b>{change?.name || row.action}</b>
              {change && change.next != null ? <span>{`${fmt(change.old)} → ${fmt(change.next)}`}</span> : null}
              {results.size > 1 ? <ResultMark result={row.result} label={t(row.result)} /> : null}
              {row.reason ? <span className="audit-reason">{phrase(row.reason, t)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function AuditLibrary({ current, ids, onWorkspace }: { current: WorkspaceId; ids: WorkspaceId[]; onWorkspace: (id: WorkspaceId) => void }) {
  const t = useT();
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [result, setResult] = useState("");
  const [period, setPeriod] = useState("day");
  const [revertItems, setRevertItems] = useState<{ name: string; from: number | null; value: number }[] | null>(null);
  const [revertBusy, setRevertBusy] = useState(false);
  const [revertNote, setRevertNote] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setErr("");
    ai.audit()
      .then((r) => setRows(r.events))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const sources = useMemo(() => [...new Set(rows.map((row) => row.source))].sort(), [rows]);
  const results = useMemo(() => [...new Set(rows.map((row) => row.result))].sort(), [rows]);
  const packs = useMemo(() => packEvents(rows), [rows]);
  const needle = q.trim().toLowerCase();
  const shown = packs.filter((pack) => {
    if (source && !pack.rows.some((row) => row.source === source)) return false;
    if (result && !pack.rows.some((row) => row.result === result)) return false;
    const age = Date.now() / 1000 - pack.rows[0].at;
    if (period === "day" && age > 86400) return false;
    if (period === "week" && age > 7 * 86400) return false;
    if (!needle) return true;
    return pack.rows.some((row) => {
      const change = readChange(row);
      const delta = change ? `${change.name} ${fmt(change.old)} ${fmt(change.next)}` : "";
      return `${row.action} ${row.reason} ${row.result} ${row.source} ${delta}`.toLowerCase().includes(needle);
    });
  });

  return (
    <section className="scope work">
      <div className="work-bar">
        <WorkspaceTabs current={current} ids={ids} onSelect={onWorkspace} />
        <button type="button" className="firmware-refresh" onClick={load} disabled={loading}>
          {loading ? t("Refreshing…") : t("Refresh")}
        </button>
      </div>
      {err ? <p className="work-empty">{err}</p> : null}
      <div className="split">
        <div className="param-main">
          <div className="table-tools">
            <label className="work-find-wrap">
              <span className="sr-only">{t("Search the audit")}</span>
              <input className="work-find" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={t("Search the audit")} autoComplete="off" spellCheck={false} />
            </label>
            <span className="work-count" title={t("Audit events: {count}", { count: shown.length })}>{shown.length}</span>
          </div>
          <div className="work-list">
            {!err && !loading && rows.length === 0 ? <p className="work-empty">{t("No assistant actions yet.")}</p> : null}
            {!err && !loading && rows.length > 0 && shown.length === 0 ? <p className="work-empty">{t("No audit events match this filter.")}</p> : null}
            {shown.map((pack, i) => (
              <AuditPack key={`${pack.rows[0].at}-${i}`} pack={pack} t={t} onRevert={(items) => { setRevertNote(""); setRevertItems(items); }} />
            ))}
          </div>
        </div>
        <nav className="side-nav" aria-label={t("audit")}>
          <b>{t("When")}</b>
          <button type="button" className={period === "day" ? "on" : undefined} onClick={() => setPeriod("day")}>{t("Last 24 hours")}</button>
          <button type="button" className={period === "week" ? "on" : undefined} onClick={() => setPeriod("week")}>{t("Last 7 days")}</button>
          <button type="button" className={period === "all" ? "on" : undefined} onClick={() => setPeriod("all")}>{t("Any time")}</button>
          <b>{t("Sources")}</b>
          <button type="button" className={source === "" ? "on" : undefined} onClick={() => setSource("")}>{t("All sources")}</button>
          {sources.map((item) => (
            <button key={item} type="button" className={source === item ? "on" : undefined} onClick={() => setSource(item)}>{t(item)}</button>
          ))}
          <b>{t("Results")}</b>
          <button type="button" className={result === "" ? "on" : undefined} onClick={() => setResult("")}>{t("Any result")}</button>
          {results.map((item) => (
            <button key={item} type="button" className={result === item ? "on" : undefined} onClick={() => setResult(item)}>{t(item)}</button>
          ))}
        </nav>
      </div>
      {revertItems ? (
        <RevertDialog
          items={revertItems}
          busy={revertBusy}
          note={revertNote}
          t={t}
          onCancel={() => { if (!revertBusy) setRevertItems(null); }}
          onConfirm={() => {
            if (revertBusy) return;
            setRevertBusy(true);
            setRevertNote("");
            void ai.revert(revertItems.map((item) => ({ name: item.name, value: item.value, from: item.from }))).then((res) => {
              if ((res.applied ?? 0) < revertItems.length) {
                setRevertNote(t("Could not apply the change"));
                load();
                return;
              }
              setRevertItems(null);
              load();
            }).catch((err: Error) => setRevertNote(err.message)).finally(() => setRevertBusy(false));
          }}
        />
      ) : null}
    </section>
  );
}
