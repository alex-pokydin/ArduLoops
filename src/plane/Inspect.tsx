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
  nodeBand,
  nodesLiveIn,
  type NodeDef,
} from "./cascade";

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

export function PlaneInspect({
  sel,
  onSel,
  showAll,
}: {
  sel: string | null;
  onSel: (id: string | null) => void;
  showAll: boolean;
}) {
  const t = useT();
  const s = useViewSample();
  const modeKey = showAll ? "ALL" : s.mode;
  const live = !s.ok ? new Set<string>() : nodesLiveIn(modeKey, s);
  const band = isBandId(sel) ? sel : null;
  const node = band ? null : NODES.find((n) => n.id === sel) ?? null;
  const incoming = EDGES.filter((e) => e.to === sel && edgeLiveIn(e, modeKey, live));
  const outgoing = EDGES.filter((e) => e.from === sel && edgeLiveIn(e, modeKey, live));
  const dimmed = node ? !live.has(node.id) : false;

  return (
    <div className="inspect">
      <div className="inspect-head">
        <h2>{node ? t(node.title) : band ? t(BAND_LABEL[band]) : t("How this mode flies")}</h2>
      </div>
      {node ? (
        <>
          <div className={"kind " + nodeBand(node.id)}>
            {t(BAND_LABEL[nodeBand(node.id)])} · {t(node.unit)} · {t(node.kind)}
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
            {t("Empty map shows every link this mode closes. Click a card for its in and out. Roll and pitch are two loops — not one block with an axis switch. Axis buttons sit above the scheme.")}{" "}
            {LAYERS.map((l) => l.label).join(" → ")}
          </p>
        </>
      )}
    </div>
  );
}
