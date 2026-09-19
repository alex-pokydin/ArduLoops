import type { Axis } from "../mav/axis";
import { useT } from "../i18n/i18n";

const AXES: Axis[] = ["roll", "pitch", "yaw"];

export function PlaneAxisSwitch({
  axis,
  onAxis,
}: {
  axis: Axis;
  onAxis: (axis: Axis) => void;
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
          {t(id === "yaw" ? "yaw" : id)}
        </button>
      ))}
    </div>
  );
}
