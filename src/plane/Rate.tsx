import { useState } from "react";
import { paramOf } from "../components/GainRow";
import { LoopLiveBox } from "../components/LoopPids";
import { namedGains, SchemeKey, SchemeKnobs, loopCls, schemeHit } from "../components/SchemeKnobs";
import { PaneHead } from "../components/Studio";
import { useT } from "../i18n/i18n";
import { type Axis } from "../mav/axis";
import { useViewSample } from "../mav/view";
import { NODES, nodesLiveIn } from "./cascade";

const COL = {
  cyan: "#4fc3f7",
  dim: "#8b98a8",
};

function fmt(v: number | null, d: number): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(d);
}

/** Yaw is YAW2SRV, not AC_PID. Roll/pitch Rate uses the shared Loop diagram. */
export function PlaneRate({ axis, embed, compact }: { axis: Axis; embed?: boolean; compact?: boolean }) {
  const t = useT();
  const s = useViewSample();
  const node = NODES.find((n) => n.id === "yaw_damp")!;
  const idle = s.ok && !nodesLiveIn(s.mode, s).has(node.id);
  const [pick, setPick] = useState<string | null>(null);
  const hit = (id: string) => schemeHit(id, pick, setPick);
  const knobs = namedGains(
    [node.gains],
    pick === "damp" ? ["YAW2SRV_DAMP"] : pick === "ahrs" ? ["YAW2SRV_RLL"] : pick === "des" ? ["YAW2SRV_SLIP", "YAW2SRV_INT"] : [],
  );

  return (
    <div className={loopCls(compact, embed)}>
      {idle && !compact ? (
        <p className="warn">
          {t("In {mode} this loop is not running: the autopilot is not turning it. You can inspect gains, but they will not change behaviour until the mode closes the loop.", {
            mode: s.mode || t("this mode"),
          })}
        </p>
      ) : null}
      <PaneHead>
        <b>{t("Yaw damper · rudder")}</b>
      </PaneHead>
      {compact ? null : (
        <p className="loop-lead">{t("DAMP resists yaw rate; RLL coordinates from AHRS bank. Live in FBWA and the nav modes.")}</p>
      )}
      <div onClick={() => setPick(null)}>
      <svg className="loop-svg" viewBox="0 0 640 220" role="img" aria-label={t("Rate")}>
        <LoopLiveBox
          x={8}
          y={12}
          w={150}
          h={88}
          stroke={COL.dim}
          title={t("desired")}
          value="—"
          pick={() => null}
          mark="tune"
          {...hit("des")}
        />
        <LoopLiveBox
          x={8}
          y={112}
          w={150}
          h={88}
          stroke={COL.cyan}
          title={t("gyro")}
          value={`${fmt(s.yaw_rate, 1)} °/s`}
          pick={(p) => p.yaw_rate}
          mark="struct"
          {...hit("gyro")}
        />
        <LoopLiveBox
          x={180}
          y={60}
          w={200}
          h={100}
          stroke={COL.dim}
          title={t("YAW2SRV_DAMP")}
          sub={t("on gyro z")}
          value={fmt(paramOf(s, "YAW2SRV_DAMP"), 2)}
          pick={() => paramOf(s, "YAW2SRV_DAMP")}
          mark="tune"
          {...hit("damp")}
        />
        <LoopLiveBox
          x={400}
          y={60}
          w={220}
          h={100}
          stroke={COL.cyan}
          title={t("AHRS")}
          sub={t("RLL reads sin(this bank)")}
          value={`${fmt(s.roll, 1)}°`}
          pick={(p) => p.roll}
          mark="tune"
          {...hit("ahrs")}
        />
      </svg>
      </div>
      <SchemeKey />
      {!compact ? (
        <>
          <SchemeKnobs node={node} axis={axis === "d" ? "roll" : axis} gains={knobs} picked={pick} />
          <p className="frame-hint">
            {t("In FBWA this is the rudder damper. Ground steering is the nosewheel, only below GROUND_STEER_ALT.")}
          </p>
        </>
      ) : null}
    </div>
  );
}
