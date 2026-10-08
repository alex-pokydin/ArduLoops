import { useEffect, useRef, useState, type ReactNode } from "react";
import { NODES as COPTER_NODES } from "../cascade";
import { tDetail, useT } from "../i18n/i18n";
import { addLog } from "../log";
import { axisView, type Axis } from "../mav/axis";
import { noteUi, send } from "../mav/cmd";
import { paramOf } from "./GainRow";
import { isSitl } from "../mav/sim";
import { getLatest } from "../mav/store";
import { frameLive, usePicked, viewBuffer } from "../mav/view";
import type { Sample } from "../mav/types";
import type { NodeDef } from "../lib/gains";
import { GainRow } from "./GainRow";
import { Craft, camStickAxis, type CraftImu } from "./Craft";

type Feel = { kind: string; title: string; hint: string; axis?: Axis };

const PRESET = {
  wool: { p: 0.027, i: 0.015, d: 0.0036 },
  stock: { p: 0.135, i: 0.135, d: 0.0036, tc: 0.1, acc: 1100, rmax: 0 },
  hot: { p: 0.675, i: 0.135, d: 0.0036 },
};

const COPTER_MODES = ["STABILIZE", "ALT_HOLD", "LOITER", "POSHOLD", "ACRO", "LAND", "RTL"];

export type LogRow = { t: string; msg: string; kind: string };

const STATUS_KIND: Record<string, "ok" | "bad" | "dim"> = {
  EMERGENCY: "bad",
  ALERT: "bad",
  CRITICAL: "bad",
  ERROR: "bad",
  WARNING: "bad",
  NOTICE: "ok",
  INFO: "dim",
  DEBUG: "dim",
};

/** `texts` is newest-first. Return newly prepended rows, oldest first. */
function freshStatus(curr: string[], prev: string[]): string[] {
  if (!curr.length) return [];
  if (!prev.length) {
    const seen = new Set<string>();
    const uniq: string[] = [];
    for (const raw of curr.slice().reverse()) {
      if (seen.has(raw)) continue;
      seen.add(raw);
      uniq.push(raw);
    }
    return uniq;
  }
  for (let i = 0; i <= curr.length; i++) {
    const rest = curr.slice(i);
    if (rest.length <= prev.length && rest.every((v, j) => v === prev[j])) {
      return curr.slice(0, i).reverse();
    }
  }
  return curr.slice().reverse();
}

function logStatus(raw: string): void {
  const sp = raw.indexOf(" ");
  const sev = sp > 0 ? raw.slice(0, sp) : "";
  const kind = STATUS_KIND[sev];
  addLog(kind ? raw.slice(sp + 1) : raw, kind || "dim");
}

function stdev(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

function pwmFromNorm(n: number): number {
  return Math.round(1500 + Math.max(-1, Math.min(1, n)) * 500);
}

type LinkSnap = {
  ok: boolean;
  detail: string;
  mode: string;
  armed: boolean;
  att: boolean;
  attHz: number;
  frame: string;
  grounded: boolean;
  texts: string[];
  gainP: number | null;
};

function linkSnap(s: Sample): LinkSnap {
  return {
    ok: s.ok,
    detail: s.detail || "",
    mode: s.mode,
    armed: !!s.armed,
    att: s.att_hz > 0,
    attHz: s.att_hz,
    frame: s.frame,
    grounded: s.alt != null && !Number.isNaN(s.alt) && s.alt < 2,
    texts: s.texts || [],
    gainP: s.gain_p,
  };
}

function sameLink(a: LinkSnap, b: LinkSnap): boolean {
  if (
    a.ok !== b.ok ||
    a.detail !== b.detail ||
    a.mode !== b.mode ||
    a.armed !== b.armed ||
    a.att !== b.att ||
    a.frame !== b.frame ||
    a.grounded !== b.grounded ||
    a.gainP !== b.gainP ||
    a.texts.length !== b.texts.length
  ) {
    return false;
  }
  for (let i = 0; i < a.texts.length; i++) if (a.texts[i] !== b.texts[i]) return false;
  return true;
}

function sameFeel(a: Feel, b: Feel): boolean {
  return a.kind === b.kind && a.title === b.title && a.hint === b.hint && a.axis === b.axis;
}

function nextFeel(s: Sample, ax: Axis, vehicle: "copter" | "plane"): Feel {
  if (!s.ok) {
    return {
      kind: "idle",
      title: "Idle",
      hint:
        vehicle === "plane"
          ? "No plane on this link. Grey until HEARTBEAT says plane."
          : "No copter on this link. Grey until HEARTBEAT says copter.",
    };
  }
  const plane = vehicle === "plane" || s.frame === "plane";
  if (plane) {
    if (s.alt != null && !Number.isNaN(s.alt) && s.alt < 2) {
      return {
        kind: "gnd",
        title: "On the ground",
        hint: "On the runway. MANUAL is the stick on the surface.",
      };
    }
    return {
      kind: "ok",
      title: "Tune in FBWA",
      axis: ax,
      hint: "FBWA. Stick is an angle — FF, scaled by airspeed, moves the servo.",
    };
  }
  if (s.alt != null && !Number.isNaN(s.alt) && s.alt < 2) {
    return {
      kind: "gnd",
      title: "On the ground",
      hint: "The craft is sitting. Raise throttle — otherwise the stick will not move it.",
    };
  }
  const last = viewBuffer(vehicle).slice(-80);
  const angs = last.map((p) => axisView(p, ax).ang || 0);
  const rates = last.map((p) => axisView(p, ax).rate || 0);
  const cmds = last.map((p) => axisView(p, ax).cmd || 0);
  const meanAbs = angs.length ? angs.reduce((a, b) => a + Math.abs(b), 0) / angs.length : 0;
  let zc = 0;
  for (let n = 1; n < rates.length; n++) if (rates[n - 1] * rates[n] < 0) zc++;
  const zcHz = zc / ((last.length > 1 ? last[last.length - 1].t - last[0].t : 1) || 1);
  const rstd = rates.length ? stdev(rates) : 0;
  const yawP = Number(s.params?.ATC_RAT_YAW_P ?? NaN);
  const g = ax === "yaw" ? yawP : ax === "d" ? Number(s.params?.PSC_D_POS_P ?? NaN) : Number(s.gain_p ?? NaN);
  if (ax === "d") {
    const climb = Math.abs(s.climb || 0);
    const thr = Math.abs(s.thr_cmd || 0);
    if (climb > 0.2 || thr > 12) {
      return {
        kind: "ok",
        title: "Climb",
        axis: ax,
        hint: "Throttle stick is climb. Amber on the lower plot should meet cyan.",
      };
    }
    return {
      kind: "ok",
      title: "Holding",
      axis: ax,
      hint: "D+ is down. Height is AGL (−D). Left stick up/down is throttle.",
    };
  }
  const moving =
    ax === "yaw"
      ? Math.max(...rates.map(Math.abs), ...cmds.map(Math.abs), 0) > 8
      : meanAbs > 4 || Math.max(...cmds.map(Math.abs), 0) > 2;
  const ringing = rstd > 8 || (zcHz > 4 && rstd > 1.5);
  if (!Number.isNaN(g) && g < 0.1) {
    return {
      kind: "wool",
      title: "Wool",
      axis: ax,
      hint: moving
        ? "Act lags Tar. P and I are small: there is error, little rate."
        : ax === "yaw"
          ? "Yaw P is small. Left stick — a slow turn."
          : "P×0.2 and I are cut. Quiet in hover; {stick} stick — slow return (wool).",
    };
  }
  if (!Number.isNaN(g) && g >= 0.4) {
    return {
      kind: "hot",
      title: ringing ? "Harsh / ringing" : "Sharp",
      axis: ax,
      hint: ringing || moving
        ? "Act chases Tar. P is large — expect overshoot or ringing."
        : "P is high. {Stick} stick will show overshoot or ringing.",
    };
  }
  if (moving) {
    return {
      kind: "ok",
      title: "Maneuver",
      hint:
        ax === "yaw"
          ? "Yaw stick is rate. Watch whether amber and cyan match on the lower plot."
          : "Watch whether cyan meets yellow after you release the stick.",
    };
  }
  return {
    kind: "ok",
    title: Number.isNaN(g) ? "—" : "Stock",
    axis: ax,
    hint:
      ax === "yaw"
        ? "Yaw is separate: I is smaller, D is often 0. Left stick is the reference — does rate catch the command."
        : "Typical P. {Stick} stick is the horizon-return reference.",
  };
}

function SignalLog({
  vehicle,
  holdUntil,
  shownGain,
}: {
  vehicle: "copter" | "plane";
  holdUntil: { current: number };
  shownGain: { current: string };
}) {
  const t = useT();
  const snap = usePicked(linkSnap, sameLink);
  const prev = useRef({
    mode: null as string | null,
    armed: null as boolean | null,
    ok: null as boolean | null,
    att: null as boolean | null,
    grounded: null as boolean | null,
    texts: [] as string[],
  });

  useEffect(() => {
    const texts = snap.texts;
    if (!snap.ok) {
      prev.current.texts = texts.slice();
      if (prev.current.ok) {
        addLog(t("No link · {detail}", { detail: tDetail(snap.detail) }), "bad");
        prev.current.ok = false;
      }
      return;
    }
    if (snap.gainP != null && Date.now() >= holdUntil.current) {
      const g = snap.gainP.toFixed(3);
      if (g !== shownGain.current) {
        if (shownGain.current) addLog("P " + shownGain.current + " → " + g);
        shownGain.current = g;
      }
    }
    if (prev.current.ok !== snap.ok) {
      addLog(
        snap.ok ? t("Link {url}", { url: snap.detail }) : t("No link · {detail}", { detail: tDetail(snap.detail) }),
        snap.ok ? "ok" : "bad",
      );
      prev.current.ok = snap.ok;
    }
    if (snap.mode && snap.mode !== prev.current.mode) {
      addLog(t("Mode {mode}", { mode: (prev.current.mode ? prev.current.mode + " → " : "") + snap.mode }));
      prev.current.mode = snap.mode;
    }
    if (prev.current.armed !== null && prev.current.armed !== snap.armed) {
      addLog(snap.armed ? "armed" : "disarm", snap.armed ? "ok" : "dim");
    }
    prev.current.armed = snap.armed;
    if (prev.current.att !== null && prev.current.att !== snap.att) {
      addLog(snap.att ? "ATT " + snap.attHz + " Hz" : "ATT 0 Hz", snap.att ? "ok" : "bad");
    }
    prev.current.att = snap.att;
    if (prev.current.grounded !== null && prev.current.grounded !== snap.grounded) {
      addLog(
        snap.grounded
          ? vehicle === "plane" || snap.frame === "plane"
            ? t("On the runway. MANUAL is the stick on the surface.")
            : t("On the ground · AGL < 2 m, sticks barely rotate the craft")
          : t("Airborne"),
        snap.grounded ? "bad" : "ok",
      );
    }
    prev.current.grounded = snap.grounded;
    for (const raw of freshStatus(texts, prev.current.texts)) logStatus(raw);
    prev.current.texts = texts.slice();
  }, [snap, vehicle, t, holdUntil, shownGain]);

  return null;
}

function finite(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function imuOf(s: Sample): CraftImu {
  const nums = s.live_nums;
  const x = finite(nums?.["VIBRATION.vibration_x"]);
  const y = finite(nums?.["VIBRATION.vibration_y"]);
  const z = finite(nums?.["VIBRATION.vibration_z"]);
  const axes = [x, y, z].filter((value): value is number => value != null);
  const c0 = finite(nums?.["VIBRATION.clipping_0"]);
  const c1 = finite(nums?.["VIBRATION.clipping_1"]);
  const c2 = finite(nums?.["VIBRATION.clipping_2"]);
  const clips = [c0, c1, c2].filter((value): value is number => value != null);
  return {
    vibe: axes.length ? Math.max(...axes.map((value) => Math.abs(value))) : null,
    clip: clips.length ? clips.reduce((sum, value) => sum + value, 0) : null,
    x, y, z, c0, c1, c2,
  };
}

function sameImu(a: CraftImu, b: CraftImu): boolean {
  const near = (left: number | null, right: number | null) =>
    (left == null ? null : Math.round(left * 10)) === (right == null ? null : Math.round(right * 10));
  return near(a.vibe, b.vibe) && near(a.x, b.x) && near(a.y, b.y) && near(a.z, b.z)
    && a.clip === b.clip && a.c0 === b.c0 && a.c1 === b.c1 && a.c2 === b.c2;
}

function batteryOf(s: Sample): { volts: number | null; pct: number | null } {
  const mv = s.live_nums?.["SYS_STATUS.voltage_battery"];
  const pctRaw = s.live_nums?.["SYS_STATUS.battery_remaining"];
  const volts = typeof mv === "number" && mv >= 1000 && mv < 65535 ? Math.round(mv / 10) / 100 : null;
  const pct = typeof pctRaw === "number" && pctRaw >= 0 && pctRaw <= 100 ? Math.round(pctRaw) : null;
  return { volts, pct };
}

function CraftLive({
  axis,
  vehicle,
  onCam,
}: {
  axis: Axis;
  vehicle: "copter" | "plane";
  onCam?: (cam: "rear" | "side" | "top") => void;
}) {
  const t = useT();
  const pose = usePicked(
    (s) => ({
      roll: s.roll || 0,
      pitch: s.pitch || 0,
      yaw: s.yaw || 0,
      tarRoll: s.tar == null ? s.cmd || 0 : s.tar,
      tarPitch: s.pitch_tar == null ? s.pitch_cmd || 0 : s.pitch_tar,
      tarYaw: s.yaw_tar == null ? s.yaw || 0 : s.yaw_tar,
      grounded: s.alt != null && !Number.isNaN(s.alt) && s.alt < 2,
      alt: s.alt ?? null,
      climb: s.climb || 0,
      status: s.texts?.[0] ?? "",
      alive: s.ok,
      battery: batteryOf(s),
      imu: imuOf(s),
    }),
    (a, b) =>
      a.roll === b.roll &&
      a.pitch === b.pitch &&
      a.yaw === b.yaw &&
      a.tarRoll === b.tarRoll &&
      a.tarPitch === b.tarPitch &&
      a.tarYaw === b.tarYaw &&
      a.grounded === b.grounded &&
      a.alt === b.alt &&
      a.climb === b.climb &&
      a.status === b.status &&
      a.alive === b.alive &&
      a.battery.volts === b.battery.volts &&
      a.battery.pct === b.battery.pct &&
      sameImu(a.imu, b.imu),
  );
  let altLabel: ReactNode = t("AGL height");
  let altClass = "";
  if (pose.grounded) {
    altLabel = pose.climb > 0.15 ? t("takeoff ↑ {v} m/s", { v: pose.climb.toFixed(1) }) : t("Sitting");
    altClass = "gnd";
  } else if (pose.alt != null && !Number.isNaN(pose.alt)) {
    if (pose.climb > 0.15) {
      altLabel = t("↑ {v} m/s", { v: pose.climb.toFixed(1) });
      altClass = "up";
    } else if (pose.climb < -0.15) {
      altLabel = t("↓ {v} m/s", { v: Math.abs(pose.climb).toFixed(1) });
      altClass = "dn";
    } else altLabel = t("Holding");
  }
  return (
    <Craft
      roll={pose.roll}
      pitch={pose.pitch}
      yaw={pose.yaw}
      tarRoll={pose.tarRoll}
      tarPitch={pose.tarPitch}
      tarYaw={pose.tarYaw}
      grounded={pose.grounded}
      alt={pose.alt}
      altLabel={altLabel}
      altClass={altClass}
      axis={axis}
      status={pose.status}
      battery={pose.battery}
      imu={pose.imu}
      vehicle={vehicle}
      alive={pose.alive}
      onCam={onCam}
    />
  );
}

function FlightBar({
  modes,
  vehicle,
  onDisarm,
}: {
  modes: string[];
  vehicle: "copter" | "plane";
  onDisarm: () => void;
}) {
  const t = useT();
  const face = usePicked(
    (s) => ({ ok: s.ok, mode: s.mode, armed: !!s.armed }),
    (a, b) => a.ok === b.ok && a.mode === b.mode && a.armed === b.armed,
  );
  const modeOptions = modes.includes(face.mode) || face.mode === "?" ? modes : [...modes, face.mode];
  return (
    <div className="flight">
      <select
        title={t("Flight mode")}
        aria-label={t("Mode")}
        disabled={!face.ok}
        value={modeOptions.includes(face.mode) ? face.mode : modes[0] ?? face.mode}
        onChange={(ev) => {
          const before = getLatest();
          if (!frameLive(vehicle, before)) return;
          send({ op: "mode", mode: ev.target.value });
          noteUi([{ kind: "mode", from: before.mode, mode: ev.target.value }]);
          addLog(t("Mode {mode}", { mode: ev.target.value }), "cmd");
        }}
      >
        {modeOptions.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <button
        type="button"
        className={face.armed ? "arm-sw on" : "arm-sw"}
        aria-pressed={face.armed}
        disabled={!face.ok}
        title={t("Arm / force disarm")}
        onClick={() => {
          if (!frameLive(vehicle, getLatest())) return;
          if (face.armed) {
            send({ op: "arm", on: false });
            send({ op: "release" });
            noteUi([{ kind: "arm", on: false }]);
            onDisarm();
            addLog("disarm", "cmd");
            return;
          }
          send({ op: "arm", on: true });
          noteUi([{ kind: "arm", on: true }]);
          addLog(t("arm · {mode}", { mode: face.mode }), "cmd");
        }}
      >
        {face.armed ? "armed" : "disarm"}
      </button>
    </div>
  );
}

function FeelLive({
  axis,
  vehicle,
  stickName,
}: {
  axis: Axis;
  vehicle: "copter" | "plane";
  stickName: string;
}) {
  const t = useT();
  const feel = usePicked((s) => nextFeel(s, axis, vehicle), sameFeel);
  const StickName = stickName.charAt(0).toUpperCase() + stickName.slice(1);
  return (
    <>
      <div className={`feel ${feel.kind}`}>{feel.title === "—" ? "—" : t(feel.title)}</div>
      <div className="hint">{t(feel.hint, { stick: stickName, Stick: StickName })}</div>
    </>
  );
}

export function FoldSection({
  label,
  extra,
  scroll,
  children,
}: {
  label: string;
  extra?: string;
  scroll?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={open ? "controls-toggle on aside-fold" : "controls-toggle aside-fold"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {extra ? <span>{extra}</span> : null}
      </button>
      <div className={scroll ? "fold-body fold-scroll" : "fold-body"} hidden={!open}>{children}</div>
    </>
  );
}

function PresetBar({ alive, onPick }: { alive: boolean; onPick: (name: "wool" | "stock" | "hot") => void }) {
  const t = useT();
  const gainP = usePicked((s) => s.gain_p);
  const [held, setHeld] = useState<number | null>(null);
  const p = held ?? gainP ?? 0.135;
  function click(name: "wool" | "stock" | "hot") {
    setHeld(PRESET[name].p);
    window.setTimeout(() => setHeld(null), 1500);
    onPick(name);
  }
  return (
    <div className="btns">
      <button disabled={!alive} className={p < 0.1 ? "cyan on" : "cyan"} onClick={() => click("wool")}>{t("Wool")}</button>
      <button disabled={!alive} className={p >= 0.1 && p < 0.4 ? "on" : ""} onClick={() => click("stock")}>{t("Stock")}</button>
      <button disabled={!alive} className={p >= 0.4 ? "hot on" : "hot"} onClick={() => click("hot")}>{t("Sharp")}</button>
    </div>
  );
}

export function Aside({
  log,
  sel,
  onSel,
  axis,
  modes = COPTER_MODES,
  nodes = COPTER_NODES,
  presets = true,
  vehicle = "copter",
  knobs = true,
  inspect,
}: {
  log: LogRow[];
  sel: string | null;
  onSel: (id: string) => void;
  axis: Axis;
  modes?: string[];
  nodes?: NodeDef[];
  presets?: boolean;
  vehicle?: "copter" | "plane";
  knobs?: boolean;
  inspect?: ReactNode;
}) {
  const t = useT();
  const alive = usePicked((s) => s.ok);
  const [planeCam, setPlaneCam] = useState<"rear" | "side" | "top">("rear");
  const holdUntil = useRef(0);
  const stickTimer = useRef(0);
  const rc = useRef({ roll: 1500, pitch: 1500, yaw: 1500, thr: 0 });
  const leftN = useRef({ x: 0, y: 0 });
  const rightN = useRef({ x: 0, y: 0 });
  const stickL = useRef<HTMLDivElement>(null);
  const stickR = useRef<HTMLDivElement>(null);
  const knobL = useRef<HTMLDivElement>(null);
  const knobR = useRef<HTMLDivElement>(null);
  const logEl = useRef<HTMLDivElement>(null);
  const shownGain = useRef("");

  useEffect(() => {
    const el = logEl.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);


  function setKnob(el: HTMLDivElement | null, nx: number, ny: number) {
    if (!el) return;
    el.style.left = 50 + nx * 38 + "%";
    el.style.top = 50 - ny * 38 + "%";
  }

  function pushStick(immediate: boolean) {
    if (!frameLive(vehicle, getLatest())) return;
    const fire = () => send({ op: "stick", ...rc.current });
    if (immediate) {
      window.clearTimeout(stickTimer.current);
      stickTimer.current = 0;
      fire();
      return;
    }
    if (stickTimer.current) return;
    stickTimer.current = window.setTimeout(() => {
      stickTimer.current = 0;
      fire();
    }, 40);
  }

  function resetSticks() {
    rc.current = { roll: 1500, pitch: 1500, yaw: 1500, thr: 0 };
    leftN.current = { x: 0, y: 0 };
    rightN.current = { x: 0, y: 0 };
    setKnob(knobL.current, 0, 0);
    setKnob(knobR.current, 0, 0);
  }

  useEffect(() => {
    function bind(
      el: HTMLDivElement | null,
      onMove: (nx: number, ny: number) => void,
      onEnd: () => void,
    ) {
      if (!el) return () => {};
      let down = false;
      const read = (ev: PointerEvent) => {
        const r = el.getBoundingClientRect();
        let nx = (ev.clientX - (r.left + r.width / 2)) / (r.width * 0.42);
        let ny = (r.top + r.height / 2 - ev.clientY) / (r.height * 0.42);
        const mag = Math.hypot(nx, ny);
        if (mag > 1) {
          nx /= mag;
          ny /= mag;
        }
        if (Math.abs(nx) < 0.08) nx = 0;
        if (Math.abs(ny) < 0.08) ny = 0;
        return [nx, ny] as const;
      };
      const downH = (ev: PointerEvent) => {
        ev.preventDefault();
        down = true;
        el.setPointerCapture(ev.pointerId);
        const [nx, ny] = read(ev);
        onMove(nx, ny);
      };
      const moveH = (ev: PointerEvent) => {
        if (!down) return;
        const [nx, ny] = read(ev);
        onMove(nx, ny);
      };
      const endH = () => {
        if (!down) return;
        down = false;
        onEnd();
      };
      el.addEventListener("pointerdown", downH);
      el.addEventListener("pointermove", moveH);
      el.addEventListener("pointerup", endH);
      el.addEventListener("pointercancel", endH);
      return () => {
        el.removeEventListener("pointerdown", downH);
        el.removeEventListener("pointermove", moveH);
        el.removeEventListener("pointerup", endH);
        el.removeEventListener("pointercancel", endH);
      };
    }
    const u1 = bind(stickL.current, (nx, ny) => {
      leftN.current = { x: nx, y: ny };
      rc.current.yaw = pwmFromNorm(nx);
      rc.current.thr = pwmFromNorm(ny);
      setKnob(knobL.current, nx, ny);
      pushStick(false);
    }, () => {
      leftN.current.x = 0;
      rc.current.yaw = 1500;
      setKnob(knobL.current, 0, leftN.current.y);
      pushStick(true);
    });
    const u2 = bind(stickR.current, (nx, ny) => {
      rightN.current = { x: nx, y: ny };
      rc.current.roll = pwmFromNorm(nx);
      rc.current.pitch = pwmFromNorm(-ny);
      setKnob(knobR.current, nx, ny);
      pushStick(false);
    }, () => {
      rightN.current = { x: 0, y: 0 };
      rc.current.roll = 1500;
      rc.current.pitch = 1500;
      setKnob(knobR.current, 0, 0);
      pushStick(true);
    });
    return () => {
      u1();
      u2();
    };
  }, [vehicle]);

  function applyPreset(name: "wool" | "stock" | "hot") {
    const before = getLatest();
    if (!frameLive(vehicle, before) || !(isSitl(before.params) || before.sitl_running)) return;
    const pset = PRESET[name];
    const ang = name === "wool" ? 2 : 4.5;
    const written: { name: string; value: number }[] = [];
    for (const axis of ["RLL", "PIT"]) {
      written.push({ name: `ATC_RAT_${axis}_P`, value: pset.p });
      written.push({ name: `ATC_RAT_${axis}_I`, value: pset.i });
      written.push({ name: `ATC_RAT_${axis}_D`, value: pset.d });
      written.push({ name: `ATC_ANG_${axis}_P`, value: ang });
    }
    if ("tc" in pset && pset.tc != null) {
      written.push({ name: "ATC_INPUT_TC", value: pset.tc });
      written.push({ name: "ATC_ACC_R_MAX", value: pset.acc });
      written.push({ name: "ATC_ACC_P_MAX", value: pset.acc });
      written.push({ name: "ATC_RATE_R_MAX", value: pset.rmax });
      written.push({ name: "ATC_RATE_P_MAX", value: pset.rmax });
    }
    holdUntil.current = Date.now() + 1500;
    send({ op: "preset", name });
    noteUi(written.map((row) => ({ kind: "param", name: row.name, value: row.value, from: paramOf(before, row.name) })));
    shownGain.current = pset.p.toFixed(3);
    if ("tc" in pset && pset.tc != null) {
      addLog(
        t("Stock · P {p} I {i} D {d} · TC {tc} ACC {acc} Rmax {rmax}", {
          p: pset.p,
          i: pset.i,
          d: pset.d,
          tc: pset.tc.toFixed(2),
          acc: Math.round(pset.acc),
          rmax: pset.rmax <= 0 ? t("off") : Math.round(pset.rmax),
        }),
        "cmd",
      );
    } else if (name === "wool") {
      addLog(t("Wool · P {p} I {i} D {d}", { p: pset.p, i: pset.i, d: pset.d }), "cmd");
    } else {
      addLog(t("Sharp · P {p} I {i} D {d}", { p: pset.p, i: pset.i, d: pset.d }), "cmd");
    }
    onSel("atc_rat");
  }

  const tuneNode = nodes.find((n) => n.id === sel) ?? nodes.find((n) => n.guide) ?? nodes[0] ?? null;
  const stickAxis = vehicle === "plane" ? camStickAxis(planeCam) : axis;
  const [controlsOpen, setControlsOpen] = useState(false);
  const sitl = usePicked((s) => isSitl(s.params) || !!s.sitl_running);

  return (
    <aside className={alive ? undefined : "idle"}>
      <SignalLog vehicle={vehicle} holdUntil={holdUntil} shownGain={shownGain} />
      <CraftLive axis={axis} vehicle={vehicle} onCam={vehicle === "plane" ? setPlaneCam : undefined} />
      <button
        type="button"
        className={controlsOpen ? "controls-toggle on" : "controls-toggle"}
        aria-expanded={controlsOpen}
        onClick={() => setControlsOpen((open) => !open)}
      >
        {t("Controls")}
      </button>
      <div className="controls" hidden={!controlsOpen}>
      <FlightBar modes={modes} vehicle={vehicle} onDisarm={resetSticks} />
      <div className={`sticks axis-${stickAxis}`} aria-label={t("Virtual Mode 2 sticks")}>
        <div className="stick thr" ref={stickL} role="button" tabIndex={0} title={stickAxis === "d" ? t("Left stick: throttle (up-down)") : stickAxis === "yaw" ? t("Left stick: yaw (left-right)") : t("Left stick: throttle and yaw")}>
          <div className="cross" />
          <span className="tag n">{t("Thr")}</span>
          <span className="tag s">{t("Thr−")}</span>
          <span className="tag w">{t("Yaw−")}</span>
          <span className="tag e">{t("Yaw+")}</span>
          <div className="knob" ref={knobL} />
        </div>
        <div className="stick" ref={stickR} role="button" tabIndex={0} title={stickAxis === "pitch" ? t("Right stick: pitch (up-down)") : t("Right stick: roll (left-right)")}>
          <div className="cross" />
          <span className="tag n">{t("pitch")}</span>
          <span className="tag s">{t("pitch")}</span>
          <span className="tag w">{t("Roll−")}</span>
          <span className="tag e">{t("Roll+")}</span>
          <div className="knob" ref={knobR} />
        </div>
      </div>
      </div>
      {sitl ? <FeelLive axis={axis} vehicle={vehicle} stickName={t(stickAxis)} /> : null}
      {sitl && presets ? <PresetBar alive={alive} onPick={applyPreset} /> : null}
      {knobs && tuneNode ? (
          <FoldSection label={t(tuneNode.title)} extra={t(tuneNode.unit)}>
            {tuneNode.gains.length ? (
              <div className="sliders">
                {tuneNode.gains.map((g) => (
                  <GainRow key={g.key} gain={g} node={tuneNode} axis={axis} />
                ))}
              </div>
            ) : (
              <p className="tune-empty">{t("No gains. Pick a regulator — sliders stay here and on the plot.")}</p>
            )}
          </FoldSection>
        ) : null}
      {inspect}
      <div className="log-label">{t("Log")}</div>
      <div className="log" ref={logEl}>
        {log.map((row, idx) => (
          <div className="row" key={idx}>
            <span className="t">{row.t}</span>
            <span className={row.kind}>{row.msg}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
