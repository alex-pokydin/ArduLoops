import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { channelOf } from "../lib/radio";
import { getLatest, getSetupSnapshot, subscribe } from "../mav/store";
import { useStorePicked } from "../mav/view";
import { type WizardClose } from "../wizards/close";
import { readPack } from "./BatteryStep";
import { Icon, Toggle } from "./MotorSetup";
import { NumField, SelectField, StepFooter, SwitchField, pnum, useParamDraft } from "./OutputSetup";
import { SensorWizard } from "./SensorWizard";
import { StepPreArm } from "./StepPreArm";

const GUIDE = "https://ardupilot.org/copter/docs/failsafe-landing-page.html";
const okPwm = (v: number | undefined): v is number => typeof v === "number" && v >= 800 && v <= 2200;

/** ArduPilot's own value names (Parameters.cpp, AP_BattMonitor_Params.cpp). */
const OPT = {
  copterRadio: [[0, "Disabled"], [1, "Return home"], [2, "Keep the mission in Auto"], [3, "Land"], [4, "SmartRTL or RTL"], [5, "SmartRTL or Land"], [6, "Auto landing or RTL"], [7, "Brake or Land"]],
  copterBatt: [[0, "Warn only"], [1, "Land"], [2, "Return home"], [3, "SmartRTL or RTL"], [4, "SmartRTL or Land"], [5, "Terminate"], [6, "Auto landing or RTL"], [7, "Brake or Land"]],
  copterGcs: [[0, "Disabled"], [1, "Return home"], [3, "SmartRTL or RTL"], [4, "SmartRTL or Land"], [5, "Land"], [6, "Auto landing or RTL"], [7, "Brake or Land"]],
  copterEkf: [[1, "Land"], [2, "AltHold"], [3, "Land, even in Stabilize"]],
  planeRadio: [[0, "Disabled"], [1, "Enabled"], [2, "Detect only"]],
  planeShort: [[0, "Circle, or keep the mission"], [1, "Circle"], [2, "Level, throttle off"], [3, "Disabled"], [4, "FBWB"]],
  planeLong: [[0, "Keep going"], [1, "Return home"], [2, "Glide"], [3, "Parachute"], [4, "Auto"], [5, "Autoland"]],
  planeBatt: [[0, "Warn only"], [1, "Return home"], [2, "Land"], [3, "Terminate"], [4, "QLand"], [5, "Parachute"], [6, "Loiter to QLand"], [7, "Autoland or RTL"]],
  planeGcs: [[0, "Disabled"], [1, "Heartbeat"], [2, "Heartbeat and remote RSSI"], [3, "Heartbeat, in Auto too"]],
} satisfies Record<string, [number, string][]>;


/** The receiver as the radio failsafe sees it: enough live channels, and the throttle above the failsafe value. */
function radioNow(s: ReturnType<typeof getLatest>, thrCh: number, fsValue: number | null): { signal: boolean; thr: number | null; tripped: boolean } {
  const rc = s.rc ?? [];
  const count = s.live_nums?.["RC_CHANNELS.chancount"];
  const signal = !!s.ok && (typeof count !== "number" || count > 0) && rc.filter(okPwm).length >= 4;
  const v = rc[thrCh - 1];
  const thr = okPwm(v) ? v : null;
  return { signal, thr, tripped: !signal || (fsValue != null && thr != null && thr < fsValue) };
}

/** One live trigger: the value now against the point where the failsafe starts. */
function Gauge({ label, value, text, lo, hi, at, tripped, dim }: { label: string; value: number | null; text: string; lo: number; hi: number; at: number | null; tripped: boolean; dim?: boolean }) {
  const p = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo || 1)) * 100))}%`;
  return (
    <div className={`fs-g${tripped ? " hot" : ""}${dim ? " dim" : ""}`}>
      <div className="fs-g-head"><b>{label}</b><span>{text}</span></div>
      <span className="fs-g-bar">
        {at != null ? <i style={{ left: p(at) }} /> : null}
        {value != null ? <em style={{ left: p(value) }} /> : null}
      </span>
    </div>
  );
}

/**
 * Failsafes: what each failsafe watches, live, against where it starts (left), then what the vehicle does for each
 * (numbered jobs), and the settings as a draft. The radio failsafe has a real test: switch the transmitter off.
 */
export function FailsafeStep({ frame }: { frame: "copter" | "plane" }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const live = useSyncExternalStore(subscribe, getLatest, getLatest);
  const armed = useStorePicked((s) => !!s.armed);
  const params = sample.params || {};
  const draft = useParamDraft(params);
  const [test, setTest] = useState(false);
  const plane = frame === "plane";
  const thrCh = channelOf(params, "throttle");
  const fsValueName = plane ? "THR_FS_VALUE" : "FS_THR_VALUE";
  const fsValue = pnum(params, fsValueName);
  const radio = radioNow(live, thrCh, fsValue);
  const pack = readPack(live.live_nums);
  const low = pnum(params, "BATT_LOW_VOLT");
  const crit = pnum(params, "BATT_CRT_VOLT");
  const nums = live.live_nums ?? {};
  const ekfVars = ["velocity_variance", "pos_horiz_variance", "compass_variance"].map((f) => nums[`EKF_STATUS_REPORT.${f}`]).filter((x): x is number => typeof x === "number");
  const ekf = ekfVars.length ? Math.max(...ekfVars) : null;
  const ekfThresh = pnum(params, "FS_EKF_THRESH");

  const battList = plane ? OPT.planeBatt : OPT.copterBatt;

  const gcsName = plane ? "FS_GCS_ENABL" : "FS_GCS_ENABLE";


  return (
    <div className="frs">
      <StepPreArm step="failsafe" />
      {!sample.ok ? <div className="frs-note info">{t("Connect a vehicle to read its failsafes.")}</div> : null}
      <div className="ms-top">
        <div className="ms-art fs-art-col">
          <Gauge label={t("Radio")} value={radio.signal ? radio.thr : null} text={!live.ok ? "—" : !radio.signal ? t("No signal") : t("CH{n} {v} µs · trips below {f}", { n: thrCh, v: radio.thr ?? "—", f: fsValue ?? "—" })} lo={850} hi={2100} at={fsValue} tripped={live.ok && radio.tripped} />
          {draft.value("BATT_FS_LOW_ACT") != null ? (
            <Gauge label={t("Battery")} value={pack.volts != null && pack.volts >= 3 ? pack.volts : null} text={pack.volts != null && pack.volts >= 3 ? t("{v} V · low {l} V · critical {c} V", { v: pack.volts.toFixed(1), l: low != null ? +low.toFixed(2) : "—", c: crit != null ? +crit.toFixed(2) : "—" }) : t("No pack")} lo={(crit ?? 10) * 0.9} hi={Math.max((low ?? 12) * 1.25, pack.volts ?? 0)} at={low} tripped={pack.volts != null && pack.volts >= 3 && low != null && low > 0 && pack.volts < low} dim={!(pack.volts != null && pack.volts >= 3)} />
          ) : null}
          {!plane ? <Gauge label={t("EKF")} value={ekf} text={ekf != null ? t("variance {v} · trips above {f}", { v: ekf.toFixed(2), f: ekfThresh != null ? +ekfThresh.toFixed(2) : "—" }) : "—"} lo={0} hi={Math.max(1, ekfThresh ?? 0.8)} at={ekfThresh} tripped={ekf != null && ekfThresh != null && ekfThresh > 0 && ekf > ekfThresh} /> : null}
          <span>{t("Live: what each failsafe watches, against where it starts")}</span>
        </div>
        <div className="ms-cards">
          <div className="ms-card">
            <div className="ms-card-head">
              <b>{t("Settings")}</b>
              <button type="button" className="frs-btn quiet" disabled={!live.ok || live.armed || !radio.signal} title={t("Switch the transmitter off and see the board notice. Propellers off.")} onClick={() => setTest(true)}>{t("Test radio failsafe")}</button>
            </div>
            {plane ? (
              <>
                <SelectField draft={draft} name="THR_FAILSAFE" label="Radio failsafe" options={OPT.planeRadio} />
                <NumField draft={draft} name="THR_FS_VALUE" label="Throttle failsafe value" unit="µs" />
                <SelectField draft={draft} name="FS_SHORT_ACTN" label="Short radio loss" options={OPT.planeShort} />
                <NumField draft={draft} name="FS_SHORT_TIMEOUT" label="Short loss after" unit="s" step={0.5} />
                <SelectField draft={draft} name="FS_LONG_ACTN" label="Long radio loss" options={OPT.planeLong} />
                <NumField draft={draft} name="FS_LONG_TIMEOUT" label="Long loss after" unit="s" />
              </>
            ) : (
              <>
                <SelectField draft={draft} name="FS_THR_ENABLE" label="Radio lost" options={OPT.copterRadio} />
                <NumField draft={draft} name="FS_THR_VALUE" label="Throttle failsafe value" unit="µs" />
              </>
            )}
            <SelectField draft={draft} name="BATT_FS_LOW_ACT" label="Battery low" options={battList} />
            <SelectField draft={draft} name="BATT_FS_CRT_ACT" label="Battery critical" options={battList} />
            <SelectField draft={draft} name={gcsName} label="Ground station lost" options={plane ? OPT.planeGcs : OPT.copterGcs} />
            {!plane ? (
              <>
                <SelectField draft={draft} name="FS_EKF_ACTION" label="EKF unhealthy" options={OPT.copterEkf} />
                <NumField draft={draft} name="FS_EKF_THRESH" label="EKF threshold" step={0.1} />
                <SwitchField draft={draft} name="FS_CRASH_CHECK" label="Disarm after a crash" />
              </>
            ) : null}
            <span className="ms-hint">{t(plane ? "Battery levels are set on the Battery step. RTL needs GPS." : "Battery levels are set on the Battery step. RTL needs a position.")}</span>
          </div>
        </div>
      </div>
      {test ? <RadioFailsafeTest frame={frame} onClose={() => setTest(false)} /> : null}
      <StepFooter draft={draft} armed={armed} ok={sample.ok} guide={GUIDE} guideLabel="Failsafe landing page" rebootNames={[]} />
    </div>
  );
}

/**
 * Switch the transmitter off and see the board notice: the receiver stops sending, or sends its failsafe throttle
 * below the failsafe value. A receiver that keeps the last sticks would never trip it, and is the case this catches.
 */
export function RadioFailsafeTest({ frame, onClose, fromAssistant }: { frame: "copter" | "plane"; onClose: (report?: WizardClose) => void; fromAssistant?: boolean }) {
  const t = useT();
  const s = useSyncExternalStore(subscribe, getLatest, getLatest);
  const params = s.params ?? {};
  const thrCh = channelOf(params, "throttle");
  const fsValue = pnum(params, frame === "plane" ? "THR_FS_VALUE" : "FS_THR_VALUE");
  const radio = radioNow(s, thrCh, fsValue);
  const [props, setProps] = useState(false);
  const [phase, setPhase] = useState<"ready" | "off" | "on" | "done">("ready");
  const [how, setHow] = useState<"stopped" | "low" | null>(null);
  const [waited, setWaited] = useState(0);
  const since = useRef(0);

  useEffect(() => {
    if (phase === "off" && radio.tripped) {
      setHow(!radio.signal ? "stopped" : "low");
      setPhase("on");
    } else if (phase === "on" && !radio.tripped) {
      setPhase("done");
    }
  }, [phase, radio.tripped, radio.signal]);
  useEffect(() => {
    if (phase !== "off") return;
    since.current = Date.now();
    const id = window.setInterval(() => setWaited((Date.now() - since.current) / 1000), 500);
    return () => window.clearInterval(id);
  }, [phase]);
  const leave = () => onClose({ outcome: phase === "done" ? "completed" : "cancelled", measures: { tripped: how ?? "no", FS_VALUE: fsValue } });

  let body;
  let footer;
  if (phase === "ready") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Test the radio failsafe")}</h3><p>{t("Switch the transmitter off and see the board notice within a second or two. Nothing is armed or written.")}</p></div>
        <div className="mw-checks">
          <span className={s.ok ? "ok" : "bad"}>{s.ok ? Icon.check("var(--ok)", 12) : Icon.x("var(--hot)", 12)}{t(s.ok ? "Connected" : "No link")}</span>
          <span className={s.armed ? "bad" : "ok"}>{s.armed ? Icon.x("var(--hot)", 12) : Icon.check("var(--ok)", 12)}{t(s.armed ? "Armed" : "Disarmed")}</span>
          <span className={radio.signal ? "ok" : "bad"}>{radio.signal ? Icon.check("var(--ok)", 12) : Icon.x("var(--hot)", 12)}{t(radio.signal ? "Receiver sending" : "No signal")}</span>
        </div>
        {s.rc_override ? <div className="mw-note warn">{Icon.warn()}<span>{t("Virtual sticks are overriding the receiver. Release them on the Radio step first.")}</span></div> : null}
      </>
    );
    footer = (<><button type="button" className="mw-btn text" onClick={leave}>{t("Cancel")}</button><button type="button" className="mw-btn primary" disabled={!props || !s.ok || s.armed || !radio.signal || !!s.rc_override} onClick={() => setPhase("off")}><span>{t("Start")}</span>{Icon.chevR()}</button></>);
  } else if (phase === "off") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Switch the transmitter off")}</h3><p>{t("Now. The board should see the signal go within a second or two.")}</p></div>
        <div className="mw-note ok"><i className="sw-dot" /><span>{radio.thr != null ? t("Throttle CH{n} at {v} µs · failsafe below {f}", { n: thrCh, v: radio.thr, f: fsValue ?? "—" }) : t("No signal")}</span></div>
        {waited > 6 ? <div className="sw-fail"><b>{t("Still no failsafe after {n} s.", { n: Math.round(waited) })}</b><p>{t("If the transmitter is off, the receiver keeps sending the last sticks. Set the receiver's failsafe to no pulses (or throttle below {f} µs), then test again.", { f: fsValue ?? 975 })}</p></div> : null}
      </>
    );
    footer = (<><button type="button" className="mw-btn text" onClick={leave}>{t("Cancel")}</button><span /></>);
  } else if (phase === "on") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Failsafe seen. Switch the transmitter back on.")}</h3><p>{t(how === "stopped" ? "The receiver stopped sending: ArduPilot treats that as radio loss." : "The receiver sent its failsafe throttle, below the failsafe value: ArduPilot treats that as radio loss.")}</p></div>
        <div className="mw-note ok">{Icon.check("var(--ok)", 14)}<span>{t("Radio loss detected.")}</span></div>
      </>
    );
    footer = (<><span /><span className="mw-dim mw-sm">{t("Waiting for the signal to come back…")}</span></>);
  } else {
    body = <div className="mw-headline"><h3>{t("The radio failsafe works")}</h3><p>{t("Loss and return both seen. In flight, the vehicle does what Radio lost is set to.")}</p></div>;
    footer = (<><span /><button type="button" className="mw-btn primary" onClick={leave}>{t("Close")}</button></>);
  }
  return (
    <SensorWizard
      title={t("Radio failsafe test")}
      fromAssistant={fromAssistant}
      steps={[t("Ready"), t("Transmitter off"), t("Back on")]}
      step={phase === "ready" ? 0 : phase === "off" ? 1 : 2}
      left={phase === "ready" ? <div className="mw-safety"><Toggle on={props} icon={Icon.propOff} label={t("Propellers off")} sub={t("On every motor")} onToggle={() => setProps(!props)} /></div> : (
        <div className="sw-art"><div className={`fs-big ${phase === "off" ? "" : "hot"}`}>{phase === "off" ? t("Signal") : phase === "on" ? t("Lost") : t("Back")}</div></div>
      )}
      body={body}
      footer={footer}
      blocker={!s.ok ? "lost" : s.armed ? "armed" : null}
      busy={false}
      onClose={leave}
    />
  );
}
