import {
  BAND_COPY,
  BAND_LABEL,
  EDGES,
  NODES,
  edgeLiveIn,
  edgeShownIn,
  hasKnobs,
  isBandId,
  isLaterNode,
  isTuneNode,
  nodeBand,
  nodesLiveIn,
  type NodeDef,
} from "../cascade";
import { fmtGain, liveGain, paramUi } from "./GainRow";
import { t, useT } from "../i18n/i18n";
import { axisTar, axisView, type Axis } from "../mav/axis";
import { useViewSample } from "../mav/view";
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

export function CopterInspect({
  sel,
  onSel,
  axis,
  showAll,
}: {
  sel: string | null;
  onSel: (id: string | null) => void;
  axis: Axis;
  showAll: boolean;
}) {
  const t = useT();
  const s = useViewSample();
  const modeKey = showAll ? "ALL" : s.mode;
  const closed = nodesLiveIn(modeKey);
  const live = !s.ok ? new Set<string>() : closed;
  const band = isBandId(sel) ? sel : null;
  const node = band ? null : NODES.find((n) => n.id === sel) ?? null;
  const incoming = EDGES.filter((e) => e.to === sel && edgeShownIn(e, modeKey, closed));
  const outgoing = EDGES.filter((e) => e.from === sel && edgeShownIn(e, modeKey, closed));
  const dimmed = node ? !live.has(node.id) : false;

  return (
    <div className="inspect">
      <div className="inspect-head">
        <h2>{node ? t(node.title) : band ? t(BAND_LABEL[band]) : t("Why the loops are separate")}</h2>
      </div>
      {node ? (
        <>
          <div className={"kind " + nodeBand(node.id)}>
            {t(BAND_LABEL[nodeBand(node.id)])} · {t(node.unit)} · {t(node.kind)}
            {isTuneNode(node)
              ? ` · ${t("tune")}`
              : isLaterNode(node)
                ? ` · ${t("sometimes")}`
                : hasKnobs(node)
                  ? ""
                  : ` · ${t("no knobs")}`}
            {node.inner && axis !== "d" ? ` · ${t(axisView(s, axis).name)}` : ""}
          </div>
          {dimmed && s.ok ? (
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
                  {edgeLiveIn(e, modeKey, closed) ? "" : ` · ${t("pilot override")}`}
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
                  {edgeLiveIn(e, modeKey, closed) ? "" : ` · ${t("pilot override")}`}
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
            {t("A letter on a card is a knob: P I D, or TC, ANGLE_MAX, hover. Left bar is first flight; the Loiter stack comes after attitude.")}
          </p>
          <p>
            {t("The manuals tune attitude first: rate (Manual / QuikTune / AutoTune), then angle P, then stick feel (Input Shaping). PSC position loops are usually left at defaults.")}
          </p>
          <p>
            {t("Autotune writes the same rate and angle blocks, from AltHold. If Loiter still weaves after that, NE velocity is the next knob — not Navigation.")}
          </p>
          <p>
            {t("Stock Copter layers: PosControl (PSC) holds where to be, Attitude Control (ATC) holds the angle.")}
          </p>
          <p>
            {t("Motors cannot “turn to 10°” — only thrust. Thrust difference makes torque. So the attitude regulator (ATC_ANG) does not spin motors: from angle error it computes how fast to rotate toward the target and sets a rate command for the next loop. The rate regulator does that job: °/s error → mixer torque.")}
          </p>
          <p>
            {t("The boundary is lean: horizontal acceleration becomes desired roll and pitch. Then ATC works in the body (° and °/s). Vertical skips angle: Down acceleration (PSC_D_ACC) goes straight to throttle. Yaw is the same two inner loops: angle and rate.")}
          </p>
          <p className="io">
            {t("WP, Loiter and Circle write targets for PosControl. Horizontal output is lean; vertical accel goes to throttle. Not shown: Plane, CC2_, FHLD, FOLL, heli.")}{" "}
            {showAll
              ? t("All stock layers are visible now.")
              : s.ok
                ? t("In {mode}, inactive blocks are not closed now.", { mode: s.mode || t("this mode") })
                : null}
          </p>
        </>
      )}
    </div>
  );
}
