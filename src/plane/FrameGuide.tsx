import type { AxisFocus } from "../lib/gains";
import { useT } from "../i18n/i18n";

function ink(on: boolean, hot: string, rest = "#5c6b7a"): string {
  return on ? hot : rest;
}

function WingTop({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} fill="#1a1e24" stroke="#8b98a8" strokeWidth="1.4">
      <polygon points="0,-22 -28,8 0,4 28,8" />
      <polygon points="0,4 -6,18 0,14 6,18" fill="#8b98a8" stroke="none" />
    </g>
  );
}

export function PlaneGuide({ focus }: { focus: AxisFocus | null }) {
  const t = useT();
  const track = focus === "nav" || focus === "energy";
  const body = focus === "att" || focus === "rate" || focus === "mix" || focus === "yaw";
  const aspd = focus === "aspd" || focus === "mix" || focus === "energy";
  const amber = "#ffb74d";
  const cyan = "#4fc3f7";

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
          <WingTop x={72} y={58} />
          <path d="M 18 78 Q 72 28 126 78" fill="none" stroke={ink(track, amber)} strokeWidth="1.6" strokeDasharray="4 3" />
          <text x="8" y="94" fontSize="9" fill="#5c6b7a">
            {t("L1 bank")}
          </text>
        </svg>
      </div>
      <div className={aspd ? "frame on amber" : "frame"}>
        <span className="cap">{t("side · airspeed")}</span>
        <svg viewBox="0 0 140 100" aria-hidden="true">
          <line x1="8" y1="48" x2="132" y2="48" stroke="#3a4650" strokeDasharray="4 3" />
          <g transform="translate(52 48)" fill="#1a1e24" stroke="#8b98a8" strokeWidth="1.4">
            <polygon points="-16,0 28,-8 28,8" />
          </g>
          <g stroke={ink(aspd, amber)} fill={ink(aspd, amber)} strokeWidth="1.8" strokeLinecap="round">
            <line x1="88" y1="48" x2="124" y2="48" />
            <polygon points="128,48 120,44 120,52" />
          </g>
          <text x="8" y="18" fontSize="9" fill="#5c6b7a">
            V
          </text>
          <text x="8" y="94" fontSize="9" fill="#5c6b7a">
            {t("m/s · scaler")}
          </text>
        </svg>
      </div>
      <div className={body ? "frame on cyan" : "frame"}>
        <span className="cap">{t("rear · body")}</span>
        <svg viewBox="0 0 140 100" aria-hidden="true">
          <line x1="8" y1="58" x2="132" y2="58" stroke="#3a4650" strokeDasharray="4 3" />
          <g transform="translate(70 52)" fill="#1a1e24" stroke="#8b98a8" strokeWidth="1.4">
            <line x1="-40" y1="4" x2="40" y2="4" />
            <polygon points="0,-8 -8,6 8,6" />
          </g>
          <text x="108" y="38" fontSize="11" fill={ink(body, cyan)}>
            {focus === "rate" ? t("°/s") : "°"}
          </text>
          <text x="8" y="94" fontSize="9" fill="#5c6b7a">
            {t("roll · pitch · yaw")}
          </text>
        </svg>
      </div>
      <p className="frame-hint">{hint}</p>
    </div>
  );
}
