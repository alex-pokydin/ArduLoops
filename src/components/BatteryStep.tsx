import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { askAssistant } from "../lib/assistantAsk";
import { guessCells } from "../lib/vehicleProfile";
import { noteUi, send as sendCmd, writeParam } from "../mav/cmd";
import { getLatest, getSetupSnapshot, subscribe } from "../mav/store";
import { paramNum, type WizardClose } from "../wizards/close";
import { Icon } from "./MotorSetup";
import { StepNum } from "./OutputSetup";
import { SensorWizard } from "./SensorWizard";
import { battActionName } from "./SetupWizards";
import { StepPreArm } from "./StepPreArm";

/**
 * Battery: what measures the pack, then calibrate it against real measurements: a meter for the voltage, the mAh a
 * charger puts back for the current. Thresholds are read-only here; the assistant sets them from the pack the user
 * names. Analog sensors (BATT_MONITOR 3, 4) read through a scale; digital ones report volts and amps themselves.
 */

/** BATT_MONITOR: 3 = analog voltage, 4 = analog voltage and current. Everything else measures in real units. */
const VOLT_ANALOG = new Set([3, 4]);
const AMP_ANALOG = new Set([4]);
const MONITOR_NAMES: Record<number, string> = {
  0: "No battery monitor", 3: "Analog voltage only", 4: "Analog voltage and current", 5: "Solo", 6: "Bebop", 7: "SMBus smart battery",
  8: "DroneCAN battery", 9: "ESC telemetry", 10: "Sum of other batteries", 11: "Fuel flow", 12: "Fuel level", 13: "SMBus SUI3", 14: "SMBus SUI6",
  15: "NeoDesign", 16: "SMBus Maxell", 17: "Generator", 18: "Generator fuel", 19: "Rotoye", 20: "MPPT", 21: "INA2xx", 22: "LTC2946", 23: "Torqeedo",
  24: "Fuel level analog", 25: "Synthetic current", 26: "INA239", 27: "EFI", 28: "AD7091R5", 29: "Scripting", 30: "INA3221", 31: "Analog current only",
};

type Pack = { volts: number | null; amps: number | null; used: number | null; esc: { volts: number; amps: number; n: number } | null; cells: number[] };

function num(nums: Record<string, number> | undefined, key: string): number | null {
  const value = nums?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Battery 1 as the board reports it, plus the ESCs' own voltage and current when they send telemetry. */
export function readPack(nums: Record<string, number> | undefined): Pack {
  const mv = num(nums, "SYS_STATUS.voltage_battery");
  const ca = num(nums, "BATTERY_STATUS.current_battery") ?? num(nums, "SYS_STATUS.current_battery");
  const mah = num(nums, "BATTERY_STATUS.current_consumed");
  const escV: number[] = [];
  let escA = 0;
  for (const group of ["ESC_TELEMETRY_1_TO_4", "ESC_TELEMETRY_5_TO_8"]) {
    for (let i = 0; i < 4; i++) {
      const v = num(nums, `${group}.voltage${i}`);
      if (v != null && v > 0) {
        escV.push(v / 100);
        escA += (num(nums, `${group}.current${i}`) ?? 0) / 100;
      }
    }
  }
  const cells: number[] = [];
  for (let i = 0; i < 10; i++) {
    const c = num(nums, `BATTERY_STATUS.voltages${i}`);
    if (c == null || c <= 0 || c >= 65535) break;
    cells.push(c / 1000);
  }
  return {
    volts: mv == null || mv <= 0 || mv >= 65535 ? null : mv / 1000,
    amps: ca == null || ca < 0 ? null : ca / 100,
    used: mah == null || mah < 0 ? null : mah,
    esc: escV.length ? { volts: escV.reduce((a, b) => a + b, 0) / escV.length, amps: escA, n: escV.length } : null,
    cells: cells.length > 1 ? cells : [],
  };
}

function parseNum(text: string): number | null {
  const value = Number(text.trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) && text.trim() !== "" ? value : null;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

async function writeOne(name: string, value: number, from: number | null): Promise<string | null> {
  const err = await writeParam(name, value);
  if (!err) noteUi([{ kind: "param", name, value, from }]);
  return err;
}

/** The pack against its arm, low and critical marks. */
function PackArt({ pack, cells, marks, note }: { pack: Pack; cells: number; marks: { arm: number | null; low: number | null; crit: number | null }; note: string }) {
  const t = useT();
  // 3.3 to 4.2 V a cell, stretched down to the lowest mark so a mark set too low is still drawn where it is.
  const lowest = [marks.arm, marks.low, marks.crit].filter((m): m is number => m != null && m > 0);
  const lo = Math.min(3.3 * cells, ...lowest.map((m) => m - 0.3 * cells / 4));
  const hi = 4.2 * cells;
  const y = (v: number) => 196 - Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 168;
  const v = pack.volts != null && pack.volts >= 1 ? pack.volts : null;
  const tone = v == null ? "mute" : marks.crit != null && v < marks.crit ? "hot" : marks.low != null && v < marks.low ? "amber" : "ok";
  const mark = (value: number | null, label: string, cls: string) =>
    value == null || value <= 0 ? null : (
      <g key={label} className={`bs-mark ${cls}`}>
        <line x1="16" y1={y(value)} x2="98" y2={y(value)} />
        <text x="104" y={y(value) + 4}>{`${t(label)} ${value.toFixed(1)}`}</text>
      </g>
    );
  return (
    <div className="ms-art bs-art">
      <svg viewBox="0 0 230 214" className="bs-pack" aria-hidden="true">
        <rect x="40" y="14" width="28" height="12" rx="3" className="bs-cap" />
        <rect x="16" y="24" width="76" height="178" rx="10" className="bs-shell" />
        {v != null ? <rect x="22" y={y(v)} width="64" height={Math.max(0, 196 - y(v))} rx="6" className={`bs-fill ${tone}`} /> : null}
        {mark(marks.arm, "Arm", "cyan")}
        {mark(marks.low, "Low", "amber")}
        {mark(marks.crit, "Critical", "hot")}
      </svg>
      <b className={`bs-volts ${tone}`}>{v == null ? "—" : `${v.toFixed(2)} V`}</b>
      <span>{v == null ? note : t("{n}S · {v} V per cell", { n: cells, v: (v / cells).toFixed(2) })}</span>
      <span>{[pack.amps != null && v != null ? `${pack.amps.toFixed(1)} A` : "", pack.used != null && v != null ? t("{n} mAh used", { n: Math.round(pack.used) }) : ""].filter(Boolean).join(" · ")}</span>
    </div>
  );
}

export function BatteryStep() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const live = useSyncExternalStore(subscribe, getLatest, getLatest);
  const params = sample.params || {};
  const [open, setOpen] = useState<null | "sensor" | "voltage" | "current">(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fresh = typeof live.heartbeat_at === "number" && Date.now() / 1000 - live.heartbeat_at < 3;
  const ready = live.ok && !live.armed && fresh;
  const vehicle = sample.frame === "plane" ? "plane" : "copter";
  const pack = readPack(live.live_nums);
  const monitorRaw = paramNum(params, "BATT_MONITOR");
  const monitor = monitorRaw == null ? null : Math.round(monitorRaw);
  const voltAnalog = monitor != null && VOLT_ANALOG.has(monitor);
  const ampAnalog = monitor != null && AMP_ANALOG.has(monitor);
  const digital = monitor != null && monitor !== 0 && !voltAnalog && monitor !== 31;
  const hasPack = pack.volts != null && pack.volts >= 1;
  const marks = { arm: paramNum(params, "BATT_ARM_VOLT"), low: paramNum(params, "BATT_LOW_VOLT"), crit: paramNum(params, "BATT_CRT_VOLT") };
  // Cells from the pack, else from the motor voltage limit, else from the critical or low mark (about 3.3 or 3.5 V a cell).
  const fromMark = marks.crit && marks.crit > 2 ? Math.round(marks.crit / 3.3) : marks.low && marks.low > 2 ? Math.round(marks.low / 3.5) : null;
  const cells = guessCells(hasPack ? pack.volts : null, paramNum(params, "MOT_BAT_VOLT_MAX"))?.cells ?? fromMark ?? 4;
  const vPin = paramNum(params, "BATT_VOLT_PIN");
  const aPin = paramNum(params, "BATT_CURR_PIN");
  const offset = paramNum(params, "BATT_AMP_OFFSET");
  const perVolt = paramNum(params, "BATT_AMP_PERVLT");
  // At rest the board, receiver and video transmitter draw real current. Only a negative reading is an offset error.
  const negative = ampAnalog && hasPack && pack.amps != null && pack.amps < -0.05;
  const capacity = paramNum(params, "BATT_CAPACITY");
  const lowMah = paramNum(params, "BATT_LOW_MAH");
  const lowAct = paramNum(params, "BATT_FS_LOW_ACT");
  // With a pack on, the low mark per cell shows thresholds left from another pack.
  const lowPerCell = hasPack && marks.low != null && marks.low > 0 ? marks.low / (pack.cells.length || cells) : null;
  const crtAct = paramNum(params, "BATT_FS_CRT_ACT");

  async function fixOffset() {
    if (!ready || busy || pack.amps == null || offset == null || perVolt == null || perVolt === 0) return;
    setBusy(true);
    const err = await writeOne("BATT_AMP_OFFSET", round3(offset + pack.amps / perVolt), offset);
    setBusy(false);
    setMessage(err ?? "");
  }

  const job = (n: number, state: "done" | "warn" | "todo", title: string, detail: string, label: string, onClick: (() => void) | null, primary = false) => (
    <div className="ms-wstep">
      <StepNum n={n} state={state} />
      <span className="ms-wstep-copy"><b>{t(title)}</b><span>{detail}</span></span>
      {onClick && label ? <button type="button" className={`frs-btn ${primary ? "primary sm" : "quiet"}`} disabled={!ready || busy} onClick={onClick}>{label}</button> : null}
    </div>
  );
  const sensorText = monitor == null
    ? ""
    : [t(MONITOR_NAMES[monitor] ?? "Sensor {n}", { n: monitor }), voltAnalog && vPin != null ? (ampAnalog && aPin != null ? t("pins {v} and {a}", { v: vPin, a: aPin }) : t("pin {v}", { v: vPin })) : ""].filter(Boolean).join(" · ");
  const escAgree = pack.esc && hasPack ? Math.abs(pack.esc.volts - (pack.volts as number)) <= Math.max(0.15, (pack.volts as number) * 0.015) : null;
  const threshold = (label: string, value: string, hint: string) => (
    <div className="bs-th"><span>{t(label)}</span><b>{value}</b><span className="bs-th-hint">{hint}</span></div>
  );
  const volt = (v: number | null) => (v == null ? "—" : v > 0 ? `${v.toFixed(1)} V` : t("off"));

  return (
    <div className="frs">
      <StepPreArm step="battery" />
      {!sample.ok ? <div className="frs-note info">{t("Connect a vehicle to read its battery.")}</div> : null}
      {sample.ok && !hasPack && monitor !== 0 ? <div className="frs-note warn">{t("No pack: the board reads about 0 V, as it does on USB power. ArduPilot reports a critical-voltage failsafe until a pack is plugged in; calibration waits for one.")}</div> : null}
      <div className="ms-top">
        <PackArt pack={pack} cells={pack.cells.length || cells} marks={marks} note={monitor === 0 ? t("No battery monitor") : t("No pack: the board is on USB")} />
        <div className="ms-cards">
          <div className="ms-card">
            <div className="ms-card-head">
              <b>{t("Calibration")}</b>
              <span className="ms-fix">{t(digital ? "Measured by the sensor" : hasPack ? "Pack plugged in, props off" : "Needs a pack plugged in")}</span>
            </div>
            {monitor == null ? null : job(1, monitor === 0 || monitor === 3 ? "warn" : "done", "Sensor", monitor === 0 ? t("No battery monitor: no voltage, no failsafe.") : sensorText, t("Change"), () => setOpen("sensor"), monitor === 0)}
            {monitor == null || monitor === 0 ? null : digital
              ? job(2, "done", "Voltage", t("The sensor measures it: nothing to calibrate."), "", null)
              : job(2, hasPack ? "todo" : "todo", "Voltage", hasPack ? t("Board reads {v} V. Match it to a meter on the pack.", { v: (pack.volts as number).toFixed(2) }) : t("Plug in a pack to match it to a meter."), t("Match a meter"), hasPack ? () => setOpen("voltage") : null, hasPack)}
            {monitor == null || monitor === 0 ? null : digital
              ? job(3, "done", "Current", t("The sensor measures it: nothing to calibrate."), "", null)
              : !ampAnalog
                ? job(3, "warn", "Current", t("No current sensor: mAh used and the capacity failsafe do not work."), "", null)
                : job(3, negative ? "warn" : "todo", "Current", negative ? t("Reads {a} A at rest: below zero, so the offset is off.", { a: (pack.amps as number).toFixed(2) }) : hasPack && pack.amps != null ? t("{a} A at rest: normal for a board, receiver and video transmitter. Scale it after a flight.", { a: pack.amps.toFixed(1) }) : t("Fly a pack, then compare with the charger."), t("From a charge"), () => setOpen("current"))}
            {negative ? <button type="button" className="frs-btn quiet" disabled={!ready || busy} onClick={() => void fixOffset()}>{t("Fix the offset")}</button> : null}
            {pack.esc && hasPack ? (
              <div className={`bs-cross${escAgree ? "" : " warn"}`}>
                <span className={`ms-dot ${escAgree ? "done" : "warn"}`} />
                <span>{t(escAgree ? "ESC telemetry: {v} V, {a} A · agrees with the sensor" : "ESC telemetry: {v} V, {a} A · differs from the sensor", { v: pack.esc.volts.toFixed(2), a: pack.esc.amps.toFixed(1) })}</span>
              </div>
            ) : null}
            {monitor === 3 && pack.esc ? (
              <button type="button" className="setup-fix" onClick={() => askAssistant(t("This board has a voltage-only battery sensor and the ESCs report current. Use the ESC current for mAh and capacity, and propose the parameters."))}>{t("Use ESC current")}</button>
            ) : null}
            {message ? <div className="mw-note warn">{Icon.warn()}<span>{t(message)}</span></div> : null}
          </div>
          <div className="ms-card">
            <div className="ms-card-head">
              <b>{t("Thresholds")}</b>
              <button type="button" className="setup-fix" onClick={() => askAssistant(t("Set the battery thresholds and capacity for my pack. Ask me the cells, chemistry and capacity if you do not know them."))}>{t("Change")}</button>
            </div>
            {threshold("Arm above", volt(marks.arm), "BATT_ARM_VOLT")}
            {threshold("Low", `${volt(marks.low)}${lowAct != null ? ` → ${t(battActionName(vehicle, Math.round(lowAct)))}` : ""}`, "BATT_LOW_VOLT · BATT_FS_LOW_ACT")}
            {threshold("Critical", `${volt(marks.crit)}${crtAct != null ? ` → ${t(battActionName(vehicle, Math.round(crtAct)))}` : ""}`, "BATT_CRT_VOLT · BATT_FS_CRT_ACT")}
            {threshold("Capacity", capacity ? `${Math.round(capacity)} mAh${lowMah ? ` · ${t("low at {n}", { n: Math.round(lowMah) })}` : ""}` : "—", "BATT_CAPACITY · BATT_LOW_MAH")}
            {lowPerCell != null && lowPerCell < 3.3 ? (
              <div className="mw-note warn">{Icon.warn()}<span>{t("Low is {v} V per cell on this {n}S pack: below what a LiPo usually allows. Were the thresholds set for another pack?", { v: lowPerCell.toFixed(2), n: cells })}</span></div>
            ) : null}
            <span className="ms-hint">{t("Set by the assistant from the pack you name, for example “4S 1300 mAh LiPo”.")}</span>
          </div>
        </div>
      </div>
      {open === "sensor" ? <BatterySensorWizard onClose={() => setOpen(null)} /> : null}
      {open === "voltage" ? <BatteryVoltageWizard onClose={() => setOpen(null)} /> : null}
      {open === "current" ? <BatteryCurrentWizard onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** Live readiness shared by the wizards. */
function useBattery() {
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const fresh = typeof sample.heartbeat_at === "number" && Date.now() / 1000 - sample.heartbeat_at < 3;
  return { sample, params: sample.params ?? {}, ready: !!sample.ok && !sample.armed && fresh, pack: readPack(sample.live_nums) };
}

const SENSORS: { id: string; monitor: number; title: string; sub: string }[] = [
  { id: "board", monitor: 4, title: "Built into the board", sub: "Voltage and current through the board's own sensor" },
  { id: "module", monitor: 4, title: "Power module", sub: "A brick between battery and board: PM02, PM06, Matek…" },
  { id: "esc_pad", monitor: 4, title: "ESC current sensor", sub: "The 4-in-1 ESC's current pad to the board" },
  { id: "esc", monitor: 9, title: "ESC telemetry only", sub: "The ESCs report volts and amps over DShot or serial" },
  { id: "smart", monitor: 8, title: "Smart battery", sub: "DroneCAN: the battery measures itself" },
  { id: "volt", monitor: 3, title: "Voltage only", sub: "No current: mAh and capacity will not work" },
];

/** What measures the battery: one choice, written as BATT_MONITOR, then a reboot. Pins and module scales go to the assistant. */
export function BatterySensorWizard({ onClose, fromAssistant }: { onClose: (report?: WizardClose) => void; fromAssistant?: boolean }) {
  const t = useT();
  const { sample, params, ready } = useBattery();
  const stored = paramNum(params, "BATT_MONITOR");
  const [pick, setPick] = useState<string>(() => SENSORS.find((s) => s.monitor === (stored == null ? -1 : Math.round(stored)))?.id ?? "board");
  const [phase, setPhase] = useState<"pick" | "reboot">("pick");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const choice = SENSORS.find((s) => s.id === pick) ?? SENSORS[0];
  const changed = stored == null || Math.round(stored) !== choice.monitor;
  const leave = (rebooted = false) => onClose({ outcome: phase === "reboot" ? "completed" : "cancelled", measures: { sensor: choice.id, BATT_MONITOR: paramNum(getLatest().params, "BATT_MONITOR"), rebooted: rebooted ? 1 : 0 } });

  async function next() {
    if (!changed) {
      setPhase("reboot");
      return;
    }
    setBusy(true);
    const err = await writeOne("BATT_MONITOR", choice.monitor, stored);
    setBusy(false);
    if (err) setMessage(err);
    else setPhase("reboot");
  }

  const left = (
    <div className="bs-mods">
      {(phase === "pick" ? SENSORS : [choice]).map((s) => (
        <button key={s.id} type="button" className={`bs-mod${s.id === pick ? " on" : ""}`} disabled={phase !== "pick" || busy} onClick={() => setPick(s.id)}>
          <span className="bs-mod-dot" />
          <span className="bs-mod-copy"><b>{t(s.title)}</b><span>{t(s.sub)}</span></span>
        </button>
      ))}
    </div>
  );
  const body = phase === "pick" ? (
    <>
      <div className="mw-headline"><h3>{t("What measures the battery?")}</h3><p>{t("This decides what can be calibrated. Analog sensors read through a scale; digital ones report volts and amps themselves.")}</p></div>
      {pick === "module" || pick === "esc_pad" ? <div className="mw-note info"><span>{t("Its pins and scale differ from the board's defaults. The assistant can set them for your module; match a meter after the reboot.")}</span></div> : null}
      {pick === "volt" ? <div className="mw-note warn">{Icon.warn()}<span>{t("Without current, mAh used, the remaining percentage and the capacity failsafe do not work.")}</span></div> : null}
      <span className="mw-dim mw-sm">{t("Not sure? Ask: the assistant can read the board type and the wiring you describe.")}</span>
    </>
  ) : (
    <>
      <div className="mw-headline"><h3>{t(changed ? "Reboot to use the new sensor" : "The sensor is already set")}</h3><p>{t("ArduPilot reads the sensor type at boot.")}</p></div>
      <div className="mw-sums"><div className="mw-sum"><span className="mw-dim mw-sm">{t("Monitor")}</span><b>{t(MONITOR_NAMES[choice.monitor] ?? "Sensor {n}", { n: choice.monitor })}</b><span className="mw-dim mw-sm">BATT_MONITOR {choice.monitor}</span></div></div>
      {pick === "module" || pick === "esc_pad" ? (
        <button type="button" className="setup-fix" onClick={() => askAssistant(t("I use a {what} for the battery. Set its voltage and current pins and scales for this board, and propose the parameters.", { what: t(choice.title).toLowerCase() }))}>{t("Set its pins and scales")}</button>
      ) : null}
    </>
  );
  const footer = phase === "pick" ? (
    <>
      <button type="button" className="mw-btn text" onClick={() => leave()}>{t("Cancel")}</button>
      <button type="button" className="mw-btn primary" disabled={!ready || busy} onClick={() => void next()}><span>{t("Next")}</span>{Icon.chevR()}</button>
    </>
  ) : (
    <>
      <button type="button" className="mw-btn text" onClick={() => leave()}>{t("Finish")}</button>
      <button type="button" className="mw-btn warn-solid" disabled={!sample.ok || sample.armed} onClick={() => { sendCmd({ op: "reboot" }); leave(true); }}>{Icon.power()}<span>{t("Reboot & finish")}</span></button>
    </>
  );
  return (
    <SensorWizard
      title={t("Battery sensor")}
      fromAssistant={fromAssistant}
      steps={[t("What measures it"), t("Result")]}
      step={phase === "pick" ? 0 : 1}
      left={left}
      body={<>{body}{message ? <div className="mw-note warn">{Icon.warn()}<span>{t(message)}</span></div> : null}</>}
      footer={footer}
      blocker={!sample.ok ? "lost" : sample.armed ? "armed" : null}
      busy={busy}
      onClose={() => leave()}
    />
  );
}

/** The board's reading once it has held within 0.03 V for 3 s, or null while it moves. */
function useSteady(volts: number | null): number | null {
  const hist = useRef<{ at: number; v: number }[]>([]);
  const [steady, setSteady] = useState<number | null>(null);
  useEffect(() => {
    const now = Date.now();
    if (volts == null) {
      hist.current = [];
      setSteady(null);
      return;
    }
    hist.current = [...hist.current.filter((p) => now - p.at < 3000), { at: now, v: volts }];
    const vs = hist.current.map((p) => p.v);
    const span = hist.current.length ? now - hist.current[0].at : 0;
    setSteady(span >= 2500 && Math.max(...vs) - Math.min(...vs) <= 0.03 ? vs.reduce((a, b) => a + b, 0) / vs.length : null);
  }, [volts]);
  return steady;
}

/** One number from a meter on the pack; BATT_VOLT_MULT follows. A change over 15% is questioned before it is saved. */
export function BatteryVoltageWizard({ onClose, fromAssistant }: { onClose: (report?: WizardClose) => void; fromAssistant?: boolean }) {
  const t = useT();
  const { sample, params, ready, pack } = useBattery();
  const [phase, setPhase] = useState<"ready" | "measure" | "check" | "done">("ready");
  const [meterText, setMeterText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ board: number; meter: number; from: number; to: number } | null>(null);
  const steady = useSteady(pack.volts != null && pack.volts >= 1 ? pack.volts : null);
  const held = useRef<number | null>(null);
  if (steady != null) held.current = steady;
  const mult = paramNum(params, "BATT_VOLT_MULT");
  const monitor = paramNum(params, "BATT_MONITOR");
  const analog = monitor != null && VOLT_ANALOG.has(Math.round(monitor));
  const hasPack = pack.volts != null && pack.volts >= 1;
  const meter = parseNum(meterText);
  const board = held.current;
  const ratio = meter != null && board != null && board > 0 ? meter / board : null;
  const big = ratio != null && Math.abs(ratio - 1) > 0.15;
  const leave = () => onClose({ outcome: phase === "done" ? "completed" : "cancelled", measures: result ? { board_v: result.board, meter_v: result.meter, BATT_VOLT_MULT_from: result.from, BATT_VOLT_MULT_to: result.to } : { phase } });

  async function save() {
    if (busy || ratio == null || mult == null || board == null || meter == null) return;
    const to = round3(mult * ratio);
    setBusy(true);
    const err = await writeOne("BATT_VOLT_MULT", to, mult);
    setBusy(false);
    if (err) {
      setMessage(err);
      return;
    }
    setResult({ board, meter, from: mult, to });
    setPhase("done");
  }

  const compare = (a: string, b: string, tone: "warn" | "ok") => (
    <div className="bs-cmp">
      <div><span>{t("Board reads")}</span><b className={tone}>{a}</b></div>
      {Icon.chevR("var(--dim)", 18)}
      <div><span>{t("Meter reads")}</span><b className="ok">{b}</b></div>
    </div>
  );
  let left;
  let body;
  let footer;
  if (phase === "ready") {
    left = <div className="bs-meter"><svg viewBox="0 0 300 230" aria-hidden="true"><rect x="18" y="20" width="118" height="180" rx="14" className="bs-m-body" /><rect x="32" y="36" width="90" height="44" rx="6" className="bs-m-lcd" /><text x="77" y="66" className="bs-m-text">{hasPack ? (pack.volts as number).toFixed(2) : "--.--"}</text><circle cx="77" cy="128" r="28" className="bs-m-dial" /><path d="M77 128l14-16" className="bs-m-needle" /><rect x="200" y="122" width="70" height="88" rx="10" className="bs-m-pack" /><rect x="214" y="96" width="42" height="26" rx="4" className="bs-m-plug" /><path d="M60 200C60 230 160 228 180 170S205 110 222 104" className="bs-m-red" /><path d="M94 200C94 222 170 222 190 160S228 112 248 104" className="bs-m-black" /></svg><span>{t("Probes on the main plug, red to +")}</span></div>;
    body = (
      <>
        <div className="mw-headline"><h3>{t("Measure the pack with a meter")}</h3><p>{t("Pack plugged in, motors stopped. Put the probes on the main plug, or on the outer pins of the balance lead.")}</p></div>
        <div className="mw-checks">
          <span className={sample.ok ? "ok" : "bad"}>{sample.ok ? Icon.check("var(--ok)", 12) : Icon.x("var(--hot)", 12)}{t(sample.ok ? "Connected" : "No link")}</span>
          <span className={hasPack ? "ok" : "bad"}>{hasPack ? Icon.check("var(--ok)", 12) : Icon.x("var(--hot)", 12)}{hasPack ? t("Pack plugged in · {v} V", { v: (pack.volts as number).toFixed(1) }) : t("No pack")}</span>
          <span className={analog ? "ok" : "bad"}>{analog ? Icon.check("var(--ok)", 12) : Icon.x("var(--hot)", 12)}{t(analog ? "Analog sensor" : "This sensor keeps its own voltage scale")}</span>
        </div>
        <span className="mw-dim mw-sm">{t("No meter? A cell checker's total, or the charger's reading of the pack, works too.")}</span>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={leave}>{t("Cancel")}</button>
        <button type="button" className="mw-btn primary" disabled={!ready || !hasPack || !analog || mult == null} onClick={() => setPhase("measure")}><span>{t("Start")}</span>{Icon.chevR()}</button>
      </>
    );
  } else if (phase === "measure" || phase === "check") {
    left = compare(board != null ? `${board.toFixed(2)} V` : "—", meter != null ? `${meter.toFixed(2)} V` : "—", "warn");
    body = phase === "measure" ? (
      <>
        <div className="mw-headline"><h3>{t("Type what the meter reads")}</h3><p>{t("The board's reading is taken once it holds steady.")}</p></div>
        <div className={`mw-note ${steady != null ? "ok" : "warn"}`}><i className="sw-dot" /><span>{steady != null ? t("Steady at {v} V", { v: steady.toFixed(2) }) : t("Waiting for a steady reading…")}</span></div>
        <label className="bs-input"><span>{t("Meter reads")}</span><span className="bs-input-box"><input inputMode="decimal" autoFocus value={meterText} onChange={(ev) => setMeterText(ev.target.value)} /><span>V</span></span></label>
        <span className="mw-dim mw-sm">{t("Reading moving? Something is drawing power: stop the motors, put the video transmitter in pit mode.")}</span>
      </>
    ) : (
      <>
        <div className="mw-headline"><h3>{t("That is a {n}% change", { n: Math.round(Math.abs((ratio ?? 1) - 1) * 100) })}</h3><p>{t("A correction this large is rarely calibration.")}</p></div>
        <div className="sw-fail"><b>{t("Check before saving: is the sensor right for this board?")}</b><p>{t("A wrong power-module choice or pin gives a reading that is off by a fixed ratio. Probes on one cell, or on the balance lead's inner pins, read low too.")}</p></div>
      </>
    );
    footer = phase === "measure" ? (
      <>
        <button type="button" className="mw-btn text" onClick={leave}>{t("Cancel")}</button>
        <button type="button" className="mw-btn primary" disabled={!ready || busy || board == null || meter == null || meter < 1 || meter > 100} onClick={() => (big ? setPhase("check") : void save())}><span>{t("Next")}</span>{Icon.chevR()}</button>
      </>
    ) : (
      <>
        <button type="button" className="mw-btn text" onClick={() => setPhase("measure")}>{t("Measure again")}</button>
        <div className="mw-row">
          <button type="button" className="mw-btn quiet" onClick={() => askAssistant(t("My battery voltage reads {a} V but a meter shows {b} V. Check the battery sensor type, pins and scale.", { a: (board ?? 0).toFixed(2), b: (meter ?? 0).toFixed(2) }))}>{t("Check the sensor")}</button>
          <button type="button" className="mw-btn primary" disabled={!ready || busy} onClick={() => void save()}>{t("Save anyway")}</button>
        </div>
      </>
    );
  } else {
    left = compare(hasPack ? `${(pack.volts as number).toFixed(2)} V` : "—", result ? `${result.meter.toFixed(2)} V` : "—", "ok");
    body = (
      <>
        <div className="mw-headline"><h3>{t("Saved")}</h3><p>{t("The live reading follows the new scale. It should now match the meter.")}</p></div>
        {result ? <div className="mw-sums"><div className="mw-sum"><span className="mw-dim mw-sm">{t("Voltage scale")}</span><b>{`${result.from.toFixed(2)} → ${result.to.toFixed(2)}`}</b><span className="mw-dim mw-sm">BATT_VOLT_MULT · {`${((result.to / result.from - 1) * 100).toFixed(1)}%`}</span></div></div> : null}
      </>
    );
    footer = (
      <>
        <span />
        <button type="button" className="mw-btn primary" onClick={leave}>{t("Close")}</button>
      </>
    );
  }
  return (
    <SensorWizard
      title={t("Match the voltage to a meter")}
      fromAssistant={fromAssistant}
      steps={[t("Ready"), t("Measure"), t("Result")]}
      step={phase === "ready" ? 0 : phase === "done" ? 2 : 1}
      left={left}
      body={<>{body}{message ? <div className="mw-note warn">{Icon.warn()}<span>{t(message)}</span></div> : null}</>}
      footer={footer}
      blocker={phase === "measure" ? (!sample.ok ? "lost" : sample.armed ? "armed" : null) : null}
      busy={busy}
      onClose={leave}
    />
  );
}

/**
 * The board's mAh for a flight against what a balance charger puts back: BATT_AMP_PERVLT is multiplied by
 * charged ÷ counted. Under 3% is left alone, since chargers count a little high.
 */
export function BatteryCurrentWizard({ onClose, fromAssistant }: { onClose: (report?: WizardClose) => void; fromAssistant?: boolean }) {
  const t = useT();
  const { params, ready, pack } = useBattery();
  const [phase, setPhase] = useState<"used" | "charger" | "done">("used");
  // A bench count of a few mAh is not a flight; only a real one is filled in.
  const [usedText, setUsedText] = useState(pack.used != null && pack.used >= 100 ? String(Math.round(pack.used)) : "");
  const [chargedText, setChargedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ used: number; charged: number; from: number; to: number | null } | null>(null);
  const perVolt = paramNum(params, "BATT_AMP_PERVLT");
  const monitor = paramNum(params, "BATT_MONITOR");
  const analog = monitor != null && AMP_ANALOG.has(Math.round(monitor));
  const used = parseNum(usedText);
  const charged = parseNum(chargedText);
  const diff = used != null && charged != null && used > 0 ? charged / used - 1 : null;
  const leave = () => onClose({ outcome: phase === "done" ? "completed" : "cancelled", measures: result ? { used_mah: result.used, charged_mah: result.charged, BATT_AMP_PERVLT_from: result.from, BATT_AMP_PERVLT_to: result.to } : { phase } });

  async function save() {
    if (busy || used == null || charged == null || perVolt == null || diff == null) return;
    if (Math.abs(diff) < 0.03) {
      setResult({ used, charged, from: perVolt, to: null });
      setPhase("done");
      return;
    }
    const to = round3(perVolt * (charged / used));
    setBusy(true);
    const err = await writeOne("BATT_AMP_PERVLT", to, perVolt);
    setBusy(false);
    if (err) {
      setMessage(err);
      return;
    }
    setResult({ used, charged, from: perVolt, to });
    setPhase("done");
  }

  const input = (label: string, value: string, set: (v: string) => void) => (
    <label className="bs-input"><span>{t(label)}</span><span className="bs-input-box"><input inputMode="numeric" value={value} onChange={(ev) => set(ev.target.value)} /><span>mAh</span></span></label>
  );
  let left;
  let body;
  let footer;
  if (phase === "used") {
    left = (
      <div className="bs-used">
        <b>{pack.used != null ? Math.round(pack.used).toLocaleString() : "—"}</b>
        <span>{t("mAh used, counted by the board since it started")}</span>
      </div>
    );
    body = (
      <>
        <div className="mw-headline"><h3>{t("Fly a pack, then charge it")}</h3><p>{t("The board counts the mAh it used. The charger counts the mAh it puts back. If the current sensor is right, the two match.")}</p></div>
        {input("Used, by the board", usedText, setUsedText)}
        <div className="mw-note warn">{Icon.warn()}<span>{t("The count resets when the board restarts. Fill it in before you unplug the pack, or ask the assistant to read it from the flight log.")}</span></div>
        {!analog ? <div className="mw-note warn">{Icon.warn()}<span>{t("This sensor keeps its own current scale.")}</span></div> : null}
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={leave}>{t("Cancel")}</button>
        <button type="button" className="mw-btn primary" disabled={!analog || used == null || used <= 0 || perVolt == null} onClick={() => setPhase("charger")}><span>{t("Next")}</span>{Icon.chevR()}</button>
      </>
    );
  } else if (phase === "charger") {
    left = (
      <div className="bs-cmp">
        <div><span>{t("Board counted")}</span><b className="warn">{used != null ? `${Math.round(used)} mAh` : "—"}</b></div>
        {Icon.chevR("var(--dim)", 18)}
        <div><span>{t("Charger")}</span><b className="ok">{charged != null ? `${Math.round(charged)} mAh` : "—"}</b></div>
      </div>
    );
    body = (
      <>
        <div className="mw-headline"><h3>{t("Type what the charger put back")}</h3><p>{t("After a full balance charge, most chargers show the mAh added.")}</p></div>
        {input("Charger put back", chargedText, setChargedText)}
        {diff != null ? <span className="mw-dim mw-sm">{t(diff > 0 ? "The board reads {n}% low." : "The board reads {n}% high.", { n: Math.abs(diff * 100).toFixed(1) })}</span> : null}
        <span className="mw-dim mw-sm">{t("Chargers count a little high from losses; under 3% is within that and is left as it is. A storage charge does not count.")}</span>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={() => setPhase("used")}>{t("Back")}</button>
        <button type="button" className="mw-btn primary" disabled={!ready || busy || charged == null || charged <= 0 || diff == null || Math.abs(diff) > 0.6} onClick={() => void save()}><span>{t("Next")}</span>{Icon.chevR()}</button>
      </>
    );
  } else {
    left = (
      <div className="bs-cmp">
        <div><span>{t("Board counted")}</span><b className="warn">{result ? `${Math.round(result.used)} mAh` : "—"}</b></div>
        {Icon.chevR("var(--dim)", 18)}
        <div><span>{t("Charger")}</span><b className="ok">{result ? `${Math.round(result.charged)} mAh` : "—"}</b></div>
      </div>
    );
    body = result?.to == null ? (
      <div className="mw-headline"><h3>{t("The current sensor is right")}</h3><p>{t("Within 3% of the charger. Nothing changed.")}</p></div>
    ) : (
      <>
        <div className="mw-headline"><h3>{t("Saved")}</h3><p>{t("It applies from the next flight. Check again after one more pack: two flights within 3% means the scale is right.")}</p></div>
        <div className="mw-sums"><div className="mw-sum"><span className="mw-dim mw-sm">{t("Current scale")}</span><b>{`${result.from.toFixed(2)} → ${result.to.toFixed(2)}`}</b><span className="mw-dim mw-sm">BATT_AMP_PERVLT · ×{(result.to / result.from).toFixed(3)}</span></div></div>
      </>
    );
    footer = (
      <>
        <span />
        <button type="button" className="mw-btn primary" onClick={leave}>{t("Close")}</button>
      </>
    );
  }
  return (
    <SensorWizard
      title={t("Scale the current from a charge")}
      fromAssistant={fromAssistant}
      steps={[t("After a flight"), t("Charger"), t("Result")]}
      step={phase === "used" ? 0 : phase === "charger" ? 1 : 2}
      left={left}
      body={<>{body}{message ? <div className="mw-note warn">{Icon.warn()}<span>{t(message)}</span></div> : null}</>}
      footer={footer}
      blocker={null}
      busy={busy}
      onClose={leave}
    />
  );
}
