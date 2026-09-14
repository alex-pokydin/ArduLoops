import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  EDGES,
  NODES,
  BAND_LABEL,
  edgeLiveIn,
  edgePath,
  layoutCopter,
  nodeBand,
  nodesLiveIn,
  pidTerms,
  type Band,
  type NodeDef,
} from "../cascade";
import { FrameGuide } from "./FrameGuide";
import { fmtGain, paramOf } from "./GainRow";
import { axisTar, axisView, gainKeysForAxis, type Axis } from "../mav/axis";
import { getSnapshot, subscribe } from "../mav/store";
import type { Sample } from "../mav/types";

function liveBits(node: NodeDef, s: Sample, axis: Axis): string {
  if (!node.live?.length) return "";
  const v = axisView(s, axis);
  const tar = axisTar(v);
  const parts: string[] = [];
  for (const k of node.live) {
    if (k === "cmd") parts.push(`стик ${v.cmd.toFixed(1)}${v.cmdUnit}`);
    if (k === "tar") parts.push(`ціль ${tar.toFixed(1)}°`);
    if (k === "roll") parts.push(`${v.name} ${v.ang.toFixed(1)}°`);
    if (k === "des") parts.push(`tar ${(v.des || 0).toFixed(1)}°/с`);
    if (k === "rate") parts.push(`rate ${v.rate.toFixed(1)}°/с`);
    if (k === "alt" && s.alt != null) parts.push(`AGL ${s.alt.toFixed(1)} м`);
  }
  return parts.join(" · ");
}

/** One figure on the map card. Outer PSC stays as units — we don't have NE pos/vel. */
function cardLive(node: NodeDef, s: Sample, axis: Axis): string | null {
  if (!node.live?.length) return null;
  const v = axisView(s, axis);
  const tar = axisTar(v);
  if (node.id === "pilot") return `${v.cmd.toFixed(1)}${v.cmdUnit}`;
  if (node.id === "atc_ang") return `${tar.toFixed(1)}°`;
  if (node.id === "atc_rat") return `${v.rate.toFixed(1)} °/с`;
  if (node.id === "psc_d_pos" && s.alt != null) return `${s.alt.toFixed(1)} м`;
  if (node.id === "motors") return `${v.ang.toFixed(1)}°`;
  return null;
}

function titleOf(id: string): string {
  return NODES.find((n) => n.id === id)?.title ?? id;
}

function ParamList({ node, sample, axis }: { node: NodeDef; sample: Sample; axis: Axis }) {
  if (!node.gains.length) return null;
  return (
    <div className="plist">
      {node.gains.flatMap((g) =>
        gainKeysForAxis(g, axis).map((name) => {
          const v = paramOf(sample, name);
          return (
            <div className="prow" key={name}>
              <code>{name}</code>
              <b>{v == null ? "—" : fmtGain(g, v, name)}</b>
            </div>
          );
        }),
      )}
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
                <marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <polygon points="0 0, 7 3.5, 0 7" fill="#6b7884" />
                </marker>
                <marker id="arrHot" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <polygon points="0 0, 7 3.5, 0 7" fill="#4fc3f7" />
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
                      {g.label}
                    </text>
                  </g>
                );
              })}
              {layout.ranks.map((r) => (
                <g key={r.label}>
                  <rect x={r.x + 22} y={r.y} width={r.w - 22} height={r.h} rx="6" fill={rankFill(r.band)} />
                  <text x={r.x + 30} y={r.y + 16} fill={rankInk(r.band)} fontSize="10">
                    {r.label}
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
                  межа · lean стає бажаним кутом
                </text>
              ) : null}
              {EDGES.map((e) => {
                const a = boxById.get(e.from);
                const b = boxById.get(e.to);
                if (!a || !b) return null;
                const x1 = a.x + a.w / 2;
                const y1 = a.y + a.h;
                const x2 = b.x + b.w / 2;
                const y2 = b.y;
                const on = edgeLiveIn(e, modeKey, live);
                const connected = sel != null && (e.from === sel || e.to === sel);
                const hot = connected && on;
                return (
                  <g key={`${e.from}-${e.to}-${e.label}`}>
                    <path
                      d={edgePath(x1, y1, x2, y2)}
                      fill="none"
                      stroke={hot ? "#4fc3f7" : on ? "#6b7884" : "#2a333c"}
                      strokeWidth={hot ? 2.2 : 1.2}
                      strokeDasharray={on ? undefined : "4 4"}
                      opacity={sel && !hot ? 0.22 : 1}
                      markerEnd={hot ? "url(#arrHot)" : on ? "url(#arr)" : undefined}
                    />
                    {hot ? (
                      <text
                        x={(x1 + x2) / 2}
                        y={(y1 + y2) / 2 - 6}
                        textAnchor="middle"
                        fill="#4fc3f7"
                        fontSize="10"
                      >
                        {e.label}
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
              const cls = [
                "cnode",
                nodeBand(n.id),
                sel === n.id ? "sel" : neighbors.has(n.id) ? "rel" : "",
                on ? "" : "dim",
                pid.length ? "has-pid" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const liveTxt = on ? cardLive(n, s, axis) : null;
              return (
                <button
                  key={n.id}
                  type="button"
                  className={cls}
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
                  <span className="t">{n.title}</span>
                  <span className={liveTxt ? "p live" : "p"}>{liveTxt ?? n.unit}</span>
                </button>
              );
            })}
          </div>
        </div>
        <FrameGuide focus={node?.axes ?? null} />
      </div>
      <div className="inspect">
        <div className="inspect-head">
          <h2>{node ? node.title : "Чому контури окремі"}</h2>
          <button
            type="button"
            className={showAll ? "map-sw on" : "map-sw"}
            aria-pressed={showAll}
            onClick={() => setShowAll((v) => !v)}
          >
            <span className="track" aria-hidden="true" />
            усі контури
          </button>
        </div>
        {node ? (
          <>
            <div className={"kind " + nodeBand(node.id)}>
              {BAND_LABEL[nodeBand(node.id)]} · {node.unit} · {node.kind}
              {node.inner ? ` · ${axisView(s, axis).name}` : ""}
            </div>
            {dimmed ? (
              <p className="warn">
                У {s.mode || "цьому режимі"} цей контур не працює: автопілот його зараз не крутить.
                Гейни можна дивитись, але на поведінку вони не вплинуть, поки режим його не замкне.
              </p>
            ) : null}
            <p>{node.does}</p>
            {liveBits(node, s, axis) ? <div className="live">{liveBits(node, s, axis)}</div> : null}
            <ParamList node={node} sample={s} axis={axis} />
            {incoming.length ? (
              <div className="io">
                Входить
                {incoming.map((e) => (
                  <div key={e.from + e.label}>
                    {titleOf(e.from)} · <b>{e.label}</b>
                  </div>
                ))}
              </div>
            ) : null}
            {outgoing.length ? (
              <div className="io">
                Віддає
                {outgoing.map((e) => (
                  <div key={e.to + e.label}>
                    <b>{e.label}</b> · {titleOf(e.to)}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p>
              Штатний каскад Copter: <b>PosControl (PSC, зовнішній)</b> тримає де бути,{" "}
              <b>Attitude Control (ATC, внутрішній)</b> тримає кут.
            </p>
            <p>
              Мотори не вміють «повернутись на 10°» — лише тяга. Різниця тяг дає момент (torque).
              Тому регулятор кута (attitude, ATC_ANG) не крутить мотори: з помилки кута він рахує, як
              швидко треба крутитись до цілі, і ставить завдання кутової швидкості (rate, ATC_RAT)
              наступному контуру. Регулятор rate це завдання виконує: помилка °/с → момент у мікшер.
            </p>
            <p>
              Межа між ними — нахил (lean): горизонтальне прискорення стає бажаним креном і тангажем.
              Далі ATC працює в тілі (° і °/с). Вертикаль кут обходить: прискорення Down (accel,
              PSC_D_ACC) одразу йде в газ. Рискання (yaw) — ті самі два внутрішні контури: кут і
              кутова швидкість.
            </p>
            <p className="io">
              Окремого PID горизонтального прискорення немає. WP, Loiter і Circle задають цілі, це не
              регулятори. Не показано: Plane, CC2_, FHLD, FOLL, heli.
              {!showAll
                ? ` У ${s.mode} неактивні блоки зараз не замкнені.`
                : " Зараз видно всі контури штатного каскаду."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
