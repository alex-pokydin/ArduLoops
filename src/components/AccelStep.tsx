import { useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { describeDevice } from "../lib/sensorIds";
import { APP_HTTP } from "../mav/link";
import { getLatest, getSetupSnapshot, subscribe } from "../mav/store";
import { useStorePicked } from "../mav/view";
import { AccelOrient } from "./AccelOrient";
import { AccelWizard } from "./CalibrationPanel";
import { ORIENT_IDS, orientLabel } from "./compass-orient";
import { NumField, SelectField, StepFooter, pnum, useParamDraft } from "./OutputSetup";
import { StepPreArm } from "./StepPreArm";

const GUIDE = "https://ardupilot.org/copter/docs/common-accelerometer-calibration.html";
const G = 9.80665;
const DEG = Math.PI / 180;

const ORIENTATIONS: [number, string][] = ORIENT_IDS.map((id) => [id, orientLabel(id)]);
const GYRO_CAL: [number, string][] = [[0, "Never"], [1, "Every boot"]];
const IMU_MSG = ["SCALED_IMU", "SCALED_IMU2", "SCALED_IMU3"] as const;

/** Parameter name for IMU n: `INS_ACCOFFS_X`, `INS_ACC2OFFS_X`, … */
function insName(n: number, stem: "OFFS" | "SCAL" | "_ID", axis = ""): string {
  const base = n === 1 ? "INS_ACC" : `INS_ACC${n}`;
  return `${base}${stem}${axis ? `_${axis}` : ""}`;
}

/** An IMU whose offsets are all zero and scales all one has never been through the six-side calibration. */
function calibrated(params: Record<string, number>, n: number): boolean | null {
  const ofs = ["X", "Y", "Z"].map((a) => pnum(params, insName(n, "OFFS", a)));
  const scl = ["X", "Y", "Z"].map((a) => pnum(params, insName(n, "SCAL", a)));
  if (ofs.some((v) => v == null)) return null;
  return ofs.some((v) => Math.abs(v as number) > 1e-4) || scl.some((v) => v != null && Math.abs(v - 1) > 1e-4);
}

function Horizon({ roll, pitch }: { roll: number; pitch: number }) {
  return (
    <svg className="acs-horizon" viewBox="0 0 120 120" aria-hidden="true">
      <defs><clipPath id="acs-hc"><circle cx="60" cy="60" r="54" /></clipPath></defs>
      <g clipPath="url(#acs-hc)">
        <g transform={`rotate(${-roll} 60 60) translate(0 ${Math.max(-40, Math.min(40, pitch * 2))})`}>
          <rect x="-60" y="-60" width="240" height="120" className="acs-sky" />
          <rect x="-60" y="60" width="240" height="120" className="acs-ground" />
          <line x1="-60" y1="60" x2="180" y2="60" className="acs-line" />
        </g>
      </g>
      <circle cx="60" cy="60" r="54" className="acs-rim" />
      <path d="M34 60h18M68 60h18M60 56v8" className="acs-mark" />
    </svg>
  );
}

type Imu = { n: number; name: string; where: string; temp: number | null; diff: number | null; use: boolean };

/**
 * Accelerometer: board orientation with a live horizon, the six-side calibration, the level trim, and each IMU
 * with its temperature and whether it agrees with the first one. Edits are a draft; calibrations run at once.
 */
export function AccelStep() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const live = useSyncExternalStore(subscribe, getLatest, getLatest);
  const armed = useStorePicked((s) => !!s.armed);
  const params = sample.params || {};
  const draft = useParamDraft(params);
  const [wizard, setWizard] = useState(false);
  const [detect, setDetect] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fresh = typeof live.heartbeat_at === "number" && Date.now() / 1000 - live.heartbeat_at < 3;
  const ready = live.ok && !live.armed && fresh;
  const roll = Number.isFinite(live.roll) ? live.roll : 0;
  const pitch = Number.isFinite(live.pitch) ? live.pitch : 0;
  const nums = live.live_nums ?? {};

  const threshold = pnum(params, "ARMING_ACCTHRESH") ?? 0.75;
  const accOf = (msg: string) => {
    const v = ["xacc", "yacc", "zacc"].map((k) => nums[`${msg}.${k}`]);
    return v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v as number[]) : null;
  };
  const first = accOf(IMU_MSG[0]);
  const imus: Imu[] = [1, 2, 3].flatMap((n) => {
    const dev = describeDevice(pnum(params, insName(n, "_ID")), "imu");
    if (!dev) return [];
    const acc = accOf(IMU_MSG[n - 1]);
    const temp = nums[`${IMU_MSG[n - 1]}.temperature`];
    const diff = n > 1 && first && acc ? (Math.hypot(acc[0] - first[0], acc[1] - first[1], acc[2] - first[2]) * G) / 1000 : null;
    const use = pnum(params, n === 1 ? "INS_USE" : `INS_USE${n}`);
    return [{ n, name: dev.name, where: dev.where, temp: typeof temp === "number" && temp !== 0 ? temp / 100 : null, diff, use: use !== 0 }];
  });
  const cal = calibrated(params, 1);
  const ofs = ["X", "Y", "Z"].map((a) => pnum(params, insName(1, "OFFS", a)));
  const sideways = live.ok && (Math.abs(roll) > 60 || Math.abs(pitch) > 60);

  async function run(kind: "level" | "gyro" | "baro") {
    if (!ready || busy) return;
    setBusy(kind);
    try {
      const response = await fetch(`${APP_HTTP}/calibrate?kind=${kind}`, { method: "POST" });
      const result = (await response.json()) as { message?: string };
      addLog(t(result.message || "Could not send calibration command"), response.ok ? "ok" : "bad");
    } catch {
      addLog(t("Connection lost during calibration"), "bad");
    } finally {
      setBusy(null);
    }
  }

  const orient = pnum(params, "AHRS_ORIENTATION");
  const trimX = pnum(params, "AHRS_TRIM_X");
  const trimY = pnum(params, "AHRS_TRIM_Y");
  const trimmed = trimX != null && trimY != null && (Math.abs(trimX) > 1e-4 || Math.abs(trimY) > 1e-4);
  const wizRow = (state: "done" | "warn" | "todo", title: string, detail: string, label: string, onClick: () => void, primary = false) => (
    <div className="ms-wstep">
      <span className={`ms-dot ${state === "todo" ? "" : state}`} />
      <span className="ms-wstep-copy"><b>{t(title)}</b><span>{detail}</span></span>
      <button type="button" className={`frs-btn ${primary ? "primary sm" : "quiet"}`} disabled={!ready || !!busy} onClick={onClick}>{label}</button>
    </div>
  );

  return (
    <div className="frs">
      <StepPreArm step="level" />
      {!sample.ok ? <div className="frs-note info">{t("Connect a vehicle to read its accelerometers.")}</div> : null}
      <div className="ms-top">
        <div className="ms-art acs-art">
          <Horizon roll={live.ok ? roll : 0} pitch={live.ok ? pitch : 0} />
          <span className={sideways ? "warn" : ""}>{live.ok ? t("Roll {roll}° · pitch {pitch}°", { roll: roll.toFixed(1), pitch: pitch.toFixed(1) }) : t("Live attitude")}</span>
        </div>
        <div className="ms-cards">
          <div className="ms-card">
            <div className="ms-card-head">
              <b>{t("Calibration")}</b>
              <span className="ms-fix">{t("Propellers off, vehicle still")}</span>
            </div>
            {orient == null ? null : wizRow(
              sideways ? "warn" : "done",
              "Orientation",
              sideways ? t("{name} · reads more than 60° off level at rest", { name: orientLabel(Math.round(orient)) }) : t("{name} · reads level", { name: orientLabel(Math.round(orient)) }),
              t("Detect"),
              () => setDetect(true),
            )}
            {cal == null ? null : wizRow(
              cal ? "done" : "warn",
              "Six-side calibration",
              cal && ofs.every((v) => v != null) ? `INS_ACCOFFS ${ofs.map((v) => (v as number).toFixed(2)).join(", ")} m/s²` : t("Not done on this board. ArduPilot will not arm until it is."),
              t(cal ? "Recalibrate" : "Calibrate"),
              () => setWizard(true),
              !cal,
            )}
            {trimX == null || trimY == null ? null : wizRow(
              trimmed ? "done" : "todo",
              "Level",
              trimmed ? t("Trim roll {x}° · pitch {y}°", { x: (trimX / DEG).toFixed(1), y: (trimY / DEG).toFixed(1) }) : t("No trim stored. Set it with the vehicle level on its legs."),
              busy === "level" ? t("Calibrating…") : t("Set level"),
              () => void run("level"),
            )}
            <span className="ms-hint">{t("Tilt the nose down: pitch should go negative. Roll right: roll should go positive.")}</span>
          </div>
          <div className="ms-card">
            <div className="ms-card-head"><b>{t("Settings")}</b></div>
            <SelectField draft={draft} name="AHRS_ORIENTATION" label="Orientation" options={ORIENTATIONS} />
            <NumField draft={draft} name="AHRS_TRIM_X" label="Roll trim" unit="°" scale={DEG} step={0.1} />
            <NumField draft={draft} name="AHRS_TRIM_Y" label="Pitch trim" unit="°" scale={DEG} step={0.1} />
            <SelectField draft={draft} name="INS_GYR_CAL" label="Gyro calibration" options={GYRO_CAL} />
          </div>
        </div>
      </div>

      <h4 className="sov-sect pas-sect">
        <span>{t("IMUs")}</span>
        <span className="pas-src">{t("each against IMU 1 · ArduPilot will not arm over {n} m/s² (ARMING_ACCTHRESH)", { n: threshold })}</span>
      </h4>
      {imus.length ? (
        <div className="cps-table" role="table">
          <div className="acs-tr head" role="row"><span>#</span><span>{t("Sensor")}</span><span>{t("Temperature")}</span><span>{t("Agreement")}</span></div>
          {imus.map((imu) => {
            const off = imu.diff != null && imu.diff > threshold;
            return (
              <div key={imu.n} className={`acs-tr${imu.use ? "" : " off"}`} role="row">
                <span className="cps-n">{imu.n}</span>
                <span className="cps-sensor"><b>{imu.name}</b><span>{imu.where}</span></span>
                <span>{imu.temp != null ? `${imu.temp.toFixed(0)} °C` : "—"}</span>
                <span className={`cps-cal${off ? " warn" : ""}`}>
                  <span className={`ms-dot ${!imu.use ? "" : off ? "warn" : "done"}`} />
                  {!imu.use ? t("not used") : imu.n === 1 ? t("reference") : imu.diff == null ? "—" : off ? t("differs by {n} m/s²", { n: imu.diff.toFixed(2) }) : t("agrees")}
                </span>
              </div>
            );
          })}
        </div>
      ) : <span className="ms-hint">{t("Waiting for the IMU parameters.")}</span>}
      <div className="acs-actions">
        <button type="button" className="frs-btn quiet" disabled={!ready || !!busy} onClick={() => void run("gyro")}>
          {busy === "gyro" ? t("Calibrating…") : t("Calibrate gyro")}
        </button>
        <button type="button" className="frs-btn quiet" disabled={!ready || !!busy} onClick={() => void run("baro")}>
          {busy === "baro" ? t("Calibrating…") : t("Calibrate barometer")}
        </button>
        <span className="ms-hint">{t("Gyros calibrate by themselves at boot when Gyro calibration is Every boot.")}</span>
      </div>

      {wizard ? <AccelWizard ready={ready} onClose={() => setWizard(false)} /> : null}
      {detect ? (
        <AccelOrient
          current={Math.round(pnum(params, "AHRS_ORIENTATION") ?? 0)}
          onPick={(id) => draft.set("AHRS_ORIENTATION", id)}
          onClose={() => setDetect(false)}
        />
      ) : null}
      <StepFooter draft={draft} armed={armed} ok={sample.ok} guide={GUIDE} guideLabel="Accelerometer calibration" rebootNames={["AHRS_ORIENTATION"]} why={t("Orientation changes need a reboot, then level again.")} />
    </div>
  );
}
