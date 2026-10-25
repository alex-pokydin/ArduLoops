import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";

export type ChartLine = { name: string; x: number[]; y: number[]; hue?: number; dash?: string };
export type ChartAxis = { label: string; lines: ChartLine[] };
export type ChartHeat = { y_label: string; z_label: string; z_min?: number; z_max?: number; x: number[]; y: number[]; z: number[][] };
export type ChartSpec = { title: string; x_label: string; axes: ChartAxis[]; heatmap?: ChartHeat; slug?: string };

type SketchCell = { x: number; y: number; w: number; h: number; fill: string };

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
  lines: { color: string; points: string; dash?: string }[];
  heat: SketchCell[];
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
    if (item.name !== "show_chart" && item.name !== "show_spectrum" && item.name !== "show_spectrogram") continue;
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
    if (value.removed) return { title: "", slug, caption: "", output, lines: [], heat: [], removed: true };
    if (!value.chart || !hasPicture(value.chart)) return null;
    const chart = slug ? { ...value.chart, slug } : value.chart;
    return { title: chart.title, slug, caption: chartCaption(chart), output, lines: sketchLines(chart), heat: sketchHeat(chart) };
  } catch {
    return null;
  }
}

function chartData(output: string): ChartSpec | null {
  try {
    const value = JSON.parse(output) as { ok?: boolean; slug?: string; chart?: ChartSpec };
    if (!value?.ok || !value.chart || !hasPicture(value.chart)) return null;
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
            <ChartSketch lines={chart.lines} heat={chart.heat} />
          </button>
        ))}
      </div>
      {full ? <ChartWindow chart={full} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function ChartSketch({ lines, heat }: { lines: { color: string; points: string; dash?: string }[]; heat: SketchCell[] }) {
  return (
    <svg className="ai-chart-sketch" viewBox="0 0 160 48" preserveAspectRatio="none" aria-hidden="true">
      <rect width="160" height="48" rx="6" fill="#101418" />
      {heat.length === 0 ? (
        <>
          <line x1="0" y1="16" x2="160" y2="16" stroke="#2a3140" strokeWidth="1" />
          <line x1="0" y1="32" x2="160" y2="32" stroke="#2a3140" strokeWidth="1" />
        </>
      ) : null}
      {heat.map((cell, index) => <rect key={index} x={cell.x} y={cell.y} width={cell.w} height={cell.h} fill={cell.fill} />)}
      {lines.map((line, index) => <polyline key={index} points={line.points} fill="none" stroke={line.color} strokeWidth="1.6" strokeDasharray={sketchDash(line.dash)} strokeLinejoin="round" strokeLinecap="round" />)}
    </svg>
  );
}

function hasPicture(chart: ChartSpec): boolean {
  const heat = chart.heatmap;
  if (heat && Array.isArray(heat.z) && heat.z.length > 1 && Array.isArray(heat.x) && heat.x.length > 0 && Array.isArray(heat.y) && heat.y.length > 1) return true;
  return Array.isArray(chart.axes) && chart.axes.some((axis) => axis.lines?.some((line) => (line.x?.length ?? 0) > 1 && (line.y?.length ?? 0) > 1));
}

function sketchDash(dash?: string): string | undefined {
  if (dash === "dot") return "1.5 2.4";
  if (dash === "dash") return "4 3";
  return undefined;
}

function lineColor(line: ChartLine, index: number): string {
  return typeof line.hue === "number" ? COLORS[line.hue % COLORS.length] : COLORS[index % COLORS.length];
}

function sketchLines(chart: ChartSpec): { color: string; points: string; dash?: string }[] {
  const width = 160;
  const height = 48;
  const pad = 3;
  const axes = (chart.axes ?? []).map((axis) => axis.lines.map((line) => ({ line, points: coarsen(line.x, line.y, SKETCH_POINTS) })));
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const axis of axes) {
    for (const line of axis) {
      for (const point of line.points) {
        if (point.x < x0) x0 = point.x;
        if (point.x > x1) x1 = point.x;
      }
    }
  }
  if (!Number.isFinite(x0)) return [];
  const spanX = x1 - x0 || 1;
  const out: { color: string; points: string; dash?: string }[] = [];
  let color = 0;
  axes.forEach((axis) => {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const line of axis) {
      for (const point of line.points) {
        if (point.y < y0) y0 = point.y;
        if (point.y > y1) y1 = point.y;
      }
    }
    const spanY = y1 - y0 || 1;
    const flat = y1 === y0;
    for (const line of axis) {
      const pts = line.points.map((point) => {
        const px = pad + ((point.x - x0) / spanX) * (width - pad * 2);
        const py = flat ? height / 2 : pad + (1 - (point.y - y0) / spanY) * (height - pad * 2);
        return `${px.toFixed(1)},${py.toFixed(1)}`;
      });
      if (pts.length) out.push({ color: lineColor(line.line, color), points: pts.join(" "), dash: sketchDash(line.line.dash) });
      if (typeof line.line.hue !== "number") color += 1;
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

function sketchHeat(chart: ChartSpec): SketchCell[] {
  const heat = chart.heatmap;
  if (!heat || heat.z.length < 2 || heat.x.length < 1) return [];
  const cols = heat.x.length;
  const rows = heat.y.length;
  const gridX = 48;
  const gridY = 16;
  const cellW = 160 / gridX;
  const cellH = 48 / gridY;
  const zmin = heat.z_min ?? -40;
  const zmax = heat.z_max ?? 0;
  const span = zmax - zmin || 1;
  const cells: SketchCell[] = [];
  for (let gy = 0; gy < gridY; gy++) {
    const yHi = rows - 1 - Math.floor(gy * rows / gridY);
    const yLo = Math.max(0, rows - Math.floor((gy + 1) * rows / gridY));
    for (let gx = 0; gx < gridX; gx++) {
      const x0 = Math.floor(gx * cols / gridX);
      const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cols / gridX));
      const top = Math.max(yLo, yHi);
      const bottom = Math.min(yLo, yHi);
      let peak = -Infinity;
      for (let y = bottom; y <= top; y++) {
        const row = heat.z[y];
        if (!row) continue;
        for (let x = x0; x < Math.min(cols, x1); x++) {
          const value = row[x];
          if (typeof value === "number" && value > peak) peak = value;
        }
      }
      if (!Number.isFinite(peak)) continue;
      const t = Math.max(0, Math.min(1, (peak - zmin) / span));
      cells.push({ x: gx * cellW, y: gy * cellH, w: cellW + 0.25, h: cellH + 0.25, fill: inferno(t) });
    }
  }
  return cells;
}

function inferno(t: number): string {
  const stops: [number, number, number][] = [
    [0, 0, 4],
    [40, 11, 84],
    [101, 21, 110],
    [159, 42, 99],
    [223, 101, 41],
    [251, 182, 26],
    [252, 255, 164],
  ];
  const scaled = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const blend = scaled - index;
  const from = stops[index];
  const to = stops[index + 1];
  const color = from.map((value, channel) => Math.round(value + (to[channel] - value) * blend));
  return `rgb(${color[0]},${color[1]},${color[2]})`;
}

function chartIdentity(chart: ChartSpec): string {
  const parts = [chart.slug ?? "", chart.title, chart.x_label];
  const heat = chart.heatmap;
  if (heat) {
    const mid = heat.z[Math.floor(heat.z.length / 2)];
    parts.push(`heat:${heat.x.length}:${heat.y.length}:${mid?.[Math.floor((mid?.length ?? 0) / 2)] ?? ""}`);
  }
  for (const axis of chart.axes ?? []) {
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
  const axes = (chart.axes ?? []).map((axis) => {
    const names = axis.lines.map((line) => line.name).join(", ");
    return axis.label ? `${axis.label}: ${names}` : names;
  });
  const heat = chart.heatmap ? `${chart.heatmap.y_label}, ${chart.heatmap.z_label}` : "";
  return [heat, axes.join(" · ")].filter(Boolean).join(" · ");
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
      const heat = chart.heatmap;
      const hasHeat = Boolean(heat && heat.z.length > 1);
      const layout: Record<string, unknown> = {
        margin: { t: 28, r: hasHeat ? 72 : chart.axes.length > 1 ? 56 : 16, l: 52, b: 40 },
        paper_bgcolor: "#14181d",
        plot_bgcolor: "#101418",
        font: { color: "#e8eef4", size: 12 },
        xaxis: { title: { text: chart.x_label || "s" }, gridcolor: "#2a3140", zerolinecolor: "#2a3140" },
        showlegend: (chart.axes ?? []).some((axis) => axis.lines.length > 0),
        legend: { orientation: "h", y: 1.14 },
        hovermode: hasHeat ? "closest" : "x unified",
      };
      if (hasHeat && heat) {
        layout.yaxis = {
          title: { text: heat.y_label || "Hz" },
          gridcolor: "#2a3140",
          zeroline: false,
        };
        data.push({
          type: "heatmap",
          x: heat.x,
          y: heat.y,
          z: heat.z,
          zauto: false,
          zmin: heat.z_min ?? -40,
          zmax: heat.z_max ?? 0,
          colorscale: "Inferno",
          showscale: true,
          hoverongaps: false,
          colorbar: {
            title: { text: heat.z_label || "dB" },
            thickness: 12,
            outlinewidth: 0,
            tickfont: { color: "#e8eef4", size: 11 },
          },
          hovertemplate: "%{y:.1f} Hz<br>%{x:.2f} s<br>%{z:.1f} dB<extra></extra>",
        });
      }
      let color = 0;
      (chart.axes ?? []).forEach((axis, index) => {
        const key = index === 0 ? "yaxis" : `yaxis${index + 1}`;
        if (!(hasHeat && index === 0)) {
          layout[key] = {
            title: { text: axis.label },
            gridcolor: index === 0 ? "#2a3140" : "transparent",
            zerolinecolor: "#2a3140",
            ...(index > 0 ? { overlaying: "y", side: "right" } : {}),
          };
        }
        for (const line of axis.lines) {
          data.push({
            x: line.x,
            y: line.y,
            name: line.name,
            type: "scatter",
            mode: "lines",
            yaxis: index === 0 ? "y" : "y2",
            line: {
              color: hasHeat ? "#f4f7fb" : (typeof line.hue === "number" ? COLORS[line.hue % COLORS.length] : COLORS[color % COLORS.length]),
              width: hasHeat ? 1.2 : line.dash === "dot" ? 1.2 : 1.6,
              dash: line.dash || "solid",
            },
          });
          color += typeof line.hue === "number" ? 0 : 1;
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
  return createPortal(
    <div className="ai-chart-back" onClick={onClose} role="presentation">
      <div
        className={full ? "ai-chart-window full" : "ai-chart-window"}
        ref={frame}
        role="dialog"
        aria-label={chart.title || chartCaption(chart)}
        onClick={(ev) => ev.stopPropagation()}
      >
        <header
          onPointerDown={onDrag}
          onPointerMove={onMove}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onLostPointerCapture={() => { drag.current = null; }}
        >
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
