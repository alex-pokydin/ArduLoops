import type { Band } from "./gains";

export type NodeBox = { id: string; x: number; y: number; w: number; h: number };
export type RankBox = { label: string; x: number; y: number; w: number; h: number; band: Band };
export type GroupBox = { band: "outer" | "inner"; label: string; x: number; y: number; w: number; h: number };
export type CascadeLayout = {
  width: number;
  height: number;
  nodeW: number;
  nodeH: number;
  nodes: NodeBox[];
  ranks: RankBox[];
  groups: GroupBox[];
  cutY: number | null;
};

export type LayerDef = { label: string; ids: string[]; band: Band };

function rankPack(n: number, avail: number): { nodeW: number; gap: number } {
  if (n <= 2) {
    const gap = 28;
    return { nodeW: Math.min(200, Math.max(136, Math.floor((avail - gap) / 2))), gap };
  }
  const gap = n >= 4 ? 8 : 16;
  const cap = n === 3 ? 128 : 92;
  const floor = n >= 5 ? 64 : 88;
  return {
    nodeW: Math.min(cap, Math.max(floor, Math.floor((avail - (n - 1) * gap) / n))),
    gap,
  };
}

export function layoutRanks(
  layers: LayerDef[],
  width: number,
  bandLabel: Record<Band, string>,
  _height = 0,
): CascadeLayout {
  const padL = 96;
  const padR = 14;
  const padT = 10;
  const rankGap = 20;
  const bandPad = 8;
  const nodeH = 48;
  const avail = Math.max(width, 360) - padL - padR;
  const packed = layers.map((layer) => {
    const n = layer.ids.length;
    const { nodeW, gap } = rankPack(n <= 1 ? 2 : n, avail);
    const total = n * nodeW + Math.max(n - 1, 0) * gap;
    return { layer, n, nodeW, gap, total };
  });
  const maxSpan = packed.reduce((m, p) => Math.max(m, p.total), 0);
  const bandW = padL + maxSpan + padR - 16;
  const nodes: NodeBox[] = [];
  const ranks: RankBox[] = [];
  let y = padT;
  let nodeW = packed[0]?.nodeW ?? 200;
  for (const p of packed) {
    const rankH = nodeH + bandPad * 2;
    ranks.push({ label: p.layer.label, x: 8, y, w: bandW, h: rankH, band: p.layer.band });
    const ny = y + bandPad;
    const x0 = padL + (maxSpan - p.total) / 2;
    p.layer.ids.forEach((id, i) => {
      nodes.push({ id, x: x0 + i * (p.nodeW + p.gap), y: ny, w: p.nodeW, h: nodeH });
    });
    if (p.n === 2) nodeW = p.nodeW;
    y += rankH + rankGap;
  }

  const groups: GroupBox[] = [];
  let i = 0;
  while (i < ranks.length) {
    const band = ranks[i].band;
    if (band === "ends") {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < ranks.length && ranks[j + 1].band === band) j += 1;
    const a = ranks[i];
    const b = ranks[j];
    groups.push({
      band,
      label: bandLabel[band],
      x: 6,
      y: a.y,
      w: 18,
      h: b.y + b.h - a.y,
    });
    i = j + 1;
  }

  const lastOuter = [...ranks].reverse().find((r) => r.band === "outer");
  const firstInner = ranks.find((r) => r.band === "inner");
  const cutY =
    lastOuter && firstInner ? (lastOuter.y + lastOuter.h + firstInner.y) / 2 : null;

  return {
    width: padL + maxSpan + padR,
    height: y - rankGap + padT,
    nodeW,
    nodeH,
    nodes,
    ranks,
    groups,
    cutY,
  };
}

export type EdgePorts = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "h" | "v";
};

export function edgePorts(a: NodeBox, b: NodeBox): EdgePorts {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = bcx - acx;
  const dy = bcy - acy;
  const inset = 3;
  if (Math.abs(dy) < Math.min(a.h, b.h) * 0.6) {
    if (dx >= 0) {
      return { x1: a.x + a.w + inset, y1: acy, x2: b.x - inset, y2: bcy, kind: "h" };
    }
    return { x1: a.x - inset, y1: acy, x2: b.x + b.w + inset, y2: bcy, kind: "h" };
  }
  if (dy >= 0) {
    return { x1: acx, y1: a.y + a.h + inset, x2: bcx, y2: b.y - inset, kind: "v" };
  }
  return { x1: acx, y1: a.y - inset, x2: bcx, y2: b.y + b.h + inset, kind: "v" };
}

export type EdgeRoute = {
  d: string;
  lx: number;
  ly: number;
};

function f(n: number): string {
  return n.toFixed(1);
}

export function edgePath(x1: number, y1: number, x2: number, y2: number, kind: "h" | "v" = "v"): string {
  if (kind === "h") {
    const mx = (x1 + x2) / 2;
    return `M ${f(x1)} ${f(y1)} C ${f(mx)} ${f(y1)}, ${f(mx)} ${f(y2)}, ${f(x2)} ${f(y2)}`;
  }
  const my = (y1 + y2) / 2;
  return `M ${f(x1)} ${f(y1)} C ${f(x1)} ${f(my)}, ${f(x2)} ${f(my)}, ${f(x2)} ${f(y2)}`;
}

export function edgeRoute(a: NodeBox, b: NodeBox): EdgeRoute {
  const p = edgePorts(a, b);
  const lx = (p.x1 + p.x2) / 2;
  const ly = p.kind === "h" ? p.y1 - 8 : (p.y1 + p.y2) / 2 - 6;
  return { d: edgePath(p.x1, p.y1, p.x2, p.y2, p.kind), lx, ly };
}
