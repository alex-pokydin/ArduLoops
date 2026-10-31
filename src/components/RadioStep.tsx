import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { askAssistant } from "../lib/assistantAsk";
import { AUX_NAMES, STICKS, channelOf, endsOf, pnum, stickPos, sticksCalibrated, type Stick } from "../lib/radio";
import { noteUi, sameParam, send, writeParam } from "../mav/cmd";
import { getLatest, getSetupSnapshot, getSnapshot, subscribe } from "../mav/store";
import { type WizardClose } from "../wizards/close";
import { SensorWizard } from "./SensorWizard";
import { Icon } from "./MotorSetup";
import { StepNum } from "./OutputSetup";
import { StepPreArm } from "./StepPreArm";

/**
 * Radio: the transmitter drawn with the live sticks, then three jobs: the receiver is sending, the stick ends are
 * calibrated, each stick moves the way ArduPilot expects. The channels follow as a table. The mode switch, the radio
 * failsafe, aux functions and the receiver port are elsewhere.
 */

const okPwm = (v: number | undefined): v is number => typeof v === "number" && v >= 800 && v <= 2200;

/** While the app's virtual sticks override channels 1–4, the board reports them instead of the transmitter. */
function OverrideNote() {
  const t = useT();
  return (
    <div className="mw-note warn rs-override">
      {Icon.warn()}
      <span>{t("Virtual sticks are overriding roll, pitch, throttle and yaw (the pilot-stick panel or the assistant). The board shows them, not your transmitter.")}</span>
      <button type="button" className="mw-btn quiet" onClick={() => send({ op: "release" })}>{t("Release virtual sticks")}</button>
    </div>
  );
}

/** Mode 2 transmitter from the front. Positions are -1..1; `hl` is the stick being asked for, with an arrow toward `to`. */
export function Transmitter({ left, right, hl, to, ends, dim }: { left: [number, number]; right: [number, number]; hl?: Stick | null; to?: [number, number] | null; ends?: boolean; dim?: boolean }) {
  const t = useT();
  const G = 46;
  const gimbal = (cx: number, [x, y]: [number, number], axisX: Stick, axisY: Stick, label: string) => {
    const sx = cx + x * (G - 10);
    const sy = 92 - y * (G - 10);
    const lit = hl === axisX || hl === axisY;
    return (
      <g>
        <rect x={cx - G} y={92 - G} width={2 * G} height={2 * G} rx="12" className={`tx-well${lit ? " lit" : ""}`} />
        <line x1={cx - G + 8} y1="92" x2={cx + G - 8} y2="92" className="tx-cross" />
        <line x1={cx} y1={92 - G + 8} x2={cx} y2={92 + G - 8} className="tx-cross" />
        {ends ? <rect x={cx - G + 6} y={92 - G + 6} width={2 * G - 12} height={2 * G - 12} rx="6" className="tx-ends" /> : null}
        {lit && to ? <line x1={cx} y1="92" x2={cx + to[0] * (G - 4)} y2={92 - to[1] * (G - 4)} className="tx-arrow" markerEnd="url(#tx-arrow)" /> : null}
        <line x1={cx} y1="92" x2={sx} y2={sy} className="tx-shaft" />
        <circle cx={sx} cy={sy} r="10" className={`tx-knob${lit ? " lit" : ""}`} />
        <text x={cx} y={92 + G + 16} className="tx-label">{label}</text>
      </g>
    );
  };
  return (
    <svg viewBox="0 0 300 190" className={`tx${dim ? " dim" : ""}`} aria-hidden="true">
      <defs><marker id="tx-arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7z" className="tx-arrowhead" /></marker></defs>
      <line x1="150" y1="4" x2="150" y2="26" className="tx-antenna" />
      <rect x="6" y="24" width="288" height="156" rx="26" className="tx-body" />
      {[40, 70, 230, 260].map((x) => <rect key={x} x={x - 4} y="30" width="8" height="16" rx="3" className="tx-switch" />)}
      {gimbal(84, left, "yaw", "throttle", t("Throttle · Yaw"))}
      {gimbal(216, right, "roll", "pitch", t("Pitch · Roll"))}
    </svg>
  );
}

/** Live stick positions for the transmitter, through RCMAP and the stored ends. */
function useSticks(): { left: [number, number]; right: [number, number]; raw: Record<Stick, number | null> } {
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const params = sample.params ?? {};
  const rc = sample.rc ?? [];
  const raw = {} as Record<Stick, number | null>;
  const pos = {} as Record<Stick, number>;
  for (const s of STICKS) {
    const ch = channelOf(params, s.key);
    const v = rc[ch - 1];
    raw[s.key] = okPwm(v) ? v : null;
    pos[s.key] = stickPos(v ?? 0, endsOf(params, ch), s.key);
  }
  // Pitch forward lowers the channel, so up on the gimbal is the negative of the stick value.
  return { left: [pos.yaw, pos.throttle], right: [pos.roll, -pos.pitch], raw };
}

/** The receiver protocol from ArduPilot's own boot line ("RCInput: decoding CRSF"), when it has sent one. */
function protocolOf(texts: string[] | undefined): string | null {
  for (const line of texts ?? []) {
    const m = /RCInput: decoding (\w+)/i.exec(line);
    if (m) return m[1];
  }
  return null;
}

export function RadioStep() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const live = useSyncExternalStore(subscribe, getLatest, getLatest);
  const params = sample.params || {};
  const nums = live.live_nums ?? {};
  const sticks = useSticks();
  const [open, setOpen] = useState<null | "ends" | "directions">(null);
  const ready = live.ok && !live.armed;
  const count = nums["RC_CHANNELS.chancount"];
  const rssi = nums["RC_CHANNELS.rssi"];
  const rc = live.rc ?? [];
  const sending = live.ok && (typeof count === "number" ? count > 0 : true) && rc.filter(okPwm).length >= 4;
  const protocol = protocolOf(live.texts);
  const quality = typeof rssi === "number" && rssi < 255 ? Math.round((rssi / 254) * 100) : null;
  const linkText = [protocol, typeof count === "number" && count > 0 ? t("{n} channels", { n: count }) : null, quality != null ? t("link {n}%", { n: quality }) : null].filter(Boolean).join(" · ");
  const calibrated = sticksCalibrated(params);
  const reversed = STICKS.filter((s) => endsOf(params, channelOf(params, s.key)).reversed).map((s) => t(s.name));
  const modeCh = Math.round(pnum(params, "FLTMODE_CH") ?? pnum(params, "MODE_CH") ?? 5);
  const chans = Math.max(8, typeof count === "number" ? Math.min(16, count) : 8);
  const stickOf = (ch: number) => STICKS.find((s) => channelOf(params, s.key) === ch);
  const radioStatus = typeof nums["RADIO_STATUS.rssi"] === "number" ? {
    // SiK reports 0..254 counts; its manual gives dBm ≈ counts / 1.9 − 127.
    rssi: Math.round((nums["RADIO_STATUS.rssi"] as number) / 1.9 - 127),
    rem: Math.round((nums["RADIO_STATUS.remrssi"] ?? 0) / 1.9 - 127),
    noise: Math.round((nums["RADIO_STATUS.noise"] ?? 0) / 1.9 - 127),
    errors: nums["RADIO_STATUS.rxerrors"] ?? 0,
  } : null;

  const job = (n: number, state: "done" | "warn" | "todo", title: string, detail: string, label: string, onClick: (() => void) | null, primary = false) => (
    <div className="ms-wstep">
      <StepNum n={n} state={state} />
      <span className="ms-wstep-copy"><b>{t(title)}</b><span>{detail}</span></span>
      {onClick && label ? <button type="button" className={`frs-btn ${primary ? "primary sm" : "quiet"}`} disabled={!ready || !sending || !!live.rc_override} onClick={onClick}>{label}</button> : null}
    </div>
  );

  return (
    <div className="frs">
      <StepPreArm step="radio" />
      {!sample.ok ? <div className="frs-note info">{t("Connect a vehicle to read its radio.")}</div> : null}
      {live.ok && live.rc_override ? <OverrideNote /> : null}
      <div className="ms-top">
        <div className="ms-art rs-art">
          <Transmitter left={sticks.left} right={sticks.right} dim={!sending} />
          <span>{sending ? linkText || t("Sticks are arriving.") : t("No signal")}</span>
        </div>
        <div className="ms-cards">
          <div className="ms-card">
            <div className="ms-card-head"><b>{t("Radio")}</b><span className="ms-fix">{t("Transmitter on, propellers off")}</span></div>
            {job(1, sending ? "done" : "warn", "Receiver", sending ? linkText || t("Sticks are arriving.") : t("Nothing from the receiver"), "", null)}
            {!sending && live.ok ? (
              <div className="rs-check">
                <span>{t("Transmitter on, and the model selected on it")}</span>
                <span>{t("Receiver bound: its light is solid, not blinking")}</span>
                <span>{t("Receiver on the port ArduPilot reads (SERIALn_PROTOCOL 23)")}</span>
                <button type="button" className="setup-fix" onClick={() => askAssistant(t("The board gets nothing from my RC receiver. Check the receiver port, protocol and RCMAP, and tell me what to check on the receiver."))}>{t("Find the receiver")}</button>
              </div>
            ) : null}
            {job(2, calibrated ? "done" : sending ? "warn" : "todo", "Stick ends", !sending ? t("Needs a signal") : calibrated ? t("Calibrated") : t("ArduPilot's defaults, 1100 to 1900: not calibrated"), t("Calibrate"), () => setOpen("ends"), !calibrated)}
            {job(3, reversed.length ? "done" : "todo", "Directions", !sending ? t("Needs a signal") : reversed.length ? t("Reversed: {list}", { list: reversed.join(", ") }) : t("Check that each stick moves the way ArduPilot expects."), t("Check"), () => setOpen("directions"), !!calibrated && !reversed.length)}
            <span className="ms-hint">{t("The mode switch is on Flight modes; what the radio does when the signal is lost is on Failsafes.")}</span>
          </div>
          {radioStatus ? (
            <div className="ms-card">
              <div className="ms-card-head"><b>{t("Telemetry radio")}</b></div>
              <span className="rs-tel">{t("RSSI {a} dBm here · {b} dBm there · noise {n} dBm · {e} errors", { a: radioStatus.rssi, b: radioStatus.rem, n: radioStatus.noise, e: radioStatus.errors })}</span>
              <span className="ms-hint">{t("From RADIO_STATUS. Its port and speed are set by the assistant.")}</span>
            </div>
          ) : null}
        </div>
      </div>
      {sending ? (
        <>
          <h4 className="sov-sect pas-sect"><span>{t("Channels")}</span><span className="pas-src">{t("what each channel does · aux functions are set by the assistant")}</span></h4>
          <div className="cps-table" role="table">
            <div className="rs-tr head" role="row"><span>CH</span><span>{t("Function")}</span><span>{t("Now")}</span><span /><span>{t("Min · trim · max")}</span></div>
            {Array.from({ length: chans }, (_, i) => i + 1).map((ch) => {
              const e = endsOf(params, ch);
              const v = rc[ch - 1];
              const stick = stickOf(ch);
              const option = Math.round(pnum(params, `RC${ch}_OPTION`) ?? 0);
              const use = stick ? t(stick.name) : ch === modeCh ? t("Flight mode") : option ? t(AUX_NAMES[option] ?? "Option {n}", { n: option }) : "—";
              const p = (x: number) => Math.max(0, Math.min(100, ((x - 900) / 1200) * 100));
              return (
                <div key={ch} className={`rs-tr${use === "—" ? " off" : ""}`} role="row">
                  <span className="cps-n">{ch}</span>
                  <span>{use}{e.reversed ? <em className="rs-rev">{t("reversed")}</em> : null}</span>
                  <span className="rs-bar"><i style={{ left: `${p(e.min)}%`, width: `${p(e.max) - p(e.min)}%` }} /><b style={{ left: `${p(e.trim)}%` }} />{okPwm(v) ? <em style={{ left: `${p(v)}%` }} /> : null}</span>
                  <span className="mono">{okPwm(v) ? v : "—"}</span>
                  <span className="mw-dim">{`${Math.round(e.min)} · ${Math.round(e.trim)} · ${Math.round(e.max)}`}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
      {open === "ends" ? <RadioEndsWizard onClose={() => setOpen(null)} onNext={() => setOpen("directions")} /> : null}
      {open === "directions" ? <RadioDirectionsWizard onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

async function writeList(pairs: [string, number][]): Promise<string | null> {
  const params = getSnapshot().params;
  for (const [name, value] of pairs) {
    const from = params[name];
    if (typeof from === "number" && sameParam(from, value)) continue;
    const err = await writeParam(name, value);
    if (err) return err;
    noteUi([{ kind: "param", name, value, from: typeof from === "number" ? from : null }]);
  }
  return null;
}

function useRadio() {
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const fresh = typeof sample.heartbeat_at === "number" && Date.now() / 1000 - sample.heartbeat_at < 3;
  return { sample, params: sample.params ?? {}, rc: sample.rc ?? [], ready: !!sample.ok && !sample.armed && fresh };
}

const STICK_SPAN = 400;
const SWITCH_SPAN = 200;

/**
 * Stick ends: sweep every stick (and switch) to its ends, then centre with throttle down. Writes RCn_MIN, RCn_MAX and
 * RCn_TRIM for each channel that moved; the throttle's trim is its low end, as ArduPilot uses it.
 */
export function RadioEndsWizard({ onClose, onNext, fromAssistant }: { onClose: (report?: WizardClose) => void; onNext?: () => void; fromAssistant?: boolean }) {
  const t = useT();
  const { sample, params, rc, ready } = useRadio();
  const sticks = useSticks();
  const [phase, setPhase] = useState<"ready" | "ends" | "centre" | "done">("ready");
  const [seen, setSeen] = useState<Record<number, [number, number]>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState<Record<number, [number, number, number]>>({});
  const stickCh = STICKS.map((s) => channelOf(params, s.key));
  const thrCh = channelOf(params, "throttle");
  // A plane with FLIGHT_OPTIONS bit 10 (CENTER_THROTTLE_TRIM) takes zero thrust from the throttle trim, and will not arm
  // unless it is between 1250 and 1750; everywhere else the throttle's trim is its low end.
  const centreThrottle = sample.frame === "plane" && ((Math.round(pnum(params, "FLIGHT_OPTIONS") ?? 0) & 1024) !== 0);
  const n = Math.min(16, Math.max(8, rc.length));

  // Ends: widen each channel's seen range.
  useEffect(() => {
    if (phase !== "ends") return;
    setSeen((prev) => {
      let next = prev;
      for (let ch = 1; ch <= n; ch++) {
        const v = rc[ch - 1];
        if (!okPwm(v)) continue;
        const [lo, hi] = prev[ch] ?? [v, v];
        if (v < lo || v > hi || !prev[ch]) {
          if (next === prev) next = { ...prev };
          next[ch] = [Math.min(lo, v), Math.max(hi, v)];
        }
      }
      return next;
    });
  }, [rc, phase, n]);

  // Centre: roll, pitch and yaw near the middle of their swept range and the throttle fully down (centred instead on a
  // plane with a centred throttle); the user presses Next when they rest there. The throttle's trim is its low end.
  const offCentre = phase === "centre" ? STICKS.filter((s) => {
    const ch = channelOf(params, s.key);
    const v = rc[ch - 1];
    if (!seen[ch] || !okPwm(v)) return true;
    const [lo, hi] = seen[ch];
    if (s.key === "throttle" && !centreThrottle) return v - lo > 60;
    return Math.abs(v - (lo + hi) / 2) > (hi - lo) * 0.12;
  }) : [];
  const moved = (ch: number, span: number) => !!seen[ch] && seen[ch][1] - seen[ch][0] >= span;
  const allSticks = stickCh.every((ch) => moved(ch, STICK_SPAN));
  const leave = () => onClose({ outcome: phase === "done" ? "completed" : "cancelled", measures: Object.fromEntries(Object.entries(saved).flatMap(([ch, [lo, tr, hi]]) => [[`RC${ch}_MIN`, lo], [`RC${ch}_TRIM`, tr], [`RC${ch}_MAX`, hi]])) });

  async function save(centre: number[]) {
    if (busy) return;
    setPhase("done");
    setBusy(true);
    const out: Record<number, [number, number, number]> = {};
    for (let ch = 1; ch <= n; ch++) {
      const isStick = stickCh.includes(ch);
      if (!moved(ch, isStick ? STICK_SPAN : SWITCH_SPAN)) continue;
      const [lo, hi] = seen[ch];
      const at = isStick ? centre[stickCh.indexOf(ch)] : rc[ch - 1] ?? Math.round((lo + hi) / 2);
      const trim = ch === thrCh && !centreThrottle ? lo : Math.min(hi, Math.max(lo, at));
      out[ch] = [lo, trim, hi];
    }
    const err = await writeList(Object.entries(out).flatMap(([ch, [lo, tr, hi]]) => [[`RC${ch}_MIN`, lo], [`RC${ch}_MAX`, hi], [`RC${ch}_TRIM`, tr]] as [string, number][]));
    setBusy(false);
    setSaved(out);
    if (err) setMessage(err);
  }

  const p = (x: number) => Math.max(0, Math.min(100, ((x - 900) / 1200) * 100));
  const rows = STICKS.map((s) => {
    const ch = channelOf(params, s.key);
    const [lo, hi] = seen[ch] ?? [0, 0];
    const v = rc[ch - 1];
    const centre = phase === "centre";
    const done = centre ? !offCentre.includes(s) : moved(ch, STICK_SPAN);
    const target = s.key === "throttle" && !centreThrottle ? lo : Math.round((lo + hi) / 2);
    return (
      <div key={s.key} className={`rs-rr${done ? " done" : ""}`}>
        <span className="mono">CH{ch}</span><b>{t(s.name)}</b>
        <span className="rs-bar">{seen[ch] ? <i style={{ left: `${p(lo)}%`, width: `${p(hi) - p(lo)}%` }} /> : null}{centre && seen[ch] ? <b style={{ left: `${p(target)}%` }} /> : null}{okPwm(v) ? <em style={{ left: `${p(v)}%` }} /> : null}</span>
        <span className="mono">{centre ? (okPwm(v) ? String(v) : "—") : seen[ch] ? `${lo}–${hi}` : "—"}</span>
      </div>
    );
  });
  const stuck = phase === "ends" && Object.keys(seen).length > 0 ? STICKS.filter((s) => {
    const ch = channelOf(params, s.key);
    return seen[ch] && seen[ch][1] - seen[ch][0] < 20 && STICKS.some((o) => moved(channelOf(params, o.key), STICK_SPAN));
  }) : [];

  let body;
  let footer;
  if (phase === "ready") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Teach the board where each stick ends")}</h3><p>{t("About 20 seconds. Move the sticks, then centre them; the board stores the ends and the centre of every channel.")}</p></div>
        <div className="mw-checks">
          <span className={sample.ok ? "ok" : "bad"}>{sample.ok ? Icon.check("var(--ok)", 12) : Icon.x("var(--hot)", 12)}{t(sample.ok ? "Connected" : "No link")}</span>
          <span className={sample.armed ? "bad" : "ok"}>{sample.armed ? Icon.x("var(--hot)", 12) : Icon.check("var(--ok)", 12)}{t(sample.armed ? "Armed" : "Disarmed")}</span>
          <span className={rc.filter(okPwm).length >= 4 ? "ok" : "bad"}>{rc.filter(okPwm).length >= 4 ? Icon.check("var(--ok)", 12) : Icon.x("var(--hot)", 12)}{t(rc.filter(okPwm).length >= 4 ? "Receiver sending" : "No signal")}</span>
        </div>
        <span className="mw-dim mw-sm">{t("Propellers off: the motors can start while the sticks move. Transmitter trims at zero.")}</span>
        {sample.rc_override ? <OverrideNote /> : null}
      </>
    );
    footer = (<><button type="button" className="mw-btn text" onClick={leave}>{t("Cancel")}</button><button type="button" className="mw-btn primary" disabled={!ready || rc.filter(okPwm).length < 4 || !!sample.rc_override} onClick={() => { setSeen({}); setPhase("ends"); }}><span>{t("Start")}</span>{Icon.chevR()}</button></>);
  } else if (phase === "ends") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Move every stick to its ends")}</h3><p>{t("Circle both sticks to the corners a few times, and flip each switch through its positions. Each bar widens as it sees new ends.")}</p></div>
        <div className="rs-rrs">{rows}</div>
        {stuck.length ? <div className="mw-note warn">{Icon.warn()}<span>{t("{name} is not moving. The transmitter may send it on another channel; the assistant can set the stick map (RCMAP).", { name: stuck.map((s) => t(s.name)).join(", ") })}</span></div> : null}
        <div className={`mw-note ${allSticks ? "ok" : "warn"}`}><i className="sw-dot" /><span>{t(allSticks ? "All four sticks reached their ends." : "Keep moving: every stick needs to reach both ends.")}</span></div>
      </>
    );
    footer = (<><button type="button" className="mw-btn text" onClick={leave}>{t("Cancel")}</button><button type="button" className="mw-btn primary" disabled={!allSticks} onClick={() => setPhase("centre")}><span>{t("Next")}</span>{Icon.chevR()}</button></>);
  } else if (phase === "centre") {
    body = (
      <>
        <div className="mw-headline"><h3>{t(centreThrottle ? "Centre the sticks" : "Centre the sticks, throttle down")}</h3><p>{t(centreThrottle ? "Let go of roll, pitch and yaw so they rest in the middle, and put the throttle in the middle too, then press Next. This plane uses a centred throttle (FLIGHT_OPTIONS 1024): its trim is the zero-thrust point." : "Let go of roll, pitch and yaw so they rest in the middle, pull the throttle fully down, then press Next.")}</p></div>
        <div className="rs-rrs">{rows}</div>
        {offCentre.length
          ? <div className="mw-note warn">{Icon.warn()}<span>{t("Not there yet: {list}.", { list: offCentre.map((x) => t(x.key === "throttle" && !centreThrottle ? "throttle not fully down" : "{name} not centred", { name: t(x.name) })).join(", ") })}</span></div>
          : <div className="mw-note ok"><i className="sw-dot" /><span>{t(centreThrottle ? "All four sticks are centred." : "Sticks centred, throttle down.")}</span></div>}
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={() => setPhase("ends")}>{t("Back")}</button>
        <button type="button" className="mw-btn primary" disabled={busy || offCentre.length > 0} onClick={() => void save(stickCh.map((ch) => rc[ch - 1] ?? 0))}><span>{t("Next")}</span>{Icon.chevR()}</button>
      </>
    );
  } else {
    body = (
      <>
        <div className="mw-headline"><h3>{t(busy ? "Saving…" : "Stick ends saved")}</h3><p>{t("ArduPilot uses them at once; no reboot.")}</p></div>
        <div className="mw-sums rs-sums">
          {STICKS.map((s) => {
            const ch = channelOf(params, s.key);
            const v = saved[ch];
            return <div key={s.key} className="mw-sum"><span className="mw-dim mw-sm">{`${t(s.name)} · CH${ch}`}</span><b>{v ? `${v[0]} · ${v[1]} · ${v[2]}` : "—"}</b></div>;
          })}
        </div>
        <span className="mw-dim mw-sm">{t("{n} channels written. Next: check the directions.", { n: Object.keys(saved).length })}</span>
      </>
    );
    footer = (<><button type="button" className="mw-btn text" onClick={leave}>{t("Close")}</button><button type="button" className="mw-btn primary" disabled={busy} onClick={() => { leave(); onNext?.(); }}><span>{t("Check directions")}</span>{Icon.chevR()}</button></>);
  }
  return (
    <SensorWizard
      title={t("Calibrate the stick ends")}
      fromAssistant={fromAssistant}
      steps={[t("Ready"), t("Ends"), t("Centre"), t("Result")]}
      step={phase === "ready" ? 0 : phase === "ends" ? 1 : phase === "centre" ? 2 : 3}
      left={<div className="sw-art"><Transmitter left={sticks.left} right={sticks.right} ends={phase === "ends"} /></div>}
      body={<>{body}{message ? <div className="mw-note warn">{Icon.warn()}<span>{t(message)}</span></div> : null}</>}
      footer={footer}
      blocker={phase === "ends" || phase === "centre" ? (!sample.ok ? "lost" : sample.armed ? "armed" : null) : null}
      busy={busy}
      onClose={leave}
    />
  );
}

/**
 * One stick at a time: the user holds it where asked, the wizard sees which way the raw channel moved and compares it
 * with what ArduPilot expects. The reversed ones are written together at the end as RCn_REVERSED.
 */
export function RadioDirectionsWizard({ onClose, fromAssistant }: { onClose: (report?: WizardClose) => void; fromAssistant?: boolean }) {
  const t = useT();
  const { sample, params, rc, ready } = useRadio();
  const sticks = useSticks();
  const [index, setIndex] = useState(0);
  const [found, setFound] = useState<Partial<Record<Stick, 1 | -1>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [written, setWritten] = useState(false);
  const base = useRef<number | null>(null);
  const since = useRef<{ at: number; sign: 1 | -1 } | null>(null);
  const done = index >= STICKS.length;
  const s = STICKS[Math.min(index, STICKS.length - 1)];
  const ch = channelOf(params, s.key);
  const v = rc[ch - 1];

  useEffect(() => {
    base.current = null;
    since.current = null;
  }, [index]);
  useEffect(() => {
    if (done || !okPwm(v) || sample.rc_override) return;
    if (base.current == null) {
      base.current = v;
      return;
    }
    const delta = v - base.current;
    if (Math.abs(delta) < 150) {
      since.current = null;
      return;
    }
    const sign = delta > 0 ? 1 : -1;
    const now = Date.now();
    if (!since.current || since.current.sign !== sign) {
      since.current = { at: now, sign };
      return;
    }
    if (now - since.current.at >= 500) {
      setFound((f) => ({ ...f, [s.key]: sign }));
      setIndex((i) => i + 1);
    }
  }, [v, done]);

  // Raw sign that ArduPilot reads as the asked direction: the expected one, flipped when the channel is reversed.
  const need = (k: Stick): boolean | null => {
    const sign = found[k];
    if (sign == null) return null;
    const st = STICKS.find((x) => x.key === k)!;
    return sign !== st.expect;
  };
  const changes = STICKS.flatMap((st) => {
    const r = need(st.key);
    if (r == null) return [];
    const c = channelOf(params, st.key);
    const cur = (pnum(params, `RC${c}_REVERSED`) ?? 0) !== 0;
    return r === cur ? [] : [[`RC${c}_REVERSED`, r ? 1 : 0] as [string, number]];
  });
  const leave = () => onClose({ outcome: done ? "completed" : "cancelled", measures: { ...Object.fromEntries(STICKS.map((st) => [st.key, need(st.key) == null ? null : need(st.key) ? "reversed" : "right way"])), written: written ? 1 : 0 } });

  async function write() {
    setBusy(true);
    const err = await writeList(changes);
    setBusy(false);
    if (err) setMessage(err);
    else setWritten(true);
  }

  const rows = (
    <div className="rs-drs">
      {STICKS.map((st, i) => {
        const r = need(st.key);
        const cls = i === index && !done ? "on" : r == null ? "" : r ? "rev" : "ok";
        return (
          <div key={st.key} className={`rs-dr ${cls}`}>
            {r === false ? Icon.check("var(--ok)", 14) : r ? Icon.warn() : <span className="rs-dr-dot" />}
            <b>{t(st.name)}</b>
            <span>{r == null ? (i === index && !done ? t("asked now") : "") : r ? t("reversed · RC{n}_REVERSED", { n: channelOf(params, st.key) }) : t("right way")}</span>
          </div>
        );
      })}
    </div>
  );
  let body;
  let footer;
  if (!done) {
    body = (
      <>
        <div className="mw-headline"><h3>{t(s.ask)}</h3><p>{t("Hold it there. The wizard reads which way the channel moves.")}</p></div>
        {sample.rc_override ? <OverrideNote /> : <div className="mw-note ok"><i className="sw-dot" /><span>{okPwm(v) ? t("CH{n} at {v}", { n: ch, v }) : t("No signal")}</span></div>}
        {rows}
        {s.key === "throttle" ? <span className="mw-dim mw-sm">{t("Propellers off. The board stays disarmed; nothing spins.")}</span> : null}
      </>
    );
    footer = (<><button type="button" className="mw-btn text" onClick={leave}>{t("Cancel")}</button>{index > 0 ? <button type="button" className="mw-btn quiet" onClick={() => setIndex(index - 1)}>{t("Back")}</button> : <span />}</>);
  } else {
    body = (
      <>
        <div className="mw-headline">
          <h3>{written ? t("Saved") : changes.length ? t("{n} to change", { n: changes.length }) : t("Every stick moves the right way")}</h3>
          <p>{written ? t("The channel bars on the Radio step now follow the sticks the right way.") : changes.length ? t("Write fixes them on the board. Reverse on the board or on the transmitter, not both.") : t("Nothing to change.")}</p>
        </div>
        {rows}
        {changes.length && !written ? <div className="mw-sums">{changes.map(([name, val]) => <div key={name} className="mw-sum"><span className="mw-dim mw-sm">{name}</span><b>{`${val ? 0 : 1} → ${val}`}</b></div>)}</div> : null}
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={() => { setFound({}); setIndex(0); setWritten(false); }}>{t("Measure again")}</button>
        {changes.length && !written
          ? <button type="button" className="mw-btn primary" disabled={!ready || busy} onClick={() => void write()}>{busy ? t("Writing…") : t("Write")}</button>
          : <button type="button" className="mw-btn primary" onClick={leave}>{t("Close")}</button>}
      </>
    );
  }
  return (
    <SensorWizard
      title={t("Check the stick directions")}
      fromAssistant={fromAssistant}
      steps={[t("Roll"), t("Pitch"), t("Throttle"), t("Yaw"), t("Result")]}
      step={Math.min(index, 4)}
      left={<div className="sw-art"><Transmitter left={sticks.left} right={sticks.right} hl={done ? null : s.key} to={done ? null : s.to} /></div>}
      body={<>{body}{message ? <div className="mw-note warn">{Icon.warn()}<span>{t(message)}</span></div> : null}</>}
      footer={footer}
      blocker={!done ? (!sample.ok ? "lost" : sample.armed ? "armed" : null) : null}
      busy={busy}
      onClose={leave}
    />
  );
}
