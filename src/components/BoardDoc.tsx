import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useT } from "../i18n/i18n";
import { APP_HTTP } from "../mav/link";
import { usePicked } from "../mav/view";
import { closeBoardWindow, openBoardWindow, raiseBoardWindow, refreshBoardDoc, setBoardWindow, useBoardDoc, useBoardWindow, useLastBoardDoc, type BoardDocReply, type BoardTab } from "../lib/boardDoc";
import { openImageIn } from "./ImageViewer";
import { versionKnown } from "../lib/vehicleHeader";
import { Icon } from "./MotorSetup";

const REMARK = [remarkGfm];
// A README image opens full screen with zoom; the others in the same README are a step away.
const MD: Components = {
  img({ node: _node, ...props }) {
    return <img {...props} className="bd-zoomable" onClick={(ev) => openImageIn(ev.currentTarget.closest(".bd-md"), ev.currentTarget)} />;
  },
};
const TREE = "https://github.com/ArduPilot/ardupilot/blob/master/libraries/AP_HAL_ChibiOS/hwdef";
const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/** Images come from the bridge (saved on first use); other relative links open the file in the ArduPilot repo. */
function docUrl(board: string) {
  return (url: string, key: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#") || url.startsWith("/")) return url;
    if (key === "src") return `${APP_HTTP}/board-doc/file?board=${encodeURIComponent(board)}&path=${encodeURIComponent(url)}`;
    return `${TREE}/${board}/${url}`;
  };
}

function useLinkedBoardDoc(): BoardDocReply | null {
  const identity = usePicked((s) => `${s.ok ? 1 : 0}|${s.board_name ?? ""}|${s.boot_uid ?? ""}|${versionKnown(s) ? 1 : 0}`);
  return useBoardDoc(identity);
}

function BoardGlyph() {
  return (
    <svg className="bd-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.2" />
      <path d="M6 1.5v2.5M10 1.5v2.5M6 12v2.5M10 12v2.5M1.5 6h2.5M1.5 10h2.5M12 6h2.5M12 10h2.5" />
    </svg>
  );
}

function PopOut() {
  return <svg className="bd-pop" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5L8 8M11.5 9.5v4h-9v-9h4" /></svg>;
}

// Highlighting by line shape only: a comment, the first word (a directive, or a pin like PA9), the path after include,
// quoted strings and numbers. defaults.parm: the parameter name, then its value. Nothing else is read.
type LineState = { first: boolean; include: boolean };
const hwdefMode: StreamParser<LineState> = {
  name: "hwdef",
  startState: () => ({ first: true, include: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.first = true;
      state.include = false;
    }
    if (stream.eatSpace()) return null;
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (state.first) {
      state.first = false;
      const word = (stream.match(/^\S+/) as RegExpMatchArray | null)?.[0] ?? "";
      if (word === "include") state.include = true;
      return /^P[A-K]\d+$/.test(word) ? "atom" : "keyword";
    }
    if (state.include) {
      state.include = false;
      stream.match(/^\S+/);
      return "link";
    }
    if (stream.match(/^"[^"]*"?/)) return "string";
    if (stream.match(/^(0x[0-9a-fA-F]+|-?\d+(\.\d+)?)(?=\s|$)/)) return "number";
    stream.match(/^\S+/);
    return null;
  },
};
const parmMode: StreamParser<LineState> = {
  name: "parm",
  startState: () => ({ first: true, include: false }),
  token(stream, state) {
    if (stream.sol()) state.first = true;
    if (stream.eatSpace()) return null;
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (state.first) {
      state.first = false;
      stream.match(/^[^\s,]+/);
      return "def";
    }
    if (stream.match(/^-?\d+(\.\d+)?/)) return "number";
    stream.next();
    return null;
  },
};
const HWDEF_LANG = StreamLanguage.define(hwdefMode);
const PARM_LANG = StreamLanguage.define(parmMode);

function CodeView({ text, parm, onInclude }: { text: string; parm?: boolean; onInclude?: (path: string) => void }) {
  const include = useRef(onInclude);
  include.current = onInclude;
  const extensions = useMemo(() => [
    parm ? PARM_LANG : HWDEF_LANG,
    // A click on the path of an include line opens that file.
    EditorView.domEventHandlers({
      click(ev, view) {
        const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
        if (pos == null) return false;
        const line = view.state.doc.lineAt(pos);
        const m = /^(\s*include\s+)(\S+)/.exec(line.text);
        if (!m) return false;
        const from = line.from + m[1].length;
        if (pos < from || pos > from + m[2].length) return false;
        include.current?.(m[2]);
        return true;
      },
    }),
  ], [parm]);
  return (
    <div className="bd-cm">
      <CodeMirror value={text} height="100%" theme="dark" extensions={extensions} editable={false} readOnly basicSetup={{ foldGutter: false, highlightActiveLine: false }} />
    </div>
  );
}

type Geom = { x: number; y: number; w: number; h: number };
const GEOM_KEY = "arduloops.boardWindow";
const MIN_W = 380;
const MIN_H = 260;

function clampGeom(g: Geom): Geom {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.max(MIN_W, Math.min(g.w, vw - 16));
  const h = Math.max(MIN_H, Math.min(g.h, vh - 16));
  return { w, h, x: Math.max(8, Math.min(g.x, vw - w - 8)), y: Math.max(8, Math.min(g.y, vh - h - 8)) };
}

function readGeom(): Geom {
  try {
    const saved = JSON.parse(localStorage.getItem(GEOM_KEY) ?? "null") as Geom | null;
    if (saved && [saved.x, saved.y, saved.w, saved.h].every(Number.isFinite)) return clampGeom(saved);
  } catch {
    // no saved place: open on the right
  }
  const w = Math.min(640, window.innerWidth - 32);
  const h = Math.min(560, window.innerHeight - 140);
  return clampGeom({ x: window.innerWidth - w - 24, y: 96, w, h });
}

function saveGeom(g: Geom) {
  try {
    localStorage.setItem(GEOM_KEY, JSON.stringify(g));
  } catch {
    // the place is a convenience
  }
}

/**
 * The board window: README.md, hwdef.dat and defaults.parm as tabs. Not modal: dragged by its title bar, resized from the corner,
 * kept open across tabs and workspaces. While the link is down it keeps the last board it showed, marked.
 */
export function BoardWindow() {
  const t = useT();
  const win = useBoardWindow();
  const current = useLinkedBoardDoc();
  const lastDoc = useLastBoardDoc();
  const linked = !!current && current.state !== "off";
  const doc = current && (current.state === "saved" || current.state === "stale") ? current : lastDoc;
  const [geom, setGeom] = useState<Geom>(readGeom);
  const [front, setFront] = useState(true);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 768);
  const box = useRef<HTMLElement | null>(null);
  const md = useRef<HTMLDivElement | null>(null);
  const hold = useRef<{ kind: "move" | "size"; x: number; y: number; g: Geom } | null>(null);

  useEffect(() => {
    if (!win.open) return;
    // The saved place, or the right side of the window as it is now.
    setGeom(readGeom());
    setFront(true);
    const onResize = () => {
      setNarrow(window.innerWidth < 768);
      setGeom((g) => clampGeom(g));
    };
    // Last clicked is on top: the assistant window and this one share a layer.
    const onDown = (ev: PointerEvent) => setFront(!!box.current && ev.target instanceof Node && box.current.contains(ev.target));
    window.addEventListener("resize", onResize);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [win.open]);

  useEffect(() => {
    if (win.open) setFront(true);
  }, [win.raise, win.open]);

  useEffect(() => {
    if (!win.heading || win.tab !== "readme") return;
    const target = [...(md.current?.querySelectorAll("h1, h2, h3") ?? [])].find((el) => el.textContent?.trim() === win.heading);
    target?.scrollIntoView({ block: "start" });
  }, [win.heading, win.tab]);

  if (!win.open || !doc) return null;
  const board = doc.board ?? "";
  const files = doc.files ?? [];
  const hwdefFiles = files.filter((f) => f.path !== "defaults.parm");
  const parm = files.find((f) => f.path === "defaults.parm");
  const tabs: [BoardTab, string][] = [];
  if (doc.readme) tabs.push(["readme", "README.md"]);
  if (hwdefFiles.length) tabs.push(["hwdef", "hwdef.dat"]);
  if (parm) tabs.push(["parm", "defaults.parm"]);
  const tab = tabs.some(([id]) => id === win.tab) ? win.tab : tabs[0]?.[0];
  const file = hwdefFiles.find((f) => f.path === win.path) ?? hwdefFiles[0];
  const headings = (doc.readme ?? "").split(/\r?\n/).filter((line) => /^##?\s/.test(line)).map((line) => line.replace(/^#+\s*/, "").trim());

  // An include line names a file relative to the one it is in; the bridge lists them relative to the board folder.
  const openInclude = (inc: string) => {
    const parts = (file?.path ?? "").split("/").slice(0, -1);
    for (const part of inc.split("/")) {
      if (part === ".." && parts.length && parts[parts.length - 1] !== "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    let target = parts.join("/");
    if (target.startsWith(`../${board}/`)) target = target.slice(board.length + 4);
    if (hwdefFiles.some((f) => f.path === target)) setBoardWindow({ path: target });
  };

  const start = (kind: "move" | "size") => (ev: ReactPointerEvent<HTMLElement>) => {
    if (narrow || ev.button !== 0) return;
    if (kind === "move" && (ev.target as HTMLElement).closest("button, a")) return;
    hold.current = { kind, x: ev.clientX, y: ev.clientY, g: geom };
    ev.currentTarget.setPointerCapture(ev.pointerId);
  };
  const move = (ev: ReactPointerEvent<HTMLElement>) => {
    const h = hold.current;
    if (!h) return;
    const dx = ev.clientX - h.x;
    const dy = ev.clientY - h.y;
    setGeom(clampGeom(h.kind === "move" ? { ...h.g, x: h.g.x + dx, y: h.g.y + dy } : { ...h.g, w: h.g.w + dx, h: h.g.h + dy }));
  };
  const end = () => {
    if (!hold.current) return;
    hold.current = null;
    saveGeom(geom);
  };

  const saved = doc.saved_at ? DAY.format(new Date(doc.saved_at * 1000)) : "";
  const age = !linked
    ? <span className="bd-age stale">{t("no link · saved {when}", { when: saved })}</span>
    : doc.state === "stale"
      ? <span className="bd-age stale" title={doc.error}>{t("offline · saved {when}", { when: saved })}</span>
      : <span className="bd-age">{t("saved {when}", { when: saved })}</span>;
  const ghPath = tab === "readme" ? `${board}/README.md` : tab === "parm" ? `${board}/defaults.parm` : file?.path.startsWith("../") ? file.path.slice(3) : `${board}/${file?.path ?? "hwdef.dat"}`;

  return createPortal(
    <section
      ref={box}
      className={`bwin${narrow ? " sheet" : ""}${front ? " front" : ""}`}
      style={narrow ? undefined : { left: geom.x, top: geom.y, width: geom.w, height: geom.h }}
      role="dialog"
      aria-label={t("Board doc")}
    >
      <header className="bwin-head" onPointerDown={start("move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <BoardGlyph />
        <b>{board}</b>
        <span className="bwin-tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setBoardWindow({ tab: id })}>{label}</button>
          ))}
        </span>
        <span className="bwin-gap" />
        {age}
        <button type="button" className="mw-icon" onClick={refreshBoardDoc} disabled={!linked} aria-label={t("Refresh")} title={t("Download again")}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M12.8 8a4.8 4.8 0 1 1-1.5-3.5M12 2.2v2.8H9.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <a className="bd-ext" href={`${TREE}/${ghPath}`}>GitHub ↗</a>
        <button type="button" className="mw-icon" onClick={closeBoardWindow} aria-label={t("Close")} title={t("Close")}>{Icon.x()}</button>
      </header>
      <div className="bwin-body">
        {tab === "readme" ? (
          <>
            {headings.length > 1 ? (
              <nav className="bd-files" aria-label={t("Sections")}>
                {headings.map((h, i) => (
                  <button type="button" key={`${h}-${i}`} className={h === win.heading ? "on" : ""} onClick={() => setBoardWindow({ heading: h })}>{h}</button>
                ))}
              </nav>
            ) : null}
            <div className="bd-md bwin-md" ref={md}>
              <Markdown remarkPlugins={REMARK} urlTransform={docUrl(board)} components={MD}>{doc.readme ?? ""}</Markdown>
            </div>
          </>
        ) : tab === "hwdef" && file ? (
          <>
            {hwdefFiles.length > 1 ? (
              <nav className="bd-files" aria-label={t("Files")}>
                {hwdefFiles.map((f) => (
                  <button type="button" key={f.path} className={f.path === file.path ? "on" : ""} onClick={() => setBoardWindow({ path: f.path })}>
                    {f.path}
                    {f.path !== "hwdef.dat" ? <em>{t("include")}</em> : null}
                  </button>
                ))}
              </nav>
            ) : null}
            <CodeView key={file.path} text={file.text} onInclude={openInclude} />
          </>
        ) : parm ? (
          <CodeView key="parm" text={parm.text} parm />
        ) : null}
      </div>
      {narrow ? null : (
        <span className="bwin-grip" onPointerDown={start("size")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden="true">
          <svg viewBox="0 0 12 12" width="12" height="12"><path d="M11 5L5 11M11 8.5L8.5 11" /></svg>
        </span>
      )}
    </section>,
    document.body,
  );
}

/**
 * The Overview's Board section: the linked board's README from the ArduPilot tree, whole and as tall as it is.
 * Open in window moves it into the board window; while that is open the card keeps only its head.
 */
export function BoardDoc() {
  const t = useT();
  const doc = useLinkedBoardDoc();
  const win = useBoardWindow();
  const simulator = usePicked((s) => !!s.sitl_running || s.truth_lat != null);
  if (!doc || doc.state === "off") return null;
  const board = doc.board ?? "";
  const files = doc.files ?? [];
  const head = (body: ReactNode, tools: ReactNode = null) => (
    <div className="bd-head"><BoardGlyph /><div className="bd-name">{body}</div>{tools}</div>
  );
  let card: ReactNode;
  if (doc.state === "none") {
    card = head(<><b>{simulator ? "SITL" : board || t("Unknown board")}</b><span>{t("No board doc: ArduPilot has no README or hwdef.dat for a simulator or a custom build.")}</span></>);
  } else if (doc.state === "never") {
    card = head(
      <><b>{board}</b><span>{t("The board doc is saved the first time the app is online. Nothing to show yet.")}</span></>,
      <button type="button" className="frs-btn quiet" onClick={refreshBoardDoc}>{t("Try again")}</button>,
    );
  } else {
    const saved = doc.saved_at ? DAY.format(new Date(doc.saved_at * 1000)) : "";
    const age = doc.state === "stale"
      ? <span className="bd-age stale" title={doc.error}>{t("offline · saved {when}", { when: saved })}</span>
      : <span className="bd-age">{t("saved {when}", { when: saved })}</span>;
    const gh = <a className="bd-ext" href={`${TREE}/${board}`}>GitHub ↗</a>;
    if (win.open) {
      card = head(
        <><b>{board}</b><span>{t("Open in the board window. It stays open on other tabs; drag it by its title, resize it from the corner.")}</span></>,
        <>{age}<button type="button" className="frs-btn quiet" onClick={raiseBoardWindow}>{t("Show window")}</button></>,
      );
    } else if (doc.readme) {
      card = (
        <>
          {head(
            <><b>{board}</b><code className="bd-path">hwdef/{board}/README.md</code></>,
            <>{age}<button type="button" className="frs-btn quiet" onClick={() => openBoardWindow("readme")}><PopOut />{t("Open in window")}</button>{gh}</>,
          )}
          <div className="bd-md">
            <Markdown remarkPlugins={REMARK} urlTransform={docUrl(board)} components={MD}>{doc.readme}</Markdown>
          </div>
        </>
      );
    } else {
      card = head(
        <><b>{board}</b><span>{t("ArduPilot has no README for this board. Its hwdef.dat lists the pins, buses and sensors the firmware was built for.")}</span></>,
        <>{age}{files.length ? <button type="button" className="frs-btn quiet" onClick={() => openBoardWindow("hwdef")}>{t("Open hwdef.dat")}</button> : null}{gh}</>,
      );
    }
  }
  return (
    <>
      <h4 className="sov-sect">{t("Board")}</h4>
      <div className="bd">{card}</div>
    </>
  );
}
