import { useState } from "react";
import { paramOf } from "../components/GainRow";
import { LoopLiveBox, LoopMixDot } from "../components/LoopPids";
import { namedGains, SchemeDoc, SchemeKey, SchemeKnobs, schemeHit } from "../components/SchemeKnobs";
import { useT } from "../i18n/i18n";
import { isPaused } from "../mav/store";
import { useViewSample } from "../mav/view";
import { NODES, nodesLiveIn } from "./cascade";
import type { Gain } from "../lib/gains";

const COL = {
  cyan: "#4fc3f7",
  amber: "#ffb74d",
  dim: "#8b98a8",
  line: "#3a4652",
};

const TECS = NODES.find((n) => n.id === "tecs")!;
const L1 = NODES.find((n) => n.id === "navl1")!;

const TECS_LIMITS = [
  { key: "THR_MAX", label: "THR+", min: 0, max: 100, step: 1, digits: 0 },
  { key: "TRIM_THROTTLE", label: "Trim", min: 0, max: 100, step: 1, digits: 0 },
  { key: "AIRSPEED_MIN", label: "Vmin", min: 5, max: 40, step: 0.5, digits: 1 },
  { key: "AIRSPEED_CRUISE", label: "V", min: 6, max: 50, step: 0.5, digits: 1 },
  { key: "AIRSPEED_MAX", label: "Vmax", min: 8, max: 80, step: 0.5, digits: 1 },
  { key: "PTCH_LIM_MAX_DEG", label: "θ+", min: 0, max: 40, step: 1, digits: 0 },
  { key: "PTCH_LIM_MIN_DEG", label: "θ−", min: -45, max: 0, step: 1, digits: 0 },
  { key: "TECS_CLMB_MAX", label: "Climb", min: 0.5, max: 20, step: 0.1, digits: 1 },
  { key: "TECS_SINK_MIN", label: "Sink−", min: 0.1, max: 10, step: 0.1, digits: 1 },
  { key: "TECS_SINK_MAX", label: "Sink+", min: 1, max: 20, step: 0.1, digits: 1 },
] as const;

const TECS_RESP = [
  { key: "TECS_TIME_CONST", label: "TC", min: 3, max: 10, step: 0.5, digits: 1 },
  { key: "TECS_PTCH_DAMP", label: "θd", min: 0, max: 1, step: 0.05, digits: 2 },
  { key: "TECS_THR_DAMP", label: "Td", min: 0, max: 1, step: 0.05, digits: 2 },
  { key: "TECS_INTEG_GAIN", label: "I", min: 0, max: 1, step: 0.05, digits: 2 },
  { key: "TECS_SPDWEIGHT", label: "W", min: 0, max: 2, step: 0.1, digits: 1 },
  { key: "TECS_RLL2THR", label: "R2T", min: 0, max: 30, step: 0.5, digits: 1 },
] as const;

function fmt(v: number | null | undefined, d: number): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(d);
}

const INV_PI = 0.3183099;

function kL1Of(damp: number | null | undefined): number | null {
  return damp == null || Number.isNaN(damp) ? null : 4 * damp * damp;
}

function l1DistOf(
  damp: number | null | undefined,
  period: number | null | undefined,
  v: number | null | undefined,
): number | null {
  if (damp == null || period == null || v == null) return null;
  if (Number.isNaN(damp) || Number.isNaN(period) || Number.isNaN(v)) return null;
  return INV_PI * damp * period * v;
}

const L1_WIKI = "https://ardupilot.org/plane/docs/navigation-tuning.html";
const TECS_WIKI =
  "https://ardupilot.org/plane/docs/tecs-total-energy-control-system-for-speed-height-tuning-guide.html";

type Phrase = (key: string) => string;

function l1Doc(t: Phrase, pick: string | null): string[] {
  switch (pick) {
    case "xtrack":
      return [
        t("Cross-track error to the line. L1 uses it with Nu (the angle to the L1 point). This MAVLink sample does not carry the error itself — you see the bank that came out."),
      ];
    case "gspd":
      return [
        t("Groundspeed. L1 length grows with V so the same PERIOD feels the same at different speeds. Wiki: a complementary filter fuses GPS velocity, airspeed and heading so GPS lag does not dominate."),
      ];
    case "nu":
      return [
        t("Nu is the angle from the velocity vector to the L1 point. Lateral acceleration is K · V² / L1 · sin(Nu). Not on this MAVLink sample."),
      ];
    case "l1":
      return [
        t("L1 distance = (1/π) · DAMPING · PERIOD · groundspeed. The aircraft aims that far ahead on the track. The turn onto the next leg starts at this length, but never farther than WP_RADIUS."),
      ];
    case "t":
      return [
        t("NAVL1_PERIOD. The time the guidance loop is tuned for. Smaller = sharper corners. Wiki start: 17, damping 0.75. If it weaves after a turn, add 1–2 s. If the turn is too slow, subtract about 5."),
      ];
    case "k":
      return [
        t("Guidance gain K = 4 · DAMPING² (instead of a fixed 2). Extra NAVL1_DAMPING covers GPS lag and roll delay. After PERIOD is set, you may step DAMPING by 0.05. Unlikely you need it below 0.6."),
      ];
    case "ay":
      return [
        t("Demanded lateral acceleration a = K · V² / L1 · sin(Nu). Bank is atan(a/g). This sample does not carry a_y; nav_roll is what we see."),
      ];
    case "bank":
      return [
        t("nav_roll — the bank L1 asked for. Set ROLL_LIMIT_DEG to a bank the wing can hold without stalling (wiki: about 50° for a slow glider, about 65° for a fast aerobatic)."),
      ];
    case "roll":
      return [
        t("The roll loop. Wiki: tune roll and pitch, and trim so the plane does not lose height in a turn, before L1. Raising PERIOD will not hold a wing that cannot hold bank."),
      ];
    default:
      return [
        t("The L1 controller looks a distance L1 ahead of the track and asks for a lateral acceleration, then a bank φ* = atan(a/g). That bank is nav_roll for the roll loop."),
        t("L1 length is (1/π) · DAMPING · PERIOD · groundspeed, so the tracking loop keeps a constant period as speed changes. NAVL1_PERIOD is the main knob (wiki default around 17–20): smaller is a tighter turn. NAVL1_DAMPING adds extra damping for GPS lag and roll delay — unlikely you need it below 0.6."),
        t("Wiki: tune roll and pitch first, and set ROLL_LIMIT_DEG so the wing can hold the bank without stalling. Turns too slow: lower PERIOD by about 5. Weaving after a turn: raise PERIOD by 1–2. WP_RADIUS chooses fly-through vs turn-early."),
      ];
  }
}

function tecsDoc(t: Phrase, pick: string | null): string[] {
  switch (pick) {
    case "herr":
      return [
        t("Height error becomes gravitational potential energy. TECS_CLMB_MAX is the best climb at THR_MAX and AIRSPEED_CRUISE. TECS_SINK_MIN / SINK_MAX are idle glide and the steepest safe descent. Measure them in FBWA; if they are optimistic, height will oscillate."),
      ];
    case "aspd":
      return [
        t("Airspeed is kinetic energy. AIRSPEED_MIN is the slowest safe speed in a bank. AIRSPEED_MAX is just under level-flight top with THR_MAX. AIRSPEED_CRUISE is where you took the climb/sink measurements. Without an airspeed estimate, SPDWEIGHT is forced to 0 (pitch holds height)."),
      ];
    case "spe":
      return [
        t("Gravitational potential energy = mass × gravity × height. Raising height costs energy; falling releases it. The stand shows g · h (energy per unit mass). This feeds both STE (throttle) and, through W, SEB (pitch)."),
      ];
    case "ske":
      return [
        t("Kinetic energy = ½ × mass × speed². Speeding up costs energy even at the same height. The stand shows ½ · V². This also feeds STE and, through W, SEB."),
      ];
    case "w":
      return [
        t("TECS_SPDWEIGHT: how much the pitch loop weights speed vs height errors. 0.0: pitch holds height and ignores speed. 2.0: pitch holds speed and ignores height (glider / soaring). 1.0: both. It is not a P. STE is always SPE + SKE. No effect without an airspeed estimate."),
        t("The circle sits where the four arrows meet: height and speed each feed total energy and energy balance. Straight paths are each channel into itself; the diagonals are the cross."),
      ];
    case "ste":
      return [
        t("Total energy = potential + kinetic. Throttle holds this total. More throttle: both higher and faster. TECS_TIME_CONST is the time constant of that chase (smaller = faster). TECS_THR_DAMP damps speed/height oscillation; TECS_INTEG_GAIN trims leftover error."),
      ];
    case "seb":
      return [
        t("Energy balance. Pitch moves energy between height and speed. Lower the nose: potential → kinetic. W sets how much of that job pitch takes versus throttle. TECS_PTCH_DAMP damps height oscillation after the pitch-to-servo loop is already tuned."),
      ];
    case "thr":
      return [
        t("Throttle demand. THR_MAX must climb at PTCH_LIM_MAX_DEG at AIRSPEED_CRUISE. TRIM_THROTTLE is level flight at cruise. TECS_RLL2THR adds throttle in a bank for extra drag. Throttle cannot set the balance — that is pitch."),
      ];
    case "pitch":
      return [
        t("Pitch demand from the energy balance, clipped by PTCH_LIM_MAX_DEG / MIN. This is nav_pitch for the pitch loop, not the rate loop itself. TECS writes it in AUTO / FBWB / CRUISE / RTL / LOITER."),
      ];
    case "plant":
      return [
        t("The wing and the engine. Drag constantly reduces total energy. Only thrust (or a thermal) puts it back. Nose up: height grows, speed falls — the plant cannot add height without losing speed."),
      ];
    case "ploop":
      return [
        t("The pitch-to-servo loop (PTCH_RATE). Wiki: TECS is only as good as this loop. Tune it in FBWA with AUTOTUNE or the pitch-rate knobs before touching TECS_TIME_CONST."),
      ];
    default:
      return [
        t("TECS (Total Energy Control System) coordinates throttle and pitch to hold height and airspeed. The aircraft has two mechanical energies: gravitational potential (mass × g × height) and kinetic (½ × mass × speed²). Drag always takes energy; only thrust or a thermal puts it back."),
        t("Total energy is their sum. TECS sets throttle to hold that total. Pitch does not add energy — it trades height for speed. If you are high and slow, total energy can still be right: too much potential, not enough kinetic. Lower the nose to move energy into speed."),
        t("W (TECS_SPDWEIGHT) sits at the four-arrow crossing. It is how much pitch listens to speed vs height: 0 height, 1 both (stock), 2 speed (glider). STE does not use W. TECS_TIME_CONST is how quickly the energy error is chased — time, not a mix."),
        t("Wiki: tune the pitch-to-servo loop in FBWA first. If height then oscillates, raise TECS_TIME_CONST (do not go past 10). TECS is live in AUTO / FBWB / CRUISE / RTL / LOITER, not FBWA or MANUAL."),
      ];
  }
}

export function L1Scheme({ onPause, embed }: { onPause: () => void; embed?: boolean }) {
  const t = useT();
  const s = useViewSample();
  const paused = isPaused();
  const live = nodesLiveIn(s.mode, s).has("navl1");
  const per = paramOf(s, "NAVL1_PERIOD");
  const damp = paramOf(s, "NAVL1_DAMPING");
  const k = kL1Of(damp);
  const l1 = l1DistOf(damp, per, s.gspd);
  const [pick, setPick] = useState<string | null>(null);
  const hit = (id: string) => schemeHit(id, pick, setPick);
  const knobs = namedGains(
    [L1.gains],
    pick === "l1" || pick === "ay" ? ["NAVL1_PERIOD", "NAVL1_DAMPING"] : pick === "t" ? ["NAVL1_PERIOD"] : pick === "k" ? ["NAVL1_DAMPING"] : [],
  );

  return (
    <div className={embed ? "loop embed" : "loop"}>
      {live || !s.ok ? null : (
        <p className="warn">
          {t("In {mode} this loop is not running: the autopilot is not turning it. You can inspect gains, but they will not change behaviour until the mode closes the loop.", {
            mode: s.mode || t("this mode"),
          })}
        </p>
      )}
      <div className="plot-head">
        <b>{t("L1 · track → bank")}</b>
        <span>{t("Looks a distance L1 ahead, asks for lateral accel, then bank via atan(a/g). Period smaller = tighter.")}</span>
        <button type="button" className={paused ? "pause-btn on" : "pause-btn"} onClick={onPause} title={t("Space")}>
          {paused ? t("Resume") : t("Pause")}
        </button>
      </div>
      <div className={!s.ok ? "loop-board idle" : paused ? "loop-board paused" : "loop-board"} onClick={() => setPick(null)}>
        <svg viewBox="0 0 900 330" preserveAspectRatio="xMidYMid meet" role="img" aria-label={t("L1 track")}>
          <defs>
            <marker id="l1Arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill={COL.line} />
            </marker>
            <marker id="l1ArrA" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill={COL.amber} />
            </marker>
            <marker id="l1ArrC" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill={COL.cyan} />
            </marker>
          </defs>
          <LoopLiveBox
            x={10}
            y={48}
            w={150}
            h={88}
            stroke={COL.dim}
            title={t("cross-track")}
            sub={t("not on this MAVLink sample")}
            value="—"
            pick={() => null}
            mark="struct"
            {...hit("xtrack")}
          />
          <LoopLiveBox
            x={10}
            y={194}
            w={150}
            h={88}
            stroke={COL.cyan}
            title={t("groundspeed")}
            sub="VFR_HUD"
            value={s.gspd == null ? "—" : `${fmt(s.gspd, 1)} m/s`}
            pick={(p) => p.gspd}
            mark="struct"
            {...hit("gspd")}
          />
          <path d="M 160 92 L 186 92" fill="none" stroke={COL.line} strokeWidth="1.5" markerEnd="url(#l1Arr)" />
          <path d="M 160 238 L 186 238" fill="none" stroke={COL.cyan} strokeWidth="1.5" markerEnd="url(#l1ArrC)" />
          <LoopLiveBox
            x={186}
            y={48}
            w={140}
            h={88}
            stroke={COL.dim}
            title="Nu"
            sub={t("to L1 point")}
            value="—"
            pick={() => null}
            mark="struct"
            {...hit("nu")}
          />
          <LoopLiveBox
            x={186}
            y={194}
            w={140}
            h={88}
            stroke={COL.amber}
            title="L1"
            sub={t("(1/pi)·DAMP·PERIOD·V")}
            value={l1 == null ? "—" : `${fmt(l1, 0)} m`}
            pick={(p) => l1DistOf(paramOf(p, "NAVL1_DAMPING"), paramOf(p, "NAVL1_PERIOD"), p.gspd)}
            mark="tune"
            {...hit("l1")}
          />
          <path d="M 326 92 L 364 92" fill="none" stroke={COL.line} strokeWidth="1.4" markerEnd="url(#l1Arr)" />
          <path d="M 326 222 L 364 108" fill="none" stroke={COL.line} strokeWidth="1.2" markerEnd="url(#l1Arr)" />
          <path d="M 443 194 L 443 136" fill="none" stroke={COL.line} strokeWidth="1.2" markerEnd="url(#l1Arr)" />
          <LoopMixDot
            cx={345}
            cy={165}
            stroke={COL.amber}
            label="T"
            value={fmt(per, 0)}
            mark="tune"
            {...hit("t")}
          />
          <LoopLiveBox
            x={364}
            y={48}
            w={158}
            h={88}
            stroke={COL.amber}
            title={t("lateral accel")}
            sub={t("K · V² / L1 · sin(Nu)")}
            value="—"
            pick={() => null}
            mark="tune"
            {...hit("ay")}
          />
          <LoopLiveBox
            x={364}
            y={194}
            w={158}
            h={88}
            stroke={COL.amber}
            title="K"
            sub={t("4 · DAMP²")}
            value={fmt(k, 2)}
            pick={(p) => kL1Of(paramOf(p, "NAVL1_DAMPING"))}
            mark="tune"
            {...hit("k")}
          />
          <path d="M 522 92 L 548 92" fill="none" stroke={COL.amber} strokeWidth="1.5" markerEnd="url(#l1ArrA)" />
          <LoopLiveBox
            x={548}
            y={48}
            w={140}
            h={88}
            stroke={COL.amber}
            title={t("desired roll")}
            sub="nav_roll · atan(a/g)"
            value={`${fmt(s.tar, 1)}°`}
            pick={(p) => p.tar}
            mark="struct"
            {...hit("bank")}
          />
          <path d="M 688 92 L 714 92" fill="none" stroke={COL.line} strokeWidth="1.5" markerEnd="url(#l1Arr)" />
          <LoopLiveBox
            x={714}
            y={48}
            w={174}
            h={88}
            stroke={COL.cyan}
            title={t("roll loop")}
            sub="ATTITUDE.roll"
            value={`${fmt(s.roll, 1)}°`}
            pick={(p) => p.roll}
            mark="struct"
            {...hit("roll")}
          />
        </svg>
      </div>
      <SchemeKey />
      <div className="loop-rest">
        <div className="loop-form">
          <div className="frow">
            <span>T</span>
            <code>PERIOD</code>
            <b>{per == null ? "—" : `${fmt(per, 1)} s`}</b>
          </div>
          <div className="frow">
            <span>ξ</span>
            <code>DAMP</code>
            <b>{fmt(damp, 2)}</b>
          </div>
          <div className="frow">
            <span>L1</span>
            <code>(1/pi) · ξ · T · V</code>
            <b>{l1 == null ? "—" : `${fmt(l1, 1)} m`}</b>
          </div>
          <div className="frow">
            <span>K</span>
            <code>4 · ξ²</code>
            <b>{fmt(k, 2)}</b>
          </div>
          <div className="frow">
            <span>a</span>
            <code>K · V² / L1 · sin(Nu)</code>
            <b>{t("not on this MAVLink sample")}</b>
          </div>
          <div className="frow">
            <span>φ*</span>
            <code>atan(a / g) → nav_roll</code>
            <b>{`${fmt(s.tar, 1)}°`}</b>
          </div>
        </div>
        <SchemeKnobs node={L1} gains={knobs} picked={pick} quiet />
        <SchemeDoc lines={l1Doc(t, pick)} href={L1_WIKI} wiki={t("L1 navigation")} />
      </div>
    </div>
  );
}

const TECS_POOL: Gain[] = [
  ...TECS.gains,
  ...TECS_LIMITS.map((g) => ({ ...g })),
  ...TECS_RESP.map((g) => ({ ...g })),
];

function tecsKnobKeys(pick: string | null): string[] {
  if (pick === "herr") return ["TECS_CLMB_MAX", "TECS_SINK_MIN", "TECS_SINK_MAX"];
  if (pick === "aspd") return ["AIRSPEED_MIN", "AIRSPEED_CRUISE", "AIRSPEED_MAX"];
  if (pick === "w") return ["TECS_SPDWEIGHT"];
  if (pick === "ste") return ["TECS_TIME_CONST", "TECS_THR_DAMP", "TECS_INTEG_GAIN", "TECS_RLL2THR"];
  if (pick === "seb") return ["TECS_PTCH_DAMP", "TECS_INTEG_GAIN", "TECS_SPDWEIGHT"];
  if (pick === "thr") return ["THR_MAX", "TRIM_THROTTLE"];
  if (pick === "pitch") return ["PTCH_LIM_MAX_DEG", "PTCH_LIM_MIN_DEG"];
  return [];
}

const G = 9.80665;

function speOf(alt: number | null | undefined): number | null {
  return alt == null || Number.isNaN(alt) ? null : G * alt;
}

function skeOf(v: number | null | undefined): number | null {
  return v == null || Number.isNaN(v) ? null : 0.5 * v * v;
}

function steOf(alt: number | null | undefined, v: number | null | undefined): number | null {
  const pe = speOf(alt);
  const ke = skeOf(v);
  return pe == null || ke == null ? null : pe + ke;
}

function sebOf(alt: number | null | undefined, v: number | null | undefined, w: number | null): number | null {
  const pe = speOf(alt);
  const ke = skeOf(v);
  if (pe == null || ke == null || w == null) return null;
  return (2 - w) * pe - w * ke;
}

export function TecsScheme({ onPause, embed }: { onPause: () => void; embed?: boolean }) {
  const t = useT();
  const s = useViewSample();
  const paused = isPaused();
  const live = nodesLiveIn(s.mode, s).has("tecs");
  const w = paramOf(s, "TECS_SPDWEIGHT");
  const tc = paramOf(s, "TECS_TIME_CONST");
  const hErr = s.alt_tar != null && s.alt != null ? s.alt_tar - s.alt : null;
  const spe = speOf(s.alt);
  const ske = skeOf(s.aspd);
  const ste = steOf(s.alt, s.aspd);
  const seb = sebOf(s.alt, s.aspd, w);
  const [pick, setPick] = useState<string | null>(null);
  const hit = (id: string) => schemeHit(id, pick, setPick);
  const knobs = namedGains([TECS_POOL], tecsKnobKeys(pick));

  return (
    <div className={embed ? "loop embed" : "loop"}>
      {live || !s.ok ? null : (
        <p className="warn">
          {t("In {mode} this loop is not running: the autopilot is not turning it. You can inspect gains, but they will not change behaviour until the mode closes the loop.", {
            mode: s.mode || t("this mode"),
          })}
        </p>
      )}
      <div className="plot-head">
        <b>{t("TECS · energy → pitch + throttle")}</b>
        <span>{t("Throttle holds total energy. Pitch only trades height for speed. W is the mix, not a P.")}</span>
        <button type="button" className={paused ? "pause-btn on" : "pause-btn"} onClick={onPause} title={t("Space")}>
          {paused ? t("Resume") : t("Pause")}
        </button>
      </div>
      <div className={!s.ok ? "loop-board idle" : paused ? "loop-board paused" : "loop-board"} onClick={() => setPick(null)}>
        <svg viewBox="0 0 900 330" preserveAspectRatio="xMidYMid meet" role="img" aria-label={t("TECS energy")}>
          <defs>
            <marker id="tecsArr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill={COL.line} />
            </marker>
            <marker id="tecsArrA" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill={COL.amber} />
            </marker>
            <marker id="tecsArrC" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill={COL.cyan} />
            </marker>
          </defs>
          <LoopLiveBox
            x={10}
            y={48}
            w={150}
            h={88}
            stroke={COL.amber}
            title={t("height error")}
            sub={`AGL ${fmt(s.alt, 1)} m`}
            value={`${fmt(hErr, 1)} m`}
            pick={(p) => (p.alt_tar != null && p.alt != null ? p.alt_tar - p.alt : null)}
            mark="later"
            {...hit("herr")}
          />
          <LoopLiveBox
            x={10}
            y={194}
            w={150}
            h={88}
            stroke={COL.cyan}
            title={t("airspeed")}
            sub="VFR_HUD"
            value={s.aspd == null ? "—" : `${fmt(s.aspd, 1)} m/s`}
            pick={(p) => p.aspd}
            mark="later"
            {...hit("aspd")}
          />
          <path d="M 160 92 L 186 92" fill="none" stroke={COL.amber} strokeWidth="1.5" markerEnd="url(#tecsArrA)" />
          <path d="M 160 238 L 186 238" fill="none" stroke={COL.cyan} strokeWidth="1.5" markerEnd="url(#tecsArrC)" />
          <LoopLiveBox
            x={186}
            y={48}
            w={128}
            h={88}
            stroke={COL.amber}
            title="SPE"
            sub={t("g · height")}
            value={fmt(spe, 0)}
            pick={(p) => speOf(p.alt)}
            mark="struct"
            {...hit("spe")}
          />
          <LoopLiveBox
            x={186}
            y={194}
            w={128}
            h={88}
            stroke={COL.cyan}
            title="SKE"
            sub={t("½ V²")}
            value={fmt(ske, 0)}
            pick={(p) => skeOf(p.aspd)}
            mark="struct"
            {...hit("ske")}
          />
          <path d="M 314 92 L 348 92" fill="none" stroke={COL.line} strokeWidth="1.4" markerEnd="url(#tecsArr)" />
          <path d="M 314 238 L 348 238" fill="none" stroke={COL.line} strokeWidth="1.4" markerEnd="url(#tecsArr)" />
          <path d="M 314 108 L 348 222" fill="none" stroke={COL.line} strokeWidth="1.2" />
          <path d="M 314 222 L 348 108" fill="none" stroke={COL.line} strokeWidth="1.2" markerEnd="url(#tecsArr)" />
          <LoopMixDot
            cx={331}
            cy={165}
            stroke={COL.amber}
            label="W"
            value={fmt(w, 1)}
            mark="tune"
            {...hit("w")}
          />
          <LoopLiveBox
            x={348}
            y={48}
            w={162}
            h={88}
            stroke={COL.amber}
            title="STE · Σ"
            sub={t("total → throttle")}
            value={fmt(ste, 0)}
            pick={(p) => steOf(p.alt, p.aspd)}
            mark="tune"
            {...hit("ste")}
          />
          <LoopLiveBox
            x={348}
            y={194}
            w={162}
            h={88}
            stroke={COL.amber}
            title="SEB · Δ"
            sub={t("W mix → pitch")}
            value={fmt(seb, 0)}
            pick={(p) => sebOf(p.alt, p.aspd, paramOf(p, "TECS_SPDWEIGHT"))}
            mark="later"
            {...hit("seb")}
          />
          <path d="M 510 92 L 536 92" fill="none" stroke={COL.line} strokeWidth="1.5" markerEnd="url(#tecsArr)" />
          <path d="M 510 238 L 536 238" fill="none" stroke={COL.amber} strokeWidth="1.5" markerEnd="url(#tecsArrA)" />
          <LoopLiveBox
            x={536}
            y={48}
            w={140}
            h={88}
            stroke={COL.amber}
            title={t("throttle")}
            sub={`TC ${fmt(tc, 1)} · VFR_HUD`}
            value={`${fmt(s.thr_out, 0)}%`}
            pick={(p) => p.thr_out}
            mark="later"
            {...hit("thr")}
          />
          <LoopLiveBox
            x={536}
            y={194}
            w={140}
            h={88}
            stroke={COL.amber}
            title={t("desired pitch")}
            sub="nav_pitch"
            value={`${fmt(s.pitch_tar, 1)}°`}
            pick={(p) => p.pitch_tar}
            mark="later"
            {...hit("pitch")}
          />
          <path d="M 676 92 L 702 92" fill="none" stroke={COL.line} strokeWidth="1.5" markerEnd="url(#tecsArr)" />
          <path d="M 676 238 L 702 238" fill="none" stroke={COL.line} strokeWidth="1.5" markerEnd="url(#tecsArr)" />
          <LoopLiveBox
            x={702}
            y={48}
            w={186}
            h={88}
            stroke={COL.cyan}
            title={t("plant")}
            sub={t("engine / air")}
            value={`${fmt(s.aspd, 1)} m/s`}
            pick={(p) => p.aspd}
            mark="struct"
            {...hit("plant")}
          />
          <LoopLiveBox
            x={702}
            y={194}
            w={186}
            h={88}
            stroke={COL.cyan}
            title={t("pitch loop")}
            sub="ATTITUDE.pitch"
            value={`${fmt(s.pitch, 1)}°`}
            pick={(p) => p.pitch}
            mark="struct"
            {...hit("ploop")}
          />
        </svg>
      </div>
      <SchemeKey />
      <div className="loop-rest">
        <div className="loop-form">
          <div className="frow">
            <span>SPE</span>
            <code>g · h</code>
            <b>{spe == null || s.alt == null ? "—" : `9.81 × ${fmt(s.alt, 1)} = ${fmt(spe, 1)}`}</b>
          </div>
          <div className="frow">
            <span>SKE</span>
            <code>0.5 · V²</code>
            <b>{ske == null || s.aspd == null ? "—" : `0.5 × ${fmt(s.aspd, 1)}² = ${fmt(ske, 1)}`}</b>
          </div>
          <div className="frow">
            <span>STE</span>
            <code>SPE + SKE → throttle</code>
            <b>{fmt(ste, 1)}</b>
          </div>
          <div className="frow">
            <span>SEB</span>
            <code>(2−W)·SPE − W·SKE → pitch</code>
            <b>{fmt(seb, 1)}</b>
          </div>
          <div className="frow">
            <span>W</span>
            <code>{t("0 height on pitch · 2 speed on pitch")}</code>
            <b>{fmt(w, 1)}</b>
          </div>
        </div>
        <SchemeKnobs node={TECS} gains={knobs} picked={pick} quiet />
        <SchemeDoc lines={tecsDoc(t, pick)} href={TECS_WIKI} wiki={t("TECS speed/height")} />
      </div>
    </div>
  );
}
