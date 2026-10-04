import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { noteUi, sameParam, writeParam } from "../mav/cmd";
import { getLatest, getSnapshot, subscribe } from "../mav/store";
import { paramNum, type WizardClose } from "../wizards/close";

type Phase = "prepare" | "watch" | "ends" | "save" | "reverse" | "done";

const AXES = [
  { key: "roll", map: "RCMAP_ROLL", fallback: 1, hint: "Stick right should raise the bar." },
  { key: "pitch", map: "RCMAP_PITCH", fallback: 2, hint: "Stick forward should raise the bar." },
  { key: "Thr", map: "RCMAP_THROTTLE", fallback: 3, hint: "Stick up should raise the bar." },
  { key: "yaw", map: "RCMAP_YAW", fallback: 4, hint: "Stick right should raise the bar." },
] as const;

const STEPS = ["Ready the vehicle", "Channels", "Stick ends", "Centered sticks", "Reverse", "Finished"] as const;

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

function rcClose(phase: Phase): WizardClose {
  const params = getLatest().params;
  const measures: Record<string, number | string | null> = { phase };
  for (const axis of AXES) {
    const channel = channelOf(params, axis.map, axis.fallback);
    measures[`${axis.key}_ch`] = channel;
    measures[`RC${channel}_MIN`] = paramNum(params, `RC${channel}_MIN`);
    measures[`RC${channel}_MAX`] = paramNum(params, `RC${channel}_MAX`);
    measures[`RC${channel}_TRIM`] = paramNum(params, `RC${channel}_TRIM`);
    measures[`RC${channel}_REVERSED`] = paramNum(params, `RC${channel}_REVERSED`);
  }
  return { outcome: phase === "done" ? "completed" : "cancelled", measures };
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

export function RcSetup({ onClose }: { onClose: (report?: WizardClose) => void }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const params = sample.params ?? {};
  const rc = sample.rc ?? [];
  const [phase, setPhase] = useState<Phase>("prepare");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [ends, setEnds] = useState<{ min: number[]; max: number[] }>({ min: [], max: [] });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const modeCh = channelOf(params, "FLTMODE_CH", 5);
  const live = rc.some(known);
  const throttle = rc[channelOf(params, "RCMAP_THROTTLE", 3) - 1] ?? 0;
  const step = phase === "prepare" ? 0 : phase === "watch" ? 1 : phase === "ends" ? 2 : phase === "save" ? 3 : phase === "reverse" ? 4 : 5;

  function leave() {
    onClose(rcClose(phaseRef.current));
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  useEffect(() => {
    if (!capturing) return;
    setEnds((prev) => {
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
  }, [rc, capturing]);

  function role(index: number): string {
    const axis = AXES.find((item) => channelOf(params, item.map, item.fallback) === index + 1);
    if (axis) return t(axis.key);
    if (index + 1 === modeCh) return t("Flight modes");
    return t("Channel {n}", { n: index + 1 });
  }

  function begin() {
    const min: number[] = [];
    const max: number[] = [];
    rc.forEach((value, index) => {
      if (known(value)) { min[index] = value; max[index] = value; }
    });
    setEnds({ min, max });
    setCapturing(true);
    setMessage("");
    setPhase("ends");
  }

  async function saveEnds() {
    if (busy) return;
    const pairs: [string, number][] = [];
    for (let index = 0; index < 16; index += 1) {
      const lo = ends.min[index];
      const hi = ends.max[index];
      const now = rc[index];
      if (lo == null || hi == null || hi - lo < 40 || !known(now)) continue;
      const channel = index + 1;
      pairs.push([`RC${channel}_MIN`, Math.round(lo)], [`RC${channel}_MAX`, Math.round(hi)], [`RC${channel}_TRIM`, Math.round(now)]);
    }
    if (!pairs.length) {
      setMessage("Move the sticks before saving.");
      return;
    }
    setBusy(true);
    setMessage("");
    const err = await writeList(pairs);
    setBusy(false);
    if (err) {
      setMessage(err);
      return;
    }
    setCapturing(false);
    setMessage("Saved.");
    setPhase("reverse");
  }

  async function toggleReverse(channel: number) {
    if (busy) return;
    const name = `RC${channel}_REVERSED`;
    const current = paramNum(params, name);
    if (current == null) {
      setMessage("RC parameters have not arrived.");
      return;
    }
    setBusy(true);
    setMessage("");
    const err = await writeList([[name, Math.round(current) === 0 ? 1 : 0]]);
    setBusy(false);
    setMessage(err ?? "Saved.");
  }

  const rows = Array.from({ length: Math.max(16, rc.length) }, (_, index) => {
    const value = rc[index] ?? 0;
    return { index, value, seen: known(value) };
  });

  return createPortal(
    <div className="modal-back" role="presentation">
      <div className="modal orient-wizard" role="dialog" aria-modal="true" aria-labelledby="rc-title">
        <div className="modal-head">
          <h2 id="rc-title">{t("Radio setup")}</h2>
          <button type="button" className="modal-x" disabled={busy} onClick={leave} aria-label={t("Close")} title={t("Close")}>×</button>
        </div>
        <ol className="orient-steps">
          {STEPS.map((name, index) => (
            <li key={name} className={index === step ? "on" : index < step ? "done" : ""}>{t(name)}</li>
          ))}
        </ol>
        {phase === "prepare" ? (
          <>
            <p className="mag-line">{t("Propellers off. Transmitter on. The board stays disarmed.")}</p>
            <p className="mag-line">{t("This window watches the sticks, saves their ends, and can reverse a channel. It does not change the receiver port or the flight modes.")}</p>
            {live ? null : <p className="mag-line warn">{t("No RC frames yet.")}</p>}
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={!sample.ok} onClick={() => setPhase("watch")}>{t("Next")}</button>
            </div>
          </>
        ) : null}
        {phase === "watch" ? (
          <>
            <p className="mag-line">{t("Move each stick. The bar is the raw signal from the receiver.")}</p>
            <div className="rc-grid">
              {rows.map((row) => (
                <span key={row.index} className="rc-span">
                  <b>{role(row.index)}</b>
                  <i><b style={{ width: row.seen ? `${share(row.value) * 100}%` : "0%" }} /></i>
                  <em>{row.seen ? row.value : "—"}</em>
                </span>
              ))}
            </div>
            {live ? null : <p className="mag-line warn">{t("No RC frames yet.")}</p>}
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={!sample.ok || !live} onClick={begin}>{t("Watch the ends")}</button>
            </div>
          </>
        ) : null}
        {phase === "ends" || phase === "save" ? (
          <>
            <p className="mag-line">{phase === "ends" ? t("Move every stick and switch out to its ends, then back.") : t("Throttle down. Other sticks centered. Trim is saved as the position right now.")}</p>
            {phase === "save" && known(throttle) && throttle > 1200 ? <p className="mag-line warn">{t("The throttle stick is not down.")}</p> : null}
            <div className="rc-grid">
              {rows.map((row) => {
                const lo = ends.min[row.index];
                const hi = ends.max[row.index];
                const span = lo != null && hi != null ? hi - lo : 0;
                return (
                  <span key={row.index} className="rc-span">
                    <b>{role(row.index)}</b>
                    <i><b style={{ width: row.seen ? `${share(row.value) * 100}%` : "0%" }} /></i>
                    <em>{row.seen ? row.value : "—"}{span >= 40 ? ` · ${Math.round(lo as number)}–${Math.round(hi as number)}` : ""}</em>
                  </span>
                );
              })}
            </div>
            <div className="wiz-apply">
              {phase === "ends" ? (
                <button type="button" className="wiz-go" onClick={() => setPhase("save")}>{t("Next")}</button>
              ) : (
                <button type="button" className="wiz-go" disabled={!sample.ok || busy} onClick={() => void saveEnds()}>{busy ? t("Writing…") : t("Save the stick ends")}</button>
              )}
            </div>
          </>
        ) : null}
        {phase === "reverse" ? (
          <>
            <p className="mag-line">{t("The bar stays raw. Reverse flips that channel on the board.")}</p>
            {AXES.map((axis) => {
              const channel = channelOf(params, axis.map, axis.fallback);
              const value = rc[channel - 1] ?? 0;
              const reversed = paramNum(params, `RC${channel}_REVERSED`);
              return (
                <div key={axis.key} className="rc-rev">
                  <span className="rc-span">
                    <b>{t(axis.key)}</b>
                    <i><b style={{ width: known(value) ? `${share(value) * 100}%` : "0%" }} /></i>
                    <em>{known(value) ? value : "—"}</em>
                  </span>
                  <p className="mag-line">{t(axis.hint)}</p>
                  <div className="rc-rev-act">
                    <span>{reversed === 1 ? t("Reversed") : t("Normal")}</span>
                    <button type="button" className="wiz-quiet" disabled={busy || reversed == null} onClick={() => void toggleReverse(channel)}>{t("Reverse")}</button>
                  </div>
                </div>
              );
            })}
            <div className="wiz-apply">
              <button type="button" className="wiz-go" onClick={() => setPhase("done")}>{t("Next")}</button>
            </div>
          </>
        ) : null}
        {phase === "done" ? (
          <>
            <p className="mag-line fit-ok">{t("Radio ends are stored. A channel marked reversed is flipped on the board.")}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-go" onClick={leave}>{t("Close")}</button>
            </div>
          </>
        ) : null}
        {message ? <p className="mag-line" role="status">{t(message)}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
