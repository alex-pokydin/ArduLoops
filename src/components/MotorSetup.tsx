import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { noteUi, sameParam, writeParam } from "../mav/cmd";
import { APP_HTTP } from "../mav/link";
import { getSetupSnapshot, getSnapshot, subscribe } from "../mav/store";
import { paramNum, type WizardClose } from "../wizards/close";

type Pose = { angle: number; yaw: 1 | -1; test: number };
type Phase = "prepare" | "bind" | "idle" | "place" | "spin" | "done";

const POSES: Record<string, Pose[]> = {
  x: [
    { angle: 45, yaw: 1, test: 1 },
    { angle: -135, yaw: 1, test: 3 },
    { angle: -45, yaw: -1, test: 4 },
    { angle: 135, yaw: -1, test: 2 },
  ],
  plus: [
    { angle: 90, yaw: 1, test: 2 },
    { angle: -90, yaw: 1, test: 4 },
    { angle: 0, yaw: -1, test: 1 },
    { angle: 180, yaw: -1, test: 3 },
  ],
  bf: [
    { angle: 135, yaw: -1, test: 2 },
    { angle: 45, yaw: 1, test: 1 },
    { angle: -135, yaw: 1, test: 3 },
    { angle: -45, yaw: -1, test: 4 },
  ],
  hex: [
    { angle: 90, yaw: -1, test: 2 },
    { angle: -90, yaw: 1, test: 5 },
    { angle: -30, yaw: -1, test: 6 },
    { angle: 150, yaw: 1, test: 3 },
    { angle: 30, yaw: 1, test: 1 },
    { angle: -150, yaw: -1, test: 4 },
  ],
  octo: [
    { angle: 22.5, yaw: -1, test: 1 },
    { angle: -157.5, yaw: -1, test: 5 },
    { angle: 67.5, yaw: 1, test: 2 },
    { angle: 157.5, yaw: 1, test: 4 },
    { angle: -22.5, yaw: 1, test: 8 },
    { angle: -112.5, yaw: 1, test: 6 },
    { angle: -67.5, yaw: -1, test: 7 },
    { angle: 112.5, yaw: -1, test: 3 },
  ],
  y6: [
    { angle: 56, yaw: 1, test: 2 },
    { angle: -56, yaw: -1, test: 5 },
    { angle: -56, yaw: 1, test: 6 },
    { angle: 180, yaw: -1, test: 4 },
    { angle: 56, yaw: -1, test: 1 },
    { angle: 180, yaw: 1, test: 3 },
  ],
};

function useSample() {
  return useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
}

function num(params: Record<string, number>, name: string): number | null {
  const value = params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function spot(angle: number, r: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: 80 + Math.sin(rad) * r, y: 80 - Math.cos(rad) * r };
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

function channelOf(motorIndex: number): number | null {
  const fn = 33 + motorIndex;
  const params = getSetupSnapshot().params;
  for (let channel = 1; channel <= 16; channel += 1) {
    const value = num(params, `SERVO${channel}_FUNCTION`);
    if (value != null && Math.round(value) === fn) return channel;
  }
  return null;
}

function fnOf(channel: number): number | null {
  return num(getSetupSnapshot().params, `SERVO${channel}_FUNCTION`);
}

function motorIndexOf(fn: number, count: number): number | null {
  const index = Math.round(fn) - 33;
  return index >= 0 && index < count ? index : null;
}

function candidateChannels(count: number): number[] {
  const params = getSetupSnapshot().params;
  const motors: number[] = [];
  const empty: number[] = [];
  for (let channel = 1; channel <= 16; channel += 1) {
    const value = num(params, `SERVO${channel}_FUNCTION`);
    if (value == null) continue;
    const fn = Math.round(value);
    if (fn >= 33 && fn < 33 + count) motors.push(channel);
    else if (fn === 0) empty.push(channel);
  }
  const missing = Array.from({ length: count }, (_, i) => channelOf(i) == null).some(Boolean);
  return missing ? [...motors, ...empty] : motors;
}

function motorClose(phase: Phase): WizardClose {
  const params = getSetupSnapshot().params;
  const outputs: string[] = [];
  for (let channel = 1; channel <= 16; channel += 1) {
    const fn = paramNum(params, `SERVO${channel}_FUNCTION`);
    if (fn != null && fn >= 33 && fn <= 40) outputs.push(`${channel}:${Math.round(fn)}`);
  }
  return {
    outcome: phase === "done" ? "completed" : "cancelled",
    measures: {
      phase,
      MOT_SPIN_ARM: paramNum(params, "MOT_SPIN_ARM"),
      MOT_SPIN_MIN: paramNum(params, "MOT_SPIN_MIN"),
      SERVO_BLH_RVMASK: paramNum(params, "SERVO_BLH_RVMASK"),
      outputs: outputs.join(",") || null,
    },
  };
}

export function MotorSetup({ frame, count, onClose }: { frame: string; count: number; onClose: (report?: WizardClose) => void }) {
  const t = useT();
  const sample = useSample();
  const poses = POSES[frame] ?? null;
  const order = poses ? [...poses].sort((a, b) => a.test - b.test) : null;
  const [phase, setPhase] = useState<Phase>("prepare");
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [choose, setChoose] = useState(false);
  const [message, setMessage] = useState("");
  const [pct, setPct] = useState(10);
  const [hold, setHold] = useState(false);
  const [outChannel, setOutChannel] = useState(1);
  const holdTimer = useRef<number | null>(null);
  const outputsNamed = Array.from({ length: count }, (_, i) => channelOf(i) != null).every(Boolean);
  const pwm = num(sample.params, "MOT_PWM_TYPE");
  const dshot = pwm != null && Math.round(pwm) >= 4 && Math.round(pwm) <= 7;
  const current = order?.[cursor] ?? null;
  const step = phase === "prepare" ? 0 : phase === "bind" ? 1 : phase === "idle" ? 2 : phase === "place" ? 3 : phase === "spin" ? 4 : 5;
  const channels = candidateChannels(count);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  function leave() {
    onClose(motorClose(phaseRef.current));
  }

  useEffect(() => {
    const arm = num(getSetupSnapshot().params, "MOT_SPIN_ARM");
    if (arm != null) setPct(Math.min(25, Math.max(0, Math.round(arm * 100))));
  }, []);

  useEffect(() => () => {
    if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose, leave]);

  function go(next: Phase) {
    setPhase(next);
    setCursor(0);
    setChoose(false);
    setMessage("");
    if (next === "bind") setOutChannel(candidateChannels(count)[0] ?? 1);
  }

  function advanceChannel() {
    const list = candidateChannels(count);
    const later = list.find((channel) => channel > outChannel);
    if (later != null) {
      setOutChannel(later);
      setChoose(false);
      return;
    }
    if (Array.from({ length: count }, (_, i) => channelOf(i) != null).every(Boolean)) go("idle");
    else setMessage("Some motors are still not on an output.");
  }

  async function spinOutput(channel: number) {
    if (busy || hold || getSnapshot().armed) {
      if (getSnapshot().armed) setMessage("Disarm before a motor test");
      return;
    }
    const fn = fnOf(channel);
    let index = fn == null ? null : motorIndexOf(fn, count);
      if (index == null) {
        let free: number | null = null;
        for (let i = 0; i < count; i += 1) {
          if (channelOf(i) == null) {
            free = i;
            break;
          }
        }
        if (free == null) {
          setMessage("All motors already have an output.");
          return;
        }
        index = free;
        const occupant = channelOf(index);
        const pairs: [string, number][] = [];
        if (occupant != null && occupant !== channel) pairs.push([`SERVO${occupant}_FUNCTION`, 0]);
        pairs.push([`SERVO${channel}_FUNCTION`, 33 + index]);
        setBusy(true);
        const err = await writeList(pairs);
        setBusy(false);
        if (err) {
          setMessage(err);
          return;
        }
      }
    const seq = poses?.[index]?.test ?? index + 1;
    await spin(seq);
  }

  async function bindTap(index: number) {
    if (!choose || busy || index < 0 || index >= count) return;
    setChoose(false);
    const here = fnOf(outChannel);
    const occupant = channelOf(index);
    const pairs: [string, number][] = [];
    if (occupant != null && occupant !== outChannel) {
      const displaced = here != null && motorIndexOf(here, count) != null && motorIndexOf(here, count) !== index ? here : 0;
      pairs.push([`SERVO${occupant}_FUNCTION`, displaced]);
    }
    pairs.push([`SERVO${outChannel}_FUNCTION`, 33 + index]);
    setBusy(true);
    const err = await writeList(pairs);
    setBusy(false);
    if (err) {
      setMessage(err);
      return;
    }
    setMessage("Output named.");
    advanceChannel();
  }

  async function notMotor() {
    if (busy) return;
    const fn = fnOf(outChannel);
    if (fn != null && motorIndexOf(fn, count) != null) {
      setBusy(true);
      const err = await writeList([[`SERVO${outChannel}_FUNCTION`, 0]]);
      setBusy(false);
      if (err) {
        setMessage(err);
        return;
      }
    }
    setMessage("");
    advanceChannel();
  }

  async function saveIdle() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const arm = pct / 100;
    const minNow = num(getSetupSnapshot().params, "MOT_SPIN_MIN");
    const pairs: [string, number][] = [["MOT_SPIN_ARM", arm]];
    if (minNow == null || minNow < arm + 0.01) pairs.push(["MOT_SPIN_MIN", Math.min(0.3, +(arm + 0.02).toFixed(2))]);
    const err = await writeList(pairs);
    setBusy(false);
    setMessage(err ?? "Saved.");
  }

  async function spin(seq: number) {
    if (busy || getSnapshot().armed) {
      if (getSnapshot().armed) setMessage("Disarm before a motor test");
      return;
    }
    setBusy(true);
    setMessage("");
    setChoose(false);
    try {
      const response = await fetch(`${APP_HTTP}/motor-test?seq=${seq}&percent=${Math.min(25, Math.max(1, pct || 10))}&seconds=2`, { method: "POST" });
      const result = await response.json() as { message?: string };
      const text = result.message || "Could not send calibration command";
      setMessage(text);
      if (text === "Motor test started") {
        setChoose(true);
        setHold(true);
        if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
        holdTimer.current = window.setTimeout(() => setHold(false), 2200);
      }
    } catch {
      setMessage("Connection lost during calibration");
    } finally {
      setBusy(false);
    }
  }

  async function pick(index: number) {
    if (!choose || !order || !current || busy) return;
    const expected = poses?.indexOf(current) ?? -1;
    if (expected < 0) return;
    setChoose(false);
    if (index !== expected) {
      const from = channelOf(expected);
      const to = channelOf(index);
      if (from == null || to == null) {
        setMessage("Output is not numbered");
        return;
      }
      setBusy(true);
      const err = await writeList([
        [`SERVO${from}_FUNCTION`, 33 + index],
        [`SERVO${to}_FUNCTION`, 33 + expected],
      ]);
      setBusy(false);
      if (err) {
        setMessage(err);
        return;
      }
      setMessage("Outputs swapped.");
      return;
    }
    setMessage("");
    if (cursor + 1 >= order.length) go("spin");
    else setCursor(cursor + 1);
  }

  async function direction(reversed: boolean) {
    if (!order || !current) return;
    const index = poses?.indexOf(current) ?? -1;
    if (reversed && dshot && index >= 0) {
      const channel = channelOf(index);
      const mask = num(getSetupSnapshot().params, "SERVO_BLH_RVMASK");
      if (channel == null || mask == null) {
        setMessage("Output is not numbered");
        return;
      }
      setBusy(true);
      const err = await writeList([["SERVO_BLH_RVMASK", (Math.round(mask) ^ (1 << (channel - 1))) >>> 0]]);
      setBusy(false);
      if (err) {
        setMessage(err);
        return;
      }
      setMessage("Direction reversed on the vehicle.");
      setChoose(false);
      return;
    }
    if (reversed && !dshot) {
      setMessage("Swap two wires on this motor. The reverse mask works only with DShot.");
      return;
    }
    setMessage("");
    setChoose(false);
    if (cursor + 1 >= order.length) go("done");
    else setCursor(cursor + 1);
  }

  const names = ["Ready the vehicle", "Output binding", "Idle throttle", "Which motor", "Spin direction", "Finished"] as const;
  const motorNo = current && poses ? poses.indexOf(current) + 1 : cursor + 1;
  return createPortal(
    <div className="modal-back" role="presentation">
      <div className="modal orient-wizard" role="dialog" aria-modal="true" aria-labelledby="motor-title">
        <div className="modal-head">
          <h2 id="motor-title">{t("Set up the motors")}</h2>
          <button type="button" className="modal-x" disabled={busy} onClick={leave} aria-label={t("Close")} title={t("Close")}>×</button>
        </div>
        <ol className="orient-steps">
          {names.map((name, index) => (
            <li key={name} className={index === step ? "on" : index < step ? "done" : ""}>{t(name)}</li>
          ))}
        </ol>
        {phase === "prepare" ? (
          <>
            <p className="mag-line">{t("Propellers off. Each spin lasts two seconds and then stops.")}</p>
            <p className="mag-line">{t("ESC calibration stays in the wiki. Thrust curve and hover throttle come after the first hover.")}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={!sample.ok} onClick={() => go("bind")}>{t("Next")}</button>
            </div>
          </>
        ) : null}
        {phase === "bind" && poses ? (
          <>
            <Board poses={poses} hot={-1} choose={choose} onPick={(index) => void bindTap(index)} />
            <p className="mag-line">{channels.length === 0 ? t("Servo outputs have not arrived.") : t("Spin output {n}, then tap the arm that turned. That output becomes that motor.", { n: outChannel })}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={busy || hold || !sample.ok || pct < 1 || channels.length === 0} onClick={() => void spinOutput(outChannel)}>{busy ? t("Sending…") : t("Spin output {n}", { n: outChannel })}</button>
              <button type="button" className="wiz-quiet" disabled={busy || channels.length === 0} onClick={() => void notMotor()}>{t("This output is not a motor")}</button>
              <button type="button" className="wiz-quiet" disabled={busy || !outputsNamed} onClick={() => go("idle")}>{t("Next")}</button>
            </div>
          </>
        ) : null}
        {phase === "idle" ? (
          <>
            <p className="mag-line">{t("Idle is the percent where the propellers just start. In flight the minimum stays just above it.")}</p>
            <div className="idle-row">
              <input type="range" min={0} max={25} step={1} value={pct} aria-label={t("Idle throttle")} onChange={(ev) => setPct(Number(ev.target.value))} />
              <b>{pct}%</b>
            </div>
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={busy || hold || !sample.ok || pct < 1} onClick={() => void spin(1)}>{busy ? t("Sending…") : t("Spin one motor")}</button>
              <button type="button" className="wiz-quiet" disabled={busy || !sample.ok} onClick={() => void saveIdle()}>{busy ? t("Writing…") : t("Save idle")}</button>
              <button type="button" className="wiz-quiet" disabled={busy} onClick={() => go(order ? "place" : "done")}>{t("Next")}</button>
            </div>
          </>
        ) : null}
        {phase === "place" && order && current ? (
          <>
            <Board poses={poses ?? []} hot={poses?.indexOf(current) ?? -1} choose={choose} onPick={(index) => void pick(index)} />
            <p className="mag-line">{t("Motor {n}. Spin it, then tap the arm that turned.", { n: motorNo })}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={busy || hold || !sample.ok || pct < 1} onClick={() => void spin(current.test)}>{busy ? t("Sending…") : t("Spin this motor")}</button>
            </div>
          </>
        ) : null}
        {phase === "spin" && order && current ? (
          <>
            <Board poses={poses ?? []} hot={poses?.indexOf(current) ?? -1} choose={false} onPick={() => {}} />
            <p className="mag-line">{current.yaw < 0 ? t("This motor should turn clockwise.") : t("This motor should turn counterclockwise.")}</p>
            <div className="wiz-apply">
              <button type="button" className="wiz-go" disabled={busy || hold || !sample.ok || pct < 1} onClick={() => void spin(current.test)}>{busy ? t("Sending…") : t("Spin this motor")}</button>
              <button type="button" className="wiz-quiet" disabled={busy || !choose} onClick={() => void direction(false)}>{t("It matches")}</button>
              <button type="button" className="wiz-quiet" disabled={busy || !choose} onClick={() => void direction(true)}>{t("It is reversed")}</button>
            </div>
          </>
        ) : null}
        {phase === "done" ? (
          <>
            <p className="mag-line fit-ok">{t("Idle, motor order, and direction are set. Propellers stay off until the first flight.")}</p>
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

function Board({ poses, hot, choose, onPick }: { poses: Pose[]; hot: number; choose: boolean; onPick: (index: number) => void }) {
  const seen = new Map<number, number>();
  const ring = poses.map((pose) => {
    const key = Math.round(pose.angle);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return n;
  });
  const radius = poses.length > 4 ? 10 : 14;
  return (
    <svg className="motor-board" viewBox="0 0 160 160" aria-hidden="true">
      <polygon points="80,18 88,32 72,32" fill="currentColor" />
      {poses.map((pose, index) => {
        const p = spot(pose.angle, ring[index] === 0 ? 54 : 32);
        return (
          <g key={`${pose.angle}-${pose.test}`} className={index === hot ? "on" : ""} onClick={() => choose && onPick(index)} style={{ cursor: choose ? "pointer" : "default" }}>
            <circle cx={p.x} cy={p.y} r={radius} fill="#141a22" stroke="currentColor" strokeWidth={index === hot ? 2.5 : 1} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fill="currentColor">{index + 1}</text>
          </g>
        );
      })}
    </svg>
  );
}
