import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  EDGES,
  NODES,
  edgeLiveIn,
  edgeShownIn,
  edgeRoute,
  isBandId,
  LAYERS,
  layoutCopter,
  nodeBand,
  nodesLiveIn,
  isTuneNode,
  isLaterNode,
  cardMarks,
  hasKnobs,
  type Band,
  type NodeDef,
} from "../cascade";
import { fitScale, preferredLayoutWidth } from "../lib/layout";
import { FrameGuide } from "./FrameGuide";
import { t, useT } from "../i18n/i18n";
import { axisTar, axisView, type Axis } from "../mav/axis";
import { useViewSample } from "../mav/view";
import type { Sample } from "../mav/types";

/** One figure on the map card. Outer PSC stays as units — we don't have NE pos/vel. */
function cardLive(node: NodeDef, s: Sample, axis: Axis): string | null {
  if (!node.live?.length) return null;
  const v = axisView(s, axis);
  const tar = axisTar(v);
  if (node.id === "pilot") return t("{v}{unit}", { v: v.cmd.toFixed(1), unit: v.cmdUnit === "°/s" ? t("°/s") : v.cmdUnit });
  if (node.id === "atc_ang") return `${tar.toFixed(1)}°`;
  if (node.id === "atc_rat") return t("{v} °/s", { v: v.rate.toFixed(1) });
  if (node.id === "psc_d_pos" && s.alt != null) return t("{v} m", { v: s.alt.toFixed(1) });
  if (node.id === "psc_d_vel" && s.climb != null) return t("{v} m/s", { v: s.climb.toFixed(2) });
  if (node.id === "motors") {
    if (axis === "d") return t("{v}%", { v: v.cmd.toFixed(0) });
    return `${v.ang.toFixed(1)}°`;
  }
  return null;
}

function rankFill(band: Band): string {
  if (band === "ends") return "#1a2428";
  if (band === "outer") return "#221c14";
  return "#152028";
}

function rankInk(band: Band): string {
  if (band === "ends") return "#90a4ae";
  if (band === "outer") return "#ffb74d";
  return "#4fc3f7";
}

export function Cascade({
  sel,
  onSel,
  axis,
  showAll,
  onShowAll,
}: {
  sel: string | null;
  onSel: (id: string | null) => void;
  axis: Axis;
  showAll: boolean;
  onShowAll: (on: boolean) => void;
}) {
  const t = useT();
  const s = useViewSample();
  const wrapRef = useRef<HTMLDivElement>(null);
  const prefW = useMemo(() => preferredLayoutWidth(LAYERS), []);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const layout = useMemo(() => layoutCopter(prefW, 0), [prefW]);
  const scale = fitScale(box.w, box.h, layout.width, layout.height);
  const modeKey = showAll ? "ALL" : s.mode;
  const closed = nodesLiveIn(modeKey);
  const live = !s.ok ? new Set<string>() : closed;
  const band = isBandId(sel) ? sel : null;
  const node = band ? null : NODES.find((n) => n.id === sel) ?? null;
  const boxById = useMemo(() => {
    const m = new Map<string, (typeof layout.nodes)[0]>();
    for (const b of layout.nodes) m.set(b.id, b);
    return m;
  }, [layout]);
  const neighbors = new Set<string>();
  if (sel) {
    neighbors.add(sel);
    for (const e of EDGES) {
      if (!edgeShownIn(e, modeKey, closed)) continue;
      if (e.from === sel) neighbors.add(e.to);
      if (e.to === sel) neighbors.add(e.from);
    }
  }

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const sync = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="map-wrap">
      <div className="map-col">
        <div className="cmap" onClick={() => onSel(null)}>
          <div className="cmap-fit" ref={wrapRef}>
            <div
              className="cmap-shell"
              style={{ width: layout.width * scale, height: layout.height * scale }}
            >
          <div
            className="cmap-inner"
            style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}
          >
            <svg className="cmap-edges" width={layout.width} height={layout.height} aria-hidden="true">
              <defs>
                <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                  <polygon points="0 0, 8 4, 0 8" fill="#6b7884" />
                </marker>
                <marker id="arrHot" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                  <polygon points="0 0, 8 4, 0 8" fill="#4fc3f7" />
                </marker>
              </defs>
              {layout.groups.map((g) => {
                const cx = g.x + g.w / 2;
                const cy = g.y + g.h / 2;
                const on = g.band === band;
                const ink = g.band === "outer" ? "#ffb74d" : "#4fc3f7";
                const fill = g.band === "outer" ? "rgba(255,183,77,0.12)" : "rgba(79,195,247,0.12)";
                return (
                  <g key={g.band}>
                    <rect
                      x={g.x}
                      y={g.y}
                      width={g.w}
                      height={g.h}
                      rx="5"
                      fill={fill}
                      stroke={ink}
                      strokeOpacity={on ? 0.95 : 0.45}
                      strokeWidth={on ? 1.6 : 1}
                    />
                    <text
                      x={cx}
                      y={cy}
                      fill={ink}
                      fontSize="10"
                      fontWeight="650"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      transform={`rotate(-90 ${cx} ${cy})`}
                    >
                      {t(g.label)}
                    </text>
                  </g>
                );
              })}
              {layout.ranks.map((r) => (
                <g key={r.label}>
                  <rect x={r.x + 22} y={r.y} width={r.w - 22} height={r.h} rx="6" fill={rankFill(r.band)} />
                  <text x={r.x + 30} y={r.y + 16} fill={rankInk(r.band)} fontSize="10">
                    {t(r.label)}
                  </text>
                </g>
              ))}
              {layout.cutY != null ? (
                <text
                  x={(layout.ranks[0]?.x ?? 0) + (layout.ranks[0]?.w ?? layout.width) / 2}
                  y={layout.cutY + 4}
                  textAnchor="middle"
                  fill="#8b98a8"
                  fontSize="10"
                >
                  {t("boundary · lean becomes desired angle")}
                </text>
              ) : null}
              {EDGES.map((e) => {
                const a = boxById.get(e.from);
                const b = boxById.get(e.to);
                if (!a || !b) return null;
                if (!edgeShownIn(e, modeKey, closed)) return null;
                const r = edgeRoute(a, b);
                const on = s.ok && edgeLiveIn(e, modeKey, closed);
                const connected = !band && sel != null && (e.from === sel || e.to === sel);
                const bandEdge = !!band && (nodeBand(e.from) === band || nodeBand(e.to) === band);
                const hot = connected;
                return (
                  <g key={`${e.from}-${e.to}-${e.label}`}>
                    <path
                      d={r.d}
                      fill="none"
                      stroke={hot ? "#4fc3f7" : on ? "#6b7884" : "#2a333c"}
                      strokeWidth={hot ? 2.2 : 1.2}
                      strokeDasharray={on ? undefined : "4 4"}
                      opacity={sel && !hot && !bandEdge ? 0.22 : 1}
                      markerEnd={hot ? "url(#arrHot)" : on ? "url(#arr)" : undefined}
                    />
                    {hot ? (
                      <text
                        x={r.lx}
                        y={r.ly}
                        textAnchor="middle"
                        fill="#4fc3f7"
                        fontSize="10"
                        stroke="#0c0e11"
                        strokeWidth="3"
                        paintOrder="stroke"
                      >
                        {t(e.label)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
            {layout.groups.map((g) => (
              <button
                key={g.band}
                type="button"
                className={["cband", g.band, band === g.band ? "sel" : ""].filter(Boolean).join(" ")}
                style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
                aria-pressed={band === g.band}
                aria-label={t(g.label)}
                title={t(g.label)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSel(g.band === sel ? null : g.band);
                }}
              />
            ))}
            {NODES.map((n) => {
              const box = boxById.get(n.id);
              if (!box) return null;
              const on = live.has(n.id);
              const inBand = band != null && nodeBand(n.id) === band;
              const marks = cardMarks(n);
              const knobs = hasKnobs(n);
              const tune = isTuneNode(n);
              const later = isLaterNode(n);
              const cls = [
                "cnode",
                nodeBand(n.id),
                sel === n.id ? "sel" : inBand || neighbors.has(n.id) ? "rel" : "",
                !on || (band != null && !inBand) ? "dim" : "",
                marks.length ? "has-pid" : "",
                !knobs ? "struct" : tune ? "tune" : later ? "later" : "",
                axis === "d" && n.axes === "d" ? "d-on" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const liveTxt = on ? cardLive(n, s, axis) : null;
              return (
                <button
                  key={n.id}
                  type="button"
                  className={cls}
                  aria-pressed={sel === n.id}
                  title={n.param}
                  style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSel(n.id === sel ? null : n.id);
                  }}
                >
                  {marks.length ? (
                    <span className="pid" aria-hidden="true">
                      {marks.map((k) => (
                        <span key={k}>{k}</span>
                      ))}
                    </span>
                  ) : null}
                  <span className="t">{t(n.title)}</span>
                  <span className={liveTxt ? "p live" : "p"}>{liveTxt ?? t(n.unit)}</span>
                </button>
              );
            })}
          </div>
            </div>
          </div>
        </div>
        <div className="cmap-bar">
        <div className="cmap-key" aria-hidden="true">
          <span className="k-tune">{t("tune · manuals")}</span>
          <span className="k-later">{t("sometimes · Loiter")}</span>
          {NODES.some((n) => !hasKnobs(n)) ? <span className="k-struct">{t("dashed · no knobs")}</span> : null}
        </div>
          <button
            type="button"
            className={showAll ? "map-sw on" : "map-sw"}
            aria-pressed={showAll}
            onClick={() => onShowAll(!showAll)}
          >
            <span className="track" aria-hidden="true" />
            {t("all loops")}
          </button>
        </div>
        <FrameGuide
          focus={
            band === "outer"
              ? axis === "d"
                ? "d"
                : "ne"
              : band === "inner"
                ? "att"
                : axis === "d"
                  ? "d"
                  : node?.axes ?? null
          }
        />
      </div>
    </div>
  );
}
