import { useState } from "react";
import { paramOf } from "../components/GainRow";
import { LoopFrame, LoopLiveBox, loopBoxHit, type LoopMark } from "../components/LoopPids";
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
        t("The circle of radius L1 is centred on the aircraft and meets the track at the L1 point. Nu is the angle from the velocity vector V to that point. PERIOD sets how long L1 is; it does not sit in the accel formula."),
        t("Lateral acceleration a = K · V² / L1 · sin(Nu), then bank φ* = atan(a/g) = nav_roll. K = 4 · DAMPING². L1 = (1/π) · DAMPING · PERIOD · groundspeed, so the same PERIOD feels the same as speed changes."),
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
        t("TECS_SPDWEIGHT (W) is not a P. It only weights the pitch trade (SEB). Throttle still holds total energy STE = SPE + SKE — W does not go into STE. Without an airspeed estimate W is forced to 0."),
        t("A stick jab in FBWB is a climb-rate pulse — two TIME_CONST humps, the same at any W. Hold elevator for several seconds, or change speed with the throttle stick and leave elevator centered: W = 0 keeps height (speed sags), W = 2 keeps speed (height wanders)."),
        t("0 — height. Pitch holds altitude and ignores speed. A powered plane in a valley, a landing pattern, or any flight where not sinking matters more than a few m/s of airspeed. Throttle then looks after speed, because pitch already took height."),
        t("1 — both (stock). Pitch shares height and speed. Start here on a powered plane with an airspeed sensor in AUTO / FBWB / CRUISE / RTL. Usual cruise: stay on the altitude line without letting speed wander."),
        t("2 — speed. Pitch holds airspeed and ignores height. A glider, or soaring: climb from rising air (thermal, ridge, wave), not from the motor. Pitch keeps a safe glide speed; height comes from the air. Also when stall or overspeed would be worse than being off altitude."),
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
        t("W (TECS_SPDWEIGHT) is the slider on the pitch trade: 0 height, 1 both (stock), 2 speed (glider). STE does not use W — throttle always holds the sum. TECS_TIME_CONST is how quickly the energy error is chased — time, not a mix."),
        t("Wiki: tune the pitch-to-servo loop in FBWA first. If height then oscillates, raise TECS_TIME_CONST (do not go past 10). TECS is live in AUTO / FBWB / CRUISE / RTL / LOITER, not FBWA or MANUAL."),
      ];
  }
}

function LoopChip({
  x,
  y,
  w,
  h,
  title,
  value,
  stroke,
  mark,
  step,
  picked,
  onPick,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  value?: string;
  stroke: string;
  mark?: LoopMark;
  step?: string;
  picked: boolean;
  onPick: () => void;
}) {
  return (
    <g {...loopBoxHit(onPick)}>
      <LoopFrame x={x} y={y} w={w} h={h} rx={6} color={stroke} mark={mark} picked={picked} />
      {step ? (
        <text x={x + 10} y={y + h / 2 + 4} fill={stroke} fontSize="11" fontWeight="700">
          {step}
        </text>
      ) : null}
      <text x={x + (step ? 26 : 10)} y={y + h / 2 + 4} fill={COL.dim} fontSize="11" fontWeight="700">
        {title}
      </text>
      {value != null ? (
        <text x={x + w - 8} y={y + h / 2 + 4} textAnchor="end" fill={stroke} fontSize="11" fontWeight="700">
          {value}
        </text>
      ) : null}
    </g>
  );
}

function L1Plane() {
  return (
    <g fill="#1a1e24" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <polygon points="0,-26 -4,-13 4,-13" />
      <rect x="-3.4" y="-13" width="6.8" height="38" rx="2" />
      <polygon points="-38,-1 0,-10 38,-1 0,5" />
      <polygon points="-12,17 0,14 12,17 0,23" />
    </g>
  );
}

function TecsPlane() {
  return (
    <g fill="#1a1e24" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round">
      <polygon points="-40,4 -34,-18 -24,4" />
      <polygon points="-42,-5.5 28,-5.5 50,0 28,5.5 -42,5.5" />
      <polygon points="-12,5.5 28,5.5 18,16 -10,16" />
    </g>
  );
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
    pick === "l1" ? ["NAVL1_PERIOD", "NAVL1_DAMPING"] : pick === "t" ? ["NAVL1_PERIOD"] : pick === "k" ? ["NAVL1_DAMPING"] : [],
  );
  const knobNode = pick === "t" || pick === "k" || pick === "l1" ? { ...L1, gains: [] } : L1;

  const PX = 190;
  const PY = 248;
  const hd = (32 * Math.PI) / 180;
  const vx = Math.sin(hd);
  const vy = -Math.cos(hd);
  const L1X = 428;
  const L1Y = 84;
  const rL = Math.hypot(L1X - PX, L1Y - PY);
  const aL = Math.atan2(L1Y - PY, L1X - PX);
  const aArc = aL - 0.38;
  const arcX = PX + rL * Math.cos(aArc);
  const arcY = PY + rL * Math.sin(aArc);
  const vLen = 74;
  const vX = PX + vx * vLen;
  const vY = PY + vy * vLen;
  const nuR = 54;
  const nuVx = PX + vx * nuR;
  const nuVy = PY + vy * nuR;
  const nuLx = PX + Math.cos(aL) * nuR;
  const nuLy = PY + Math.sin(aL) * nuR;
  const xtrackOn = pick === "xtrack";
  const nuOn = pick === "nu";
  const l1On = pick === "l1" || pick === "t";
  const vOn = pick === "gspd";

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
        <span>{t("1 look ahead → 2 Nu → 3 accel → 4 bank. Solid left edge is a knob.")}</span>
        <button type="button" className={paused ? "pause-btn on" : "pause-btn"} onClick={onPause} title={t("Space")}>
          {paused ? t("Resume") : t("Pause")}
        </button>
      </div>
      <SchemeKey />
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
          <text x="36" y="22" fill={COL.dim} fontSize="11">
            {t("track")}
          </text>
          <line
            x1="36"
            y1="84"
            x2="548"
            y2="84"
            stroke={xtrackOn ? COL.amber : COL.line}
            strokeWidth={xtrackOn ? 2 : 1.4}
            strokeDasharray="7 5"
          />
          <circle cx="48" cy="84" r="3.2" fill={xtrackOn ? COL.amber : COL.dim} stroke="none" />
          <circle cx="536" cy="84" r="3.2" fill={xtrackOn ? COL.amber : COL.dim} stroke="none" />
          <line
            x1={PX}
            y1={PY}
            x2={PX}
            y2="84"
            stroke={xtrackOn ? COL.amber : COL.line}
            strokeWidth={xtrackOn ? 2 : 1.3}
            strokeDasharray="4 3"
          />
          <path
            d={`M ${arcX.toFixed(1)} ${arcY.toFixed(1)} A ${rL.toFixed(1)} ${rL.toFixed(1)} 0 0 1 ${L1X} ${L1Y}`}
            fill="none"
            stroke={l1On ? COL.amber : "#5a4a32"}
            strokeWidth={l1On ? 2 : 1.3}
            strokeDasharray="5 4"
          />
          <line x1={PX} y1={PY} x2={L1X} y2={L1Y} stroke={COL.amber} strokeWidth={l1On ? 2.4 : 1.7} />
          <circle cx={L1X} cy={L1Y} r="5" fill={COL.amber} stroke="#0c0e11" strokeWidth="1.2" />
          <line
            x1={PX}
            y1={PY}
            x2={vX}
            y2={vY}
            stroke={vOn ? COL.cyan : COL.amber}
            strokeWidth={vOn ? 2.4 : 1.8}
            strokeLinecap="round"
            markerEnd="url(#l1ArrC)"
          />
          <path
            d={`M ${nuVx.toFixed(1)} ${nuVy.toFixed(1)} A ${nuR} ${nuR} 0 0 1 ${nuLx.toFixed(1)} ${nuLy.toFixed(1)}`}
            fill="none"
            stroke={nuOn ? COL.amber : COL.dim}
            strokeWidth={nuOn ? 2.4 : 1.6}
          />
          <g transform={`translate(${PX} ${PY}) rotate(32)`} color={COL.amber} pointerEvents="none">
            <L1Plane />
          </g>
          <LoopChip
            x={8}
            y={96}
            w={128}
            h={32}
            title={t("cross-track")}
            stroke={COL.dim}
            mark="struct"
            {...hit("xtrack")}
          />
          <LoopChip
            x={8}
            y={218}
            w={128}
            h={32}
            title="V"
            value={s.gspd == null ? "—" : `${fmt(s.gspd, 1)} m/s`}
            stroke={COL.cyan}
            mark="struct"
            {...hit("gspd")}
          />
          <LoopChip
            x={248}
            y={210}
            w={96}
            h={32}
            step="2"
            title="Nu"
            stroke={COL.dim}
            mark="struct"
            {...hit("nu")}
          />
          <LoopChip
            x={248}
            y={128}
            w={156}
            h={34}
            title="PERIOD"
            value={per == null ? "—" : `${fmt(per, 1)} s`}
            stroke={COL.amber}
            mark="tune"
            {...hit("t")}
          />
          <LoopChip
            x={L1X - 20}
            y={8}
            w={168}
            h={34}
            step="1"
            title="L1"
            value={l1 == null ? "—" : `${fmt(l1, 0)} m`}
            stroke={COL.amber}
            mark="struct"
            {...hit("l1")}
          />
          <path
            d={`M ${L1X + 18} ${L1Y + 8} L 608 80`}
            fill="none"
            stroke={COL.amber}
            strokeWidth="1.5"
            markerEnd="url(#l1ArrA)"
          />
          <LoopChip
            x={608}
            y={6}
            w={160}
            h={34}
            title="DAMP"
            value={fmt(damp, 2)}
            stroke={COL.amber}
            mark="later"
            {...hit("k")}
          />
          <LoopLiveBox
            x={608}
            y={46}
            w={272}
            h={72}
            stroke={COL.amber}
            title={`3 · ${t("lateral accel")}`}
            sub={t("K · V² / L1 · sin(Nu)")}
            value="—"
            pick={() => null}
            mark="struct"
            {...hit("ay")}
          />
          <path d="M 744 118 L 744 130" fill="none" stroke={COL.amber} strokeWidth="1.5" markerEnd="url(#l1ArrA)" />
          <LoopLiveBox
            x={608}
            y={132}
            w={272}
            h={72}
            stroke={COL.amber}
            title={`4 · ${t("desired roll")}`}
            sub="nav_roll · atan(a/g)"
            value={`${fmt(s.tar, 1)}°`}
            pick={(p) => p.tar}
            mark="struct"
            {...hit("bank")}
          />
          <path d="M 744 204 L 744 216" fill="none" stroke={COL.line} strokeWidth="1.5" markerEnd="url(#l1Arr)" />
          <LoopLiveBox
            x={608}
            y={218}
            w={272}
            h={72}
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
      <SchemeKnobs node={knobNode} gains={knobs} picked={pick} quiet />
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

function energyFrac(v: number | null, typical: number): number {
  if (v == null || Number.isNaN(v) || typical <= 0) return 0.5;
  return Math.min(0.92, Math.max(0.16, v / typical));
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
  const spe = speOf(s.alt);
  const ske = skeOf(s.aspd);
  const ste = steOf(s.alt, s.aspd);
  const seb = sebOf(s.alt, s.aspd, w);
  const [pick, setPick] = useState<string | null>(null);
  const hit = (id: string) => schemeHit(id, pick, setPick);
  const knobs = namedGains([TECS_POOL], tecsKnobKeys(pick));
  const knobNode = pick === "w" || pick === "ste" || pick === "seb" ? { ...TECS, gains: [] } : TECS;
  const wVal = w == null || Number.isNaN(w) ? 1 : Math.min(2, Math.max(0, w));
  const knobX = 352;
  const wX0 = knobX;
  const wX2 = knobX + 148;
  const wY = 130;
  const wFx = wX0 + (wVal / 2) * (wX2 - wX0);
  const PX = 132;
  const PY = 196;
  const GND = 286;
  const planeScale = 1.58;
  const noseX = PX + 50 * planeScale;
  const speX = 28;
  const speW = 20;
  const speTop = 8;
  const speTankH = GND - speTop;
  const speFillH = GND - PY;
  const vArrow = 78;
  const skeX = noseX + 6;
  const skeY = PY - 38;
  const skeH = 18;
  const skeMaxW = 72;
  const skeFillW = skeMaxW * energyFrac(ske, 350);
  const tcW = 124;
  const tcH = 28;
  const tcY = 36;
  const tcCy = tcY + tcH / 2;
  const skeRight = skeX + skeMaxW;
  const hOn = pick === "herr" || pick === "spe";
  const vOn = pick === "aspd" || pick === "ske";
  const wOn = pick === "w" || pick === "seb";
  const addOn = pick === "ste" || pick === "thr";

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
        <span>{t("1 height · 2 speed → W mix → 3 throttle adds, 4 pitch trades. Solid left edge is a knob.")}</span>
        <button type="button" className={paused ? "pause-btn on" : "pause-btn"} onClick={onPause} title={t("Space")}>
          {paused ? t("Resume") : t("Pause")}
        </button>
      </div>
      <SchemeKey />
      <div className={!s.ok ? "loop-board idle" : paused ? "loop-board paused" : "loop-board"} onClick={() => setPick(null)}>
        <svg viewBox="0 0 900 300" preserveAspectRatio="xMidYMid meet" role="img" aria-label={t("TECS energy")}>
          <defs>
            <marker id="tecsArrA" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill={COL.amber} />
            </marker>
            <marker id="tecsArrC" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <polygon points="0 0, 7 3.5, 0 7" fill={COL.cyan} />
            </marker>
          </defs>
          <line x1="16" y1={GND} x2="360" y2={GND} stroke={COL.line} strokeWidth="1.2" strokeDasharray="5 4" />
          <g {...loopBoxHit(hit("spe").onPick)}>
            <rect
              x={speX}
              y={speTop}
              width={speW}
              height={speTankH}
              rx="3"
              fill="#2a2014"
              stroke={COL.amber}
              strokeWidth={hOn ? 2 : 1.3}
              strokeDasharray={hOn ? undefined : "4 3"}
            />
            <rect
              x={speX + 2}
              y={GND - speFillH}
              width={speW - 4}
              height={speFillH - 2}
              rx="2"
              fill={COL.amber}
              opacity="0.55"
              stroke="none"
            />
            <text x={speX + speW + 6} y={speTop + 16} fill={hOn ? COL.amber : COL.dim} fontSize="11" fontWeight="700">
              SPE
            </text>
            <text x={speX + speW + 6} y={speTop + 28} fill={COL.amber} fontSize="10">
              h
            </text>
            <line
              x1={speX + speW}
              y1={PY}
              x2={PX - 70}
              y2={PY}
              stroke={COL.amber}
              strokeWidth="1.1"
              strokeDasharray="3 3"
            />
          </g>
          <g {...loopBoxHit(hit("ske").onPick)}>
            <rect
              x={skeX}
              y={skeY}
              width={skeMaxW}
              height={skeH}
              rx="3"
              fill="#102028"
              stroke={COL.cyan}
              strokeWidth={vOn ? 2 : 1.3}
              strokeDasharray={vOn ? undefined : "4 3"}
            />
            <rect
              x={skeX + 2}
              y={skeY + 2}
              width={Math.max(4, skeFillW - 2)}
              height={skeH - 4}
              rx="2"
              fill={COL.cyan}
              opacity="0.55"
              stroke="none"
            />
            <text x={skeX} y={skeY - 5} fill={vOn ? COL.cyan : COL.dim} fontSize="11" fontWeight="700">
              SKE
            </text>
            <text x={skeX + 36} y={skeY - 5} fill={COL.dim} fontSize="10">
              {t("½ V²")}
            </text>
          </g>
          <g transform={`translate(${PX} ${PY}) scale(${planeScale})`} color={COL.amber} pointerEvents="none">
            <TecsPlane />
          </g>
          <g pointerEvents="none">
            <line
              x1={noseX}
              y1={PY}
              x2={noseX + vArrow}
              y2={PY}
              stroke={COL.cyan}
              strokeWidth="2"
              markerEnd="url(#tecsArrC)"
            />
          </g>
          <LoopLiveBox
            x={speX + speW + 8}
            y={86}
            w={132}
            h={56}
            stroke={COL.amber}
            title={`1 · ${t("height")}`}
            value={s.alt == null ? "—" : `${fmt(s.alt, 0)} m`}
            pick={(p) => (p.alt != null && p.alt_tar != null ? p.alt - p.alt_tar : p.alt)}
            fit="abs"
            spanMin={8}
            mark="later"
            {...hit("herr")}
          />
          <LoopLiveBox
            x={skeX}
            y={PY + 32}
            w={132}
            h={52}
            stroke={COL.cyan}
            title="2 · V"
            value={s.aspd == null ? "—" : `${fmt(s.aspd, 1)} m/s`}
            pick={(p) => {
              const v = p.aspd;
              const c = p.params.AIRSPEED_CRUISE;
              if (v == null) return null;
              return c == null || Number.isNaN(c) ? v : v - c;
            }}
            fit="abs"
            spanMin={4}
            mark="later"
            {...hit("aspd")}
          />
          <path
            d={`M ${speX + speW} ${tcCy} H ${knobX}`}
            fill="none"
            stroke={addOn ? COL.amber : COL.line}
            strokeWidth="1.4"
          />
          <path
            d={`M ${skeRight} ${skeY} V ${tcCy} H ${knobX}`}
            fill="none"
            stroke={addOn ? COL.cyan : COL.line}
            strokeWidth="1.4"
          />
          <circle cx={skeRight} cy={tcCy} r="3.5" fill={addOn ? COL.amber : COL.line} stroke="#0c0e11" strokeWidth="1" />
          <text x={skeRight} y={tcCy - 10} textAnchor="middle" fill={addOn ? COL.amber : COL.dim} fontSize="11" fontWeight="700">
            Σ {t("add")}
          </text>
          <path
            d={`M ${knobX + tcW} ${tcCy} H 546`}
            fill="none"
            stroke={addOn ? COL.amber : COL.line}
            strokeWidth="1.4"
            markerEnd="url(#tecsArrA)"
          />
          <LoopChip
            x={knobX}
            y={tcY}
            w={tcW}
            h={tcH}
            title="TIME_CONST"
            value={tc == null ? "—" : `${fmt(tc, 1)} s`}
            stroke={COL.amber}
            mark="later"
            {...hit("ste")}
          />
          <LoopChip
            x={knobX}
            y={92}
            w={124}
            h={28}
            title="W"
            value={fmt(w, 1)}
            stroke={COL.amber}
            mark="tune"
            {...hit("w")}
          />
          <g {...loopBoxHit(hit("w").onPick)}>
            <rect x={wX0 - 10} y={wY - 16} width={wX2 - wX0 + 20} height={36} fill="transparent" />
            <line
              x1={wX0}
              y1={wY}
              x2={wX2}
              y2={wY}
              stroke={wOn ? COL.amber : COL.line}
              strokeWidth={wOn ? 2.2 : 1.5}
            />
            <line x1={wX0} y1={wY - 6} x2={wX0} y2={wY + 6} stroke={COL.dim} strokeWidth="1.3" />
            <line x1={(wX0 + wX2) / 2} y1={wY - 4} x2={(wX0 + wX2) / 2} y2={wY + 4} stroke={COL.dim} strokeWidth="1.1" />
            <line x1={wX2} y1={wY - 6} x2={wX2} y2={wY + 6} stroke={COL.dim} strokeWidth="1.3" />
            <circle cx={wX0} cy={wY} r="4.5" fill={COL.amber} stroke="#0c0e11" strokeWidth="1.1" />
            <circle cx={wX2} cy={wY} r="4.5" fill={COL.cyan} stroke="#0c0e11" strokeWidth="1.1" />
            <polygon
              points={`${wFx},${wY - 9} ${wFx - 7},${wY + 5} ${wFx + 7},${wY + 5}`}
              fill={COL.amber}
              stroke="#0c0e11"
              strokeWidth="1"
            />
            <text x={wX0} y={wY + 18} textAnchor="middle" fill={COL.dim} fontSize="10">
              0
            </text>
            <text x={wX2} y={wY + 18} textAnchor="middle" fill={COL.dim} fontSize="10">
              2
            </text>
          </g>
          <path
            d={`M ${knobX + 124} 106 L 522 106 L 546 118`}
            fill="none"
            stroke={wOn ? COL.amber : COL.line}
            strokeWidth="1.4"
            markerEnd="url(#tecsArrA)"
          />
          <text x="498" y="98" fill={wOn ? COL.amber : COL.dim} fontSize="11" fontWeight="700">
            {t("trade")}
          </text>
          <LoopLiveBox
            x={548}
            y={16}
            w={336}
            h={68}
            stroke={COL.amber}
            title={`3 · ${t("throttle")}`}
            sub={`STE ${fmt(ste, 0)} · ${t("total → throttle")}`}
            value={`${fmt(s.thr_out, 0)}%`}
            pick={(p) => p.thr_out}
            mark="later"
            {...hit("thr")}
          />
          <LoopLiveBox
            x={548}
            y={96}
            w={336}
            h={68}
            stroke={COL.amber}
            title={`4 · ${t("desired pitch")}`}
            sub={`SEB ${fmt(seb, 0)} · nav_pitch`}
            value={`${fmt(s.pitch_tar, 1)}°`}
            pick={(p) => p.pitch_tar}
            mark="later"
            {...hit("pitch")}
          />
          <LoopLiveBox
            x={548}
            y={176}
            w={160}
            h={68}
            stroke={COL.cyan}
            title={t("plant")}
            sub={t("engine / air")}
            value={s.aspd == null ? "—" : `${fmt(s.aspd, 1)} m/s`}
            pick={(p) => p.aspd}
            mark="struct"
            {...hit("plant")}
          />
          <LoopLiveBox
            x={724}
            y={176}
            w={160}
            h={68}
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
        <SchemeKnobs node={knobNode} gains={knobs} picked={pick} quiet />
        <SchemeDoc lines={tecsDoc(t, pick)} href={TECS_WIKI} wiki={t("TECS speed/height")} />
      </div>
    </div>
  );
}
