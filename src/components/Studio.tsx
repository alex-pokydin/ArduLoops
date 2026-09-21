import { createContext, useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";

const PaneHeadCtx = createContext<HTMLElement | null>(null);

/** Renders into the current pane header (title row), so tools sit next to Expand. */
export function PaneHead({ children }: { children: ReactNode }) {
  const el = useContext(PaneHeadCtx);
  if (!el) return <div className="plot-head">{children}</div>;
  return createPortal(children, el);
}

export type StudioExpand = null | "loop" | "scope";

type Saved = {
  col1Rest: number;
  col1Expand: number;
  rightSplit: number;
  col1RowSplit: number;
  expand: StudioExpand;
};

type Drag =
  | { kind: "col"; startX: number; startW: number; total: number }
  | { kind: "row"; startY: number; startFr: number; total: number };

const MIN_COL1 = 280;
const MIN_COL2 = 260;
const MIN_ROW = 110;
const GUTTER = 8;

function clampSplit(v: number): number {
  return Math.min(0.78, Math.max(0.22, v));
}

function storeKey(frame: string): string {
  return "arduloops.studio.v1." + frame;
}

function load(frame: string, defaults: Saved): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(frame)) || "") as Partial<Saved>;
    if (!raw || typeof raw !== "object") return defaults;
    const col1Rest = Number(raw.col1Rest);
    const col1Expand = Number(raw.col1Expand);
    const rightSplit = Number(raw.rightSplit);
    const col1RowSplit = Number(raw.col1RowSplit);
    const expand = raw.expand === "loop" || raw.expand === "scope" ? raw.expand : null;
    return {
      col1Rest: Number.isFinite(col1Rest) ? col1Rest : defaults.col1Rest,
      col1Expand: Number.isFinite(col1Expand) ? col1Expand : defaults.col1Expand,
      rightSplit: Number.isFinite(rightSplit) ? clampSplit(rightSplit) : defaults.rightSplit,
      col1RowSplit: Number.isFinite(col1RowSplit) ? clampSplit(col1RowSplit) : defaults.col1RowSplit,
      expand,
    };
  } catch {
    return defaults;
  }
}

function save(frame: string, s: Saved): void {
  try {
    localStorage.setItem(storeKey(frame), JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function Pane({
  area,
  title,
  expanded,
  onToggle,
  children,
}: {
  area: "loop" | "scope";
  title?: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <div className={"pane pane-" + area}>
      <div className="pane-head">
        {title ? <b>{title}</b> : null}
        <div className="pane-slot" ref={setSlot} />
        <button
          type="button"
          className={expanded ? "pane-exp on" : "pane-exp"}
          aria-pressed={expanded}
          aria-label={expanded ? t("Collapse") : t("Expand")}
          title={expanded ? t("Collapse") : t("Expand")}
          onClick={onToggle}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {expanded ? (
              <path
                d="M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <path
                d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </button>
      </div>
      <PaneHeadCtx.Provider value={slot}>
        <div className="pane-body">{children}</div>
      </PaneHeadCtx.Provider>
    </div>
  );
}

export function Studio({
  frame,
  col1Default,
  scheme,
  loop,
  scope,
  toolbar,
}: {
  frame: "copter" | "plane";
  col1Default: number;
  scheme: ReactNode;
  loop: (compact: boolean) => ReactNode;
  scope: ReactNode;
  toolbar?: ReactNode;
}) {
  const t = useT();
  const defaults: Saved = {
    col1Rest: col1Default,
    col1Expand: Math.round(col1Default * 0.78),
    rightSplit: 0.5,
    col1RowSplit: 0.72,
    expand: null,
  };
  const [layout, setLayout] = useState<Saved>(() => load(frame, defaults));
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const expand = layout.expand;
  const col1Raw = expand ? layout.col1Expand : layout.col1Rest;
  const rowTopFr = expand ? layout.col1RowSplit : layout.rightSplit;

  useEffect(() => {
    save(frame, layout);
  }, [frame, layout]);

  function onColDown(ev: PointerEvent<HTMLDivElement>) {
    const root = box.current;
    if (!root) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = { kind: "col", startX: ev.clientX, startW: col1Raw, total: root.clientWidth };
  }

  function onRowDown(ev: PointerEvent<HTMLDivElement>) {
    const root = box.current;
    if (!root) return;
    ev.preventDefault();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = { kind: "row", startY: ev.clientY, startFr: rowTopFr, total: root.clientHeight };
  }

  function onSplitMove(ev: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "col") {
      const max = Math.max(MIN_COL1, d.total - MIN_COL2 - GUTTER);
      const next = Math.min(max, Math.max(MIN_COL1, d.startW + (ev.clientX - d.startX)));
      setLayout((s) => (s.expand ? { ...s, col1Expand: next } : { ...s, col1Rest: next }));
      return;
    }
    const usable = Math.max(1, d.total - GUTTER);
    const minFr = Math.min(0.45, MIN_ROW / usable);
    const next = clampSplit(Math.min(1 - minFr, Math.max(minFr, d.startFr + (ev.clientY - d.startY) / usable)));
    setLayout((s) => (s.expand ? { ...s, col1RowSplit: next } : { ...s, rightSplit: next }));
  }

  function onSplitUp() {
    drag.current = null;
  }

  const mode = expand === "loop" ? "loop" : expand === "scope" ? "scope" : "rest";

  return (
    <div className="studio-wrap">
      {toolbar ? <div className="studio-bar">{toolbar}</div> : null}
      <div
        ref={box}
        className={"studio is-" + mode}
        style={{
          ["--studio-col1" as string]: `${col1Raw}px`,
          ["--studio-row-top" as string]: `${rowTopFr}fr`,
          ["--studio-row-bot" as string]: `${1 - rowTopFr}fr`,
        }}
      >
        <div className="pane pane-scheme">
          <div className="pane-body">{scheme}</div>
        </div>
        <div
          className="studio-gutter"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("Resize columns")}
          onPointerDown={onColDown}
          onPointerMove={onSplitMove}
          onPointerUp={onSplitUp}
          onPointerCancel={onSplitUp}
        />
        <div
          className="studio-gutter is-row"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("Resize rows")}
          onPointerDown={onRowDown}
          onPointerMove={onSplitMove}
          onPointerUp={onSplitUp}
          onPointerCancel={onSplitUp}
        />
        <Pane
          area="loop"
          expanded={expand === "loop"}
          onToggle={() => setLayout((s) => ({ ...s, expand: s.expand === "loop" ? null : "loop" }))}
        >
          {loop(expand !== "loop")}
        </Pane>
        <Pane
          area="scope"
          title={t("Scope")}
          expanded={expand === "scope"}
          onToggle={() => setLayout((s) => ({ ...s, expand: s.expand === "scope" ? null : "scope" }))}
        >
          {scope}
        </Pane>
      </div>
    </div>
  );
}
