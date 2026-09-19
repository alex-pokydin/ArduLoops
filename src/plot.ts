import { t } from "./i18n/i18n";
import { TONE, TONE_HEX, traceValue, type Pane } from "./lib/traces";
import { wrap180, type Axis } from "./mav/axis";
import { MAX_T } from "./mav/store";
import type { Sample } from "./mav/types";

/** Stick gray, desired white, target amber, actual cyan. Error is the gap, not a 5th trace. */
export const TRACE = {
  stick: "#6b7884",
  desired: "rgba(255,255,255,0.92)",
  target: "#ffb74d",
  actual: "#4fc3f7",
  gap: "rgba(255, 183, 77, 0.20)",
} as const;

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

function unwrapHeading(buf: Sample[]): Sample[] {
  return unwrapKeys(buf, ["yaw", "yaw_tar", "yaw_cmd", "hdg"]);
}

function unwrapKeys(buf: Sample[], keys: Array<keyof Sample>): Sample[] {
  if (!buf.length) return buf;
  const acc: Partial<Record<string, number>> = {};
  const prev: Partial<Record<string, number>> = {};
  for (const key of keys) {
    const v = buf[0][key];
    if (typeof v === "number" && !Number.isNaN(v)) {
      acc[key] = v;
      prev[key] = v;
    }
  }
  return buf.map((p, i) => {
    if (i === 0) return p;
    const next = { ...p };
    for (const key of keys) {
      const raw = p[key];
      const last = prev[key];
      if (typeof raw !== "number" || Number.isNaN(raw) || last == null) continue;
      const a = (acc[key] ?? raw) + wrap180(raw - last);
      acc[key] = a;
      prev[key] = raw;
      (next as unknown as Record<string, unknown>)[key] = a;
    }
    return next;
  });
}

function plot(
  ctx: CanvasRenderingContext2D,
  c: HTMLCanvasElement,
  buf: Sample[],
  picks: Array<(p: Sample) => number | null>,
  ymax: number,
  colors: string[],
  gap?: [(p: Sample) => number | null, (p: Sample) => number | null],
): void {
  const [w, h, dpr] = size(c);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const padB = 16;
  const t1 = buf.length ? buf[buf.length - 1].t : 0;
  const t0 = t1 - MAX_T;
  const x = (t: number) => ((t - t0) / MAX_T) * w;
  const y = (v: number) => (h - padB) / 2 - (v / (Math.abs(ymax) || 1)) * ((h - padB) * 0.42);

  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  for (let dt = 1; dt < MAX_T; dt++) {
    const px = Math.round(x(t1 - dt)) + 0.5;
    ctx.strokeStyle = dt % 2 === 0 ? "#2e3a46" : "#222a32";
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h - padB);
    ctx.stroke();
  }
  ctx.strokeStyle = "#3a4652";
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(0, (h - padB) / 2);
  ctx.lineTo(w, (h - padB) / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#6b7884";
  ctx.font = "11px Segoe UI, system-ui, sans-serif";
  ctx.textBaseline = "top";
  for (let dt = 0; dt <= MAX_T; dt += 2) {
    const px = x(t1 - dt);
    ctx.textAlign = dt === 0 ? "right" : dt === MAX_T ? "left" : "center";
    ctx.fillText(dt === 0 ? t("now") : t("−{n} s", { n: dt }), Math.max(4, Math.min(w - 4, px)), h - 14);
  }

  if (!buf.length) return;
  if (gap) {
    const [ka, kb] = gap;
    ctx.beginPath();
    let top = false;
    for (const p of buf) {
      const v = ka(p);
      if (v == null) continue;
      if (!top) {
        ctx.moveTo(x(p.t), y(v));
        top = true;
      } else ctx.lineTo(x(p.t), y(v));
    }
    for (let i = buf.length - 1; i >= 0; i--) {
      const v = kb(buf[i]);
      if (v == null) continue;
      ctx.lineTo(x(buf[i].t), y(v));
    }
    if (top) {
      ctx.closePath();
      ctx.fillStyle = TRACE.gap;
      ctx.fill();
    }
  }
  picks.forEach((pick, i) => {
    ctx.beginPath();
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = colors[i] === TRACE.stick ? 1.6 : 2.5;
    let started = false;
    for (const p of buf) {
      const v = pick(p);
      if (v == null) continue;
      const px = x(p.t);
      const py = y(v);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else ctx.lineTo(px, py);
    }
    ctx.stroke();
  });
}

/** SVG path `d` for Loop P/I/D / Σ traces — same window as the scope strip. */
export function sparkSeries(
  buf: Sample[],
  picks: Array<(s: Sample) => number | null>,
  w: number,
  h: number,
): { ds: string[]; ymax: number } {
  const mid = h / 2;
  const t1 = buf.length ? buf[buf.length - 1].t : 0;
  const t0 = t1 - MAX_T;
  let ymax = 0.05;
  for (const p of buf) {
    for (const pick of picks) {
      const v = pick(p);
      if (v != null && Number.isFinite(v)) ymax = Math.max(ymax, Math.abs(v));
    }
  }
  ymax *= 1.25;
  const x = (t: number) => ((t - t0) / MAX_T) * w;
  const y = (v: number) => mid - (v / ymax) * (h * 0.42);
  const ds = picks.map((pick) => {
    let d = "";
    let started = false;
    for (const p of buf) {
      const v = pick(p);
      if (v == null || !Number.isFinite(v)) continue;
      const cmd = started ? "L" : "M";
      started = true;
      d += `${cmd}${x(p.t).toFixed(1)},${y(v).toFixed(1)} `;
    }
    return d.trim();
  });
  return { ds, ymax };
}

function nums(buf: Sample[], key: keyof Sample): number[] {
  return buf.map((p) => {
    const v = p[key];
    return typeof v === "number" && !Number.isNaN(v) ? v : 0;
  });
}

function keyPick(key: keyof Sample) {
  return (p: Sample) => {
    const v = p[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
}

function plotKeys(
  ctx: CanvasRenderingContext2D,
  c: HTMLCanvasElement,
  buf: Sample[],
  keys: Array<keyof Sample>,
  ymax: number,
  colors: string[],
  gap?: [keyof Sample, keyof Sample],
) {
  plot(
    ctx,
    c,
    buf,
    keys.map(keyPick),
    ymax,
    colors,
    gap ? [keyPick(gap[0]), keyPick(gap[1])] : undefined,
  );
}

export function drawPane(
  c: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  buf: Sample[],
  pane: Pane,
): void {
  const drawn = pane.unwrap ? unwrapHeading(buf) : buf;
  const picks = pane.traces.map((tr) => (p: Sample) => traceValue(p, tr));
  const colors = pane.custom
    ? pane.traces.map((_, i) => TONE_HEX[TONE[i % TONE.length]])
    : pane.traces.map((tr) => TRACE[tr.role]);
  let span = pane.spanMin;
  for (const p of drawn) {
    for (const pick of picks) {
      const v = pick(p);
      if (v != null) span = Math.max(span, Math.abs(v));
    }
  }
  const gap = pane.gap
    ? ([(p: Sample) => {
        const v = p[pane.gap![0]];
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      }, (p: Sample) => {
        const v = p[pane.gap![1]];
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      }] as [(p: Sample) => number | null, (p: Sample) => number | null])
    : undefined;
  plot(ctx, c, drawn, picks, span * 1.25, colors, gap);
}

export function drawScope(
  c1: HTMLCanvasElement,
  x1: CanvasRenderingContext2D,
  c2: HTMLCanvasElement,
  x2: CanvasRenderingContext2D,
  buf: Sample[],
  axis: Axis = "roll",
): void {
  if (axis === "d") {
    const alts = nums(buf, "alt");
    const tars = nums(buf, "alt_tar");
    const span = Math.max(1, ...alts.map(Math.abs), ...tars.map(Math.abs)) * 1.25;
    plotKeys(x1, c1, buf, ["alt_tar", "alt"], span, [TRACE.target, TRACE.actual], ["alt_tar", "alt"]);
    const climbs = nums(buf, "climb");
    const dens = nums(buf, "climb_des");
    const rspan = Math.max(0.5, ...climbs.map(Math.abs), ...dens.map(Math.abs)) * 1.25;
    plotKeys(x2, c2, buf, ["climb_des", "climb"], rspan, [TRACE.target, TRACE.actual], ["climb_des", "climb"]);
    return;
  }
  if (axis === "yaw") {
    const drawn = unwrapHeading(buf);
    const angs = nums(drawn, "yaw");
    const tars = nums(drawn, "yaw_tar");
    const cmds = nums(drawn, "yaw_cmd");
    const span = Math.max(5, ...angs.map(Math.abs), ...tars.map(Math.abs), ...cmds.map(Math.abs)) * 1.25;
    plotKeys(x1, c1, drawn, ["yaw_cmd", "yaw_tar", "yaw"], span, [TRACE.stick, TRACE.target, TRACE.actual], ["yaw_tar", "yaw"]);
    const rates = nums(buf, "yaw_rate");
    const dens = nums(buf, "yaw_des");
    const rspan = Math.max(12, ...rates.map(Math.abs), ...dens.map(Math.abs)) * 1.25;
    plotKeys(x2, c2, buf, ["yaw_des", "yaw_rate"], rspan, [TRACE.target, TRACE.actual], ["yaw_des", "yaw_rate"]);
    return;
  }
  const angK = axis === "pitch" ? "pitch" : "roll";
  const cmdK = axis === "pitch" ? "pitch_cmd" : "cmd";
  const tarK = axis === "pitch" ? "pitch_tar" : "tar";
  const desK = axis === "pitch" ? "pitch_des" : "des";
  const rateK = axis === "pitch" ? "pitch_rate" : "rate";
  const angs = nums(buf, angK);
  const cmds = nums(buf, cmdK);
  const tars = nums(buf, tarK);
  const span = Math.max(5, ...angs.map(Math.abs), ...cmds.map(Math.abs), ...tars.map(Math.abs)) * 1.25;
  plotKeys(x1, c1, buf, [cmdK, tarK, angK], span, [TRACE.stick, TRACE.target, TRACE.actual], [tarK, angK]);
  const rates = nums(buf, rateK);
  const dens = nums(buf, desK);
  const rspan = Math.max(12, ...rates.map(Math.abs), ...dens.map(Math.abs)) * 1.25;
  plotKeys(x2, c2, buf, [desK, rateK], rspan, [TRACE.target, TRACE.actual], [desK, rateK]);
}
