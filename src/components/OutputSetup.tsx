import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { COPTER_FUNCTIONS, PLANE_FUNCTIONS } from "../lib/servoFunctionData";
import { noteUi, sameParam, writeParam } from "../mav/cmd";
import { getSnapshot } from "../mav/store";
import { useStorePicked } from "../mav/view";
import { openAssistant } from "../lib/assistantAsk";
import { setViewFocus, useViewDraft } from "../lib/setupView";

export const OUTPUTS = 16;

export function pnum(params: Record<string, number>, name: string): number | null {
  const v = params[name];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Live output PWM, OUT 1 first; null until SERVO_OUTPUT_RAW arrives. */
export function useLiveOutputs(): (number | null)[] {
  return useStorePicked(
    (s) => Array.from({ length: OUTPUTS }, (_, i) => {
      const v = s.live_nums?.[`SERVO_OUTPUT_RAW.servo${i + 1}_raw`];
      return typeof v === "number" && v > 0 ? Math.round(v) : null;
    }),
    (a, b) => a.every((v, i) => v === b[i]),
  );
}

/**
 * Parameter edits held as a draft until Write. A value equal to the vehicle's is not a change,
 * so the count stays honest when an edit is put back by hand.
 */
export function useParamDraft(params: Record<string, number>) {
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [written, setWritten] = useState<string[]>([]);
  const value = (name: string) => (name in edits ? edits[name] : pnum(params, name));
  const set = (name: string, v: number) => {
    setError("");
    setWritten([]);
    setEdits((all) => ({ ...all, [name]: v }));
  };
  const changes = Object.entries(edits).filter(([name, v]) => {
    const now = pnum(params, name);
    return now == null || !sameParam(now, v);
  });
  const discard = () => {
    setEdits({});
    setError("");
  };
  async function write(): Promise<boolean> {
    setBusy(true);
    setError("");
    const done: string[] = [];
    try {
      const live = getSnapshot().params;
      for (const [name, v] of changes) {
        const from = live[name];
        if (typeof from === "number" && sameParam(from, v)) continue;
        const err = await writeParam(name, v);
        if (err) {
          setError(err);
          addLog(err, "bad");
          return false;
        }
        done.push(name);
        noteUi([{ kind: "param", name, value: v, from: typeof from === "number" ? from : null }]);
      }
      setEdits({});
      setWritten(done);
      return true;
    } finally {
      setBusy(false);
    }
  }
  useViewDraft(changes.map(([param, to]) => ({ param, from: pnum(params, param), to })));
  return { value, set, changes, discard, write, busy, error, written, setWritten };
}

export type Draft = ReturnType<typeof useParamDraft>;

/** The number of a job on a step's card: outlined until it is done, green when done, amber when it needs attention. */
export function StepNum({ n, state }: { n: number; state: "done" | "warn" | "todo" }) {
  return <span className={`ms-num ${state}`} aria-hidden="true">{n}</span>;
}

/** Guide link on the left; changes, Discard and Write on the right, as every drawn step page has. */
export function StepFooter({
  draft,
  armed,
  ok,
  guide,
  guideLabel,
  rebootNames,
  why,
}: {
  draft: Draft;
  armed: boolean;
  ok: boolean;
  guide: string;
  guideLabel: string;
  /** Parameters that only take effect after a reboot (@RebootRequired). */
  rebootNames: string[];
  why?: string;
}) {
  const t = useT();
  const n = draft.changes.length;
  const wasOk = useRef(ok);
  // The reboot note stays until the link drops for that reboot.
  useEffect(() => {
    if (wasOk.current && !ok) draft.setWritten([]);
    wasOk.current = ok;
  }, [ok, draft]);
  const needsReboot = draft.written.some((name) => rebootNames.includes(name));
  const pendingReboot = draft.changes.some(([name]) => rebootNames.includes(name));
  return (
    <>
      {draft.error ? <div className="frs-note err">{t(draft.error)}</div> : null}
      {draft.written.length ? (
        <div className={`frs-note ${needsReboot ? "warn" : "ok"}`}>
          {needsReboot ? t("Saved. Reboot the board to apply; the reboot button is in the header.") : t("Saved.")}
        </div>
      ) : null}
      <div className="frs-foot">
        <a href={guide} target="_blank" rel="noreferrer">{t(guideLabel)} ↗</a>
        <div className="frs-foot-actions">
          {armed ? <span className="frs-why">{t("Disarm to write.")}</span> : pendingReboot ? <span className="frs-why">{why ?? t("Needs a reboot after Write.")}</span> : null}
          {n ? (
            <>
              <span className="frs-changes">{n === 1 ? t("1 change") : t("{n} changes", { n })}</span>
              <button type="button" className="frs-btn text" onClick={draft.discard}>{t("Discard")}</button>
            </>
          ) : null}
          <button type="button" className="frs-btn primary" disabled={!ok || armed || !n || draft.busy} onClick={() => void draft.write()}>
            {draft.busy ? t("Writing…") : n ? t("Write") : t("Saved")}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * The violet spark on a hovered field row: opens the chat about that parameter, with the draft in the view chip.
 * Nothing is sent.
 */
export function FieldAsk({ name }: { name: string }) {
  const t = useT();
  return (
    <button
      type="button"
      className="ops-ask"
      aria-label={t("Ask about {name}", { name })}
      title={t("Ask about {name}", { name })}
      onClick={(ev) => {
        ev.preventDefault();
        setViewFocus(name);
        openAssistant([t("Is my value for {name} right for this vehicle?", { name }), t("What does {name} change in flight?", { name })]);
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.8c.35 3.1 1.55 5.2 3.7 7.35 2.15 2.15 4.25 3.35 7.35 3.7-3.1.35-5.2 1.55-7.35 3.7-2.15 2.15-3.35 4.25-3.7 7.35-.35-3.1-1.55-5.2-3.7-7.35-2.15-2.15-4.25-3.35-7.35-3.7 3.1-.35 5.2-1.55 7.35-3.7 2.15-2.15 3.35-4.25 3.7-7.35Z" /></svg>
    </button>
  );
}

/** A labelled number input bound to a parameter. `scale` shows ms as s, for example. */
export function NumField({ draft, name, label, unit, width = 74, scale = 1, step }: { draft: Draft; name: string; label: string; unit?: string; width?: number; scale?: number; step?: number }) {
  const t = useT();
  const v = draft.value(name);
  if (v == null) return null;
  const shown = +(v / scale).toFixed(4);
  return (
    <label className="ops-field">
      <span className="ops-field-copy"><b>{t(label)}</b><span>{name}</span></span>
      <FieldAsk name={name} />
      <span className="ops-num">
        <input
          type="number"
          step={step}
          value={shown}
          style={{ width }}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n)) draft.set(name, +(n * scale).toFixed(6));
          }}
        />
        {unit ? <i>{unit}</i> : null}
      </span>
    </label>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`pas-switch${on ? " on" : ""}`} disabled={disabled} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

export function SwitchField({ draft, name, label }: { draft: Draft; name: string; label: string }) {
  const t = useT();
  const v = draft.value(name);
  if (v == null) return null;
  return (
    <div className="ops-field">
      <span className="ops-field-copy"><b>{t(label)}</b><span>{name}</span></span>
      <FieldAsk name={name} />
      <Switch on={v !== 0} label={t(label)} onChange={(on) => draft.set(name, on ? 1 : 0)} />
    </div>
  );
}

export function SelectField({ draft, name, label, options, hint }: { draft: Draft; name: string; label: string; options: [number, string][]; hint?: string }) {
  const t = useT();
  const v = draft.value(name);
  if (v == null) return null;
  const list = options.some(([o]) => o === Math.round(v)) ? options : [...options, [Math.round(v), `${name} ${Math.round(v)}`] as [number, string]];
  return (
    <label className="ops-field">
      <span className="ops-field-copy"><b>{t(label)}</b><span>{hint ?? name}</span></span>
      <FieldAsk name={name} />
      <select value={Math.round(v)} onChange={(e) => draft.set(name, Number(e.target.value))}>
        {list.map(([o, text]) => <option key={o} value={o}>{t(text)}</option>)}
      </select>
    </label>
  );
}

/** PWM range with trim and the live value, 900–2100 µs across. */
export function PwmBar({ min, trim, max, live, small = false }: { min: number | null; trim: number | null; max: number | null; live: number | null; small?: boolean }) {
  const p = (v: number) => `${Math.max(0, Math.min(100, ((v - 900) / 1200) * 100))}%`;
  return (
    <span className={`ops-rng${small ? " sm" : ""}`} aria-hidden="true">
      {min != null && max != null ? <i className="r" style={{ left: p(min), width: `calc(${p(max)} - ${p(min)})` }} /> : null}
      {trim != null ? <i className="t" style={{ left: p(trim) }} /> : null}
      {live != null ? <i className="l" style={{ left: p(live) }} /> : null}
    </span>
  );
}

/** Output settings that belong to the servo wired there, so they move with its function. */
const CHANNEL_KEYS = ["FUNCTION", "MIN", "TRIM", "MAX", "REVERSED"] as const;

/**
 * Moves what is on output `from` to output `to` by swapping the two outputs: function, min/trim/max and reverse.
 * Whatever was on `to` lands on `from`, so nothing is lost.
 */
export function swapOutputs(draft: Draft, from: number, to: number): void {
  if (from === to) return;
  for (const key of CHANNEL_KEYS) {
    const a = draft.value(`SERVO${from}_${key}`);
    const b = draft.value(`SERVO${to}_${key}`);
    if (a == null || b == null) continue;
    draft.set(`SERVO${to}_${key}`, a);
    draft.set(`SERVO${from}_${key}`, b);
  }
}

/** Picks the output a function sits on; the list names what each other output carries now. */
export function OutputPicker({ vehicle, draft, out, label }: { vehicle: "copter" | "plane"; draft: Draft; out: number; label: string }) {
  const t = useT();
  return (
    <select className="ops-pick" aria-label={label} title={t("Move to another output. The two outputs swap function, range and reverse.")} value={out} onChange={(e) => swapOutputs(draft, out, Number(e.target.value))}>
      {Array.from({ length: OUTPUTS }, (_, i) => i + 1).map((o) => {
        const fn = draft.value(`SERVO${o}_FUNCTION`);
        const what = o === out || fn == null ? "" : Math.round(fn) === 0 ? ` · ${t("free")}` : ` · ${functionName(vehicle, Math.round(fn))}`;
        return <option key={o} value={o}>{`OUT ${o}${what}`}</option>;
      })}
    </select>
  );
}

export function functionList(vehicle: "copter" | "plane"): [number, string][] {
  return vehicle === "plane" ? PLANE_FUNCTIONS : COPTER_FUNCTIONS;
}

export function functionName(vehicle: "copter" | "plane", fn: number): string {
  return functionList(vehicle).find(([v]) => v === fn)?.[1] ?? `Function ${fn}`;
}

/**
 * Everything on an output as one table. `kind` decides each output: "skip" (shown elsewhere on the page),
 * "locked" (set by a wizard: `locked` draws its cells), or "row" (function, min/trim/max, live, reverse).
 * The last row assigns a function to the first free output.
 */
export function OutputsTable({
  vehicle,
  draft,
  live,
  kind,
  locked,
}: {
  vehicle: "copter" | "plane";
  draft: Draft;
  live: (number | null)[];
  kind: (out: number, fn: number) => "skip" | "locked" | "row";
  locked?: (out: number, fn: number) => { name: ReactNode; spin: ReactNode };
}) {
  const t = useT();
  const list = functionList(vehicle);
  const outs = Array.from({ length: OUTPUTS }, (_, i) => i + 1);
  const fnOf = (o: number) => {
    const v = draft.value(`SERVO${o}_FUNCTION`);
    return v == null ? null : Math.round(v);
  };
  const shown = outs.filter((o) => {
    const fn = fnOf(o);
    return fn != null && fn !== 0 && kind(o, fn) !== "skip";
  });
  const free = outs.filter((o) => fnOf(o) === 0);
  // Which free output the last row assigns; the first free one until another is picked.
  const [target, setTarget] = useState<number | null>(null);
  const slot = target != null && free.includes(target) ? target : free[0];
  const val = (name: string) => {
    const v = draft.value(name);
    return v == null ? null : Math.round(v);
  };
  return (
    <div className="ops-table" role="table">
      <div className="ops-tr head" role="row">
        <span>{t("Out")}</span><span>{t("Function")}</span><span>{t("Min / trim / max")}</span><span>{t("Live")}</span><span>{t("Rev")}</span>
      </div>
      {shown.map((o) => {
        const fn = fnOf(o) as number;
        const pwm = live[o - 1];
        if (kind(o, fn) === "locked" && locked) {
          const cell = locked(o, fn);
          return (
            <div key={o} className="ops-tr motor" role="row">
              <span className="ops-out">OUT {o}</span>
              <span className="ops-locked">{cell.name}</span>
              <span className="ops-spin">{cell.spin}</span>
              <span className="ops-live"><PwmBar min={val(`SERVO${o}_MIN`)} trim={null} max={val(`SERVO${o}_MAX`)} live={pwm} small />{pwm ?? "—"}</span>
              <span />
            </div>
          );
        }
        const options = list.some(([v]) => v === fn) ? list : [...list, [fn, `Function ${fn}`] as [number, string]];
        const rev = val(`SERVO${o}_REVERSED`);
        return (
          <div key={o} className="ops-tr" role="row">
            <span className="ops-out">OUT {o}</span>
            <select aria-label={t("Function of OUT {n}", { n: o })} value={fn} onChange={(e) => draft.set(`SERVO${o}_FUNCTION`, Number(e.target.value))}>
              {options.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
            </select>
            <span className="ops-mtm">
              {(["MIN", "TRIM", "MAX"] as const).map((k) => {
                const name = `SERVO${o}_${k}`;
                const v = val(name);
                return v == null ? null : (
                  <input
                    key={k}
                    type="number"
                    aria-label={name}
                    title={name}
                    value={v}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (e.target.value !== "" && Number.isFinite(n)) draft.set(name, Math.round(n));
                    }}
                  />
                );
              })}
            </span>
            <span className="ops-live"><PwmBar min={val(`SERVO${o}_MIN`)} trim={val(`SERVO${o}_TRIM`)} max={val(`SERVO${o}_MAX`)} live={pwm} small />{pwm ?? "—"}</span>
            <span>{rev != null ? <Switch on={rev === 1} label={t("Reverse OUT {n}", { n: o })} onChange={(on) => draft.set(`SERVO${o}_REVERSED`, on ? 1 : 0)} /> : null}</span>
          </div>
        );
      })}
      {free.length ? (
        <div className="ops-tr free" role="row">
          <select className="ops-pick" aria-label={t("Free output")} value={slot} onChange={(e) => setTarget(Number(e.target.value))}>
            {free.map((o) => <option key={o} value={o}>OUT {o}</option>)}
          </select>
          <select aria-label={t("Function of OUT {n}", { n: slot })} value={0} onChange={(e) => { draft.set(`SERVO${slot}_FUNCTION`, Number(e.target.value)); setTarget(null); }}>
            <option value={0}>{t("Choose…")}</option>
            {list.filter(([v]) => v > 0).map(([v, name]) => <option key={v} value={v}>{name}</option>)}
          </select>
          <span className="ops-more">{free.length > 1 ? t("{n} free outputs", { n: free.length }) : ""}</span>
        </div>
      ) : null}
    </div>
  );
}
