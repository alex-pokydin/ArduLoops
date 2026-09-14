import { axisLabel, type Axis } from "../mav/axis";
import { useT } from "../i18n/i18n";

const AXES: Axis[] = ["roll", "pitch", "yaw"];

export function AxisSwitch({
  axis,
  onAxis,
  live3d,
  onLive3d,
}: {
  axis: Axis;
  onAxis: (axis: Axis) => void;
  live3d: boolean;
  onLive3d: (on: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="axis-sw" role="tablist" aria-label={t("Axis")}>
      {AXES.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={axis === id}
          className={axis === id ? "on" : undefined}
          onClick={() => onAxis(id)}
        >
          {t(axisLabel(id))}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={live3d}
        className={live3d ? "on dim3d" : "dim3d"}
        title={t("Model: roll and pitch together")}
        onClick={() => onLive3d(!live3d)}
      >
        3D
      </button>
    </div>
  );
}
