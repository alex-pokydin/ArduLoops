import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { runtimeLabParams } from "../mav/labInit";
import { send } from "../mav/cmd";
import { SITL_LINK } from "../mav/link";
import {
  catalogDef,
  isSitl,
  geoToDegrees,
  geoToMeters,
  resolveSimKey,
  SIM_ENGINE_FAIL,
  SIM_GROUPS,
  SIM_PARAM_KEYS,
  type SimGroup,
  type SimKnob,
  writeSimKeys,
} from "../mav/sim";
import type { Sample } from "../mav/types";
import { useStorePicked } from "../mav/view";

const MOTOR_BITS = [0, 1, 2, 3];

export function SimRail({
  open,
  onSitlLink,
}: {
  open: boolean;
  onSitlLink: (url: string) => void;
}) {
  const sample = useStorePicked(
    (s) => s,
    (a, b) =>
      open
        ? a === b
        : a.ok === b.ok &&
          a.frame === b.frame &&
          a.detail === b.detail &&
          a.sitl_running === b.sitl_running &&
          a.sitl_phase === b.sitl_phase,
  );
  const t = useT();
  const params = sample.params || {};
  const sitl = isSitl(params);
  const snap = useRef<Record<string, number>>({});
  const asked = useRef(false);

  useEffect(() => {
    if (!sample.ok) {
      snap.current = {};
      asked.current = false;
      return;
    }
    if (open && !asked.current) {
      asked.current = true;
      for (const name of SIM_PARAM_KEYS) send({ op: "param_read", name });
    }
    const next = { ...snap.current };
    let added = false;
    for (const name of SIM_PARAM_KEYS) {
      if (next[name] == null && params[name] != null) {
        next[name] = params[name];
        added = true;
      }
    }
    if (added) snap.current = next;
  }, [sample.ok, open, params]);

  useEffect(() => {
    if (!open || !sample.ok) return;
    const id = window.setTimeout(() => {
      for (const name of SIM_PARAM_KEYS) {
        if (params[name] == null) send({ op: "param_read", name });
      }
    }, 700);
    return () => window.clearTimeout(id);
  }, [open, sample.ok]);

  function onReset() {
    const seen = snap.current;
    const names = SIM_PARAM_KEYS.filter((n) => params[n] != null);
    if (!names.length) return;
    for (const name of names) {
      const v = seen[name] ?? catalogDef(name);
      if (v == null) continue;
      send({ op: "param", name, value: v });
    }
    addLog(t("Restore simulation defaults"), "cmd");
  }

  return (
    <aside className="sim-rail" aria-label={t("Simulation")} hidden={!open} inert={!open || undefined}>
      <div className="sim-body">
        <SitlLaunch sample={sample} onSitlLink={onSitlLink} onReset={onReset} />
        {sitl
          ? SIM_GROUPS.map((g) => <SimSection key={g.id} group={g} sample={sample} />)
          : null}
      </div>
    </aside>
  );
}

const SITL_PREF = "arduloops.sitl";
const DEFAULT_HOME = "-35.363261,149.165230,584,353";

type SitlPrefs = {
  vehicle: "copter" | "plane";
  wipe: boolean;
  home: string;
  speedup: number;
};

function loadSitlPrefs(): SitlPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(SITL_PREF) || "");
    const vehicle = raw.vehicle === "plane" ? "plane" : "copter";
    const wipe = !!raw.wipe;
    const home = typeof raw.home === "string" && raw.home.trim() ? raw.home.trim() : DEFAULT_HOME;
    const speedup = Math.min(10, Math.max(1, Math.round(Number(raw.speedup) || 1)));
    return { vehicle, wipe, home, speedup };
  } catch {
    return { vehicle: "copter", wipe: false, home: DEFAULT_HOME, speedup: 1 };
  }
}

function saveSitlPrefs(p: SitlPrefs): void {
  try {
    localStorage.setItem(SITL_PREF, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function SecIcon({ id }: { id: string }) {
  return (
    <svg className="sim-ico" viewBox="0 0 12 12" aria-hidden="true">
      {id === "init" ? <path d="M6 1.5v5.2M3.6 4.5 6 7.1l2.4-2.6M2 10.3h8" /> : null}
      {id === "home" ? (
        <>
          <path d="M6 1.7a2.7 2.7 0 0 0-2.7 2.7c0 2.1 2.7 5.8 2.7 5.8s2.7-3.7 2.7-5.8A2.7 2.7 0 0 0 6 1.7z" />
          <circle cx="6" cy="4.4" r=".9" fill="currentColor" stroke="none" />
        </>
      ) : null}
      {id === "speed" ? <path d="M1.8 3.2 5 6 1.8 8.8M6.2 3.2 9.4 6 6.2 8.8" /> : null}
      {id === "wind" ? <path d="M1.4 3.2c1.6-1.5 3.2-1.5 4.8 0s3.2 1.5 4.4 0M1.4 6c1.6-1.5 3.2-1.5 4.8 0s3.2 1.5 4.4 0M1.4 8.8c1.6-1.5 3.2-1.5 4.8 0" /> : null}
      {id === "gps" ? (
        <>
          <circle cx="6" cy="6" r="2.3" />
          <path d="M6 1.4v1.7M6 8.9v1.7M1.4 6h1.7M8.9 6h1.7" />
        </>
      ) : null}
      {id === "rc" ? (
        <>
          <circle cx="6" cy="3.2" r="1.5" />
          <path d="M6 4.7v5.2M3.2 10.2h5.6" />
        </>
      ) : null}
      {id === "motors" ? (
        <>
          <circle cx="6" cy="6" r="1.15" />
          <path d="M6 1.8v2.5M6 7.7v2.5M1.8 6h2.5M7.7 6h2.5" />
        </>
      ) : null}
      {id === "imu" ? <path d="M2.4 9.6V3.1M2.4 9.6H9M2.4 9.6 8.2 3.8" /> : null}
      {id === "mag" ? (
        <>
          <circle cx="6" cy="6" r="4" />
          <path d="M6 2.6 7.3 6.6 6 5.7 4.7 6.6Z" fill="currentColor" stroke="none" />
        </>
      ) : null}
      {id === "baro" ? <path d="M2 8.6a4.2 4.2 0 0 1 8 0M6 8.4 8 4.6" /> : null}
      {id === "batt" ? <path d="M2 3.4h6.2v5.4H2zM8.2 4.8h1.4v2.4H8.2M3.2 4.8h2.4" /> : null}
    </svg>
  );
}

function SitlThumb({ kind }: { kind: "copter" | "plane" }) {
  if (kind === "copter") {
    return (
      <svg viewBox="0 0 96 72" aria-hidden="true">
        <g fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
          <line x1="24" y1="16" x2="72" y2="56" fill="none" />
          <line x1="72" y1="16" x2="24" y2="56" fill="none" />
          <circle cx="24" cy="16" r="11" />
          <circle cx="72" cy="16" r="11" />
          <circle cx="24" cy="56" r="11" />
          <circle cx="72" cy="56" r="11" />
          <rect x="38" y="28" width="20" height="16" rx="3" />
          <polygon points="48,17 42,29 54,29" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 96 72" aria-hidden="true">
      <g fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
        <polygon points="48,5 43,18 53,18" />
        <rect x="44.5" y="16" width="7" height="46" rx="2" />
        <polygon points="6,36 48,27 90,36 48,41" />
        <polygon points="32,56 48,52 64,56 48,62" />
      </g>
    </svg>
  );
}

function sitlLine(sample: Sample, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const phase = sample.sitl_phase || "idle";
  const vehicle = sample.sitl_vehicle === "plane" ? "plane" : "copter";
  const detail = sample.sitl_detail || "";
  const load =
    sample.sitl_running && (sample.sitl_rss_mb || 0) > 0
      ? " · " +
        t("{cpu}% · {ram} MB", {
          cpu: Math.round(sample.sitl_cpu || 0),
          ram: Math.round(sample.sitl_rss_mb || 0),
        })
      : "";
  if (phase === "download") return t("Downloading {file}", { file: detail || "SITL" });
  if (phase === "start") return t("Starting {vehicle}…", { vehicle: t(vehicle) });
  if (phase === "run") {
    const hb = sample.frame === "plane" || sample.frame === "copter" ? sample.frame : "";
    if (sample.ok && hb === vehicle) {
      return t("Running {vehicle} · tcp 5770", { vehicle: t(vehicle) }) + load;
    }
    return t("Waiting for HEARTBEAT on 5770") + load;
  }
  if (phase === "error") return t("SITL error: {err}", { err: detail || "?" });
  return t("SITL stopped");
}

function SitlLaunch({
  sample,
  onSitlLink,
  onReset,
}: {
  sample: Sample;
  onSitlLink: (url: string) => void;
  onReset: () => void;
}) {
  const t = useT();
  const [prefs, setPrefs] = useState(loadSitlPrefs);
  const phase = sample.sitl_phase || "idle";
  const running = !!sample.sitl_running;
  const busy = phase === "download" || phase === "start";

  function setPref(next: Partial<SitlPrefs>) {
    setPrefs((p) => {
      const merged = { ...p, ...next };
      saveSitlPrefs(merged);
      return merged;
    });
  }

  function onStart() {
    onSitlLink(SITL_LINK);
    send({
      op: "sitl_start",
      vehicle: prefs.vehicle,
      wipe: prefs.wipe,
      home: prefs.home,
      speedup: prefs.speedup,
    });
    addLog(t("Start") + " · " + t(prefs.vehicle), "cmd");
  }

  function onStop() {
    send({ op: "sitl_stop" });
    addLog(t("Stop"), "cmd");
  }

  const liveSpeed = sample.params?.SIM_SPEEDUP;
  const speedTimer = useRef(0);
  const dragging = useRef(false);
  const [speed, setSpeed] = useState(prefs.speedup);
  /** Firmware Range is 1–10; below 1 is wiki slow-mo. Tiny speedup is our pause. */
  const simPaused = liveSpeed != null && liveSpeed < 0.5;

  useEffect(() => {
    if (dragging.current) return;
    if (liveSpeed != null && liveSpeed >= 0.5) {
      setSpeed(Math.min(10, Math.max(1, Math.round(liveSpeed))));
      return;
    }
    if (!running) setSpeed(prefs.speedup);
  }, [running, liveSpeed, prefs.speedup]);

  function writeSpeed(v: number, log: string) {
    send({ op: "param", name: "SIM_SPEEDUP", value: v });
    addLog(log, "cmd");
  }

  function onSpeed(v: number, logIt: boolean) {
    dragging.current = !logIt;
    setSpeed(v);
    setPref({ speedup: v });
    if (liveSpeed == null || simPaused) {
      if (logIt) dragging.current = false;
      return;
    }
    const fire = () => {
      send({ op: "param", name: "SIM_SPEEDUP", value: v });
      if (logIt) addLog(`SIM_SPEEDUP ${v}`, "cmd");
    };
    window.clearTimeout(speedTimer.current);
    if (logIt) {
      dragging.current = false;
      fire();
    } else {
      speedTimer.current = window.setTimeout(fire, 70);
    }
  }

  function onSimPause() {
    if (liveSpeed == null) return;
    if (simPaused) {
      writeSpeed(speed, `SIM_SPEEDUP ${speed}`);
      return;
    }
    const keep = Math.min(10, Math.max(1, Math.round(liveSpeed)));
    setSpeed(keep);
    setPref({ speedup: keep });
    writeSpeed(0.01, t("Pause") + " · SITL");
  }

  const liveVehicle = sample.sitl_vehicle === "plane" ? "plane" : sample.sitl_vehicle === "copter" ? "copter" : "";
  const live = running || isSitl(sample.params);
  const initTotal = sample.init_total || 0;
  const initDone = sample.init_done || 0;
  const initing = initTotal > 0;
  const initPct = initing ? Math.min(100, Math.round((100 * initDone) / initTotal)) : 0;
  const sitlLink = sample.ok && isSitl(sample.params);

  function onInit() {
    if (!sitlLink || initing) return;
    if (sample.armed) {
      addLog(t("Init · disarm first"), "bad");
      return;
    }
    const vehicle = sample.frame === "plane" ? "plane" : "copter";
    const params = runtimeLabParams(vehicle);
    send({ op: "init", params });
    addLog(
      t("Init · {n} parameters · {vehicle}", {
        n: Object.keys(params).length,
        vehicle: t(vehicle),
      }),
      "cmd",
    );
  }

  return (
    <>
    <div className="sim-launch">
      <div className="sim-pick" role="group" aria-label={t("Simulation")}>
        {(["copter", "plane"] as const).map((v) => {
          const on = prefs.vehicle === v;
          const live = running && liveVehicle === v;
          const spin = busy && liveVehicle === v;
          return (
            <button
              key={v}
              type="button"
              className={[on && "on", live && "live", spin && "busy"].filter(Boolean).join(" ") || undefined}
              disabled={busy || running}
              aria-pressed={on}
              onClick={() => setPref({ vehicle: v })}
            >
              {live || spin ? <span className="pip" aria-hidden="true" /> : null}
              <SitlThumb kind={v} />
              <b>{t(v)}</b>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={busy ? "sim-run busy" : running ? "sim-run stop" : "sim-run start"}
        aria-pressed={busy || running}
        onClick={busy || running ? onStop : onStart}
      >
        {busy || running ? t("Stop") : t("Start")}
      </button>
      <p className="sim-status">{sitlLine(sample, t)}</p>
      {phase === "run" ? (
        <ul className="sim-links">
          <li>{t("udp {host}:14550 — Mission Planner", { host: "127.0.0.1" })}</li>
          <li>{t("tcp {host}:5760 — Mission Planner", { host: "127.0.0.1" })}</li>
          {(sample.sitl_lan || "").trim() && sample.sitl_lan !== "127.0.0.1" ? (
            <li>{t("tcp {host}:5760 — Mission Planner", { host: sample.sitl_lan || "" })}</li>
          ) : null}
        </ul>
      ) : null}
      <button
        type="button"
        className={`map-sw sim-tog${prefs.wipe ? " on hot" : ""}`}
        aria-pressed={prefs.wipe}
        disabled={busy || running}
        onClick={() => setPref({ wipe: !prefs.wipe })}
      >
        <span className="track" aria-hidden="true" />
        {t("Wipe")}
      </button>
    </div>
    <details className="sim-sec more" open>
      <summary>
        <SecIcon id="init" />
        {initing ? t("Init · {done}/{total}", { done: initDone, total: initTotal }) : t("Init")}
      </summary>
      <p className="sim-note">{t("Writes parameters that are just alive enough, not an ideal tune.")}</p>
      <button
        type="button"
        className="sim-init"
        disabled={!sitlLink || initing}
        title={t("Write the lab stand dump so a blank board can arm.")}
        onClick={onInit}
      >
        {initing ? `${initPct}%` : t("Init")}
      </button>
      {initing ? (
        <div
          className="init-meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={initTotal}
          aria-valuenow={initDone}
        >
          <i style={{ width: `${initPct}%` }} />
        </div>
      ) : null}
    </details>
    <details className="sim-sec more" open>
      <summary><SecIcon id="home" />{t("home")}</summary>
      <input
        className="sim-home"
        value={prefs.home}
        spellCheck={false}
        disabled={busy || running}
        onChange={(ev) => setPref({ home: ev.target.value })}
        title={t("home")}
      />
    </details>
    <details className="sim-sec more" open>
      <summary>
        <SecIcon id="speed" />
        {t("speedup")}
        <span className="sim-sum">{simPaused ? t("Pause") : `${speed}×`}</span>
      </summary>
      <div className="srow wide">
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={speed}
          disabled={busy || simPaused}
          onPointerUp={(ev) => onSpeed(Number((ev.currentTarget as HTMLInputElement).value), true)}
          onInput={(ev) => onSpeed(Number((ev.target as HTMLInputElement).value), false)}
        />
        <b>{simPaused ? t("Pause") : `${speed}×`}</b>
      </div>
      {live ? (
        <div className="sim-speed-btns">
          <button
            type="button"
            className={simPaused ? "pause-btn on" : "pause-btn"}
            disabled={busy || liveSpeed == null}
            onClick={onSimPause}
          >
            {simPaused ? t("Resume") : t("Pause")}
          </button>
          <button
            type="button"
            className="pause-btn"
            disabled={busy || !isSitl(sample.params)}
            onClick={onReset}
            title={t("Restore simulation defaults")}
          >
            {t("Reset")}
          </button>
        </div>
      ) : null}
    </details>
    </>
  );
}

function sectionFaults(
  group: SimGroup,
  params: Record<string, number>,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string[] {
  const faults: string[] = [];
  if (group.motors) {
    const mask = Math.round(params[SIM_ENGINE_FAIL] ?? 0);
    for (const bit of MOTOR_BITS) {
      if ((mask & (1 << bit)) !== 0) faults.push(t("motor {n}", { n: bit + 1 }));
    }
  }
  for (const knob of group.knobs) {
    if ((!knob.hot && !knob.alert) || (knob.hideIf && params[knob.hideIf] != null)) continue;
    const name = resolveSimKey(knob, params);
    if (!name || params[name] == null) continue;
    const value = params[name];
    if (knob.kind === "choice") {
      const picked = Math.round(value);
      if (picked <= 0) continue;
      const choice = knob.choices?.find((item) => item.v === picked);
      faults.push(choice ? t(choice.label) : t(knob.label));
      continue;
    }
    if (knob.alert === "off") {
      if (value < 0.5) faults.push(t("GPS off"));
      continue;
    }
    if (knob.alert === "nonzero") {
      if (Math.abs(value) > 1e-6) faults.push(t(knob.label));
      continue;
    }
    if (value >= 0.5) faults.push(t(knob.label));
  }
  return faults;
}

function SimSection({ group, sample }: { group: SimGroup; sample: Sample }) {
  const t = useT();
  const params = sample.params || {};
  const knobs = group.knobs.filter((k) => {
    if (k.hideIf && params[k.hideIf] != null) return false;
    return resolveSimKey(k, params);
  });
  const motors = group.motors && params[SIM_ENGINE_FAIL] != null;
  const faults = sectionFaults(group, params, t);
  if (!knobs.length && !motors) return null;

  return (
    <details className="sim-sec more" open={group.open}>
      <summary className={faults.length ? "sim-alert" : undefined} title={faults.length ? faults.join(" · ") : undefined}>
        <SecIcon id={group.id} />
        {t(group.title)}
        {faults.length ? <i className="sim-pip" aria-hidden="true">{faults.length > 1 ? faults.length : ""}</i> : null}
      </summary>
      {motors ? <MotorBits sample={sample} /> : null}
      {knobs.map((k) => (
        <SimKnobRow key={k.key} knob={k} sample={sample} />
      ))}
    </details>
  );
}

function MotorBits({ sample }: { sample: Sample }) {
  const t = useT();
  const raw = sample.params[SIM_ENGINE_FAIL] ?? 0;
  const mask = Math.round(raw);

  function setBit(bit: number, on: boolean) {
    const next = on ? mask | (1 << bit) : mask & ~(1 << bit);
    send({ op: "param", name: SIM_ENGINE_FAIL, value: next });
    addLog(`${SIM_ENGINE_FAIL} ${next}`, "cmd");
  }

  return (
    <div className="sim-motors">
      {MOTOR_BITS.map((bit) => {
        const on = (mask & (1 << bit)) !== 0;
        return (
          <button
            key={bit}
            type="button"
            className={`map-sw${on ? " on hot" : ""}`}
            aria-pressed={on}
            onClick={() => setBit(bit, !on)}
          >
            <span className="track" aria-hidden="true" />
            {t("motor {n}", { n: bit + 1 })}
          </button>
        );
      })}
    </div>
  );
}

function SimKnobRow({ knob, sample }: { knob: SimKnob; sample: Sample }) {
  const t = useT();
  const params = sample.params || {};
  const name = resolveSimKey(knob, params);
  const remote = name != null ? params[name] : null;
  const lat = sample.lat ?? sample.home_lat ?? sample.truth_lat ?? 0;
  const [local, setLocal] = useState<number | null>(null);
  const dragging = useRef(false);
  const timer = useRef(0);
  const remoteShown = remote == null ? null : knob.geo ? geoToMeters(knob.geo, remote, lat) : remote;
  const shown = dragging.current && local != null ? local : (local ?? remoteShown ?? knob.def);

  useEffect(() => {
    if (!dragging.current && remoteShown != null) setLocal(remoteShown);
  }, [remoteShown]);

  function push(v: number, logIt: boolean) {
    if (!name) return;
    setLocal(v);
    const raw = knob.geo ? geoToDegrees(knob.geo, v, lat) : v;
    const fire = () => {
      for (const key of writeSimKeys(knob, params)) send({ op: "param", name: key, value: raw });
      if (logIt) addLog(`${name} ${fmtSim(knob, v, t)}`, "cmd");
    };
    if (logIt) {
      window.clearTimeout(timer.current);
      fire();
    } else {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(fire, 70);
    }
  }

  if (name == null || remote == null) return null;

  if (knob.kind === "toggle") {
    const on = shown >= 0.5;
    const bad = knob.alert === "off" ? !on : on && !!knob.hot;
    return (
      <button
        type="button"
        className={`map-sw sim-tog${on ? " on" : ""}${bad ? " hot" : ""}`}
        aria-pressed={on}
        title={name}
        onClick={() => push(on ? 0 : 1, true)}
      >
        <span className="track" aria-hidden="true" />
        {t(knob.label)}
      </button>
    );
  }

  if (knob.kind === "choice" && knob.choices) {
    return (
      <div className="sim-choice" title={name}>
        <span>{t(knob.label)}</span>
        <div>
          {knob.choices.map((c) => (
            <button
              key={c.v}
              type="button"
              className={Math.round(shown) === c.v ? (knob.hot && c.v > 0 ? "on hot" : "on") : undefined}
              onClick={() => push(c.v, true)}
            >
              {t(c.label)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`srow wide${knob.alert === "nonzero" && Math.abs(shown) > 1e-6 ? " hot" : ""}`}>
      <span>{t(knob.label)}</span>
      <input
        type="range"
        min={knob.min}
        max={knob.max}
        step={knob.step}
        value={Math.min(knob.max, Math.max(knob.min, shown))}
        title={name}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onPointerUp={(ev) => {
          dragging.current = false;
          push(Number((ev.currentTarget as HTMLInputElement).value), true);
        }}
        onInput={(ev) => {
          const v = Number((ev.target as HTMLInputElement).value);
          dragging.current = true;
          push(v, false);
        }}
      />
      <b>{fmtSim(knob, shown, t)}</b>
    </div>
  );
}

function fmtSim(k: SimKnob, v: number, t: (key: string) => string): string {
  if (k.kind === "toggle") return v >= 0.5 ? t("on") : t("off");
  if (k.kind === "choice") {
    const c = k.choices?.find((x) => x.v === Math.round(v));
    return c ? t(c.label) : String(Math.round(v));
  }
  if (k.unit === "%") return `${Math.round(v * 100)}%`;
  if (k.unit === "Ah" && v <= 0) return "∞";
  if (k.geo && Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)} km`;
  const n = k.digits === 0 ? String(Math.round(v)) : v.toFixed(k.digits);
  if (!k.unit) return n;
  if (k.unit === "°" || k.unit === "×") return n + k.unit;
  return `${n} ${k.unit}`;
}
