import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cardMarks, hasKnobs } from "../lib/gains";
import { edgeRoute } from "../lib/layout";
import { fmtGain, liveGain, paramUi } from "../components/GainRow";
import { t, useT } from "../i18n/i18n";
import { axisTar, axisView, type Axis } from "../mav/axis";
import { useViewSample } from "../mav/view";
import type { Sample } from "../mav/types";
import {
  BAND_COPY,
  BAND_LABEL,
  EDGES,
  LAYERS,
  NODES,
  edgeLiveIn,
  isBandId,
  isLaterNode,
  isTuneNode,
  layoutPlane,
  nodeBand,
  nodesLiveIn,
  type Band,
  type NodeDef,
} from "./cascade";
import { PlaneGuide } from "./FrameGuide";

function nodeAxis(id: string): Axis {
  if (id === "ptch_ang" || id === "ptch_rate" || id === "elevator") return "pitch";
  if (id === "yaw_damp" || id === "rudder") return "yaw";
  return "roll";
}

function stickLive(s: Sample): string {
  const r = axisView(s, "roll").cmd;
  const p = axisView(s, "pitch").cmd;
  const y = axisView(s, "yaw").cmd;
  const thr = ((s.thr_cmd ?? 0) + 100) / 2;
  return `R${r.toFixed(0)}° · P${p.toFixed(0)}° · T${thr.toFixed(0)} · Y${y.toFixed(0)}`;
}

function liveBits(node: NodeDef, s: Sample): string {
  if (!node.live?.length) return "";
  const v = axisView(s, nodeAxis(node.id));
  const tar = axisTar(v);
  const parts: string[] = [];
  for (const k of node.live) {
    if (k === "cmd") {
      if (node.id === "pilot") {
        parts.push(stickLive(s));
      } else {
        parts.push(t("stick {v}{unit}", { v: v.cmd.toFixed(1), unit: v.cmdUnit }));
      }
    }
    if (k === "tar") parts.push(t("target {v}°", { v: tar.toFixed(1) }));
    if (k === "des") parts.push(t("tar {v}°/s", { v: (v.des || 0).toFixed(1) }));
    if (k === "rate") parts.push(t("rate {v}°/s", { v: v.rate.toFixed(1) }));
    if (k === "roll") parts.push(t("{v}°", { v: (s.roll || 0).toFixed(1) }));
    if (k === "alt" && s.alt != null) parts.push(t("AGL {v} m", { v: s.alt.toFixed(1) }));
    if (k === "aspd" && s.aspd != null) parts.push(t("{v} m/s", { v: s.aspd.toFixed(1) }));
    if (k === "thr" && s.thr_out != null) parts.push(t("thr {v}%", { v: s.thr_out.toFixed(0) }));
  }
  return parts.join(" · ");
}

function cardLive(node: NodeDef, s: Sample): string | null {
  if (node.id === "pilot") return stickLive(s);
  const v = axisView(s, nodeAxis(node.id));
  const tar = axisTar(v);
  if (node.id === "rll_ang" || node.id === "ptch_ang") return `${tar.toFixed(1)}°`;
  if (node.id === "rll_rate") return t("{v} °/s", { v: (s.rate || 0).toFixed(1) });
  if (node.id === "ptch_rate") return t("{v} °/s", { v: (s.pitch_rate || 0).toFixed(1) });
  if (node.id === "yaw_damp") return t("{v} °/s", { v: (s.yaw_rate || 0).toFixed(1) });
  if (node.id === "ahrs") return `${(s.roll || 0).toFixed(1)}°`;
  if (node.id === "tecs" && s.aspd != null) return t("{v} m/s", { v: s.aspd.toFixed(1) });
  if (node.id === "throttle" && s.thr_out != null) return t("thr {v}%", { v: s.thr_out.toFixed(0) });
  if ((node.id === "aileron" || node.id === "elevator" || node.id === "rudder") && s.aspd != null) {
    return t("{v} m/s", { v: s.aspd.toFixed(1) });
  }
  return null;
}

function ParamList({ node, sample }: { node: NodeDef; sample: Sample }) {
  if (!node.gains.length) return null;
  return (
    <div className="plist">
      {node.gains.map((g) => {
        const live = liveGain(g, sample, "roll");
        const v = paramUi(sample, g, "roll");
        return (
          <div className="prow" key={g.key}>
            <code>{live.name}</code>
            <b>{v == null ? "—" : fmtGain(g, v, live.name)}</b>
          </div>
        );
      })}
    </div>
  );
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

export function PlaneMap({
  sel,
  onSel,
}: {
  sel: string | null;
  onSel: (id: string | null) => void;
}) {
  const t = useT();
  const s = useViewSample();
  const [showAll, setShowAll] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 420, h: 0 });
  const layout = useMemo(() => layoutPlane(box.w, box.h), [box]);
  const modeKey = showAll ? "ALL" : s.mode;
  const live = !s.ok ? new Set<string>() : nodesLiveIn(modeKey, s);
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
      if (!edgeLiveIn(e, modeKey, live)) continue;
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

  const incoming = EDGES.filter((e) => e.to === sel && edgeLiveIn(e, modeKey, live));
  const outgoing = EDGES.filter((e) => e.from === sel && edgeLiveIn(e, modeKey, live));
  const dimmed = node ? !live.has(node.id) : false;

  return (
    <div className="map-wrap">
      <div className="map-col">
        <div className="cmap" ref={wrapRef} onClick={() => onSel(null)}>
          <div className="cmap-inner" style={{ width: layout.width, height: layout.height }}>
            <svg className="cmap-edges" width={layout.width} height={layout.height} aria-hidden="true">
              <defs>
                <marker id="parr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                  <polygon points="0 0, 8 4, 0 8" fill="#6b7884" />
                </marker>
                <marker id="parrHot" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
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
                  {t("boundary · bank becomes desired angle")}
                </text>
              ) : null}
              {EDGES.map((e) => {
                const a = boxById.get(e.from);
                const b = boxById.get(e.to);
                if (!a || !b) return null;
                const r = edgeRoute(a, b);
                const on = edgeLiveIn(e, modeKey, live);
                const io = !!node && (e.from === sel || e.to === sel);
                const bandHit = !!band && (nodeBand(e.from) === band || nodeBand(e.to) === band);
                const hot = on && (node ? io : band ? bandHit : true);
                const label = hot && (!!node || !!band);
                return (
                  <g key={`${e.from}-${e.to}-${e.label}`}>
                    <path
                      d={r.d}
                      fill="none"
                      stroke={hot ? (node || band ? "#4fc3f7" : "#8b98a8") : on ? "#3a4650" : "#2a333c"}
                      strokeWidth={hot ? (node || band ? 2.2 : 1.8) : 1.2}
                      strokeDasharray={on ? undefined : "4 4"}
                      opacity={hot ? 1 : on ? 0.28 : node || band ? 0.12 : 0.45}
                      markerEnd={hot ? (node || band ? "url(#parrHot)" : "url(#parr)") : undefined}
                    />
                    {label ? (
                      <text
                        x={r.lx}
                        y={r.ly}
                        textAnchor="middle"
                        fill={node || band ? "#4fc3f7" : "#8b98a8"}
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
                box.w < 110 ? "dense" : "",
                !knobs ? "struct" : tune ? "tune" : later ? "later" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const liveTxt = on ? cardLive(n, s) : null;
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
        <div className="cmap-key" aria-hidden="true">
          <span className="k-tune">{t("tune · FBWA first")}</span>
          <span className="k-later">{t("sometimes · after rate")}</span>
          <span className="k-struct">{t("dashed · no knobs")}</span>
        </div>
        <PlaneGuide focus={band === "outer" ? "energy" : band === "inner" ? "att" : node?.axes ?? null} />
      </div>
      <div className="inspect">
        <div className="inspect-head">
          <h2>{node ? t(node.title) : band ? t(BAND_LABEL[band]) : t("How this mode flies")}</h2>
          <button
            type="button"
            className={showAll ? "map-sw on" : "map-sw"}
            aria-pressed={showAll}
            onClick={() => setShowAll((v) => !v)}
          >
            <span className="track" aria-hidden="true" />
            {t("all loops")}
          </button>
        </div>
        {node ? (
          <>
            <div className={"kind " + nodeBand(node.id)}>
              {t(BAND_LABEL[nodeBand(node.id)])} · {t(node.unit)} · {t(node.kind)}
            </div>
            {dimmed ? (
              <p className="warn">
                {t("In {mode} this loop is not running: the autopilot is not turning it. You can inspect gains, but they will not change behaviour until the mode closes the loop.", {
                  mode: s.mode || t("this mode"),
                })}
              </p>
            ) : null}
            <p>{t(node.does)}</p>
            {node.trap ? (
              <p className="trap">
                <b>{t("typical")}</b> {t(node.trap)}
              </p>
            ) : null}
            {liveBits(node, s) ? <div className="live">{liveBits(node, s)}</div> : null}
            <ParamList node={node} sample={s} />
            {incoming.length ? (
              <div className="io">
                {t("In")}
                {incoming.map((e) => (
                  <div key={e.from + e.label}>
                    {t(NODES.find((n) => n.id === e.from)?.title ?? e.from)} · <b>{t(e.label)}</b>
                  </div>
                ))}
              </div>
            ) : null}
            {outgoing.length ? (
              <div className="io">
                {t("Out")}
                {outgoing.map((e) => (
                  <div key={e.to + e.label}>
                    <b>{t(e.label)}</b> · {t(NODES.find((n) => n.id === e.to)?.title ?? e.to)}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : band ? (
          <>
            <div className={"kind " + band}>
              {t(BAND_COPY[band].kind)} · {t(BAND_COPY[band].unit)}
            </div>
            <p>{t(BAND_COPY[band].does)}</p>
            <p>{t(BAND_COPY[band].more)}</p>
            <p className="trap">
              <b>{t("typical")}</b> {t(BAND_COPY[band].trap)}
            </p>
            <div className="io">
              {t("Loops")}
              {NODES.filter((n) => nodeBand(n.id) === band).map((n) => (
                <button type="button" key={n.id} onClick={() => onSel(n.id)}>
                  {t(n.title)} · <b>{t(n.kind)}</b>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p>
              {t("A letter on a card is a knob: P I D, or TCONST, DAMP, PERIOD. Dashed cards have none — AHRS measures, a surface is PWM.")}
            </p>
            <p>
              {t("In FBWA the stick is an angle; rate FF moves the servo, scaled by airspeed. Pitch numbers are independent of roll.")}
            </p>
            <p>
              {t("Tune inner loops in FBWA, not MANUAL. Feedforward first until the rate target and the gyro match, then I = FF, then P, then D. Pitch numbers are independent of roll.")}
            </p>
            <p>
              {t("AUTO / LOITER / RTL: L1 asks for bank, TECS shares height and airspeed into pitch and throttle.")}
            </p>
            <p>
              {t("Yaw is a damper on the rudder (YAW2SRV). Ground steering writes the nosewheel only below GROUND_STEER_ALT.")}
            </p>
            <p className="io">
              {t("Empty map shows every link this mode closes. Click a card for its in and out. Roll and pitch are two loops — not one block with an axis switch. Rate and Scope keep the axis buttons.")}{" "}
              {LAYERS.map((l) => l.label).join(" → ")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
