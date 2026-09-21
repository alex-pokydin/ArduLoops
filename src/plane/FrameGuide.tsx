import type { AxisFocus, Band } from "../lib/gains";
import { useT } from "../i18n/i18n";

const DIM = "#5c6b7a";
const BODY = "#8b98a8";
const AMBER = "#ffb74d";
const CYAN = "#4fc3f7";

function ink(on: boolean, hot: string, rest = DIM): string {
  return on ? hot : rest;
}

function PlaneTop() {
  return (
    <g fill="#1a1e24" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round">
      <polygon points="0,-24 -3.6,-12 3.6,-12" />
      <rect x="-3.2" y="-12" width="6.4" height="34" rx="1.8" />
      <polygon points="-34,-1 0,-9 34,-1 0,4" />
      <polygon points="-11,16 0,13 11,16 0,22" />
    </g>
  );
}

function PlaneSide() {
  return (
    <g fill="#1a1e24" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round">
      <polygon points="-26,2 -22,-13 -16,2" />
      <rect x="-26" y="-4" width="46" height="9" rx="3" />
      <polygon points="20,-3 36,-1 36,4 20,5" />
      <polygon points="-6,5 16,5 10,11 -4,11" />
    </g>
  );
}

function PlaneRear({ roll, rudder }: { roll: number; rudder: number }) {
  return (
    <g transform={`rotate(${roll})`} fill="#1a1e24" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round">
      <polygon points="-40,4 -8,-1 0,-2 8,-1 40,4 6,6.5 -6,6.5" />
      <rect x="-5" y="-7" width="10" height="14" rx="2.5" />
      <g transform={`rotate(${rudder})`}>
        <polygon points="-2.3,-6 0,-20 2.3,-6" />
      </g>
    </g>
  );
}

function Tip({ x, y, color }: { x: number; y: number; color: string }) {
  return <polygon points={`${x},${y} ${x - 8},${y - 4} ${x - 8},${y + 4}`} fill={color} stroke="none" />;
}

export function PlaneGuide({ focus, band }: { focus: AxisFocus | null; band?: Band | null }) {
  const t = useT();
  const outer = !focus && band === "outer";
  const inner = !focus && band === "inner";
  const l1 = focus === "nav" || outer;
  const steer = focus === "steer";
  const tecs = focus === "energy" || outer;
  const aspd = focus === "aspd" || focus === "mix" || tecs;
  const yaw = focus === "yaw";
  const rate = focus === "rate";
  const track = l1 || steer;
  const body = focus === "att" || rate || focus === "mix" || yaw || inner;

  const hint =
    focus === "nav"
      ? t("L1 looks at the track on the earth and asks the roll loop for a bank.")
      : focus === "energy"
        ? t("TECS: height and airspeed are one energy. Pitch and throttle share the work.")
        : focus === "att"
          ? t("Body attitude, degrees. Stick in FBWA is an angle, not a surface.")
          : focus === "rate"
            ? t("Body angular rate, °/s, into a servo. Airspeed scales how much that servo can do.")
            : focus === "yaw"
              ? t("Damper on the rudder. DAMP on gyro z; RLL from measured bank. YAW_RATE is ACRO-only.")
              : focus === "steer"
                ? t("Ground steering below GROUND_STEER_ALT. Runway, not flight.")
                : focus === "mix" || focus === "aspd"
                  ? t("Aileron, elevator, rudder, throttle, nose. Same FF at two speeds is a different machine.")
                  : t("Navigate outside: L1 and TECS. Angle and rate in the body. Airspeed is the plant.");

  return (
    <div className="frames">
      <div className={body ? "frame on cyan" : "frame"}>
        <span className="cap">{t("rear · body")}</span>
        <svg viewBox="0 0 140 100" aria-hidden="true">
          <line x1="8" y1="62" x2="132" y2="62" stroke="#3a4650" strokeDasharray="4 3" />
          {rate ? (
            <g fill="none" stroke={CYAN} strokeWidth="1.7" strokeLinecap="round">
              <path d="M 36 40 A 36 24 0 0 1 104 40" />
            </g>
          ) : null}
          {rate ? <polygon points="106,40 98,36 100,44" fill={CYAN} stroke="none" /> : null}
          <g transform="translate(70 54)" color={ink(body, CYAN, BODY)}>
            <PlaneRear roll={body && !yaw ? 16 : 0} rudder={yaw ? 22 : 0} />
          </g>
          <text x="108" y="36" fontSize="11" fill={ink(body, CYAN)}>
            {rate ? t("°/s") : "°"}
          </text>
          <text x="8" y="94" fontSize="9" fill={DIM}>
            {t("roll · pitch · yaw")}
          </text>
        </svg>
      </div>
      <div className={aspd ? "frame on amber" : "frame"}>
        <span className="cap">{t("side · TECS")}</span>
        <svg viewBox="0 0 140 100" aria-hidden="true">
          <line x1="8" y1="88" x2="132" y2="88" stroke={tecs ? AMBER : "#3a4650"} strokeWidth="1.2" />
          <g transform="translate(74 42)" color={ink(aspd, AMBER, BODY)}>
            <PlaneSide />
          </g>
          {aspd ? (
            <g stroke={CYAN} fill={CYAN} strokeWidth="1.7" strokeLinecap="round">
              <line x1="112" y1="42" x2="126" y2="42" />
              <Tip x={130} y={42} color={CYAN} />
              <text x="118" y="36" fontSize="10" fill={CYAN} stroke="none">
                V
              </text>
            </g>
          ) : (
            <text x="8" y="18" fontSize="9" fill={DIM}>
              V
            </text>
          )}
          {tecs ? (
            <g stroke={AMBER} fill={AMBER} strokeWidth="1.7" strokeLinecap="round">
              <line x1="46" y1="88" x2="46" y2="50" />
              <polygon points="46,46 42,54 50,54" stroke="none" />
              <text x="52" y="70" fontSize="10" fill={AMBER} stroke="none">
                h
              </text>
            </g>
          ) : null}
          <text x="8" y="94" fontSize="9" fill={DIM}>
            {tecs ? t("h · V") : t("m/s · scaler")}
          </text>
        </svg>
      </div>
      <div className={track ? "frame on amber" : "frame"}>
        <span className="cap">{t("top · L1")}</span>
        <svg viewBox="0 0 140 100" aria-hidden="true">
          {steer ? (
            <g stroke={ink(true, AMBER)} strokeWidth="1.25" fill="none">
              <line x1="48" y1="6" x2="48" y2="94" />
              <line x1="92" y1="6" x2="92" y2="94" />
              <line x1="70" y1="8" x2="70" y2="92" strokeDasharray="5 4" />
            </g>
          ) : null}
          {l1 && !steer ? (
            <g strokeLinecap="round" strokeLinejoin="round">
              <path
                d="M 36 96 L 36 50 L 78 42 L 112 18"
                fill="none"
                stroke={CYAN}
                strokeWidth="1.45"
              />
              <path
                d="M 91 94 A 56.6 56.6 0 0 0 78 42"
                fill="none"
                stroke={CYAN}
                strokeWidth="1.2"
                strokeDasharray="4 3"
              />
              <line x1="36" y1="80" x2="78" y2="42" stroke={AMBER} strokeWidth="1.45" fill="none" />
              <circle cx="78" cy="42" r="3" fill={AMBER} stroke="#0c0e11" strokeWidth="1" />
              <text x="84" y="40" fontSize="9" fill={AMBER}>
                L1
              </text>
              <line x1="36" y1="66" x2="36" y2="50" stroke={CYAN} strokeWidth="1.5" fill="none" />
              <polygon points="36,46 32,54 40,54" fill={CYAN} stroke="none" />
              <text x="20" y="56" fontSize="9" fill={CYAN}>
                V
              </text>
              <path d="M 36 68 A 12 12 0 0 1 45 72" fill="none" stroke={AMBER} strokeWidth="1.25" />
              <text x="48" y="80" fontSize="9" fill={AMBER}>
                Nu
              </text>
            </g>
          ) : null}
          <g
            transform={l1 && !steer ? "translate(36 80) scale(0.52)" : "translate(70 58)"}
            color={ink(track, AMBER, BODY)}
          >
            <PlaneTop />
          </g>
          <text x="8" y="94" fontSize="9" fill={DIM}>
            {steer ? t("runway") : t("track → bank")}
          </text>
        </svg>
      </div>
      <p className="frame-hint">{hint}</p>
    </div>
  );
}
