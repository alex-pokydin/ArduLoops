import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";

export type ChartLine = { name: string; x: number[]; y: number[] };
export type ChartAxis = { label: string; lines: ChartLine[] };
export type ChartSpec = { title: string; x_label: string; axes: ChartAxis[]; slug?: string };

const COLORS = ["#7fd1c8", "#ffb74d", "#e8eef4", "#ef5350", "#9aa7ff", "#c3e88d"];

type PlotlyNs = {
  newPlot: (root: HTMLElement, data: object[], layout: object, config: object) => Promise<unknown>;
  purge: (root: HTMLElement) => void;
  Plots: { resize: (root: HTMLElement) => void };
};

const SKETCH_POINTS = 24;

export type ChartCard = {
  title: string;
  slug?: string;
  caption: string;
  output: string;
  lines: { color: string; points: string }[];
  removed?: boolean;
};

const cardCache = new Map<string, ChartCard | null>();

export function chartsFromTools(items: { name: string; output: string }[]): ChartCard[] {
  const charts: ChartCard[] = [];
  const at = new Map<string, number>();
  const reindex = () => {
    at.clear();
    charts.forEach((chart, index) => { if (chart.slug) at.set(chart.slug, index); });
  };
  for (const item of items) {
    if (item.name !== "show_chart") continue;
    const card = chartCard(item.output);
    if (!card) continue;
    if (card.removed) {
      const index = card.slug ? at.get(card.slug) : undefined;
      if (index != null) {
        charts.splice(index, 1);
        reindex();
      }
      continue;
    }
    if (card.slug && at.has(card.slug)) {
      charts[at.get(card.slug)!] = card;
      continue;
    }
    if (charts.length >= 5) continue;
    if (card.slug) at.set(card.slug, charts.length);
    charts.push(card);
  }
  return charts;
}

function chartCard(output: string): ChartCard | null {
  if (cardCache.has(output)) return cardCache.get(output) ?? null;
  const card = buildCard(output);
  cardCache.set(output, card);
  if (cardCache.size > 40) {
    const oldest = cardCache.keys().next().value;
    if (oldest !== undefined) cardCache.delete(oldest);
  }
  return card;
}

function buildCard(output: string): ChartCard | null {
  try {
    const value = JSON.parse(output) as { ok?: boolean; removed?: boolean; slug?: string; chart?: ChartSpec };
    if (!value || value.ok === false) return null;
    const slug = typeof value.slug === "string" && value.slug.trim() ? value.slug.trim() : undefined;
    if (value.removed) return { title: "", slug, caption: "", output, lines: [], removed: true };
    if (!value.chart || !Array.isArray(value.chart.axes) || value.chart.axes.length === 0) return null;
    const chart = slug ? { ...value.chart, slug } : value.chart;
    return { title: chart.title, slug, caption: chartCaption(chart), output, lines: sketchLines(chart) };
  } catch {
    return null;
  }
}

export function chartData(output: string): ChartSpec | null {
  try {
    const value = JSON.parse(output) as { ok?: boolean; slug?: string; chart?: ChartSpec };
    if (!value?.ok || !value.chart || !Array.isArray(value.chart.axes) || value.chart.axes.length === 0) return null;
    const slug = typeof value.slug === "string" && value.slug.trim() ? value.slug.trim() : undefined;
    return slug ? { ...value.chart, slug } : value.chart;
  } catch {
    return null;
  }
}

export function ChartStrip({ charts }: { charts: ChartCard[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const opened = open != null ? charts[open] : undefined;
  const full = useMemo(() => opened ? chartData(opened.output) : null, [opened]);
  if (!charts.length) return null;
  return (
    <>
      <div className="ai-charts">
        {charts.map((chart, index) => (
          <button type="button" key={chart.slug || index} className="ai-chart-card" onClick={() => setOpen(index)}>
            <b>{chart.title || chart.caption}</b>
            <span>{chart.caption}</span>
            <ChartSketch lines={chart.lines} />
          </button>
        ))}
      </div>
      {full ? <ChartWindow chart={full} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function ChartSketch({ lines }: { lines: { color: string; points: string }[] }) {
  return (
    <svg className="ai-chart-sketch" viewBox="0 0 160 48" preserveAspectRatio="none" aria-hidden="true">
      <rect width="160" height="48" rx="6" fill="#101418" />
      <line x1="0" y1="16" x2="160" y2="16" stroke="#2a3140" strokeWidth="1" />
      <line x1="0" y1="32" x2="160" y2="32" stroke="#2a3140" strokeWidth="1" />
      {lines.map((line, index) => <polyline key={index} points={line.points} fill="none" stroke={line.color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />)}
    </svg>
  );
}

function sketchLines(chart: ChartSpec): { color: string; points: string }[] {
  const width = 160;
  const height = 48;
  const pad = 3;
  const coarse = chart.axes.map((axis) => axis.lines.map((line) => coarsen(line.x, line.y, SKETCH_POINTS)));
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const axis of coarse) {
    for (const line of axis) {
      for (const point of line) {
        if (point.x < x0) x0 = point.x;
        if (point.x > x1) x1 = point.x;
      }
    }
  }
  if (!Number.isFinite(x0)) return [];
  const spanX = x1 - x0 || 1;
  const out: { color: string; points: string }[] = [];
  let color = 0;
  coarse.forEach((axis) => {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const line of axis) {
      for (const point of line) {
        if (point.y < y0) y0 = point.y;
        if (point.y > y1) y1 = point.y;
      }
    }
    const spanY = y1 - y0 || 1;
    const flat = y1 === y0;
    for (const line of axis) {
      const pts = line.map((point) => {
        const px = pad + ((point.x - x0) / spanX) * (width - pad * 2);
        const py = flat ? height / 2 : pad + (1 - (point.y - y0) / spanY) * (height - pad * 2);
        return `${px.toFixed(1)},${py.toFixed(1)}`;
      });
      if (pts.length) out.push({ color: COLORS[color % COLORS.length], points: pts.join(" ") });
      color += 1;
    }
  });
  return out;
}

function coarsen(x: number[], y: number[], cap: number): { x: number; y: number }[] {
  const n = Math.min(x?.length ?? 0, y?.length ?? 0);
  if (!n) return [];
  if (n <= cap) {
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) out.push({ x: x[i], y: y[i] });
    return out;
  }
  const buckets = Math.max(1, Math.floor(cap / 2));
  const out: { x: number; y: number }[] = [];
  for (let bucket = 0; bucket < buckets; bucket++) {
    const from = Math.floor(bucket * n / buckets);
    const to = Math.min(n, Math.max(from + 1, Math.floor((bucket + 1) * n / buckets)));
    let lo = from;
    let hi = from;
    for (let i = from + 1; i < to; i++) {
      if (y[i] < y[lo]) lo = i;
      if (y[i] > y[hi]) hi = i;
    }
    const first = x[lo] <= x[hi] ? lo : hi;
    const second = first === lo ? hi : lo;
    if (Number.isFinite(x[first]) && Number.isFinite(y[first])) out.push({ x: x[first], y: y[first] });
    if (second !== first && Number.isFinite(x[second]) && Number.isFinite(y[second])) out.push({ x: x[second], y: y[second] });
  }
  return out;
}

function chartIdentity(chart: ChartSpec): string {
  const parts = [chart.slug ?? "", chart.title, chart.x_label];
  for (const axis of chart.axes) {
    parts.push(axis.label);
    for (const line of axis.lines) {
      const n = Math.min(line.x.length, line.y.length);
      const mid = n ? line.y[Math.floor(n / 2)] : "";
      parts.push(`${line.name}:${n}:${line.y[0] ?? ""}:${mid}:${n ? line.y[n - 1] : ""}`);
    }
  }
  return parts.join("|");
}

function chartCaption(chart: ChartSpec): string {
  const axes = chart.axes.map((axis) => {
    const names = axis.lines.map((line) => line.name).join(", ");
    return axis.label ? `${axis.label}: ${names}` : names;
  });
  return axes.join(" · ");
}

function ChartWindow({ chart, onClose }: { chart: ChartSpec; onClose: () => void }) {
  const t = useT();
  const frame = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const placed = useRef<{ left: string; top: string; width: string; height: string } | null>(null);
  const [full, setFull] = useState(false);
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
  const plotKey = chartIdentity(chart);
  useEffect(() => {
    const el = plot.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    let dead = false;
    let lib: PlotlyNs | null = null;
    let lastW = 0;
    let lastH = 0;
    let tick = 0;
    const place = () => {
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (w < 2 || h < 2 || (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 2)) return false;
      lastW = w;
      lastH = h;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      return true;
    };
    const fit = () => {
      if (dead || !place()) return;
      if (lib && (el as HTMLElement & { data?: unknown }).data) lib.Plots.resize(el);
    };
    const watch = new ResizeObserver(() => {
      cancelAnimationFrame(tick);
      tick = requestAnimationFrame(fit);
    });
    watch.observe(box);
    void import("plotly.js-cartesian-dist-min").then((mod) => {
      if (dead) return;
      lib = ((mod as { default?: PlotlyNs }).default ?? mod) as PlotlyNs;
      place();
      const data: object[] = [];
      const layout: Record<string, unknown> = {
        margin: { t: 28, r: chart.axes.length > 1 ? 56 : 16, l: 52, b: 40 },
        paper_bgcolor: "#14181d",
        plot_bgcolor: "#101418",
        font: { color: "#e8eef4", size: 12 },
        xaxis: { title: { text: chart.x_label || "s" }, gridcolor: "#2a3140", zerolinecolor: "#2a3140" },
        legend: { orientation: "h", y: 1.14 },
        hovermode: "x unified",
      };
      let color = 0;
      chart.axes.forEach((axis, index) => {
        const key = index === 0 ? "yaxis" : `yaxis${index + 1}`;
        layout[key] = {
          title: { text: axis.label },
          gridcolor: index === 0 ? "#2a3140" : "transparent",
          zerolinecolor: "#2a3140",
          ...(index > 0 ? { overlaying: "y", side: "right" } : {}),
        };
        for (const line of axis.lines) {
          data.push({
            x: line.x,
            y: line.y,
            name: line.name,
            type: "scatter",
            mode: "lines",
            yaxis: index === 0 ? "y" : "y2",
            line: { color: COLORS[color % COLORS.length], width: 1.5 },
          });
          color += 1;
        }
      });
      return lib.newPlot(el, data, layout, { responsive: false, displaylogo: false, scrollZoom: true });
    }).catch(() => undefined);
    return () => {
      dead = true;
      cancelAnimationFrame(tick);
      watch.disconnect();
      if (lib) lib.purge(el);
    };
  }, [plotKey]);
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
        className={full ? "ai-chart-window full" : "ai-chart-window"}
        ref={frame}
        role="dialog"
        aria-label={chart.title || chartCaption(chart)}
        onClick={(ev) => ev.stopPropagation()}
      >
        <header onPointerDown={onDrag} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}>
          <b>{chart.title || chartCaption(chart)}</b>
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
        <div className="ai-chart-plot"><div className="ai-chart-plot-inner" ref={plot} /></div>
      </div>
    </div>,
    document.body,
  );
}
