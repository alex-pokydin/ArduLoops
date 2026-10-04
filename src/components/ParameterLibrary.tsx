import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { noteUi, sameParam, send, writeParam } from "../mav/cmd";
import { APP_HTTP } from "../mav/link";
import { formatParamBackup, parseParamFile } from "../mav/paramFile";
import { getLinkBits, getParamsSnapshot, getSnapshot, subscribe } from "../mav/store";

type ParamDoc = { human?: string; doc?: string; min?: string; max?: string; range?: string; units?: string };

type Category = "all" | "flight" | "navigation" | "sensors" | "radio" | "power" | "outputs" | "safety" | "system" | "other";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "flight", label: "Flight control" },
  { id: "navigation", label: "Navigation" },
  { id: "sensors", label: "Sensors" },
  { id: "radio", label: "Radio" },
  { id: "power", label: "Power" },
  { id: "outputs", label: "Outputs" },
  { id: "safety", label: "Safety" },
  { id: "system", label: "System" },
  { id: "other", label: "Other" },
];

function categoryOf(name: string): Category {
  if (/^(?:ARMING|FS|FAILSAFE|FENCE|BRD_SAFETY|LAND|CRASH)(?:_|$|\d)/.test(name)) return "safety";
  if (/^(?:SYSID|BRD|SERIAL|LOG|SCHED|CAN|STAT|FORMAT|GCS|MAV|AUTH|FRAME)(?:_|$|\d)/.test(name)) return "system";
  if (/^(?:ATC|PSC|LOIT|WPNAV|PILOT|MOT|ACRO|ANGLE|THR|FLTD|FHLD|AUTOTUNE)(?:_|$|\d)/.test(name)) return "flight";
  if (/^(?:WP|RTL|AVOID|OA|MIS|RALLY|TERRAIN|CIRCLE|GUID)(?:_|$|\d)/.test(name)) return "navigation";
  if (/^(?:INS|EK[23]|AHRS|COMPASS|BARO|GPS|FLOW|OPTICALFLOW|RNGFND|RANGEFINDER|VISO|ARSPD)(?:_|$|\d)/.test(name)) return "sensors";
  if (/^(?:RC|RSSI|FLTMODE|MODE|BTN|JSTICK)(?:_|$|\d)/.test(name)) return "radio";
  if (/^(?:BATT|BCL|FUEL|ESC|MOT_BAT)(?:_|$|\d)/.test(name)) return "power";
  if (/^(?:SERVO|RELAY|CAM|MOUNT|GRIP|LED|NTF|OSD|VTX|RUNCAM)(?:_|$|\d)/.test(name)) return "outputs";
  return "other";
}

function numberLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(8)));
}

export const ParameterLibrary = memo(function ParameterLibrary({ focus }: { focus?: (name: string) => boolean }) {
  const tr = useT();
  const link = useSyncExternalStore(subscribe, getLinkBits, getLinkBits);
  const params = useSyncExternalStore(subscribe, getParamsSnapshot, getParamsSnapshot);
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [docs, setDocs] = useState<Record<string, ParamDoc>>({});
  const [job, setJob] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const blocked = useRef(0);
  const [limit, setLimit] = useState(24);
  const [listH, setListH] = useState(0);

  useEffect(() => {
    if (focus || !link.ok) return;
    send({ op: "params_list" });
  }, [focus, link.ok]);

  useEffect(() => {
    const vehicle = link.frame === "plane" ? "plane" : "copter";
    const controller = new AbortController();
    void fetch(`${APP_HTTP}/param-meta?vehicle=${vehicle}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { params?: Record<string, ParamDoc> } | null) => { if (body?.params) setDocs(body.params); })
      .catch(() => {});
    return () => controller.abort();
  }, [link.frame]);

  const entries = useMemo(
    () => Object.entries(params).filter(([name, value]) => Number.isFinite(value) && (!focus || focus(name))).sort(([a], [b]) => a.localeCompare(b)),
    [focus, params],
  );
  const counts = useMemo(() => {
    const next: Record<Category, number> = { all: entries.length, flight: 0, navigation: 0, sensors: 0, radio: 0, power: 0, outputs: 0, safety: 0, system: 0, other: 0 };
    entries.forEach(([name]) => { next[categoryOf(name)] += 1; });
    return next;
  }, [entries]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter(([name]) => {
      if (category !== "all" && categoryOf(name) !== category) return false;
      if (!needle) return true;
      const doc = docs[name];
      return name.toLowerCase().includes(needle) || (doc?.human ?? "").toLowerCase().includes(needle) || (doc?.doc ?? "").toLowerCase().includes(needle);
    });
  }, [category, docs, entries, query]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const next = Math.round(el.clientHeight);
      setListH((h) => (h === next ? h : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    blocked.current = 0;
  }, [listH, query, category]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !visible.length) return;
    const box = el.getBoundingClientRect();
    const rows = el.querySelectorAll<HTMLElement>(".param-line");
    if (!rows.length) return;
    let fit = 0;
    for (const row of rows) {
      if (row.getBoundingClientRect().bottom <= box.bottom + 1) fit += 1;
      else break;
    }
    if (fit < rows.length) {
      const next = Math.max(1, fit);
      blocked.current = limit;
      if (next !== limit) setLimit(next);
      return;
    }
    const last = rows[rows.length - 1].getBoundingClientRect();
    const rowH = last.height || 40;
    const extra = Math.floor((box.bottom - last.bottom) / rowH);
    if (extra < 1 || fit >= visible.length) return;
    const next = Math.min(visible.length, fit + extra);
    if (next !== limit && next !== blocked.current) setLimit(next);
  }, [category, docs, limit, listH, query, visible.length]);

  function refresh() {
    send({ op: "params_list" });
    addLog(tr("Parameter refresh requested"), "cmd");
  }

  function backup() {
    const live = getSnapshot();
    const count = live.param_count ?? 0;
    const params = live.params ?? {};
    const received = Object.keys(params).filter((name) => Number.isFinite(params[name])).length;
    if (!live.ok || count === 0 || received < count) {
      send({ op: "params_list" });
      setJob(tr("Parameter list is incomplete. Wait until every parameter arrives, then back up again."));
      return;
    }
    const board = live.board_name || "board";
    const text = formatParamBackup(
      { board, vehicle: live.frame || "vehicle", uid: live.boot_uid || "" },
      params,
    );
    const stamp = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
    const safeBoard = board.replace(/[^\w.-]+/g, "_");
    const uid = (live.boot_uid || "").slice(0, 8);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const linkEl = document.createElement("a");
    linkEl.href = url;
    linkEl.download = `${safeBoard}${uid ? `-${uid}` : ""}-${day}.param`;
    linkEl.click();
    URL.revokeObjectURL(url);
    setJob(tr("Saved {count} parameters", { count: received }));
    addLog(tr("Saved {count} parameters", { count: received }), "cmd");
  }

  async function restore(file: File) {
    if (file.size > 1024 * 1024) {
      setJob(tr("This parameter file is larger than 1 MB."));
      return;
    }
    const text = await file.text();
    const parsed = parseParamFile(text);
    if (typeof parsed === "string") {
      setJob(tr(parsed));
      return;
    }
    const live = getSnapshot();
    const count = live.param_count ?? 0;
    const received = Object.keys(live.params ?? {}).filter((name) => Number.isFinite(live.params[name])).length;
    if (!live.ok || live.armed) {
      setJob(tr("Restore requires a fresh disarmed connection"));
      return;
    }
    if (count === 0 || received < count) {
      send({ op: "params_list" });
      setJob(tr("Parameter list is incomplete. Wait until every parameter arrives, then restore again."));
      return;
    }
    const agreed = window.confirm(tr("Write {count} parameters from this file onto the disarmed vehicle?", { count: parsed.length }));
    if (!agreed) return;
    setBusy(true);
    setJob(tr("Restoring…"));
    try {
      const response = await fetch(`${APP_HTTP}/params/restore`, {
        method: "POST",
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: text,
      });
      const body = await response.json().catch(() => ({} as { error?: string; wrote?: number; unchanged?: number; missing?: number; failed?: number; refused?: number }));
      if (!response.ok) {
        const message = body.error || tr("Could not restore parameters");
        setJob(tr(message));
        addLog(tr(message), "bad");
        return;
      }
      const summary = tr("Wrote {wrote}. Unchanged {unchanged}. Missing on this vehicle {missing}. Failed {failed}. Refused {refused}.", {
        wrote: body.wrote ?? 0,
        unchanged: body.unchanged ?? 0,
        missing: body.missing ?? 0,
        failed: body.failed ?? 0,
        refused: body.refused ?? 0,
      });
      setJob(summary);
      addLog(summary, "cmd");
    } catch {
      setJob(tr("network unavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function save(name: string, current: number) {
    const raw = drafts[name] ?? numberLabel(current);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setStatus((all) => ({ ...all, [name]: tr("Enter a number") }));
      return;
    }
    setStatus((all) => ({ ...all, [name]: tr("Writing…") }));
    try {
      const refused = await writeParam(name, value);
      if (refused) {
        setDrafts((all) => {
          const next = { ...all };
          delete next[name];
          return next;
        });
        setStatus((all) => ({ ...all, [name]: tr(refused) }));
        addLog(tr(refused), "bad");
        return;
      }
    } catch {
      setStatus((all) => ({ ...all, [name]: tr("network unavailable") }));
      return;
    }
    if (!sameParam(current, value)) noteUi([{ kind: "param", name, value, from: current }]);
    setDrafts((all) => ({ ...all, [name]: numberLabel(value) }));
    addLog(`${name} = ${numberLabel(value)}`, "cmd");
  }

  return (
      <div className={focus ? "split solo" : "split"}>
        <div className="param-main">
          <div className="table-tools">
            <label className="work-find-wrap">
              <span className="sr-only">{tr("Search parameters")}</span>
              <input className="work-find" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr("Search parameters")} autoComplete="off" spellCheck={false} />
            </label>
            <span className="work-count" title={tr("Parameters received: {count}", { count: entries.length })}>{visible.length}</span>
            <button type="button" className="firmware-refresh" onClick={refresh} disabled={!link.ok || busy}>{tr("Refresh")}</button>
            {focus ? null : (
              <>
                <button type="button" className="firmware-refresh" onClick={backup} disabled={!link.ok || busy}>{tr("Full backup")}</button>
                <button type="button" className="firmware-refresh" onClick={() => fileRef.current?.click()} disabled={!link.ok || busy}>{busy ? tr("Restoring…") : tr("Full restore")}</button>
                <input
                  ref={fileRef}
                  className="sr-only"
                  type="file"
                  accept=".param,.txt,text/plain"
                  aria-label={tr("Full restore")}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void restore(file);
                  }}
                />
              </>
            )}
          </div>
          {!focus && job ? <p className="param-job" role="status">{job}</p> : null}
          <div className="work-list" ref={listRef}>
            {!entries.length ? <p className="work-empty">{tr(focus ? "No parameters in this group yet." : "No cached parameters yet.")}</p> : null}
            {entries.length && !visible.length ? <p className="work-empty">{tr("No parameters match this filter.")}</p> : null}
            {visible.slice(0, limit).map(([name, value]) => {
              const pending = drafts[name];
              const shown = pending ?? numberLabel(value);
              const dirty = shown !== numberLabel(value);
              const doc = docs[name];
              const bounds = doc?.min && doc?.max ? `${doc.min}–${doc.max}` : (doc?.range || "");
              const about = [doc?.human, bounds, doc?.units].filter(Boolean).join(" · ");
              return (
                <form className="work-row param-line" key={name} onSubmit={(event) => { event.preventDefault(); save(name, value); }}>
                  <label htmlFor={`param-${name}`} title={doc?.doc || name}><code>{name}</code>{about ? <small>{about}</small> : null}</label>
                  <input id={`param-${name}`} value={shown} onChange={(event) => {
                    const next = event.target.value;
                    setDrafts((all) => ({ ...all, [name]: next }));
                    setStatus((all) => ({ ...all, [name]: "" }));
                  }} inputMode="decimal" spellCheck={false} aria-label={name} />
                  {dirty ? <button type="submit" disabled={!link.ok}>{tr("Save")}</button> : <span />}
                  {status[name] ? <span className="param-status" role="status">{status[name]}</span> : null}
                </form>
              );
            })}
          </div>
          {visible.length > limit ? <p className="work-more">{tr("And {count} more", { count: visible.length - limit })}</p> : null}
        </div>
        {focus ? null : <nav className="side-nav" aria-label={tr("Parameter categories")}>
          {CATEGORIES.map((item) => (
            <button key={item.id} type="button" className={category === item.id ? "on" : undefined} onClick={() => setCategory(item.id)}>
              <span>{tr(item.label)}</span><small>{counts[item.id]}</small>
            </button>
          ))}
        </nav>}
      </div>
  );
});
