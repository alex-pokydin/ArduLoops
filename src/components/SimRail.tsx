import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { send } from "../mav/cmd";
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
  resetRef,
}: {
  sample: Sample;
  open: boolean;
  resetRef: { current: (() => void) | null };
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
    addLog(t("Restore SITL defaults"), "cmd");
  }

  resetRef.current = onReset;

  return (
    <aside className="sim-rail" aria-label={t("Simulation")} hidden={!open} inert={!open || undefined}>
      <div className="sim-body">
        {!sample.ok ? (
          <p className="sim-empty">{t("No link")}</p>
        ) : !sitl ? (
          <p className="sim-empty">{t("Not SITL — these parameters only exist in simulation.")}</p>
        ) : (
          SIM_GROUPS.map((g) => <SimSection key={g.id} group={g} sample={sample} />)
        )}
      </div>
    </aside>
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
