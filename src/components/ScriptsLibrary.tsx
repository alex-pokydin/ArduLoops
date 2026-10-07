import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { RangeSet, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutterLineClass, type DecorationSet } from "@codemirror/view";
import { useT } from "../i18n/i18n";
import { getLuaQuote, setLuaQuote, subscribeLuaQuote } from "../luaQuote";
import { addLog } from "../log";
import { APP_HTTP } from "../mav/link";
import { send, writeParam } from "../mav/cmd";
import { WorkspaceTabs, type WorkspaceId } from "./WorkspaceTabs";

class QuoteGutter extends GutterMarker {
  elementClass = "cm-lua-quote-gutter";
}

const quoteGutter = new QuoteGutter();
const quoteLine = Decoration.line({ class: "cm-lua-quote" });
const setQuoteLines = StateEffect.define<{ start: number; end: number } | null>();

type QuoteMarks = { start: number; end: number; lines: DecorationSet; gutters: RangeSet<GutterMarker> };

function quoteMarks(doc: Text, start: number, end: number): QuoteMarks | null {
  if (start < 1) return null;
  const from = Math.min(start, doc.lines);
  const to = Math.min(Math.max(start, end), doc.lines);
  const lines = [];
  const gutters = [];
  if (from >= 1) {
    for (let n = from; n <= to; n++) {
      const line = doc.line(n);
      lines.push(quoteLine.range(line.from));
      gutters.push(quoteGutter.range(line.from));
    }
  }
  return {
    start,
    end,
    lines: lines.length ? Decoration.set(lines) : Decoration.none,
    gutters: RangeSet.of(gutters),
  };
}

const quoteField = StateField.define<QuoteMarks | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    let set = false;
    for (const effect of tr.effects) {
      if (!effect.is(setQuoteLines)) continue;
      set = true;
      next = effect.value ? quoteMarks(tr.state.doc, effect.value.start, effect.value.end) : null;
    }
    if (!set && next && tr.docChanged) next = quoteMarks(tr.state.doc, next.start, next.end);
    return next;
  },
  provide: (field) => [
    EditorView.decorations.compute([field], (state) => state.field(field)?.lines ?? Decoration.none),
    gutterLineClass.compute([field], (state) => state.field(field)?.gutters ?? RangeSet.of([])),
  ],
});

const STARTER = `local function update()
  gcs:send_text(6, "lua: hello")
  return update, 1000
end

return update()
`;

type ScriptFile = { name: string; bytes: number };
type ScriptStatus = {
  linked: boolean;
  params_complete: boolean;
  compiled: boolean;
  enabled: boolean;
  heap: number | null;
  files: ScriptFile[];
  error?: string;
  busy?: boolean;
};

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${APP_HTTP}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function luaName(raw: string): string | null {
  let name = raw.trim();
  if (!name.toLowerCase().endsWith(".lua")) name += ".lua";
  if (name.length > 64 || name.includes("..") || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.lua$/.test(name)) return null;
  return name;
}

function FilesPanelIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M2.2 2.4h11.6v11.2H2.2z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 2.4v11.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d={open ? "M10.4 5.8 8.2 8l2.2 2.2" : "M8.2 5.8 10.4 8 8.2 10.2"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ScriptsLibrary({
  current,
  ids,
  onWorkspace,
}: {
  current: WorkspaceId;
  ids: WorkspaceId[];
  onWorkspace: (id: WorkspaceId) => void;
}) {
  const t = useT();
  const [status, setStatus] = useState<ScriptStatus | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const readingRef = useRef(false);
  readingRef.current = reading;
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  const [creating, setCreating] = useState("");
  const [askDelete, setAskDelete] = useState(false);
  const [filesOpen, setFilesOpen] = useState(true);
  const [note, setNote] = useState("");
  const dirty = name !== "" && draft !== saved;
  const fileRef = useRef({ name: "", saved: "" });
  fileRef.current = { name, saved };
  const viewRef = useRef<EditorView | null>(null);
  const quote = useSyncExternalStore(subscribeLuaQuote, getLuaQuote, getLuaQuote);
  const extensions = useMemo(() => [
    StreamLanguage.define(lua),
    quoteField,
    EditorView.updateListener.of((update) => {
      if (readingRef.current) return;
      if (!update.selectionSet && !update.docChanged) return;
      const file = fileRef.current.name;
      if (!file) return;
      const source = update.state.doc.toString();
      const unsaved = source !== fileRef.current.saved;
      const sel = update.state.selection.main;
      if (!sel.empty) {
        const selection = update.state.sliceDoc(sel.from, sel.to);
        if (!selection.trim()) return;
        const startLine = update.state.doc.lineAt(sel.from).number;
        const endLine = update.state.doc.lineAt(Math.max(sel.from, sel.to - 1)).number;
        const next = { name: file, startLine, endLine, selection, body: source, dirty: unsaved };
        const prev = getLuaQuote();
        if (
          prev
          && prev.name === next.name
          && prev.startLine === next.startLine
          && prev.endLine === next.endLine
          && prev.selection === next.selection
          && prev.body === next.body
          && prev.dirty === next.dirty
        ) return;
        setLuaQuote(next);
        return;
      }
      if (!update.docChanged) return;
      const current = getLuaQuote();
      if (!current || current.name !== file || (current.body === source && current.dirty === unsaved)) return;
      setLuaQuote({ ...current, body: source, dirty: unsaved });
    }),
  ], []);

  useEffect(() => {
    const current = getLuaQuote();
    if (current && current.name !== name) setLuaQuote(null);
  }, [name]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view?.dom.isConnected) return;
    const range = quote && quote.name === name ? { start: quote.startLine, end: quote.endLine } : null;
    const held = view.state.field(quoteField);
    if (!range && !held) return;
    if (range && held && held.start === range.start && held.end === range.end) return;
    view.dispatch({ effects: setQuoteLines.of(range) });
  }, [quote, name]);

  async function loadList(): Promise<ScriptStatus | null> {
    const next = await readJson<ScriptStatus>("/scripts");
    if (next.busy) return null;
    setStatus(next);
    setErr(next.error || "");
    return next;
  }

  async function openFile(file: string, body?: string) {
    setAskDelete(false);
    setNote("");
    if (body != null) {
      setName(file);
      setDraft(body);
      setSaved("");
      return;
    }
    const previous = { name, draft, saved };
    setReading(true);
    setName(file);
    setDraft("");
    setSaved("");
    try {
      const loaded = await readJson<{ body: string }>(`/scripts/file?name=${encodeURIComponent(file)}`);
      setDraft(loaded.body);
      setSaved(loaded.body);
    } catch (error) {
      setName(previous.name);
      setDraft(previous.draft);
      setSaved(previous.saved);
      throw error;
    } finally {
      setReading(false);
    }
  }

  useEffect(() => {
    let stop = false;
    setLoading(true);
    loadList()
      .catch((error: Error) => { if (!stop) setErr(error.message); })
      .finally(() => { if (!stop) setLoading(false); });
    send({ op: "param_read", name: "SCR_ENABLE" });
    send({ op: "param_read", name: "SCR_HEAP_SIZE" });
    let pending = false;
    const timer = window.setInterval(() => {
      if (stop || pending) return;
      pending = true;
      loadList()
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    }, 3000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  function pick(file: string) {
    if (reading || file === name) return;
    if (dirty && !window.confirm(t("Discard unsaved changes?"))) return;
    openFile(file).catch((error: Error) => setErr(error.message));
  }

  async function onCreate() {
    const file = luaName(creating);
    if (!file) {
      setErr(t("Script name must end with .lua"));
      return;
    }
    if (status?.files.some((item) => item.name === file)) {
      setCreating("");
      pick(file);
      return;
    }
    setCreating("");
    setErr("");
    await openFile(file, STARTER);
  }

  async function onSave() {
    if (!name) return;
    setErr("");
    try {
      await readJson("/scripts/file", { method: "POST", body: JSON.stringify({ name, body: draft }) });
      setSaved(draft);
      setNote(t("Saved. Reload scripting so the vehicle runs this file."));
      addLog(t("Write {name}", { name }), "cmd");
      await loadList();
    } catch (error) {
      setErr(error instanceof Error ? error.message : t("Could not load scripts"));
    }
  }

  async function onDelete() {
    if (!name) return;
    setErr("");
    try {
      await readJson("/scripts/delete", { method: "POST", body: JSON.stringify({ name }) });
      addLog(t("Delete {name}", { name }), "cmd");
      setName("");
      setDraft("");
      setSaved("");
      setAskDelete(false);
      setNote("");
      await loadList();
    } catch (error) {
      setErr(error instanceof Error ? error.message : t("Could not load scripts"));
    }
  }

  async function onReload() {
    setErr("");
    try {
      await readJson("/scripts/restart", { method: "POST", body: "{}" });
      setNote(t("Scripting reloaded."));
      addLog(t("Reload Lua scripting"), "cmd");
    } catch (error) {
      setErr(error instanceof Error ? error.message : t("Could not load scripts"));
    }
  }

  async function onEnable() {
    setErr("");
    const refused = await writeParam("SCR_ENABLE", 1);
    if (refused) {
      setErr(refused);
      return;
    }
    addLog(t("Enable scripting"), "cmd");
    setNote(t("Turn scripting on, then restart the vehicle. The engine starts at boot."));
    window.setTimeout(() => { loadList().catch(() => {}); }, 600);
  }

  const ready = status?.linked && status.compiled && status.enabled;
  const heap = status?.heap != null ? t("Heap {bytes}", { bytes: Math.round(status.heap) }) : "";
  const barNote = err === "File transfer is busy" ? t("File transfer is busy") : err;

  return (
    <section className="scope work">
      <div className="work-bar">
        <WorkspaceTabs current={current} ids={ids} onSelect={onWorkspace} />
        {barNote ? <span className="lua-bar-note" title={barNote}>{barNote}</span> : null}
        <button type="button" className="firmware-refresh" onClick={() => { setLoading(true); loadList().finally(() => setLoading(false)); }} disabled={loading}>
          {loading ? t("Refreshing…") : t("Refresh")}
        </button>
      </div>
      {!status?.linked ? <p className="lua-lead">{t("Connect a vehicle to read its scripts.")}</p> : null}
      {status?.linked && !status.params_complete && !status.compiled ? <p className="lua-lead">{t("Waiting for parameters…")}</p> : null}
      {status?.linked && status.params_complete && !status.compiled ? <p className="lua-lead">{t("This firmware has no Lua scripting.")}</p> : null}
      {status?.linked && status.compiled && !status.enabled ? (
        <div className="lua-lead">
          <p>{t("Scripting is off")}</p>
          <p>{t("Turn scripting on, then restart the vehicle. The engine starts at boot.")}</p>
          <button type="button" className="cyan" onClick={() => void onEnable()}>{t("Enable scripting")}</button>
        </div>
      ) : null}
      {ready ? (
        <div className={`split lua-split${filesOpen ? "" : " shut"}`}>
          <nav className={`side-nav${filesOpen ? "" : " shut"}`} aria-label={t("lua")}>
            <div className="lua-files-head">
              {filesOpen ? <b>{t("Scripts")}</b> : null}
              <button
                type="button"
                className="lua-files-toggle"
                aria-label={filesOpen ? t("Hide scripts") : t("Show scripts")}
                aria-expanded={filesOpen}
                title={filesOpen ? t("Hide scripts") : t("Show scripts")}
                onClick={() => setFilesOpen((open) => !open)}
              >
                <FilesPanelIcon open={filesOpen} />
              </button>
            </div>
            {filesOpen ? status.files.map((file) => (
              <button key={file.name} type="button" className={file.name === name ? "on" : undefined} disabled={reading} onClick={() => pick(file.name)}>
                <span>{file.name}</span>
                <small>{t("{bytes} B", { bytes: file.bytes })}</small>
              </button>
            )) : null}
            {filesOpen && status.files.length === 0 ? <p className="work-empty">{t("No scripts yet.")}</p> : null}
          </nav>
          <div className="param-main lua-main">
            <div className="table-tools lua-bar">
              <b>{name || t("lua")}{reading ? <i className="lua-spin" role="status" aria-label={t("Refreshing…")} /> : null}</b>
              {heap ? <span className="work-count">{heap}</span> : null}
              {creating !== "" ? (
                <form className="lua-name" onSubmit={(ev) => { ev.preventDefault(); void onCreate(); }}>
                  <input value={creating} onChange={(ev) => setCreating(ev.target.value)} placeholder={t("Script name")} aria-label={t("Script name")} autoFocus spellCheck={false} />
                  <button type="submit">{t("Create")}</button>
                </form>
              ) : (
                <button type="button" onClick={() => setCreating("hello.lua")}>{t("New script")}</button>
              )}
              <button type="button" disabled={!name || !dirty} onClick={() => void onSave()}>{t("Save")}</button>
              {askDelete ? (
                <>
                  <span>{t("Delete {name}?", { name })}</span>
                  <button type="button" onClick={() => setAskDelete(false)}>{t("Cancel")}</button>
                  <button type="button" className="cyan" onClick={() => void onDelete()}>{t("Delete")}</button>
                </>
              ) : (
                <button type="button" disabled={!name || !status.files.some((file) => file.name === name)} onClick={() => setAskDelete(true)}>{t("Delete")}</button>
              )}
              <button type="button" onClick={() => void onReload()}>{t("Reload scripts")}</button>
            </div>
            <div className="lua-body">
              {note ? <p className="lua-lead">{note}</p> : null}
              {name ? (
                <div className={`lua-editor${reading ? " busy" : ""}`}>
                  <CodeMirror
                    value={draft}
                    height="100%"
                    theme="dark"
                    extensions={extensions}
                    basicSetup
                    editable={!reading}
                    readOnly={reading}
                    onCreateEditor={(view) => { viewRef.current = view; }}
                    onChange={setDraft}
                  />
                </div>
              ) : <p className="work-empty">{t("Select a script from the list, or create a new one.")}</p>}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
