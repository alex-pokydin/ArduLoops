import { useState } from "react";
import { paramOf } from "../components/GainRow";
import { LoopLiveBox } from "../components/LoopPids";
import { namedGains, SchemeKey, SchemeKnobs, loopCls, schemeHit } from "../components/SchemeKnobs";
import { PaneHead } from "../components/Studio";
import { useT } from "../i18n/i18n";
import { useViewSample } from "../mav/view";
import { NODES, steerLive } from "./cascade";

export function PlaneSteer({ embed, compact }: { embed?: boolean; compact?: boolean }) {
  const t = useT();
  const s = useViewSample();
  const node = NODES.find((n) => n.id === "steer")!;
  const live = steerLive(s, s.mode);
  const ceil = paramOf(s, "GROUND_STEER_ALT") ?? 5;
  const [pick, setPick] = useState<string | null>(null);
  const hit = (id: string) => schemeHit(id, pick, setPick);
  const knobs = namedGains(
    [node.gains, node.extras ?? []],
    pick === "agl"
      ? ["GROUND_STEER_ALT"]
      : pick === "p"
        ? ["STEER2SRV_P", "STEER2SRV_I", "STEER2SRV_D"]
        : pick === "loop"
          ? ["STEER2SRV_TCONST", "STEER2SRV_FF", "STEER2SRV_MINSPD"]
          : [],
  );

  return (
    <div className={loopCls(compact, embed)}>
      {live || !s.ok || compact ? null : (
        <p className="warn">
          {s.mode === "MANUAL"
            ? t("In MANUAL the ground steering loop is off — the stick is the wheel.")
            : t("Steer is idle above GROUND_STEER_ALT ({alt} m). This is the runway loop, not flight yaw.", {
                alt: ceil.toFixed(1),
              })}
        </p>
      )}
      <PaneHead>
        <b>{t("Ground steering · STEER2SRV")}</b>
      </PaneHead>
      {compact ? null : (
        <p className="loop-lead">{t("Tracks heading on the runway. Every mode except MANUAL, only below GROUND_STEER_ALT.")}</p>
      )}
      <div onClick={() => setPick(null)}>
      <svg className="loop-svg" viewBox="0 0 640 140" role="img" aria-label={t("Steer")}>
        <LoopLiveBox
          x={16}
          y={20}
          w={180}
          h={96}
          stroke="#ffb74d"
          title={t("AGL")}
          sub={`GROUND_STEER_ALT ${ceil.toFixed(1)} m`}
          value={s.alt == null ? "—" : `${s.alt.toFixed(1)} m`}
          pick={(p) => p.alt}
          mark="tune"
          {...hit("agl")}
        />
        <LoopLiveBox
          x={220}
          y={20}
          w={180}
          h={96}
          stroke="#4fc3f7"
          title="STEER2SRV_P"
          value={String(paramOf(s, "STEER2SRV_P") ?? "—")}
          pick={() => paramOf(s, "STEER2SRV_P")}
          mark="tune"
          {...hit("p")}
        />
        <LoopLiveBox
          x={424}
          y={20}
          w={196}
          h={96}
          stroke={live ? "#66bb6a" : "#6b7884"}
          title={t("loop")}
          sub={live ? t("closed") : t("idle")}
          value={live ? t("on") : t("off")}
          pick={() => (live ? 1 : 0)}
          mark="later"
          {...hit("loop")}
        />
      </svg>
      </div>
      <SchemeKey />
      {!compact ? <SchemeKnobs node={node} gains={knobs} picked={pick} /> : null}
    </div>
  );
}
