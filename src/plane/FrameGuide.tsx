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
      <div className={track ? "frame on amber" : "frame"}>
        <span className="cap">{t("top · track")}</span>
        <svg viewBox="0 0 140 100" aria-hidden="true">
          {steer ? (
            <g stroke={ink(true, AMBER)} strokeWidth="1.25" fill="none">
              <line x1="48" y1="6" x2="48" y2="94" />
              <line x1="92" y1="6" x2="92" y2="94" />
              <line x1="70" y1="8" x2="70" y2="92" strokeDasharray="5 4" />
            </g>
          ) : null}
          {l1 ? (
            <g stroke={AMBER} fill={AMBER} strokeLinecap="round">
              <line x1="8" y1="30" x2="132" y2="30" fill="none" strokeWidth="1.35" strokeDasharray="5 3" />
              <circle cx="14" cy="30" r="2.1" stroke="none" />
              <circle cx="132" cy="30" r="2.1" stroke="none" />
              <line x1="42" y1="74" x2="108" y2="30" fill="none" strokeWidth="1.5" />
              <circle cx="108" cy="30" r="3.1" stroke="#0c0e11" strokeWidth="1" />
              <text x="112" y="24" fontSize="9" stroke="none">
                L1
              </text>
              <line x1="42" y1="74" x2="51" y2="54" fill="none" strokeWidth="1.5" />
              <polygon points="52.5,50 47,56 55.5,56.5" stroke="none" />
              <text x="56" y="46" fontSize="9" stroke="none">
                V
              </text>
              <path d="M 50.1 55.7 A 20 20 0 0 1 58.6 62.9" fill="none" strokeWidth="1.25" />
              <text x="70" y="66" fontSize="9" stroke="none">
                Nu
              </text>
            </g>
          ) : null}
          <g
            transform={l1 ? "translate(42 74) rotate(24) scale(0.6)" : "translate(70 58)"}
            color={ink(track, AMBER, BODY)}
          >
            <PlaneTop />
          </g>
          <text x="8" y="94" fontSize="9" fill={DIM}>
            {steer ? t("runway") : t("Nu → bank")}
          </text>
        </svg>
      </div>
      <div className={aspd ? "frame on amber" : "frame"}>
        <span className="cap">{t("side · airspeed")}</span>
        <svg viewBox="0 0 140 100" aria-hidden="true">
          <line x1="8" y1="58" x2="132" y2="58" stroke="#3a4650" strokeDasharray="4 3" />
          <g transform="translate(58 56)" color={ink(aspd, AMBER, BODY)}>
            <PlaneSide />
          </g>
          {aspd ? (
            <g stroke={AMBER} fill={AMBER} strokeWidth="1.7" strokeLinecap="round">
              <line x1="96" y1="56" x2="124" y2="56" />
              <Tip x={128} y={56} color={AMBER} />
              <text x="118" y="50" fontSize="10" fill={AMBER} stroke="none">
                V
              </text>
              {tecs ? (
                <>
                  <line x1="58" y1="44" x2="58" y2="16" />
                  <polygon points="58,12 54,20 62,20" stroke="none" />
                  <text x="64" y="22" fontSize="10" fill={AMBER} stroke="none">
                    h
                  </text>
                </>
              ) : null}
            </g>
          ) : (
            <text x="8" y="18" fontSize="9" fill={DIM}>
              V
            </text>
          )}
          <text x="8" y="94" fontSize="9" fill={DIM}>
            {tecs ? t("h · V") : t("m/s · scaler")}
          </text>
        </svg>
      </div>
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
      <p className="frame-hint">{hint}</p>
    </div>
  );
}
