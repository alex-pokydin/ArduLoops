import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { customCatalog, customPane, liveFieldSig, resolveLine, type CatalogTrace, type Pane } from "../lib/traces";
import { getLatest } from "../mav/store";
import { useStorePicked } from "../mav/view";
import { PlotStack } from "./TracePanes";

export type LiveLine = { id: string; label: string };
export type LiveChart = { title: string; lines: LiveLine[] };
export type LiveSpec = { charts: LiveChart[] };

export function liveSpecFromTools(items: { name: string; output: string }[]): LiveSpec | null {
  let spec: LiveSpec | null = null;
  for (const item of items) {
    if (item.name !== "show_live") continue;
    const next = liveSpec(item.output);
    if (next) spec = next;
  }
  return spec;
}

export function liveSpec(output: string): LiveSpec | null {
  try {
    const value = JSON.parse(output) as { ok?: boolean; charts?: unknown };
    if (!value || value.ok === false || !Array.isArray(value.charts)) return null;
    const charts: LiveChart[] = [];
    for (const row of value.charts) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { title?: unknown; lines?: unknown };
      if (!Array.isArray(rec.lines)) continue;
      const lines: LiveLine[] = [];
      for (const line of rec.lines) {
        if (!line || typeof line !== "object") continue;
        const item = line as { id?: unknown; label?: unknown };
        if (typeof item.id !== "string" || !item.id.trim()) continue;
        const id = item.id.trim();
        const label = typeof item.label === "string" && item.label.trim() ? item.label.trim() : id;
        lines.push({ id, label });
      }
      if (!lines.length) continue;
      const title = typeof rec.title === "string" ? rec.title.trim() : "";
      charts.push({ title: title || lines.map((line) => line.label).join(", "), lines });
    }
    return charts.length ? { charts: charts.slice(0, 5) } : null;
  } catch {
    return null;
  }
}

function chartStamp(spec: LiveSpec): string {
  return spec.charts.map((chart) => `${chart.title}\n${chart.lines.map((line) => line.id).join(",")}`).join("\n");
}

export function LiveView({
  spec,
  open,
  onOpen,
  onClose,
}: {
  spec: LiveSpec;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const stamp = chartStamp(spec);
  const [state, setState] = useState(() => ({ stamp, on: spec.charts.map(() => true) }));
  if (state.stamp !== stamp) setState({ stamp, on: spec.charts.map(() => true) });
  const flags = state.stamp === stamp ? state.on : spec.charts.map(() => true);
  function toggle(index: number, checked: boolean) {
    setState((prev) => {
      const base = prev.stamp === stamp ? prev.on : spec.charts.map(() => true);
      const next = base.slice();
      next[index] = checked;
      return { stamp, on: next };
    });
  }
  const shown: LiveSpec = { charts: spec.charts.filter((_, index) => flags[index]) };
  return (
    <>
      <LiveCard spec={spec} on={flags} onToggle={toggle} onOpen={onOpen} />
      {open ? <LiveWindow spec={shown} onClose={onClose} /> : null}
    </>
  );
}

export function LiveCard({
  spec,
  on,
  onToggle,
  onOpen,
}: {
  spec: LiveSpec;
  on: boolean[];
  onToggle: (index: number, checked: boolean) => void;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <div className="ai-charts">
      <div className="ai-chart-card ai-live-card">
        <button type="button" className="ai-live-open" onClick={onOpen}>
          <b>{t("Live lines")}</b>
        </button>
        {spec.charts.map((chart, index) => (
          <div key={`${chart.title}:${index}`} className={on[index] ? "ai-live-row" : "ai-live-row off"}>
            <input
              type="checkbox"
              checked={!!on[index]}
              aria-label={chart.title}
              onChange={(ev) => onToggle(index, ev.target.checked)}
            />
            <button type="button" onClick={onOpen}>
              <b>{chart.title}</b>
              <span>{chart.lines.map((line) => line.label).join(", ")}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LiveWindow({ spec, onClose }: { spec: LiveSpec; onClose: () => void }) {
  const t = useT();
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const placed = useRef<{ left: string; top: string; width: string; height: string } | null>(null);
  const [full, setFull] = useState(false);
  const paramN = useStorePicked((s) => Object.keys(s.params).length);
  const liveSig = useStorePicked((s) => liveFieldSig(s.live_nums));
  const panes = useMemo(
    () => panesFor(spec, customCatalog(getLatest().params || {}, getLatest().live_nums)),
    [spec, paramN, liveSig],
  );

  function placeFull(on: boolean) {
    const node = frame.current;
    if (!node) return;
    drag.current = null;
    if (on) {
      placed.current = { left: node.style.left, top: node.style.top, width: node.style.width, height: node.style.height };
      node.style.left = "0";
      node.style.top = "0";
      node.style.width = "100%";
      node.style.height = "100%";
      setFull(true);
      return;
    }
    const prev = placed.current;
    node.style.left = prev?.left ?? "";
    node.style.top = prev?.top ?? "";
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
    if ((ev.target as HTMLElement).closest("button")) return;
    const node = frame.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    drag.current = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top };
    ev.currentTarget.setPointerCapture(ev.pointerId);
  }
  function onMove(ev: ReactPointerEvent<HTMLElement>) {
    const start = drag.current;
    const node = frame.current;
    if (!start || !node) return;
    node.style.left = `${Math.max(8, start.left + ev.clientX - start.x)}px`;
    node.style.top = `${Math.max(8, start.top + ev.clientY - start.y)}px`;
  }

  return createPortal(
    <div className="ai-chart-back" onClick={onClose} role="presentation">
      <div
        className={full ? "ai-chart-window live full" : "ai-chart-window live"}
        ref={frame}
        role="dialog"
        aria-label={t("Live lines")}
        onClick={(ev) => ev.stopPropagation()}
      >
        <header onPointerDown={onDrag} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}>
          <b>{t("Live lines")}</b>
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
        {panes.length ? (
          <div className="ai-live-plots">
            <PlotStack panes={panes} />
          </div>
        ) : (
          <p className="ai-live-empty">{t("No live chart is on")}</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

function panesFor(spec: LiveSpec, catalog: CatalogTrace[]): Pane[] {
  const panes: Pane[] = [];
  for (const chart of spec.charts) {
    const picked = chart.lines
      .map((line) => resolveLine(line.id, catalog))
      .filter((tr): tr is CatalogTrace => !!tr);
    if (!picked.length) continue;
    const pane = customPane(picked);
    panes.push({ ...pane, title: chart.title || pane.title });
  }
  return panes;
}
