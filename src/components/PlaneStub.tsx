import { useT } from "../i18n/i18n";

export function PlaneStub() {
  const t = useT();
  return (
    <div className="stub">
      <p>
        {t("The link is {frame}. The wing layers map is still a stub — we will build it separately.", {
          frame: t("plane"),
        })}
      </p>
      <p>
        {t("Here it will not be PSC+ATC, but RLL_* / PTCH_* (angle → rate → servo), with NAVL1_* and TECS_* outside. Yaw defaults to YAW2SRV_*.")}
      </p>
    </div>
  );
}
