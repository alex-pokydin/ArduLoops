import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { send } from "../mav/cmd";
import { SITL_LINK } from "../mav/link";
import {
  catalogDef,
  isSitl,
  resolveSimKey,
  SIM_ENGINE_FAIL,
  SIM_GROUPS,
  SIM_PARAM_KEYS,
  type SimGroup,
  type SimKnob,
  writeSimKeys,
} from "../mav/sim";
import type { Sample } from "../mav/types";

const MOTOR_BITS = [0, 1, 2, 3];

export function SimRail({
  sample,
  open,
  onSitlLink,
}: {
  sample: Sample;
  open: boolean;
  onSitlLink: (url: string) => void;
}) {
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
      <summary>{t("home")}</summary>
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
      <summary>{t("speedup")}{simPaused ? " · " + t("Pause") : ""}</summary>
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

function SimSection({ group, sample }: { group: SimGroup; sample: Sample }) {
  const t = useT();
  const params = sample.params || {};
  const knobs = group.knobs.filter((k) => {
    if (k.hideIf && params[k.hideIf] != null) return false;
    return resolveSimKey(k, params);
  });
  const motors = group.motors && params[SIM_ENGINE_FAIL] != null;
  if (!knobs.length && !motors) return null;

  return (
    <details className="sim-sec more" open={group.open}>
      <summary>{t(group.title)}</summary>
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
  const [local, setLocal] = useState<number | null>(null);
  const dragging = useRef(false);
  const timer = useRef(0);
  const shown = dragging.current && local != null ? local : (local ?? remote ?? knob.def);

  useEffect(() => {
    if (!dragging.current && remote != null) setLocal(remote);
  }, [remote]);

  function push(v: number, logIt: boolean) {
    if (!name) return;
    setLocal(v);
    const fire = () => {
      for (const key of writeSimKeys(knob, params)) send({ op: "param", name: key, value: v });
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
    return (
      <button
        type="button"
        className={`map-sw sim-tog${on ? " on" : ""}${on && knob.hot ? " hot" : ""}`}
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
    <div className="srow wide">
      <span>{t(knob.label)}</span>
      <input
        type="range"
        min={knob.min}
        max={knob.max}
        step={knob.step}
        value={shown}
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
  const n = k.digits === 0 ? String(Math.round(v)) : v.toFixed(k.digits);
  if (!k.unit) return n;
  if (k.unit === "°" || k.unit === "×") return n + k.unit;
  return `${n} ${k.unit}`;
}
