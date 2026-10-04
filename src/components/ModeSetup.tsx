import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { noteUi, sameParam, writeParam } from "../mav/cmd";
import { getSetupSnapshot, getSnapshot, subscribe } from "../mav/store";
import { paramNum, type WizardClose } from "../wizards/close";

const COPTER_MODES: [string, number][] = [
  ["STABILIZE", 0],
  ["ALT_HOLD", 2],
  ["LOITER", 5],
  ["POSHOLD", 16],
  ["ACRO", 1],
  ["LAND", 9],
  ["RTL", 6],
  ["AUTO", 3],
  ["FLOWHOLD", 22],
];

const PLANE_MODES: [string, number][] = [
  ["MANUAL", 0],
  ["FBWA", 5],
  ["FBWB", 6],
  ["CRUISE", 7],
  ["STABILIZE", 2],
  ["AUTO", 10],
  ["RTL", 11],
  ["LOITER", 12],
];

const STICKS = [
  { key: "roll", map: "RCMAP_ROLL", fallback: 1 },
  { key: "pitch", map: "RCMAP_PITCH", fallback: 2 },
  { key: "Thr", map: "RCMAP_THROTTLE", fallback: 3 },
  { key: "yaw", map: "RCMAP_YAW", fallback: 4 },
] as const;

const STEPS = ["Switch channel", "Flight modes"] as const;

function known(value: number): boolean {
  return value >= 800 && value <= 2200;
}

function share(value: number): number {
  return Math.min(1, Math.max(0, (value - 1000) / 1000));
}

function channelOf(params: Record<string, number> | undefined, map: string, fallback: number): number {
  const mapped = paramNum(params, map);
  const slot = mapped != null && mapped > 0 ? Math.round(mapped) : fallback;
  return Math.min(16, Math.max(1, slot));
}

export function modeSlot(pwm: number): number | null {
  if (pwm < 800 || pwm > 2200) return null;
  if (pwm < 1231) return 0;
  if (pwm < 1361) return 1;
  if (pwm < 1491) return 2;
  if (pwm < 1621) return 3;
  if (pwm < 1750) return 4;
  return 5;
}

function movedChannel(min: number[], max: number[], sticks: Set<number>): number | null {
  let best = 0;
  let channel = 0;
  for (let index = 0; index < max.length; index += 1) {
    const lo = min[index];
    const hi = max[index];
    if (lo == null || hi == null || sticks.has(index + 1)) continue;
    const width = hi - lo;
    if (width < 80 || width <= best) continue;
    best = width;
    channel = index + 1;
  }
  return channel || null;
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

export function ModeSetup({ frame, onClose }: { frame: "copter" | "plane"; onClose: (report?: WizardClose) => void }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const params = sample.params ?? {};
  const rc = sample.rc ?? [];
  const base = frame === "plane" ? PLANE_MODES : COPTER_MODES;
  const storedChannel = channelOf(params, "FLTMODE_CH", 5);
  const initial = Array.from({ length: 6 }, (_, i) => paramNum(params, `FLTMODE${i + 1}`));
  const seed = initial.map((value) => value ?? base[0][1]);
  const [phase, setPhase] = useState<"channel" | "modes">("channel");
  const [manual, setManual] = useState<number | null>(null);
  const [span, setSpan] = useState<{ min: number[]; max: number[] }>({ min: [], max: [] });
  const [modes, setModes] = useState(seed);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const key = seed.join(",");
  useEffect(() => { setModes(seed); }, [key]);
  const saved = useRef(false);
  const phaseRef = useRef(phase);
  const channelRef = useRef(storedChannel);
  phaseRef.current = phase;

  const sticks = useMemo(() => new Set(STICKS.map((axis) => channelOf(params, axis.map, axis.fallback))), [params]);
  const found = movedChannel(span.min, span.max, sticks);
  const channel = manual ?? found ?? storedChannel;
  channelRef.current = channel;
  const live = modeSlot(rc[channel - 1] ?? 0);
  const loaded = initial.every((value) => value != null) && paramNum(params, "FLTMODE_CH") != null;

  function leave() {
    const latest = getSnapshot().params;
    const measures: Record<string, number | string | null> = {
      phase: phaseRef.current,
      saved: saved.current ? 1 : 0,
      channel: channelRef.current,
      FLTMODE_CH: paramNum(latest, "FLTMODE_CH"),
    };
    for (let index = 1; index <= 6; index += 1) measures[`FLTMODE${index}`] = paramNum(latest, `FLTMODE${index}`);
    const slot = modeSlot(getSetupSnapshot().rc?.[channelRef.current - 1] ?? 0);
    measures.slot = slot == null ? null : slot + 1;
    onClose({ outcome: saved.current ? "completed" : "cancelled", measures });
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  useEffect(() => {
    if (phase !== "channel") return;
    setSpan((prev) => {
      const min = prev.min.slice();
      const max = prev.max.slice();
      let changed = false;
      rc.forEach((value, index) => {
        if (!known(value)) return;
        if (min[index] == null || value < min[index]) { min[index] = value; changed = true; }
        if (max[index] == null || value > max[index]) { max[index] = value; changed = true; }
      });
      return changed ? { min, max } : prev;
    });
  }, [rc, phase]);

  function role(index: number): string {
    return t("Channel {n}", { n: index + 1 });
  }

  async function save() {
    if (busy) return;
    if (!loaded) {
      setMessage("Flight mode parameters have not arrived.");
      return;
    }
    const pairs: [string, number][] = [[`FLTMODE_CH`, channel]];
    modes.forEach((value, index) => pairs.push([`FLTMODE${index + 1}`, value]));
    setBusy(true);
    setMessage("");
    const err = await writeList(pairs);
    setBusy(false);
    if (!err) saved.current = true;
    setMessage(err ?? "Saved.");
  }

  const rows = Array.from({ length: Math.max(16, rc.length) }, (_, index) => {
    const value = rc[index] ?? 0;
    return { index, value, seen: known(value) };
  }).filter((row) => !sticks.has(row.index + 1));

  return createPortal(
    <div className="modal-back" role="presentation">
      <div className="modal orient-wizard" role="dialog" aria-modal="true" aria-labelledby="mode-title">
        <div className="modal-head">
          <h2 id="mode-title">{t("Flight modes")}</h2>
          <button type="button" className="modal-x" disabled={busy} onClick={leave} aria-label={t("Close")} title={t("Close")}>×</button>
        </div>
        <ol className="orient-steps">
          {STEPS.map((name, index) => {
            const on = phase === "channel" ? 0 : 1;
            return <li key={name} className={index === on ? "on" : index < on ? "done" : ""}>{t(name)}</li>;
          })}
        </ol>
        {phase === "channel" ? (
          <>
            <p className="mag-line">{t("Flip the flight mode switch through its positions. The channel that moves is selected. Tap a row to choose another.")}</p>
            <div className="rc-grid">
              {rows.map((row) => {
                const number = row.index + 1;
                return (
                  <button
                    key={row.index}
                    type="button"
                    className={number === channel ? "rc-span rc-pick is-on" : "rc-span rc-pick"}
                    onClick={() => setManual(number)}
                  >
                    <b>{role(row.index)}</b>
                    <i><b style={{ width: row.seen ? `${share(row.value) * 100}%` : "0%" }} /></i>
                    <em>{row.seen ? row.value : "—"}{found === number ? ` · ${t("Detected")}` : ""}</em>
                  </button>
                );
              })}
            </div>
            {rc.some(known) ? null : <p className="mag-line warn">{t("No RC frames yet.")}</p>}
            <div className="wiz-apply">
              <button type="button" className="wiz-go" onClick={() => setPhase("modes")}>{t("Next")}</button>
            </div>
          </>
        ) : (
          <>
            <p className="mag-line">{t("The lit slot is where the switch is now.")}</p>
            <p className={live == null ? "mag-line warn" : "mag-line ok"}>
              {live == null
                ? t("No switch yet.")
                : t("Switch is on slot {n}: {mode}", { n: live + 1, mode: base.find(([, n]) => n === modes[live])?.[0] ?? String(modes[live]) })}
            </p>
            <div className="wiz-modes">
              {modes.map((value, index) => {
                const choices = base.some(([, n]) => n === value) ? base : [[String(value), value] as [string, number], ...base];
                return (
                  <label key={index} className={live === index ? "wiz-slot on" : "wiz-slot"}>
                    <span>{index + 1}</span>
                    <select
                      value={value}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setModes((all) => all.map((item, i) => (i === index ? next : item)));
                      }}
                    >
                      {choices.map(([name, n]) => <option key={n} value={n}>{name}</option>)}
                    </select>
                  </label>
                );
              })}
            </div>
            <div className="wiz-apply">
              <button type="button" className="wiz-quiet" disabled={busy} onClick={() => setPhase("channel")}>{t("Back")}</button>
              <button type="button" className="wiz-go" disabled={busy} onClick={() => void save()}>{busy ? t("Writing…") : t("Save flight modes")}</button>
            </div>
          </>
        )}
        {message ? <p className="mag-line" role="status">{t(message)}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
