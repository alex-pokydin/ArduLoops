import { useMemo, useState, type FormEvent } from "react";
import { useT } from "../i18n/i18n";
import { getLatest } from "../mav/store";
import type { Sample } from "../mav/types";
import { useStorePicked } from "../mav/view";

type Vehicle = "copter" | "plane";
type Preset = { id: string; label: string; unit: string; digits: number; pick: (s: Sample) => number | null | undefined };

const STORE = "arduloops.readouts.";
const MAX = 8;
const CUSTOM = "f:";

function num(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function amps(s: Sample): number | null {
  const ca = s.live_nums?.["SYS_STATUS.current_battery"];
  return typeof ca === "number" && ca >= 0 ? ca / 100 : null;
}

// The craft HUD already shows mode, AGL and climb, vibration, clipping and battery; the link chip shows the attitude rate.
const PRESETS: Preset[] = [
  { id: "gspd", label: "Ground speed", unit: "m/s", digits: 1, pick: (s) => s.gspd },
  { id: "aspd", label: "Airspeed", unit: "m/s", digits: 1, pick: (s) => s.aspd },
  { id: "hdg", label: "Heading", unit: "°", digits: 0, pick: (s) => s.hdg },
  { id: "thr", label: "Throttle", unit: "%", digits: 0, pick: (s) => s.thr_out },
  { id: "alt_tar", label: "Altitude target", unit: "m", digits: 1, pick: (s) => s.alt_tar },
  { id: "amps", label: "Current", unit: "A", digits: 1, pick: amps },
  { id: "sats", label: "GPS sats", unit: "", digits: 0, pick: (s) => s.gps_sats },
  { id: "rng", label: "Rangefinder", unit: "m", digits: 2, pick: (s) => s.rng_m },
];

const DEFAULTS: Record<Vehicle, string[]> = {
  copter: ["gspd", "hdg", "sats"],
  plane: ["aspd", "gspd", "thr"],
};

function load(vehicle: Vehicle): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE + vehicle) || "null");
    if (Array.isArray(raw)) {
      return raw
        .filter((id): id is string => typeof id === "string" && (id.startsWith(CUSTOM) || PRESETS.some((p) => p.id === id)))
        .slice(0, MAX);
    }
  } catch {
    /* ignore */
  }
  return DEFAULTS[vehicle];
}

function save(vehicle: Vehicle, ids: string[]) {
  try {
    localStorage.setItem(STORE + vehicle, JSON.stringify(ids));
  } catch {
    /* ignore quota / private mode */
  }
}

function fieldName(key: string): string {
  return key.slice(key.indexOf(".") + 1);
}

function customDigits(value: number): number {
  const abs = Math.abs(value);
  if (Number.isInteger(value)) return 0;
  return abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
}

/** Live values under the craft. The set is chosen per vehicle type and kept in this browser. */
export function Readouts({ vehicle }: { vehicle: Vehicle }) {
  const t = useT();
  const [ids, setIds] = useState<string[]>(() => load(vehicle));
  const [editing, setEditing] = useState(false);
  const [field, setField] = useState("");
  const [shownFor, setShownFor] = useState(vehicle);
  if (shownFor !== vehicle) {
    setShownFor(vehicle);
    setIds(load(vehicle));
  }

  const values = useStorePicked(
    (s) =>
      ids.map((id) => {
        if (id.startsWith(CUSTOM)) {
          const v = num(s.live_nums?.[id.slice(CUSTOM.length)]);
          return v == null ? "—" : v.toFixed(customDigits(v));
        }
        const p = PRESETS.find((x) => x.id === id);
        if (!p) return "—";
        const v = num(p.pick(s));
        if (v == null) return "—";
        return (Math.abs(v) < 0.5 * 10 ** -p.digits ? 0 : v).toFixed(p.digits);
      }),
    (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  );

  const liveKeys = useMemo(
    () => (editing ? Object.keys(getLatest().live_nums || {}).sort() : []),
    [editing],
  );

  function update(next: string[]) {
    const clean = next.slice(0, MAX);
    setIds(clean);
    save(vehicle, clean);
  }

  function toggle(id: string) {
    update(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  function addField(ev: FormEvent) {
    ev.preventDefault();
    const key = field.trim();
    if (!/^[A-Z0-9_]+\.[A-Za-z0-9_]+$/.test(key)) return;
    const id = CUSTOM + key;
    if (!ids.includes(id)) update([...ids, id]);
    setField("");
  }

  const custom = ids.filter((id) => id.startsWith(CUSTOM));
  const full = ids.length >= MAX;

  return (
    <section className={editing ? "readouts editing" : "readouts"} aria-label={t("Readouts")}>
      <div className="ro-grid">
        <div className="ro-tiles">
        {ids.map((id, i) => {
          const p = PRESETS.find((x) => x.id === id);
          const label = p ? t(p.label) : fieldName(id.slice(CUSTOM.length));
          const unit = p ? p.unit : "";
          return (
            <div className="ro-tile" key={id} title={p ? undefined : id.slice(CUSTOM.length)}>
              <span>{label}</span>
              <b>
                {values[i]}
                {unit && values[i] !== "—" ? <em>{unit}</em> : null}
              </b>
            </div>
          );
        })}
        </div>
        <button
          type="button"
          className={editing ? "ro-edit on" : "ro-edit"}
          aria-expanded={editing}
          aria-label={editing ? t("Done") : t("Choose readouts")}
          title={editing ? t("Done") : t("Choose readouts")}
          onClick={() => setEditing((on) => !on)}
        >
          {editing ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="10" cy="17" r="2" />
            </svg>
          )}
        </button>
      </div>
      {editing ? (
        <div className="ro-pick">
          <p>{t("Shown for every {vehicle} in this browser. Up to {max}.", { vehicle: t(vehicle), max: MAX })}</p>
          <div className="ro-chips" role="group" aria-label={t("Predefined")}>
            {PRESETS.map((p) => {
              const on = ids.includes(p.id);
              return (
                <button key={p.id} type="button" aria-pressed={on} disabled={!on && full} onClick={() => toggle(p.id)}>
                  {t(p.label)}
                </button>
              );
            })}
            {custom.map((id) => (
              <button key={id} type="button" aria-pressed="true" className="custom" title={t("Remove")} onClick={() => toggle(id)}>
                {id.slice(CUSTOM.length)} <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
          <form className="ro-add" onSubmit={addField}>
            <input
              value={field}
              onChange={(ev) => setField(ev.target.value)}
              list="ro-fields"
              spellCheck={false}
              autoComplete="off"
              aria-label={t("MAVLink field")}
              placeholder="VFR_HUD.alt"
              disabled={full}
            />
            <datalist id="ro-fields">
              {liveKeys.map((key) => (
                <option key={key} value={key} />
              ))}
            </datalist>
            <button type="submit" disabled={full || !field.trim()}>
              {t("Add")}
            </button>
          </form>
          <button type="button" className="ro-reset" onClick={() => update(DEFAULTS[vehicle])}>
            {t("Reset to default")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
