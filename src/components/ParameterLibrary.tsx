import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { send } from "../mav/cmd";
import { getSnapshot, subscribe } from "../mav/store";

type Category = "all" | "flight" | "navigation" | "sensors" | "radio" | "power" | "outputs" | "safety" | "system" | "other";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "flight", label: "Flight control" },
  { id: "navigation", label: "Navigation" },
  { id: "sensors", label: "Sensors" },
  { id: "radio", label: "Radio" },
  { id: "power", label: "Power" },
  { id: "outputs", label: "Outputs" },
  { id: "safety", label: "Safety" },
  { id: "system", label: "System" },
  { id: "other", label: "Other" },
];

function categoryOf(name: string): Category {
  if (/^(?:ARMING|FS|FAILSAFE|FENCE|BRD_SAFETY|LAND|CRASH)(?:_|$|\d)/.test(name)) return "safety";
  if (/^(?:SYSID|BRD|SERIAL|LOG|SCHED|CAN|STAT|FORMAT|GCS|MAV|AUTH|FRAME)(?:_|$|\d)/.test(name)) return "system";
  if (/^(?:ATC|PSC|LOIT|WPNAV|PILOT|MOT|ACRO|ANGLE|THR|FLTD|FHLD|AUTOTUNE)(?:_|$|\d)/.test(name)) return "flight";
  if (/^(?:WP|RTL|AVOID|OA|MIS|RALLY|TERRAIN|CIRCLE|GUID)(?:_|$|\d)/.test(name)) return "navigation";
  if (/^(?:INS|EK[23]|AHRS|COMPASS|BARO|GPS|FLOW|OPTICALFLOW|RNGFND|RANGEFINDER|VISO|ARSPD)(?:_|$|\d)/.test(name)) return "sensors";
  if (/^(?:RC|RSSI|FLTMODE|MODE|BTN|JSTICK)(?:_|$|\d)/.test(name)) return "radio";
  if (/^(?:BATT|BCL|FUEL|ESC|MOT_BAT)(?:_|$|\d)/.test(name)) return "power";
  if (/^(?:SERVO|RELAY|CAM|MOUNT|GRIP|LED|NTF|OSD|VTX|RUNCAM)(?:_|$|\d)/.test(name)) return "outputs";
  return "other";
}

function numberLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(8)));
}

export function ParameterLibrary({ onLoops, onFirmware }: { onLoops: () => void; onFirmware: () => void }) {
  const tr = useT();
  const sample = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    if (sample.ok) send({ op: "params_list" });
  }, [sample.ok]);

  const entries = useMemo(
    () => Object.entries(sample.params ?? {}).filter(([, value]) => Number.isFinite(value)).sort(([a], [b]) => a.localeCompare(b)),
    [sample.params],
  );
  const counts = useMemo(() => {
    const next: Record<Category, number> = { all: entries.length, flight: 0, navigation: 0, sensors: 0, radio: 0, power: 0, outputs: 0, safety: 0, system: 0, other: 0 };
    entries.forEach(([name]) => { next[categoryOf(name)] += 1; });
    return next;
  }, [entries]);
  const visible = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return entries.filter(([name]) => (category === "all" || categoryOf(name) === category) && (!needle || name.includes(needle)));
  }, [category, entries, query]);

  function refresh() {
    send({ op: "params_list" });
    addLog(tr("Parameter refresh requested"), "cmd");
  }

  function save(name: string, current: number) {
    const raw = drafts[name] ?? numberLabel(current);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setStatus((all) => ({ ...all, [name]: tr("Enter a number") }));
      return;
    }
    send({ op: "param", name, value });
    setDrafts((all) => ({ ...all, [name]: numberLabel(value) }));
    setStatus((all) => ({ ...all, [name]: tr("Writing…") }));
    addLog(`${name} = ${numberLabel(value)}`, "cmd");
  }

  return (
    <section className="scope param-library">
      <div className="param-head">
        <div className="firmware-tabs" role="tablist" aria-label={tr("Workspace")}>
          <button type="button" role="tab" aria-selected={false} onClick={onLoops}>{tr("loops")}</button>
          <button type="button" role="tab" aria-selected={false} onClick={onFirmware}>{tr("controller")}</button>
          <button type="button" role="tab" aria-selected>{tr("params")}</button>
        </div>
        <button type="button" className="firmware-refresh" onClick={refresh} disabled={!sample.ok}>{tr("Refresh parameters")}</button>
      </div>
      <div className="param-summary">
        <b>{tr("Parameters")}</b>
        <span>{tr("Parameters received: {count}", { count: entries.length })}</span>
      </div>
      <label className="param-search">
        <span className="sr-only">{tr("Search parameters")}</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr("Search parameters")} autoComplete="off" spellCheck={false} />
      </label>
      <div className="param-workspace">
        <nav className="param-categories" aria-label={tr("Parameter categories")}>
          {CATEGORIES.map((item) => (
            <button key={item.id} type="button" className={category === item.id ? "on" : undefined} onClick={() => setCategory(item.id)}>
              <span>{tr(item.label)}</span><small>{counts[item.id]}</small>
            </button>
          ))}
        </nav>
        <div className="param-list" aria-live="polite">
          {!entries.length ? <p className="firmware-empty">{tr("No cached parameters yet.")}</p> : null}
          {entries.length && !visible.length ? <p className="firmware-empty">{tr("No parameters match this filter.")}</p> : null}
          {visible.map(([name, value]) => {
            const pending = drafts[name];
            const shown = pending ?? numberLabel(value);
            return (
              <form className="param-row" key={name} onSubmit={(event) => { event.preventDefault(); save(name, value); }}>
                <label htmlFor={`param-${name}`}><code>{name}</code><small>{tr(CATEGORIES.find((item) => item.id === categoryOf(name))?.label ?? "Other")}</small></label>
                <input id={`param-${name}`} value={shown} onChange={(event) => {
                  const next = event.target.value;
                  setDrafts((all) => ({ ...all, [name]: next }));
                  setStatus((all) => ({ ...all, [name]: "" }));
                }} inputMode="decimal" spellCheck={false} aria-label={name} />
                <button type="submit" disabled={!sample.ok || shown === numberLabel(value)}>{tr("Save")}</button>
                {status[name] ? <span className="param-status" role="status">{status[name]}</span> : null}
              </form>
            );
          })}
        </div>
      </div>
    </section>
  );
}
