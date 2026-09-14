import { axisLabel, type Axis } from "../mav/axis";

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
  return (
    <div className="axis-sw" role="tablist" aria-label="вісь">
      {AXES.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={axis === id}
          className={axis === id ? "on" : undefined}
          onClick={() => onAxis(id)}
        >
          {axisLabel(id)}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={live3d}
        className={live3d ? "on dim3d" : "dim3d"}
        title="Модель: крен і тангаж разом"
        onClick={() => onLive3d(!live3d)}
      >
        3D
      </button>
    </div>
  );
}
