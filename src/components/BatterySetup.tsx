import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { noteUi, sameParam, writeParam } from "../mav/cmd";
import { getLatest, getSetupSnapshot, getSnapshot, subscribe } from "../mav/store";
import { paramNum, type WizardClose } from "../wizards/close";

const MONITORS: { value: number; label: string }[] = [
  { value: 4, label: "Analog voltage and current" },
  { value: 3, label: "Analog voltage only" },
  { value: 8, label: "DroneCAN battery" },
  { value: 9, label: "ESC telemetry" },
  { value: 21, label: "INA2xx" },
  { value: 0, label: "No monitor" },
];

const VOLT_SCALE = new Set([3, 4, 25]);
const AMP_SCALE = new Set([4, 31]);

const STEPS = ["Sensor and capacity", "Voltage and current", "Review"] as const;
type Phase = "pack" | "meter" | "check";

function liveNum(nums: Record<string, number> | undefined, key: string): number | null {
  const value = nums?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function packVoltage(nums: Record<string, number> | undefined): number | null {
  const mv = liveNum(nums, "SYS_STATUS.voltage_battery");
  if (mv == null || mv <= 0 || mv >= 65535) return null;
  return mv / 1000;
}

function packCurrent(nums: Record<string, number> | undefined): number | null {
  const ca = liveNum(nums, "BATTERY_STATUS.current_battery") ?? liveNum(nums, "SYS_STATUS.current_battery");
  if (ca == null || ca < 0) return null;
  return ca / 100;
}

function packUsed(nums: Record<string, number> | undefined): number | null {
  const mah = liveNum(nums, "BATTERY_STATUS.current_consumed");
  if (mah == null || mah < 0) return null;
  return mah;
}

function parseNum(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function showNum(value: number): string {
  return String(round3(value));
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

export function BatterySetup({ onClose }: { onClose: (report?: WizardClose) => void }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const params = sample.params ?? {};
  const storedMonitor = paramNum(params, "BATT_MONITOR");
  const storedCap = paramNum(params, "BATT_CAPACITY");
  const ampStored = paramNum(params, "BATT_AMP_PERVLT");
  const [phase, setPhase] = useState<Phase>("pack");
  const [monitor, setMonitor] = useState<number | null>(storedMonitor == null ? null : Math.round(storedMonitor));
  const [capText, setCapText] = useState(storedCap == null ? "" : String(Math.round(storedCap)));
  const [meterText, setMeterText] = useState("");
  const [ampText, setAmpText] = useState(ampStored == null ? "" : showNum(ampStored));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const monitorKey = storedMonitor == null ? "" : String(Math.round(storedMonitor));
  const capKey = storedCap == null ? "" : String(Math.round(storedCap));
  const ampKey = ampStored == null ? "" : String(ampStored);
  useEffect(() => { setMonitor(storedMonitor == null ? null : Math.round(storedMonitor)); }, [monitorKey]);
  useEffect(() => { setCapText(storedCap == null ? "" : String(Math.round(storedCap))); }, [capKey]);
  useEffect(() => { setAmpText(ampStored == null ? "" : showNum(ampStored)); }, [ampKey]);

  const volts = packVoltage(sample.live_nums);
  const amps = packCurrent(sample.live_nums);
  const used = packUsed(sample.live_nums);
  const choices = monitor != null && !MONITORS.some((item) => item.value === monitor)
    ? [{ value: monitor, label: "Sensor {n}" }, ...MONITORS]
    : MONITORS;

  function leave() {
    const latest = getSnapshot().params;
    const live = getLatest().live_nums;
    onClose({
      outcome: phaseRef.current === "check" ? "completed" : "cancelled",
      measures: {
        phase: phaseRef.current,
        BATT_MONITOR: paramNum(latest, "BATT_MONITOR"),
        BATT_CAPACITY: paramNum(latest, "BATT_CAPACITY"),
        BATT_VOLT_MULT: paramNum(latest, "BATT_VOLT_MULT"),
        BATT_AMP_PERVLT: paramNum(latest, "BATT_AMP_PERVLT"),
        BATT_AMP_OFFSET: paramNum(latest, "BATT_AMP_OFFSET"),
        voltage: packVoltage(live),
        current: packCurrent(live),
        consumed_mah: packUsed(live),
      },
    });
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function savePack() {
    if (busy) return;
    const pairs: [string, number][] = [];
    if (monitor != null) pairs.push(["BATT_MONITOR", monitor]);
    const cap = parseNum(capText);
    if (cap != null && cap > 0) pairs.push(["BATT_CAPACITY", Math.round(cap)]);
    if (!pairs.length) {
      setMessage("Battery parameters have not arrived.");
      return;
    }
    setBusy(true);
    setMessage("");
    const err = await writeList(pairs);
    setBusy(false);
    setMessage(err ?? "Saved.");
  }

  async function matchMeter() {
    if (busy) return;
    const mult = paramNum(params, "BATT_VOLT_MULT");
    const meter = parseNum(meterText);
    if (volts == null || volts < 1 || meter == null || meter < 1 || meter > 80 || mult == null || mult === 0) {
      setMessage("Type the meter voltage while the board is reading a pack.");
      return;
    }
    setBusy(true);
    setMessage("");
    const err = await writeList([["BATT_VOLT_MULT", round3(mult * (meter / volts))]]);
    setBusy(false);
    setMessage(err ?? "Saved.");
  }

  async function saveAmps() {
    if (busy) return;
    const scale = parseNum(ampText);
    if (scale == null || scale <= 0) {
      setMessage("Type the amps per volt from the sensor.");
      return;
    }
    setBusy(true);
    setMessage("");
    const err = await writeList([["BATT_AMP_PERVLT", round3(scale)]]);
    setBusy(false);
    setMessage(err ?? "Saved.");
  }

  async function zeroCurrent() {
    if (busy) return;
    const scale = paramNum(params, "BATT_AMP_PERVLT");
    const offset = paramNum(params, "BATT_AMP_OFFSET");
    if (amps == null || scale == null || scale === 0 || offset == null) {
      setMessage("Current parameters have not arrived.");
      return;
    }
    setBusy(true);
    setMessage("");
    const err = await writeList([["BATT_AMP_OFFSET", round3(offset + amps / scale)]]);
    setBusy(false);
    setMessage(err ?? "Saved.");
  }

  const step = phase === "pack" ? 0 : phase === "meter" ? 1 : 2;
  const voltScale = monitor != null && VOLT_SCALE.has(monitor);
  const ampScale = monitor != null && AMP_SCALE.has(monitor);

  return createPortal(
    <div className="modal-back" role="presentation">
      <div className="modal orient-wizard" role="dialog" aria-modal="true" aria-labelledby="batt-title">
        <div className="modal-head">
          <h2 id="batt-title">{t("Battery setup")}</h2>
          <button type="button" className="modal-x" disabled={busy} onClick={leave} aria-label={t("Close")} title={t("Close")}>×</button>
        </div>
        <ol className="orient-steps">
          {STEPS.map((name, index) => (
            <li key={name} className={index === step ? "on" : index < step ? "done" : ""}>{t(name)}</li>
          ))}
        </ol>
        {phase === "pack" ? (
          <>
            <p className="mag-line">{t("Pick how the board reads the pack, and the mAh printed on it. Save stores them. Next leaves them as they are.")}</p>
            <div className="batt-cards">
              {choices.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={monitor === item.value ? "is-on" : ""}
                  onClick={() => setMonitor(item.value)}
                >
                  {t(item.label, item.label === "Sensor {n}" ? { n: item.value } : undefined)}
                </button>
              ))}
            </div>
            <label className="batt-field">
              <span>{t("Capacity, mAh")}</span>
              <input inputMode="numeric" value={capText} onChange={(ev) => setCapText(ev.target.value)} />
            </label>
            <div className="wiz-apply">
              <button type="button" className="wiz-quiet" disabled={busy} onClick={() => void savePack()}>{busy ? t("Writing…") : t("Save the pack")}</button>
              <button type="button" className="wiz-go" disabled={busy} onClick={() => { setMessage(""); setPhase("meter"); }}>{t("Next")}</button>
            </div>
          </>
        ) : null}
        {phase === "meter" ? (
          <>
            <p className="mag-line">{t("Props off. Motors stopped. Match and zero are optional. Next leaves them as they are.")}</p>
            <p className={volts == null ? "mag-line warn" : "mag-line ok"}>
              {volts == null ? t("No battery reading yet.") : t("The board reads {v} V.", { v: volts.toFixed(2) })}
            </p>
            <label className="batt-field">
              <span>{t("Meter, V")}</span>
              <input inputMode="decimal" value={meterText} onChange={(ev) => setMeterText(ev.target.value)} />
            </label>
            {voltScale ? (
              <div className="wiz-apply">
                <button type="button" className="wiz-quiet" disabled={busy} onClick={() => void matchMeter()}>{t("Match the meter")}</button>
              </div>
            ) : <p className="mag-line">{t("This sensor keeps its own voltage scale.")}</p>}
            <p className={amps == null ? "mag-line warn" : "mag-line ok"}>
              {amps == null ? t("No current reading yet.") : t("The board reads {a} A.", { a: amps.toFixed(2) })}
            </p>
            {ampScale ? (
              <>
                <label className="batt-field">
                  <span>{t("Amps per volt")}</span>
                  <input inputMode="decimal" value={ampText} onChange={(ev) => setAmpText(ev.target.value)} />
                </label>
                <div className="wiz-apply">
                  <button type="button" className="wiz-quiet" disabled={busy} onClick={() => void saveAmps()}>{t("Save amps per volt")}</button>
                  <button type="button" className="wiz-quiet" disabled={busy} onClick={() => void zeroCurrent()}>{t("Zero the current")}</button>
                </div>
              </>
            ) : <p className="mag-line">{t("This sensor keeps its own current scale.")}</p>}
            <div className="wiz-apply">
              <button type="button" className="wiz-quiet" disabled={busy} onClick={() => { setMessage(""); setPhase("pack"); }}>{t("Back")}</button>
              <button type="button" className="wiz-go" disabled={busy} onClick={() => { setMessage(""); setPhase("check"); }}>{t("Next")}</button>
            </div>
          </>
        ) : null}
        {phase === "check" ? (
          <>
            <p className="mag-line">{t("Voltage, current, and what the pack has given so far.")}</p>
            <p className="mag-line ok">{volts == null ? "—" : t("{v} V", { v: volts.toFixed(2) })}</p>
            <p className="mag-line ok">{amps == null ? "—" : t("{a} A", { a: amps.toFixed(2) })}</p>
            <p className="mag-line">{used == null ? "—" : t("Consumed {n} mAh", { n: Math.round(used) })}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-quiet" disabled={busy} onClick={() => setPhase("meter")}>{t("Back")}</button>
              <button type="button" className="wiz-go" disabled={busy} onClick={leave}>{t("Close")}</button>
            </div>
          </>
        ) : null}
        {message ? <p className="mag-line" role="status">{t(message)}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

export function BatteryWizard() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const [open, setOpen] = useState(false);
  return (
    <div className="wiz">
      <p className="wiz-msg">{t("Save stores the sensor and the capacity. Matching the meter and zeroing the current are optional.")}</p>
      <div className="wiz-apply">
        <button type="button" className="wiz-go" disabled={!sample.ok} onClick={() => setOpen(true)}>{t("Set up the battery")}</button>
      </div>
      {open ? <BatterySetup onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
