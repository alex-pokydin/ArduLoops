import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  EDGES,
  NODES,
  BAND_LABEL,
  edgeLiveIn,
  edgeRoute,
  layoutCopter,
  nodeBand,
  nodesLiveIn,
  pidTerms,
  isTuneNode,
  isLaterNode,
  type Band,
  type NodeDef,
} from "../cascade";
import { FrameGuide } from "./FrameGuide";
import { fmtGain, liveGain, paramUi } from "./GainRow";
import { t, useT } from "../i18n/i18n";
import { axisTar, axisView, type Axis } from "../mav/axis";
import { getSnapshot, subscribe } from "../mav/store";
import type { Sample } from "../mav/types";

function liveBits(node: NodeDef, s: Sample, axis: Axis): string {
  if (!node.live?.length) return "";
  const v = axisView(s, axis);
  const tar = axisTar(v);
  const parts: string[] = [];
  for (const k of node.live) {
    if (k === "cmd") parts.push(t("stick {v}{unit}", { v: v.cmd.toFixed(1), unit: v.cmdUnit === "°/s" ? t("°/s") : v.cmdUnit }));
    if (k === "tar") parts.push(t("target {v}°", { v: tar.toFixed(1) }));
    if (k === "roll") parts.push(t("{name} {v}°", { name: t(v.name), v: v.ang.toFixed(1) }));
    if (k === "des") parts.push(t("tar {v}°/s", { v: (v.des || 0).toFixed(1) }));
    if (k === "rate") parts.push(t("rate {v}°/s", { v: v.rate.toFixed(1) }));
    if (k === "alt" && s.alt != null) parts.push(t("AGL {v} m", { v: s.alt.toFixed(1) }));
    if (k === "climb" && s.climb != null) parts.push(t("climb {v} m/s", { v: s.climb.toFixed(2) }));
  }
  return parts.join(" · ");
}

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

function titleOf(id: string): string {
  const title = NODES.find((n) => n.id === id)?.title ?? id;
  return t(title);
}

function ParamList({ node, sample, axis }: { node: NodeDef; sample: Sample; axis: Axis }) {
  if (!node.gains.length) return null;
  return (
    <div className="plist">
      {node.gains.map((g) => {
        const live = liveGain(g, sample, axis);
        const v = paramUi(sample, g, axis);
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

export function Cascade({
  sel,
  onSel,
  axis,
}: {
  sel: string | null;
  onSel: (id: string | null) => void;
  axis: Axis;
}) {
  const t = useT();
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [showAll, setShowAll] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(420);
  const layout = useMemo(() => layoutCopter(width), [width]);
  const modeKey = showAll ? "ALL" : s.mode;
  const live = nodesLiveIn(modeKey);
  const node = NODES.find((n) => n.id === sel) ?? null;
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
    const sync = () => setWidth(el.clientWidth);
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
                const ink = g.band === "outer" ? "#ffb74d" : "#4fc3f7";
                const fill = g.band === "outer" ? "rgba(255,183,77,0.12)" : "rgba(79,195,247,0.12)";
                return (
                  <g key={g.band}>
                    <rect x={g.x} y={g.y} width={g.w} height={g.h} rx="5" fill={fill} stroke={ink} strokeOpacity="0.45" />
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
                  x={layout.width / 2 + 20}
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
                const r = edgeRoute(a, b);
                const on = edgeLiveIn(e, modeKey, live);
                const connected = sel != null && (e.from === sel || e.to === sel);
                const hot = connected && on;
                return (
                  <g key={`${e.from}-${e.to}-${e.label}`}>
                    <path
                      d={r.d}
                      fill="none"
                      stroke={hot ? "#4fc3f7" : on ? "#6b7884" : "#2a333c"}
                      strokeWidth={hot ? 2.2 : 1.2}
                      strokeDasharray={on ? undefined : "4 4"}
                      opacity={sel && !hot ? 0.22 : 1}
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
            {NODES.map((n) => {
              const box = boxById.get(n.id);
              if (!box) return null;
              const on = live.has(n.id);
              const pid = pidTerms(n);
              const tune = isTuneNode(n);
              const later = isLaterNode(n);
              const cls = [
                "cnode",
                nodeBand(n.id),
                sel === n.id ? "sel" : neighbors.has(n.id) ? "rel" : "",
                on ? "" : "dim",
                pid.length ? "has-pid" : "",
                tune ? "tune" : later ? "later" : pid.length ? "" : "struct",
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
                  {pid.length ? (
                    <span className="pid" aria-hidden="true">
                      {pid.map((k) => (
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
          <span className="k-tune">{t("tune · manuals")}</span>
          <span className="k-later">{t("sometimes · Loiter")}</span>
          <span className="k-struct">{t("not a regulator")}</span>
        </div>
        <FrameGuide focus={axis === "d" ? "d" : node?.axes ?? null} />
      </div>
      <div className="inspect">
        <div className="inspect-head">
          <h2>{node ? t(node.title) : t("Why the loops are separate")}</h2>
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
              {isTuneNode(node)
                ? ` · ${t("tune")}`
                : isLaterNode(node)
                  ? ` · ${t("sometimes")}`
                  : pidTerms(node).length
                    ? ""
                    : ` · ${t("not a regulator")}`}
              {node.inner && axis !== "d" ? ` · ${t(axisView(s, axis).name)}` : ""}
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
            {liveBits(node, s, axis) ? <div className="live">{liveBits(node, s, axis)}</div> : null}
            <ParamList node={node} sample={s} axis={axis} />
            {incoming.length ? (
              <div className="io">
                {t("In")}
                {incoming.map((e) => (
                  <div key={e.from + e.label}>
                    {titleOf(e.from)} · <b>{t(e.label)}</b>
                  </div>
                ))}
              </div>
            ) : null}
            {outgoing.length ? (
              <div className="io">
                {t("Out")}
                {outgoing.map((e) => (
                  <div key={e.to + e.label}>
                    <b>{t(e.label)}</b> · {titleOf(e.to)}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p>
              {t("The manuals tune attitude first: rate (Manual / QuikTune / AutoTune), then angle P, then stick feel (Input Shaping). PSC position loops are usually left at defaults.")}
            </p>
            <p>
              {t("Autotune writes the same rate and angle blocks, from AltHold. If Loiter still weaves after that, NE velocity is the next knob — not Navigation.")}
            </p>
            <p>
              {t("Stock Copter cascade: PosControl (PSC, outer) holds where to be, Attitude Control (ATC, inner) holds the angle.")}
            </p>
            <p>
              {t("Motors cannot “turn to 10°” — only thrust. Thrust difference makes torque. So the attitude regulator (ATC_ANG) does not spin motors: from angle error it computes how fast to rotate toward the target and sets a rate command for the next loop. The rate regulator does that job: °/s error → mixer torque.")}
            </p>
            <p>
              {t("The boundary is lean: horizontal acceleration becomes desired roll and pitch. Then ATC works in the body (° and °/s). Vertical skips angle: Down acceleration (PSC_D_ACC) goes straight to throttle. Yaw is the same two inner loops: angle and rate.")}
            </p>
            <p className="io">
              {t("There is no separate horizontal-acceleration PID. WP, Loiter and Circle set targets; they are not regulators. Not shown: Plane, CC2_, FHLD, FOLL, heli.")}
              {" "}
              {!showAll
                ? t("In {mode}, inactive blocks are not closed now.", { mode: s.mode })
                : t("All stock-cascade loops are visible now.")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
