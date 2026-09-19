import { TRACE } from "../plot";
import { getPlotSpan } from "../mav/store";
import type { Sample } from "../mav/types";

function size(c: HTMLCanvasElement): [number, number, number] {
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(1, c.clientWidth);
  const cssH = Math.max(1, c.clientHeight);
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return [cssW, cssH, dpr];
}

function stroke(
  ctx: CanvasRenderingContext2D,
  c: HTMLCanvasElement,
  buf: Sample[],
  pick: (p: Sample) => number | null,
  ymax: number,
  color: string,
  mark?: number | null,
): void {
  const [w, h, dpr] = size(c);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const padB = 16;
  const span = getPlotSpan();
  const t1 = buf.length ? buf[buf.length - 1].t : 0;
  const t0 = t1 - span;
  const x = (t: number) => ((t - t0) / span) * w;
  const y = (v: number) => h - padB - (v / (Math.abs(ymax) || 1)) * (h - padB - 8);

  ctx.strokeStyle = "#3a4652";
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(0, y(0));
  ctx.lineTo(w, y(0));
  ctx.stroke();
  ctx.setLineDash([]);

  if (mark != null && Number.isFinite(mark)) {
    ctx.strokeStyle = TRACE.target;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y(mark));
    ctx.lineTo(w, y(mark));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  let started = false;
  for (const p of buf) {
    if (p.t < t0) continue;
    const v = pick(p);
    if (v == null || Number.isNaN(v)) continue;
    const px = x(p.t);
    const py = y(v);
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

export function drawEnergy(
  c1: HTMLCanvasElement,
  x1: CanvasRenderingContext2D,
  c2: HTMLCanvasElement,
  x2: CanvasRenderingContext2D,
  buf: Sample[],
): void {
  let altMax = 8;
  let spdMax = 12;
  let cruise: number | null = null;
  for (const p of buf) {
    if (typeof p.alt === "number") altMax = Math.max(altMax, Math.abs(p.alt));
    if (typeof p.aspd === "number") spdMax = Math.max(spdMax, Math.abs(p.aspd));
    const cr = p.params.AIRSPEED_CRUISE;
    if (cr != null) cruise = cr;
  }
  stroke(x1, c1, buf, (p) => p.alt, altMax * 1.2, TRACE.actual);
  stroke(x2, c2, buf, (p) => p.aspd, spdMax * 1.2, TRACE.actual, cruise);
}
