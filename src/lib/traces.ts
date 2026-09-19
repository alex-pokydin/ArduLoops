import type { Axis } from "../mav/axis";
import type { Sample } from "../mav/types";

export type TraceRole = "stick" | "desired" | "target" | "actual";

export type Trace = {
  key: keyof Sample;
  role: TraceRole;
  /** MAVLink / field name — shown as-is. */
  label: string;
};

export type Pane = {
  title: string;
  hint: string;
  unit: string;
  traces: Trace[];
  gap?: [keyof Sample, keyof Sample];
  unwrap?: boolean;
  spanMin: number;
  hud?: Array<"aspd" | "gspd">;
  /** Cascade cards that share this MAVLink plot. */
  fromIds?: string[];
};

export const ROLE_CLASS: Record<TraceRole, string> = {
  stick: "g",
  desired: "w",
  target: "a",
  actual: "c",
};

export type Frame = "copter" | "plane";

function keys(axis: Axis) {
  if (axis === "d") {
    return {
      ang: "alt" as const,
      tar: "alt_tar" as const,
      cmd: "thr_cmd" as const,
      des: "climb_des" as const,
      rate: "climb" as const,
    };
  }
  if (axis === "pitch") {
    return {
      ang: "pitch" as const,
      tar: "pitch_tar" as const,
      cmd: "pitch_cmd" as const,
      des: "pitch_des" as const,
      rate: "pitch_rate" as const,
    };
  }
  if (axis === "yaw") {
    return {
      ang: "yaw" as const,
      tar: "yaw_tar" as const,
      cmd: "yaw_cmd" as const,
      des: "yaw_des" as const,
      rate: "yaw_rate" as const,
    };
  }
  return {
    ang: "roll" as const,
    tar: "tar" as const,
    cmd: "cmd" as const,
    des: "des" as const,
    rate: "rate" as const,
  };
}

function attLabel(_frame: Frame, axis: Axis): string {
  if (axis === "d") return "GLOBAL_POSITION_INT.relative_alt";
  if (axis === "pitch") return "ATTITUDE.pitch";
  if (axis === "yaw") return "ATTITUDE.yaw";
  return "ATTITUDE.roll";
}

function tarLabel(frame: Frame, axis: Axis): string {
  if (axis === "d") return "NAV_CONTROLLER_OUTPUT.alt_error → AGL";
  if (frame === "plane") {
    if (axis === "pitch") return "NAV_CONTROLLER_OUTPUT.nav_pitch";
    if (axis === "yaw") return "ATTITUDE.yaw";
    return "NAV_CONTROLLER_OUTPUT.nav_roll";
  }
  if (axis === "pitch") return "ATTITUDE_TARGET.pitch";
  if (axis === "yaw") return "ATTITUDE_TARGET.yaw";
  return "ATTITUDE_TARGET.roll";
}

function paneAngle(frame: Frame, axis: Axis, hint: string): Pane {
  const k = keys(axis);
  if (axis === "d") {
    return {
      title: "want · height, m",
      hint,
      unit: "m",
      traces: [
        { key: k.tar, role: "target", label: tarLabel(frame, axis) },
        { key: k.ang, role: "actual", label: attLabel(frame, axis) },
      ],
      gap: [k.tar, k.ang],
      spanMin: 1,
    };
  }
  return {
    title: "want · angle, °",
    hint,
    unit: "°",
    traces: [
      { key: k.cmd, role: "stick", label: "RC" },
      { key: k.tar, role: "target", label: tarLabel(frame, axis) },
      { key: k.ang, role: "actual", label: attLabel(frame, axis) },
    ],
    gap: [k.tar, k.ang],
    unwrap: axis === "yaw",
    spanMin: 5,
  };
}

function paneRate(frame: Frame, axis: Axis, hint: string): Pane {
  const k = keys(axis);
  if (axis === "d") {
    return {
      title: "command · climb, m/s",
      hint,
      unit: "m/s",
      traces: [
        { key: k.des, role: "target", label: "climb demand" },
        { key: k.rate, role: "actual", label: "GLOBAL_POSITION_INT.vz" },
      ],
      gap: [k.des, k.rate],
      spanMin: 0.5,
    };
  }
  return {
    title: "command · rate, °/s",
    hint,
    unit: "°/s",
    traces: [
      { key: k.des, role: "target", label: "PID_TUNING.desired" },
      { key: k.rate, role: "actual", label: "PID_TUNING.achieved" },
    ],
    gap: [k.des, k.rate],
    spanMin: 12,
    hud: frame === "plane" ? ["aspd"] : undefined,
  };
}

function paneClimb(hint: string): Pane {
  return paneRate("copter", "d", hint);
}

function paneHeight(hint: string): Pane {
  return paneAngle("copter", "d", hint);
}

function paneLean(hint: string): Pane {
  return {
    title: "lean · roll / pitch, °",
    hint,
    unit: "°",
    traces: [
      { key: "roll", role: "actual", label: "ATTITUDE.roll" },
      { key: "pitch", role: "desired", label: "ATTITUDE.pitch" },
    ],
    spanMin: 5,
  };
}

function paneThrottle(hint: string): Pane {
  return {
    title: "throttle, %",
    hint,
    unit: "%",
    traces: [
      { key: "thr_cmd", role: "stick", label: "RC throttle" },
      { key: "thr_out", role: "actual", label: "VFR_HUD.throttle" },
    ],
    spanMin: 10,
  };
}

function paneHeading(hint: string): Pane {
  return {
    title: "heading, °",
    hint,
    unit: "°",
    traces: [
      { key: "hdg", role: "target", label: "VFR_HUD.heading" },
      { key: "yaw", role: "actual", label: "ATTITUDE.yaw" },
    ],
    unwrap: true,
    spanMin: 5,
  };
}

function paneYawRate(hint: string): Pane {
  return {
    title: "yaw rate, °/s",
    hint,
    unit: "°/s",
    traces: [{ key: "yaw_rate", role: "actual", label: "ATTITUDE.yawspeed" }],
    spanMin: 12,
  };
}

function overview(frame: Frame, axis: Axis): Pane[] {
  if (axis === "d") return [paneHeight("Yellow is the altitude target, cyan is AGL (−D)."), paneClimb("Amber is the climb command, cyan is climb. Up is +.")];
  if (frame === "plane") {
    return [
      paneAngle(frame, axis, "FBWA stick is an angle. Actual should catch the demand. Airspeed is the plant, not this plot."),
      paneRate(frame, axis, "FF should make these overlap in FBWA."),
    ];
  }
  return [
    paneAngle(frame, axis, "Where we want to be. Target is not the stick — actual should catch the target."),
    paneRate(frame, axis, "How we get there. Rate command is not position — it is “rotate this fast”."),
  ];
}

export function panesOf(frame: Frame, sel: string | null, axis: Axis): Pane[] {
  const a = axis === "d" && frame === "plane" ? "roll" : axis;
  if (!sel) return overview(frame, a);
  const panes = frame === "copter" ? copterPanes(sel, a) : planePanes(sel, a);
  return panes.length ? panes : overview(frame, a);
}

/** Stack panes for several cards. Identical MAVLink traces collapse; names join. */
export function panesForIds(frame: Frame, ids: string[], axis: Axis): Pane[] {
  const a = axis === "d" && frame === "plane" ? "roll" : axis;
  if (!ids.length) return overview(frame, a);
  const seen = new Map<string, Pane>();
  const out: Pane[] = [];
  for (const id of ids) {
    const panes = frame === "copter" ? copterPanes(id, a) : planePanes(id, a);
    for (const pane of panes) {
      const sig = pane.traces.map((tr) => tr.key).join(",") + "|" + pane.unit;
      const hit = seen.get(sig);
      if (hit) {
        if (!hit.fromIds) hit.fromIds = [];
        if (!hit.fromIds.includes(id)) hit.fromIds.push(id);
        continue;
      }
      const tagged = { ...pane, fromIds: [id] };
      seen.set(sig, tagged);
      out.push(tagged);
    }
  }
  return out.length ? out : overview(frame, a);
}

function copterPanes(sel: string, axis: Axis): Pane[] {
  switch (sel) {
    case "pilot":
      return axis === "d"
        ? [
            paneThrottle("Throttle stick is climb. Mid stick is 0 on the plot."),
            paneClimb("Amber on the lower plot should meet cyan."),
          ]
        : [paneAngle("copter", axis, "The stick request. Stabilize wants an angle. Actual should catch the demand.")];
    case "nav":
      return [
        {
          title: "path · speed / height",
          hint: "N/E position is not on this MAVLink sample. Groundspeed and AGL are what we have.",
          unit: "m/s · m",
          traces: [
            { key: "gspd", role: "target", label: "VFR_HUD.groundspeed" },
            { key: "alt", role: "actual", label: "GLOBAL_POSITION_INT.relative_alt" },
          ],
          spanMin: 2,
          hud: ["gspd"],
        },
      ];
    case "psc_ne_pos":
    case "psc_ne_vel":
    case "lean":
      return [
        paneLean(
          sel === "lean"
            ? "NE accel becomes this bank. ATC_ANGLE_MAX is the ceiling — not Loiter speed."
            : "N/E is not on this MAVLink sample. Lean (roll/pitch) is the downstream output.",
        ),
      ];
    case "psc_d_pos":
      return [paneHeight("Holds height: AGL error (−D) → desired climb. Yellow is the target.")];
    case "psc_d_vel":
      return [paneClimb("Turns the climb command into vertical acceleration. Cyan should catch amber.")];
    case "psc_d_acc":
      return [
        paneClimb(
          "Vertical accel demand is not on this MAVLink sample. Climb is the plant we can see. Do not chase bounce on this P.",
        ),
      ];
    case "atc_ang":
      return [
        paneAngle(
          "copter",
          axis === "d" ? "roll" : axis,
          "ATT.Des vs ATT. Do not crank ANG P to hide a weak rate tune.",
        ),
      ];
    case "atc_rat":
      return [
        paneRate(
          "copter",
          axis === "d" ? "roll" : axis,
          "RATE desired vs achieved. Tune in Stabilize. Oscillation → lower P/D, not more I.",
        ),
      ];
    case "motors":
      return [paneThrottle("Hover should sit near mid stick. That is MOT_THST_HOVER, not a PID.")];
    default:
      return [];
  }
}

function planePanes(sel: string, axis: Axis): Pane[] {
  switch (sel) {
    case "pilot":
      return [
        paneAngle("plane", axis === "yaw" ? "roll" : axis, "In FBWA the stick asks for roll and pitch angle. Actual should catch the demand."),
      ];
    case "nav":
      return [paneHeight("AUTO / LOITER / RTL write a ground track and an altitude to hold.")];
    case "navl1":
      return [
        paneAngle(
          "plane",
          "roll",
          "L1 asks for a bank. Watch demanded roll vs ATTITUDE.roll in a turn. Tune Rate in FBWA first.",
        ),
      ];
    case "tecs": {
      const h = paneHeight("Height hold in loiter / RTL. If it porpoises, pitch rate first — not a height P.");
      return [
        h,
        paneAngle("plane", "pitch", "TECS pitch demand is nav_pitch. Wiki: check nav_pitch if height oscillates."),
        {
          title: "airspeed · throttle",
          hint: "TECS airspeed setpoint is not on this MAVLink sample. Airspeed and throttle are the plants we can see.",
          unit: "m/s · %",
          traces: [
            { key: "aspd", role: "actual", label: "VFR_HUD.airspeed" },
            { key: "thr_out", role: "target", label: "VFR_HUD.throttle" },
          ],
          spanMin: 8,
          hud: ["aspd"],
        },
      ];
    }
    case "rll_ang":
      return [paneAngle("plane", "roll", "FBWA stick is an angle. Actual should catch nav_roll. Airspeed is the plant, not this plot.")];
    case "ptch_ang":
      return [paneAngle("plane", "pitch", "FBWA stick is an angle. Actual should catch nav_pitch. Porpoise is usually PTCH_RATE.")];
    case "rll_rate":
    case "aileron":
      return [paneRate("plane", "roll", "FF until amber and cyan match in FBWA, then I = FF, then P, then D.")];
    case "ptch_rate":
    case "elevator":
      return [paneRate("plane", "pitch", "Same FF-first order as roll. Do not copy roll numbers onto pitch.")];
    case "yaw_damp":
    case "rudder":
      return [
        paneYawRate("Wag the tail = too much DAMP. Lateral accel ay is not on this MAVLink sample."),
        paneAngle("plane", "roll", "YAW2SRV_RLL reads this measured bank, not RLL_RATE."),
      ];
    case "ahrs":
      return [
        {
          title: "AHRS · roll / pitch, °",
          hint: "Measured attitude. The yaw damper reads sin(this bank).",
          unit: "°",
          traces: [
            { key: "roll", role: "actual", label: "ATTITUDE.roll" },
            { key: "pitch", role: "desired", label: "ATTITUDE.pitch" },
          ],
          spanMin: 5,
        },
      ];
    case "steer":
    case "nose":
      return [paneHeading("Runway tracking, not flight yaw. Idle above GROUND_STEER_ALT and in MANUAL.")];
    case "throttle":
      return [paneThrottle("TECS writes this in AUTO / FBWB. In FBWA the left stick is still throttle.")];
    default:
      return [];
  }
}
