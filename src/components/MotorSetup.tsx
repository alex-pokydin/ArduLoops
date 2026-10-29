import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { frameFromParams, motorFunction, motorOfFunction } from "../lib/motorFrames";
import { noteUi, sameParam, send, writeParam } from "../mav/cmd";
import { APP_HTTP } from "../mav/link";
import { getLatest, getSetupSnapshot, getSnapshot, subscribe } from "../mav/store";
import type { WizardClose } from "../wizards/close";
import { MotorDiagram, type MotorMark } from "./MotorDiagram";

export type MotorStep = "order" | "direction" | "idle";
/** What the assistant asked for. Safety always comes first and Done last. */
export type MotorScope = { steps?: MotorStep[]; motors?: number[] };
type Phase = "safety" | MotorStep | "done";

type Change = { name: string; from: number | null; to: number };
type Spin = { key: string; until: number };
type Note = { tone: "ok" | "warn" | "err"; text: string; action?: { label: string; run: () => void } };
type Answer = "ok" | "reversed" | "swap";

const MAX_OUT = 16;
const SPIN_S = 2;

function useSample() {
  return useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
}

type LinkFace = { ok: boolean; armed: boolean; fresh: boolean; rebooting: boolean; volts: number | null };
let linkFace: LinkFace = { ok: false, armed: false, fresh: false, rebooting: false, volts: null };

/** Link state for the wizard. Live even while the scope is paused. */
function getLinkFace(): LinkFace {
  const s = getLatest();
  const fresh = typeof s.heartbeat_at === "number" && Date.now() / 1000 - s.heartbeat_at < 3;
  const mv = s.live_nums?.["SYS_STATUS.voltage_battery"];
  const volts = typeof mv === "number" && mv > 0 && mv < 65535 ? Math.round(mv / 100) / 10 : null;
  const next = { ok: s.ok, armed: !!s.armed, fresh, rebooting: !!s.rebooting, volts };
  const same = (Object.keys(next) as (keyof LinkFace)[]).every((k) => next[k] === linkFace[k]);
  if (!same) linkFace = next;
  return linkFace;
}

function useLink() {
  return useSyncExternalStore(subscribe, getLinkFace, getLinkFace);
}

function num(params: Record<string, number>, name: string): number | null {
  const v = params[name];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Motor number per output, as the vehicle has it now. 0 = not a motor. */
function vehicleMap(params: Record<string, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (let ch = 1; ch <= MAX_OUT; ch += 1) {
    const fn = num(params, `SERVO${ch}_FUNCTION`);
    if (fn == null) continue;
    out[ch] = motorOfFunction(fn) ?? 0;
  }
  return out;
}

function isDshot(params: Record<string, number>): boolean {
  const v = num(params, "MOT_PWM_TYPE");
  return v != null && Math.round(v) >= 4 && Math.round(v) <= 7;
}

function protocolName(v: number | null): string {
  if (v == null) return "—";
  return ["PWM", "OneShot", "OneShot125", "Brushed", "DShot150", "DShot300", "DShot600", "DShot1200", "PWMRange", "PWMAngle"][Math.round(v)] ?? `Type ${Math.round(v)}`;
}

function escName(v: number | null): string {
  if (v == null || Math.round(v) === 0) return "—";
  return ["—", "BLHeli32 / AM32 / Kiss", "BLHeli_S / BlueJay", "BLHeli32 / AM32 + EDT", "BLHeli_S / BlueJay + EDT"][Math.round(v)] ?? `Type ${Math.round(v)}`;
}

async function motorTest(seq: number, percent: number): Promise<string> {
  try {
    const r = await fetch(`${APP_HTTP}/motor-test?seq=${seq}&percent=${percent}&seconds=${SPIN_S}`, { method: "POST" });
    return ((await r.json()) as { message?: string }).message || "Could not send calibration command";
  } catch {
    return "Connection lost during calibration";
  }
}

function motorStop() {
  void fetch(`${APP_HTTP}/motor-test?stop=1`, { method: "POST" }).catch(() => {});
}

/** Wizard icons, shared with the accelerometer wizards. */
export const Icon = {
  check: (c = "currentColor", s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  x: (c = "currentColor", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke={c} strokeWidth="1.8" strokeLinecap="round" /></svg>
  ),
  warn: (c = "var(--amber)", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2l6.5 11.5h-13L8 2z" stroke={c} strokeWidth="1.5" strokeLinejoin="round" /><path d="M8 6.5v3.2" stroke={c} strokeWidth="1.6" strokeLinecap="round" /><circle cx="8" cy="11.6" r=".9" fill={c} /></svg>
  ),
  err: (c = "var(--hot)", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.3" stroke={c} strokeWidth="1.5" /><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>
  ),
  play: (c = "currentColor", s = 11) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 3.5v9l7.5-4.5L5 3.5z" fill={c} /></svg>
  ),
  stop: (c = "currentColor", s = 10) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill={c} /></svg>
  ),
  chevR: (c = "currentColor", s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  chevL: (c = "currentColor", s = 14) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  chevD: (c = "currentColor", s = 12) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 6L8 10.5 12.5 6" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  ccw: (c = "var(--amber)", s = 16) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7" stroke={c} strokeWidth="1.6" strokeLinecap="round" /><path d="M3.4 1.8v3h3" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  sliders: (c = "currentColor", s = 18) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 4.5h11M2.5 11.5h11" stroke={c} strokeWidth="1.5" strokeLinecap="round" /><circle cx="6" cy="4.5" r="1.8" fill="var(--panel)" stroke={c} strokeWidth="1.5" /><circle cx="10.5" cy="11.5" r="1.8" fill="var(--panel)" stroke={c} strokeWidth="1.5" /></svg>
  ),
  power: (c = "currentColor", s = 13) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v5.5" stroke={c} strokeWidth="1.7" strokeLinecap="round" /><path d="M4.6 4.4a5 5 0 1 0 6.8 0" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>
  ),
  dots: (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4" fill="currentColor" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /><circle cx="12.5" cy="8" r="1.4" fill="currentColor" /></svg>
  ),
  propOff: (
    <svg width={44} height={44} viewBox="0 0 44 44" fill="none" aria-hidden="true"><ellipse cx="22" cy="22" rx="17" ry="4.5" transform="rotate(-25 22 22)" fill="#2a3140" /><circle cx="22" cy="22" r="4" fill="#3a4552" /><path d="M8 36L36 8" stroke="var(--hot)" strokeWidth="3" strokeLinecap="round" /></svg>
  ),
  secured: (
    <svg width={44} height={44} viewBox="0 0 44 44" fill="none" aria-hidden="true"><rect x="6" y="30" width="32" height="4" rx="2" fill="#3a4552" /><rect x="14" y="18" width="16" height="10" rx="3" fill="#2a3140" /><path d="M8 23h6M30 23h6" stroke="#3a4552" strokeWidth="3" strokeLinecap="round" /><path d="M12 30V16h20v14" stroke="var(--cyan)" strokeWidth="2" strokeLinejoin="round" /></svg>
  ),
  wires: (
    <svg width={40} height={40} viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M4 12h10c6 0 6 16 12 16h10" stroke="var(--amber)" strokeWidth="2.4" strokeLinecap="round" /><path d="M4 28h10c6 0 6-16 12-16h10" stroke="var(--cyan)" strokeWidth="2.4" strokeLinecap="round" /><path d="M4 20h32" stroke="#5a6778" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="3 3" /></svg>
  ),
  unplug: (
    <svg width={40} height={40} viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M8 20h8M24 20h8" stroke="var(--hot)" strokeWidth="2.6" strokeLinecap="round" /><rect x="15" y="14" width="5" height="12" rx="1.5" stroke="var(--hot)" strokeWidth="2.2" /><rect x="21" y="14" width="5" height="12" rx="1.5" stroke="var(--hot)" strokeWidth="2.2" /></svg>
  ),
  lock: (
    <svg width={40} height={40} viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect x="10" y="18" width="20" height="15" rx="3" stroke="var(--hot)" strokeWidth="2.4" /><path d="M14 18v-4a6 6 0 0 1 12 0v4" stroke="var(--hot)" strokeWidth="2.4" /></svg>
  ),
};

/** Two half-arc arrows in a 40×40 box. dir 1 = clockwise. */
function RotIcon({ dir, size = 34 }: { dir: 1 | -1; size?: number }) {
  const r = 13;
  const at = (deg: number) => [20 + r * Math.cos((deg * Math.PI) / 180), 20 + r * Math.sin((deg * Math.PI) / 180)];
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      {[-150, 30].map((base) => {
        const a0 = dir > 0 ? base : base + 125;
        const a1 = a0 + dir * 125;
        const [sx, sy] = at(a0);
        const [ex, ey] = at(a1);
        const t = (a1 * Math.PI) / 180;
        const ux = -Math.sin(t) * dir, uy = Math.cos(t) * dir, nx = Math.cos(t), ny = Math.sin(t), h = 4.2;
        return (
          <g key={base}>
            <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${ex} ${ey}`} stroke="var(--cyan)" strokeWidth="2.6" strokeLinecap="round" />
            <polygon points={`${ex + ux * h * 1.2},${ey + uy * h * 1.2} ${ex - ux + nx * h},${ey - uy + ny * h} ${ex - ux - nx * h},${ey - uy - ny * h}`} fill="var(--cyan)" />
          </g>
        );
      })}
    </svg>
  );
}

function Countdown({ until, size = 26 }: { until: number; size?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, (until - now) / 1000);
  const frac = Math.min(1, left / SPIN_S);
  const c = 2 * Math.PI * 17;
  return (
    <span className="mw-ring" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="17" stroke="#1c3a4a" strokeWidth="4" />
        <circle cx="20" cy="20" r="17" stroke="var(--cyan)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 20 20)" />
      </svg>
    </span>
  );
}

export function MotorSetup({ onClose, scope, fromAssistant = false }: { onClose: (report?: WizardClose) => void; scope?: MotorScope; fromAssistant?: boolean }) {
  const t = useT();
  const sample = useSample();
  const link = useLink();
  const params = sample.params;
  const seenFrame = useMemo(() => frameFromParams(params), [params.FRAME_CLASS, params.FRAME_TYPE]);
  // Parameters reload after a reboot. Keep drawing the frame we had.
  const lastFrame = useRef(seenFrame);
  if (seenFrame) lastFrame.current = seenFrame;
  const frame = seenFrame ?? lastFrame.current;
  const focus = useMemo(() => {
    const all = frame?.spots.map((s) => s.n) ?? [];
    const want = scope?.motors?.filter((n) => all.includes(n)) ?? [];
    return want.length ? want : all;
  }, [frame, scope?.motors]);

  // The vehicle mapping when the wizard opened: an output that was not a motor
  // then only starts DShot after a reboot.
  const bootMap = useRef<Record<number, number> | null>(null);
  if (bootMap.current == null && Object.keys(params).length) bootMap.current = vehicleMap(params);
  const live = vehicleMap(params);

  // Decided once when the wizard opens.
  const [flow] = useState<Phase[]>(() => {
    const steps = scope?.steps?.length ? scope.steps : (["order", "direction"] as MotorStep[]);
    const placed = new Set(Object.values(vehicleMap(params)).filter((m) => m > 0));
    const missing = focus.some((n) => !placed.has(n));
    const out: Phase[] = ["safety"];
    if (steps.includes("order") || (steps.includes("direction") && missing)) out.push("order");
    if (steps.includes("idle")) out.push("idle");
    if (steps.includes("direction")) out.push("direction");
    out.push("done");
    return out;
  });

  const [phase, setPhase] = useState<Phase>("safety");
  const [props, setProps] = useState(false);
  const [secured, setSecured] = useState(false);
  const [panel, setPanel] = useState(scope?.steps?.length === 1 && scope.steps[0] === "idle");
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [spin, setSpin] = useState<Spin | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [needReboot, setNeedReboot] = useState(false);

  // Order step: a draft of motor numbers per output, written on Save.
  const [draft, setDraft] = useState<Record<number, number>>({});
  const [tested, setTested] = useState<Set<number>>(new Set());
  const [selOut, setSelOut] = useState<number | null>(null);
  const [menuOut, setMenuOut] = useState<number | null>(null);
  const [allOuts, setAllOuts] = useState(false);
  const lastSpunOut = useRef<{ ch: number; at: number } | null>(null);

  // Direction step.
  const dirMotors = useMemo(() => (frame?.spots ?? []).filter((s) => focus.includes(s.n) && s.yaw !== 0), [frame, focus]);
  const [dirIdx, setDirIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});

  // Idle.
  const [pct, setPct] = useState(() => {
    const arm = num(getSetupSnapshot().params, "MOT_SPIN_ARM");
    return arm != null ? Math.min(25, Math.max(0, Math.round(arm * 100))) : 10;
  });
  const [idleSaved, setIdleSaved] = useState(true);
  const idleTimer = useRef<number | null>(null);

  // Reboot.
  const [reboot, setReboot] = useState<"idle" | "waiting" | "back">("idle");
  const [recheck, setRecheck] = useState<Record<number, Answer>>({});
  const rebootAt = useRef(0);

  // ArduPilot arms the outputs for a motor test. That is our own test, not a pilot arming.
  const [testHold, setTestHold] = useState(0);
  const armed = link.armed && Date.now() > testHold;
  const linked = link.ok && link.fresh;
  const blocked = reboot !== "waiting" && (!linked || armed);
  const dshot = isDshot(params);
  const testPct = Math.min(25, Math.max(1, pct));

  useEffect(() => {
    if (!Object.keys(draft).length && Object.keys(params).length) setDraft(vehicleMap(params));
  }, [params, draft]);

  useEffect(() => {
    if (!spin) return;
    const id = window.setTimeout(() => setSpin(null), Math.max(0, spin.until - Date.now()));
    return () => window.clearTimeout(id);
  }, [spin]);

  // Reboot finishes when the bridge stops reporting `rebooting` and heartbeats are fresh again.
  // `elapsed` re-runs this after the grace period: a fast board is back before it ends.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (reboot !== "waiting") return;
    if (Date.now() - rebootAt.current < 1500) return;
    if (!link.rebooting && linked) setReboot("back");
  }, [reboot, link.rebooting, linked, elapsed]);
  useEffect(() => {
    if (reboot !== "waiting") return;
    const id = window.setInterval(() => {
      const s = Math.round((Date.now() - rebootAt.current) / 1000);
      setElapsed(s);
      // The bridge gives up after 60 s; carry on with whatever link there is.
      if (s >= 62) setReboot("back");
    }, 500);
    return () => window.clearInterval(id);
  }, [reboot]);

  const outputs = useMemo(() => {
    const top = Math.max(...(frame?.spots.map((s) => s.n) ?? [4]), frame?.servo ? 7 : 0, 4);
    const set = new Set<number>();
    for (let ch = 1; ch <= top; ch += 1) set.add(ch);
    for (const [ch, m] of Object.entries(draft)) if (m > 0) set.add(Number(ch));
    const shown = [...set].filter((ch) => ch <= MAX_OUT).sort((a, b) => a - b);
    const rest: number[] = [];
    for (let ch = 1; ch <= MAX_OUT; ch += 1) if (!set.has(ch) && params[`SERVO${ch}_FUNCTION`] != null) rest.push(ch);
    return { shown, rest };
  }, [frame, draft, params]);

  // Draft: motor number per output; 0 = untouched non-motor; -1 = the user said "not a motor".
  const changed = (ch: number, m: number) => (m === -1 ? (live[ch] ?? 0) > 0 : (live[ch] ?? 0) !== m);
  const dirty = Object.entries(draft).some(([ch, m]) => changed(Number(ch), m));
  const pendingWrites = Object.entries(draft).filter(([ch, m]) => changed(Number(ch), m)).length;
  const motorsOf = (map: Record<number, number>, n: number) => Object.entries(map).filter(([, m]) => m === n).map(([ch]) => Number(ch));

  function record(list: Change[]) {
    if (list.length) setChanges((prev) => [...prev, ...list]);
  }

  async function writeList(pairs: [string, number][]): Promise<string | null> {
    const now = getSnapshot().params;
    const done: Change[] = [];
    for (const [name, value] of pairs) {
      const from = now[name];
      if (typeof from === "number" && sameParam(from, value)) continue;
      const err = await writeParam(name, value);
      if (err) {
        record(done);
        return err;
      }
      done.push({ name, from: typeof from === "number" ? from : null, to: value });
      noteUi([{ kind: "param", name, value, from: typeof from === "number" ? from : null }]);
    }
    record(done);
    return null;
  }

  function finishReport(outcome: WizardClose["outcome"]): WizardClose {
    const map = vehicleMap(getSetupSnapshot().params);
    const outs = Object.entries(map).filter(([, m]) => m > 0).map(([ch, m]) => `${ch}:${m}`).join(",");
    const dir = Object.entries(answers).map(([n, a]) => `${n}:${a}`).join(",");
    const re = Object.entries(recheck).map(([n, a]) => `${n}:${a}`).join(",");
    const todo = Object.entries(answers).filter(([, a]) => a === "swap").map(([n]) => n).join(",");
    return {
      outcome,
      measures: {
        steps: flow.join(","),
        phase,
        outputs: outs || null,
        direction: dir || null,
        recheck: re || null,
        todo: todo || null,
        rebooted: reboot === "back" ? 1 : 0,
        MOT_SPIN_ARM: num(getSetupSnapshot().params, "MOT_SPIN_ARM"),
        SERVO_BLH_RVMASK: num(getSetupSnapshot().params, "SERVO_BLH_RVMASK"),
      },
    };
  }

  function leave(force = false) {
    if (!force && dirty && phase === "order") {
      setConfirmClose(true);
      return;
    }
    if (spin) motorStop();
    onClose(finishReport(phase === "done" ? "completed" : "cancelled"));
  }
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (menuOut != null) setMenuOut(null);
      else if (panel) setPanel(false);
      else if (confirmClose) setConfirmClose(false);
      else if (!busy) leaveRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOut, panel, confirmClose, busy]);

  // A test is stopped by the vehicle when the link goes; do not keep showing it.
  useEffect(() => {
    if (blocked && spin) setSpin(null);
  }, [blocked, spin]);

  function go(next: Phase) {
    setNote(null);
    setMenuOut(null);
    setSelOut(null);
    setPhase(next);
  }
  const stepIndex = flow.indexOf(phase);
  const next = flow[stepIndex + 1];
  const prev = flow[stepIndex - 1];

  function failNote(message: string) {
    const safety = num(params, "BRD_SAFETY_DEFLT") !== 0 && message.toLowerCase().includes("safety");
    setNote({
      tone: "err",
      text: t(message),
      action: safety ? { label: t("Open motor settings"), run: () => setPanel(true) } : undefined,
    });
  }

  async function runTest(key: string, seq: number): Promise<boolean> {
    if (busy || blocked) return false;
    setBusy(true);
    setNote(null);
    const message = await motorTest(seq, testPct);
    setBusy(false);
    if (message !== "Motor test started") {
      failNote(message);
      return false;
    }
    setSpin({ key, until: Date.now() + SPIN_S * 1000 + 200 });
    setTestHold(Date.now() + SPIN_S * 1000 + 3000);
    return true;
  }

  function stopSpin() {
    motorStop();
    setSpin(null);
  }

  // ---------- Order ----------
  async function spinOutput(ch: number) {
    if (!frame) return;
    setSelOut(ch);
    setMenuOut(null);
    let motor = live[ch] ?? 0;
    if (motor === 0) {
      // Not a motor on the vehicle yet: put a free motor number on it so the test can drive it.
      const used = new Set(Object.values(live));
      const free = frame.spots.find((s) => !used.has(s.n));
      if (!free) {
        setNote({ tone: "warn", text: t("Every motor is already on an output. Clear one first.") });
        return;
      }
      setBusy(true);
      const err = await writeList([[`SERVO${ch}_FUNCTION`, motorFunction(free.n)]]);
      setBusy(false);
      if (err) {
        failNote(err);
        return;
      }
      motor = free.n;
    }
    const spot = frame.spots.find((s) => s.n === motor);
    const seq = spot?.test ?? (frame.servo && motor === 7 ? frame.servo.test : motor);
    if (await runTest(`out:${ch}`, seq)) lastSpunOut.current = { ch, at: Date.now() };
  }

  function assign(ch: number, motor: number) {
    setDraft((d) => ({ ...d, [ch]: motor }));
    const spun = lastSpunOut.current;
    setTested((s) => {
      const nextSet = new Set(s);
      if (spun && spun.ch === ch && Date.now() - spun.at < 15000 && motor > 0) nextSet.add(ch);
      else nextSet.delete(ch);
      return nextSet;
    });
    setMenuOut(null);
  }

  function pickArm(n: number) {
    if (phase === "order") {
      const spinCh = spin?.key.startsWith("out:") ? Number(spin.key.slice(4)) : null;
      const ch = spinCh ?? selOut;
      if (ch == null) {
        setNote({ tone: "warn", text: t("Pick an output first: spin it, or press its card.") });
        return;
      }
      if (spin) stopSpin();
      assign(ch, n);
      return;
    }
    if (phase === "idle") {
      const spot = frame?.spots.find((s) => s.n === n);
      if (spot) void runTest(`motor:${n}`, spot.test);
      return;
    }
    if (phase === "direction") {
      const i = dirMotors.findIndex((s) => s.n === n);
      if (i >= 0) setDirIdx(i);
    }
  }

  function fillInOrder() {
    if (!frame) return;
    const nextDraft = { ...draft };
    for (const ch of Object.keys(nextDraft)) if ((nextDraft[Number(ch)] ?? 0) > 0) nextDraft[Number(ch)] = -1;
    for (const s of frame.spots) nextDraft[s.n] = s.n;
    if (frame.servo) nextDraft[7] = 7;
    setDraft(nextDraft);
    setTested(new Set());
  }

  async function saveOrder() {
    const pairs: [string, number][] = [];
    let bootNeeded = false;
    for (const [chs, m] of Object.entries(draft)) {
      const ch = Number(chs);
      // A non-motor function (gimbal, throttle…) is never overwritten unless it was a motor.
      if (!changed(ch, m)) continue;
      pairs.push([`SERVO${ch}_FUNCTION`, m > 0 ? motorFunction(m) : 0]);
      if (m > 0 && dshot && (bootMap.current?.[ch] ?? 0) === 0) bootNeeded = true;
    }
    setBusy(true);
    const err = await writeList(pairs);
    setBusy(false);
    if (err) {
      failNote(err);
      return false;
    }
    if (bootNeeded) setNeedReboot(true);
    return true;
  }

  // ---------- Direction ----------
  const curDir = dirMotors[dirIdx] ?? null;

  async function answer(reversed: boolean) {
    if (!curDir) return;
    if (!reversed) {
      setAnswers((a) => ({ ...a, [curDir.n]: "ok" }));
      advanceDir();
      return;
    }
    if (!dshot) {
      setAnswers((a) => ({ ...a, [curDir.n]: "swap" }));
      return;
    }
    const chans = motorsOf(vehicleMap(getSetupSnapshot().params), curDir.n);
    if (!chans.length) {
      setNote({ tone: "warn", text: t("Motor {n} has no output. Match outputs first.", { n: curDir.n }) });
      return;
    }
    const p = getSetupSnapshot().params;
    let mask = Math.round(num(p, "SERVO_BLH_RVMASK") ?? 0);
    for (const ch of chans) mask = (mask ^ (1 << (ch - 1))) >>> 0;
    const pairs: [string, number][] = [["SERVO_BLH_RVMASK", mask]];
    if (num(p, "SERVO_BLH_AUTO") !== 1) {
      let blh = Math.round(num(p, "SERVO_BLH_MASK") ?? 0);
      for (const ch of chans) blh = (blh | (1 << (ch - 1))) >>> 0;
      pairs.push(["SERVO_BLH_MASK", blh]);
    }
    setBusy(true);
    const err = await writeList(pairs);
    setBusy(false);
    if (err) {
      failNote(err);
      return;
    }
    setNeedReboot(true);
    setAnswers((a) => ({ ...a, [curDir.n]: "reversed" }));
    advanceDir();
  }

  function advanceDir() {
    setNote(null);
    const after = dirMotors.findIndex((s, i) => i > dirIdx && !answers[s.n]);
    if (after >= 0) setDirIdx(after);
    else if (dirIdx + 1 < dirMotors.length) setDirIdx(dirIdx + 1);
  }

  const dirDone = dirMotors.length > 0 && dirMotors.every((s) => answers[s.n]);

  // ---------- Idle ----------
  function changeIdle(v: number) {
    const value = Math.min(25, Math.max(0, Math.round(v)));
    setPct(value);
    setIdleSaved(false);
    if (idleTimer.current != null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(async () => {
      const arm = value / 100;
      const minNow = num(getSetupSnapshot().params, "MOT_SPIN_MIN");
      const pairs: [string, number][] = [["MOT_SPIN_ARM", arm]];
      if (minNow == null || minNow < arm + 0.01) pairs.push(["MOT_SPIN_MIN", Math.min(0.3, +(arm + 0.02).toFixed(2))]);
      const err = await writeList(pairs);
      if (err) failNote(err);
      else setIdleSaved(true);
    }, 600);
  }
  useEffect(() => () => {
    if (idleTimer.current != null) window.clearTimeout(idleTimer.current);
  }, []);

  // ---------- Reboot ----------
  function startReboot() {
    rebootAt.current = Date.now();
    setElapsed(0);
    setReboot("waiting");
    setNeedReboot(false);
    send({ op: "reboot" });
  }
  const reversedMotors = (frame?.spots ?? []).filter((s) => answers[s.n] === "reversed");
  const recheckMotor = reversedMotors.find((s) => !recheck[s.n]) ?? null;

  // ---------- Settings ----------
  const safetyDeflt = num(params, "BRD_SAFETY_DEFLT");
  const safetyIssue = safetyDeflt != null && safetyDeflt !== 0;
  const rvmask = Math.round(num(params, "SERVO_BLH_RVMASK") ?? 0);
  const reversedOuts = Array.from({ length: MAX_OUT }, (_, i) => i + 1).filter((ch) => rvmask & (1 << (ch - 1)));
  const issues = (safetyIssue ? 1 : 0) + (!dshot && Object.values(answers).includes("swap") ? 1 : 0);

  // ---------- Render helpers ----------
  if (!frame) {
    return createPortal(
      <div className="modal-back" role="presentation">
        <div className="modal mw" role="dialog" aria-modal="true" aria-labelledby="mw-title">
          <div className="mw-head">
            <h2 id="mw-title">{t("Motor setup")}</h2>
            <button type="button" className="mw-icon" onClick={() => onClose({ outcome: "failed", measures: { reason: "frame" } })} aria-label={t("Close")} title={t("Close")}>{Icon.x()}</button>
          </div>
          <div className="mw-empty">
            <p>{t("This frame has no motor setup wizard.")}</p>
            <p className="mw-dim">{t("Heli, single and coax copters use servo outputs. Set them up in the servo outputs step.")}</p>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  const label = (n: number) => {
    const spot = frame.spots.find((s) => s.n === n);
    const chans = motorsOf(phase === "order" ? draft : live, n);
    const where = chans.length ? t("output {list}", { list: chans.join(", ") }) : t("no output");
    const layer = spot?.layer === "top" ? `, ${t("upper")}` : spot?.layer === "bottom" ? `, ${t("lower")}` : "";
    return `${t("Motor {n}", { n })}${layer}, ${where}`;
  };

  const outsLabel = (map: Record<number, number>) => {
    const outs: Record<number, string> = {};
    for (const s of frame.spots) {
      const chans = motorsOf(map, s.n);
      if (chans.length) outs[s.n] = `OUT ${chans.join("·")}`;
    }
    return outs;
  };

  const marks: Record<number, MotorMark> = {};
  for (const s of frame.spots) {
    if (!focus.includes(s.n) && phase !== "safety") {
      marks[s.n] = "dim";
      continue;
    }
    if (reboot === "waiting") marks[s.n] = "dim";
    else if (reboot === "back") marks[s.n] = recheckMotor?.n === s.n ? "current" : recheck[s.n] ? "done" : "dim";
    else if (phase === "order") {
      const chans = motorsOf(draft, s.n);
      if (chans.length > 1) marks[s.n] = "warn";
      else if (chans.length && tested.has(chans[0])) marks[s.n] = "done";
      else if (spin?.key.startsWith("out:") || selOut != null) marks[s.n] = "pick";
      else marks[s.n] = chans.length ? "pending" : "pending";
    } else if (phase === "direction" || phase === "done") {
      const a = answers[s.n];
      marks[s.n] = a === "ok" ? "done" : a === "reversed" ? "reversed" : a === "swap" ? "warn" : curDir?.n === s.n && phase === "direction" ? "current" : "pending";
    } else if (phase === "idle") {
      marks[s.n] = spin?.key === `motor:${s.n}` ? "current" : "pending";
    } else marks[s.n] = "pending";
  }
  const diagramArrows = phase === "direction" || phase === "done" || reboot !== "idle";
  const diagramOuts = phase === "order" ? outsLabel(draft) : phase === "done" ? outsLabel(live) : undefined;
  const pickable = phase === "order" || phase === "idle" || phase === "direction";

  const diagram = (size: number) => (
    <MotorDiagram
      frame={frame}
      size={size}
      marks={marks}
      arrows={diagramArrows}
      outs={diagramOuts}
      onPick={pickable && !blocked && reboot === "idle" ? pickArm : undefined}
      label={label}
      servoLabel={t("Servo")}
    />
  );

  const stepName: Record<Phase, string> = {
    safety: t("Safety check"),
    order: t("Order"),
    idle: t("Idle"),
    direction: t("Direction"),
    done: t("Done"),
  };

  const noteBox = note ? (
    <div className={`mw-note ${note.tone}`} role="status">
      {note.tone === "err" ? Icon.err() : note.tone === "warn" ? Icon.warn() : Icon.check("var(--ok)", 16)}
      <span>{note.text}</span>
      {note.action ? <button type="button" className="mw-link" onClick={note.action.run}>{note.action.label}</button> : null}
    </div>
  ) : null;

  // ---------- Steps ----------
  let body: ReactNode = null;
  let footer: ReactNode = null;

  const backBtn = prev && reboot === "idle" ? (
    <button type="button" className="mw-btn text" disabled={busy} onClick={() => go(prev)}>{Icon.chevL()}<span>{t("Back")}</span></button>
  ) : <span />;

  if (reboot !== "idle") {
    if (reboot === "waiting") {
      body = (
        <div className="mw-center" role="status">
          <span className="mw-spinner" aria-hidden="true" />
          <h3>{t("Rebooting the board")}</h3>
          <p className="mw-dim">{t("Waiting for it to come back · {n} s", { n: elapsed })}</p>
        </div>
      );
      footer = <><span /><button type="button" className="mw-btn primary" disabled>{t("Finish")}</button></>;
    } else if (recheckMotor) {
      body = (
        <>
          <div className="mw-headline"><h3>{t("Board is back")}</h3><p>{t("Check the reversed motor once more.")}</p></div>
          <DirCard t={t} n={recheckMotor.n} yaw={recheckMotor.yaw} spinning={spin?.key === `re:${recheckMotor.n}`} until={spin?.until} disabled={busy || blocked} onSpin={() => void runTest(`re:${recheckMotor.n}`, recheckMotor.test)} onStop={stopSpin} />
          <div className="mw-answers">
            <button type="button" className="mw-btn okb" onClick={() => setRecheck((r) => ({ ...r, [recheckMotor.n]: "ok" }))}>{Icon.check("var(--ok)", 16)}<span>{t("Matches")}</span></button>
            <button type="button" className="mw-btn warnb" onClick={() => setRecheck((r) => ({ ...r, [recheckMotor.n]: "reversed" }))}>{Icon.ccw()}<span>{t("Opposite")}</span></button>
          </div>
          {noteBox}
        </>
      );
      footer = <><span /><button type="button" className="mw-btn text" onClick={() => leave(true)}>{t("Skip")}</button></>;
    } else {
      const bad = Object.values(recheck).includes("reversed");
      body = (
        <>
          <div className="mw-headline"><h3>{bad ? t("Still reversed") : t("Motors are ready")}</h3><p>{bad ? t("Check the ESC settings, then run the direction check again.") : t("The board rebooted and the direction is applied.")}</p></div>
          {noteBox}
        </>
      );
      footer = <><span /><button type="button" className="mw-btn primary" onClick={() => leave(true)}>{t("Finish")}</button></>;
    }
  } else if (phase === "safety") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Make it safe to spin")}</h3><p>{t("Short test spins: {s} s at idle throttle ({p}%).", { s: SPIN_S, p: testPct })}</p></div>
        <div className="mw-checks">
          <span className={linked ? "ok" : "bad"}>{linked ? Icon.check("var(--ok)", 12) : Icon.x("var(--hot)", 12)}{linked ? t("Connected") : t("No link")}</span>
          <span className={armed ? "bad" : "ok"}>{armed ? Icon.x("var(--hot)", 12) : Icon.check("var(--ok)", 12)}{armed ? t("Armed") : t("Disarmed")}</span>
          {link.volts != null ? <span className="ok">{Icon.check("var(--ok)", 12)}{link.volts.toFixed(1)} V</span> : null}
        </div>
        {safetyIssue ? (
          <div className="mw-note warn">{Icon.warn()}<span>{t("Safety switch is on")}</span><button type="button" className="mw-link" onClick={() => setPanel(true)}>{t("Settings")}</button></div>
        ) : null}
      </>
    );
    footer = (
      <>
        <span />
        <button type="button" className="mw-btn primary" disabled={!props || !secured || !linked || armed} onClick={() => next && go(next)}>
          <span>{t("Start")}</span>{Icon.chevR()}
        </button>
      </>
    );
  } else if (phase === "order") {
    const assigned = frame.spots.filter((s) => motorsOf(draft, s.n).length > 0).length;
    const dupMotors = frame.spots.filter((s) => motorsOf(draft, s.n).length > 1).map((s) => s.n);
    const missing = frame.spots.filter((s) => motorsOf(draft, s.n).length === 0).map((s) => s.n);
    const shown = allOuts ? [...outputs.shown, ...outputs.rest] : outputs.shown;
    const maxMotor = Math.max(...frame.spots.map((s) => s.n), frame.servo ? 7 : 0);
    body = (
      <>
        <div className="mw-headline"><h3>{t("Match outputs to motors")}</h3><p>{t("Spin an output, then tap the arm that turned.")}</p></div>
        <div className="mw-row-between">
          <span className="mw-dim mw-sm">{t("{n} of {total} motors on an output", { n: assigned, total: frame.spots.length })}</span>
          <button type="button" className="mw-link" disabled={busy} onClick={fillInOrder}>{t("Fill 1–{n} in order", { n: Math.max(...frame.spots.map((s) => s.n)) })}</button>
        </div>
        <div className="mw-cards" role="list">
          {shown.map((ch) => {
            const m = draft[ch] ?? live[ch] ?? 0;
            const isServo = !!frame.servo && m === 7 && !frame.spots.some((s) => s.n === 7);
            const others = m > 0 ? motorsOf(draft, m).filter((c) => c !== ch) : [];
            const spinning = spin?.key === `out:${ch}`;
            const needsBoot = m > 0 && dshot && (bootMap.current?.[ch] ?? 0) === 0 && (live[ch] ?? 0) !== m;
            const state = spinning ? "spin" : others.length ? "dup" : needsBoot ? "boot" : m > 0 ? (tested.has(ch) ? "ok" : "set") : m === -1 || ch > maxMotor ? "off" : "empty";
            return (
              <div key={ch} role="listitem" className={`mw-card is-${state}${selOut === ch ? " sel" : ""}`}>
                <div className="mw-card-row" onClick={() => setSelOut(ch)}>
                  <span className="mw-out">OUT {ch}</span>
                  {isServo ? <span className="mw-chip servo">{t("Yaw servo")}</span>
                    : m > 0 ? <span className={`mw-chip ${state === "ok" ? "ok" : state === "dup" || state === "boot" ? "warn" : state === "spin" ? "cyan" : ""}`}>{state === "ok" ? Icon.check("var(--ok)", 11) : state === "dup" ? Icon.warn("var(--amber)", 11) : null}M{m}</span>
                    : state === "off" ? <span className="mw-chip off">{t("Not a motor")}</span>
                    : <span className="mw-chip empty">{t("No motor")}</span>}
                  <span className="mw-hint">
                    {state === "set" ? t("not spun yet") : state === "empty" ? t("tap an arm to assign") : state === "boot" ? t("reboot to spin") : state === "dup" ? t("also on OUT {list}", { list: others.join(", ") }) : ""}
                  </span>
                  <span className="mw-grow" />
                  {spinning ? (
                    <button type="button" className="mw-btn danger xs" onClick={(ev) => { ev.stopPropagation(); stopSpin(); }}>{Icon.stop()}<span>{t("Stop")}</span></button>
                  ) : (
                    <button
                      type="button"
                      className="mw-ib"
                      disabled={busy || blocked || needsBoot || !!spin}
                      onClick={(ev) => { ev.stopPropagation(); void spinOutput(ch); }}
                      aria-label={t("Spin output {n}", { n: ch })}
                      title={needsBoot ? t("reboot to spin") : t("Spin output {n}", { n: ch })}
                    >
                      {Icon.play()}
                    </button>
                  )}
                  <button
                    type="button"
                    className="mw-ib ghost"
                    aria-haspopup="menu"
                    aria-expanded={menuOut === ch}
                    aria-label={t("Output {n} options", { n: ch })}
                    onClick={(ev) => { ev.stopPropagation(); setMenuOut(menuOut === ch ? null : ch); setSelOut(ch); }}
                  >
                    {Icon.dots}
                  </button>
                </div>
                {spinning && spin ? (
                  <div className="mw-card-live"><Countdown until={spin.until} /><b>{t("Spinning — tap the arm that turned")}</b></div>
                ) : null}
                {others.length ? (
                  <div className="mw-card-fix">
                    <span>{t("Motor {n} is on two outputs.", { n: m })}</span>
                    <button type="button" className="mw-btn quiet xs" onClick={() => { for (const c of others) assign(c, -1); }}>{t("Keep OUT {n}", { n: ch })}</button>
                  </div>
                ) : null}
                {menuOut === ch ? (
                  <div className="mw-menu" role="menu">
                    <div className="mw-menu-h">{t("Assign OUT {n} to", { n: ch })}</div>
                    <div className="mw-menu-grid">
                      {frame.spots.map((s) => (
                        <button key={s.n} type="button" role="menuitemradio" aria-checked={m === s.n} className={m === s.n ? "on" : ""} onClick={() => assign(ch, s.n)}>{s.n}</button>
                      ))}
                    </div>
                    {frame.servo ? <button type="button" role="menuitem" className="mw-menu-i" onClick={() => assign(ch, 7)}>{t("Yaw servo")}</button> : null}
                    <button type="button" role="menuitem" className="mw-menu-i" onClick={() => assign(ch, -1)}>{t("Not a motor")}</button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {outputs.rest.length ? (
          <button type="button" className="mw-fold" aria-expanded={allOuts} onClick={() => setAllOuts(!allOuts)}>
            <span>{allOuts ? t("Hide other outputs") : t("Outputs {a}–{b}", { a: outputs.rest[0], b: outputs.rest[outputs.rest.length - 1] })}</span>
            <span className="mw-dim">{allOuts ? "" : t("not motors")}</span>
            {Icon.chevD()}
          </button>
        ) : null}
        {missing.length && !dupMotors.length ? <div className="mw-note warn">{Icon.warn()}<span>{t("No output yet: motor {list}", { list: missing.join(", ") })}</span></div> : null}
        {noteBox}
      </>
    );
    const warnSave = dupMotors.length > 0;
    footer = (
      <>
        {backBtn}
        <div className="mw-row">
          {warnSave ? <span className="mw-warn-t">{t("Allowed, but both ESCs get the same motor signal")}</span>
            : pendingWrites ? <span className="mw-dim mw-sm">{t("{n} outputs change", { n: pendingWrites })}</span> : null}
          <button
            type="button"
            className={`mw-btn ${warnSave ? "warnb" : needReboot ? "warn-solid" : "primary"}`}
            disabled={busy || blocked || !!spin}
            onClick={async () => {
              if (!(await saveOrder())) return;
              if (next) go(next);
            }}
          >
            <span>{warnSave ? t("Save anyway") : t("Save & next")}</span>{Icon.chevR()}
          </button>
        </div>
      </>
    );
  } else if (phase === "idle") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Idle test")}</h3><p>{t("Tap a motor to spin it at {p}%. Change idle in the settings panel.", { p: testPct })}</p></div>
        {spin?.key.startsWith("motor:") ? (
          <div className="mw-spin"><Countdown until={spin.until} size={36} /><div className="mw-grow"><b>{t("Motor {n} spinning", { n: Number(spin.key.slice(6)) })}</b></div><button type="button" className="mw-btn danger sm" onClick={stopSpin}>{Icon.stop()}<span>{t("Stop")}</span></button></div>
        ) : null}
        {noteBox}
      </>
    );
    footer = <>{backBtn}<button type="button" className="mw-btn primary" onClick={() => next && go(next)}><span>{t("Next")}</span>{Icon.chevR()}</button></>;
  } else if (phase === "direction") {
    const checked = dirMotors.filter((s) => answers[s.n]).length;
    const nRev = Object.values(answers).filter((a) => a === "reversed").length;
    const a = curDir ? answers[curDir.n] : undefined;
    body = curDir ? (
      <>
        <div className="mw-headline"><h3>{t("Spin direction")}</h3><p>{t("Compare with the arrow, viewed from above.")}</p></div>
        {a === "swap" ? (
          <>
            <div className="mw-swap">
              <span className="mw-swap-ic">{Icon.wires}</span>
              <div className="mw-grow"><b>{t("Swap two wires on motor {n}", { n: curDir.n })}</b><span>{t("PWM ESCs can't reverse in software. Any two of the three motor wires.")}</span></div>
            </div>
            <div className="mw-row">
              <button type="button" className="mw-btn primary sm" disabled={busy || blocked || !!spin} onClick={() => { setAnswers((x) => { const y = { ...x }; delete y[curDir.n]; return y; }); void runTest(`dir:${curDir.n}`, curDir.test); }}>{Icon.play()}<span>{t("Swapped — spin again")}</span></button>
              <button type="button" className="mw-btn quiet sm" onClick={advanceDir}>{t("Later")}</button>
            </div>
            <div className="mw-links"><button type="button" className="mw-link" onClick={() => setPanel(true)}>{Icon.sliders("var(--cyan)", 14)}{t("ESC settings")}</button></div>
          </>
        ) : (
          <>
            <DirCard t={t} n={curDir.n} yaw={curDir.yaw} spinning={spin?.key === `dir:${curDir.n}`} until={spin?.until} disabled={busy || blocked || (!!spin && spin.key !== `dir:${curDir.n}`)} onSpin={() => void runTest(`dir:${curDir.n}`, curDir.test)} onStop={stopSpin} />
            <div className="mw-answers">
              <button type="button" className="mw-btn okb" disabled={busy || blocked} onClick={() => void answer(false)}>{Icon.check("var(--ok)", 16)}<span>{t("Matches")}</span></button>
              <button type="button" className="mw-btn warnb" disabled={busy || blocked} onClick={() => void answer(true)}>{Icon.ccw()}<span>{t("Opposite")}</span></button>
            </div>
          </>
        )}
        <div className="mw-dim mw-sm">{nRev ? t("{a} of {b} checked · {r} reversed", { a: checked, b: dirMotors.length, r: nRev }) : t("{a} of {b} checked", { a: checked, b: dirMotors.length })}</div>
        {noteBox}
      </>
    ) : (
      <div className="mw-headline"><h3>{t("Spin direction")}</h3><p>{t("This frame has no direction to check.")}</p></div>
    );
    footer = <>{backBtn}<button type="button" className="mw-btn primary" disabled={!dirDone && dirMotors.length > 0} onClick={() => next && go(next)}><span>{t("Next")}</span>{Icon.chevR()}</button></>;
  } else if (phase === "done") {
    const swaps = Object.values(answers).filter((a) => a === "swap").length;
    const nRev = Object.values(answers).filter((a) => a === "reversed").length;
    // Net effect per parameter: first value before, last value after. Round trips drop out.
    const net = new Map<string, Change>();
    for (const c of changes) net.set(c.name, { name: c.name, from: net.get(c.name)?.from ?? c.from, to: c.to });
    const netChanges = [...net.values()].filter((c) => c.from == null || !sameParam(c.from, c.to));
    const outChanges = netChanges.filter((c) => /^SERVO\d+_FUNCTION$/.test(c.name)).length;
    const idleChange = netChanges.find((c) => c.name === "MOT_SPIN_ARM");
    const todo = (frame.spots ?? []).filter((s) => answers[s.n] === "swap");
    body = (
      <>
        <div className="mw-headline"><h3>{todo.length ? t("Almost ready") : t("Motors are ready")}</h3></div>
        <div className="mw-sums">
          {flow.includes("order") ? <Sum icon={Icon.check("var(--ok)", 18)} label={t("Order")} value={outChanges ? t("{n} changed", { n: outChanges }) : t("OK")} /> : null}
          {flow.includes("direction") ? <Sum icon={<RotIcon dir={1} size={18} />} label={t("Direction")} value={swaps ? t("{n} to fix", { n: swaps }) : nRev ? t("{n} reversed", { n: nRev }) : t("OK")} warn={swaps > 0} /> : null}
          {idleChange ? <Sum icon={Icon.sliders("var(--ok)", 18)} label={t("Idle")} value={`${Math.round(idleChange.to * 100)}%`} /> : null}
        </div>
        {todo.map((s) => (
          <div key={s.n} className="mw-todo">
            <span className="mw-todo-n">{s.n}</span>
            <div className="mw-grow"><b>{t("Swap two wires on motor {n}", { n: s.n })}</b><span>{t("Then check it again")}</span></div>
            <button type="button" className="mw-btn quiet sm" onClick={() => { const i = dirMotors.findIndex((d) => d.n === s.n); setAnswers((x) => { const y = { ...x }; delete y[s.n]; return y; }); if (i >= 0) setDirIdx(i); go("direction"); }}>{Icon.play()}<span>{t("Re-check")}</span></button>
          </div>
        ))}
        {needReboot ? <div className="mw-note warn">{Icon.warn()}<span>{t("Reboot to apply the changes")}</span></div> : null}
        {netChanges.length ? (
          <details className="mw-details">
            <summary>{t("{n} parameters changed", { n: netChanges.length })}{Icon.chevD()}</summary>
            <div className="mw-diff">
              {netChanges.map((c, i) => (
                <div key={`${c.name}-${i}`}><span className="mw-mono">{c.name}</span><s>{c.from == null ? "—" : +c.from.toFixed(3)}</s>{Icon.chevR("var(--dim)", 12)}<b>{+c.to.toFixed(3)}</b></div>
              ))}
            </div>
          </details>
        ) : null}
        {noteBox}
      </>
    );
    footer = (
      <>
        {backBtn}
        <div className="mw-row">
          {needReboot ? <button type="button" className="mw-btn text" onClick={() => leave(true)}>{t("Finish without reboot")}</button> : null}
          {needReboot ? (
            <button type="button" className="mw-btn warn-solid" disabled={blocked} onClick={startReboot}>{Icon.power()}<span>{t("Reboot & finish")}</span></button>
          ) : (
            <button type="button" className="mw-btn primary" onClick={() => leave(true)}>{t("Finish")}</button>
          )}
        </div>
      </>
    );
  }

  const left = phase === "safety" && reboot === "idle" ? (
    <div className="mw-safety">
      <Toggle on={props} icon={Icon.propOff} label={t("Propellers off")} sub={t("On every motor")} onToggle={() => setProps(!props)} />
      <Toggle on={secured} icon={Icon.secured} label={t("Vehicle secured")} sub={t("Hands and leads clear")} onToggle={() => setSecured(!secured)} />
    </div>
  ) : (
    <div className="mw-art">{diagram(300)}</div>
  );

  const title = fromAssistant && scope?.motors?.length === 1 && scope.steps?.length === 1 && scope.steps[0] === "direction"
    ? t("Fix motor {n} direction", { n: scope.motors[0] })
    : `${t("Motor setup")} · ${frame.title}`;

  return createPortal(
    <div className="modal-back" role="presentation">
      <div className="modal mw" role="dialog" aria-modal="true" aria-labelledby="mw-title">
        <div className="mw-head">
          <div className="mw-row">
            <h2 id="mw-title">{title}</h2>
            {fromAssistant ? <span className="mw-tag">{t("From assistant")}</span> : null}
          </div>
          <div className="mw-row">
            <button type="button" className={`mw-icon${issues ? " badge" : ""}`} onClick={() => setPanel(!panel)} aria-label={t("Motor settings")} title={t("Motor settings")} aria-expanded={panel}>
              {Icon.sliders()}
            </button>
            <button type="button" className="mw-icon" disabled={busy} onClick={() => leave()} aria-label={t("Close")} title={t("Close")}>{Icon.x()}</button>
          </div>
        </div>
        <ol className="mw-steps" aria-label={t("Steps")}>
          {flow.map((p, i) => (
            <li key={p} className={i < stepIndex ? "done" : i === stepIndex ? "on" : ""} aria-current={i === stepIndex ? "step" : undefined}>
              <span className="mw-step-dot">{i < stepIndex ? Icon.check("#101214", 11) : i + 1}</span>
              <span className="mw-step-name">{stepName[p]}</span>
            </li>
          ))}
        </ol>
        <div className={phase === "safety" && reboot === "idle" ? "mw-body is-safety" : "mw-body"}>
          <div className="mw-left">{left}</div>
          <div className="mw-right">{body}</div>
          {blocked && phase !== "safety" ? (
            <div className="mw-over" role="alert">
              <div className="mw-blocker">
                <span className="mw-blocker-ic">{armed ? Icon.lock : Icon.unplug}</span>
                <b>{armed ? t("Vehicle is armed") : t("Connection lost")}</b>
                <span>{armed ? t("Tests are off while armed. Disarm to continue.") : t("Motors stopped. Your matches are kept.")}</span>
                {!armed ? <span className="mw-row mw-dim mw-sm"><span className="mw-spinner sm" aria-hidden="true" />{t("Reconnecting…")}</span> : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="mw-foot">{footer}</div>
        {panel ? (
          <>
            <div className="mw-scrim" onClick={() => setPanel(false)} />
            <aside className="mw-panel" aria-label={t("Motor settings")}>
              <div className="mw-panel-h">
                <div className="mw-row"><b>{t("Motor settings")}</b>{issues ? <span className="mw-chip-warn">{t("{n} issue", { n: issues })}</span> : null}</div>
                <button type="button" className="mw-icon" onClick={() => setPanel(false)} aria-label={t("Close")}>{Icon.x()}</button>
              </div>
              <div className="mw-idle">
                <div className="mw-row-between"><b>{t("Idle & test throttle")}</b>{idleSaved ? <span className="mw-saved">{Icon.check("var(--ok)", 12)}{t("Saved")}</span> : <span className="mw-dim mw-sm">{t("Saving…")}</span>}</div>
                <div className="mw-idle-row">
                  <button type="button" className="mw-step-btn" onClick={() => changeIdle(pct - 1)} aria-label={t("Lower idle")}>−</button>
                  <div className="mw-val"><b>{pct}</b><span>%</span></div>
                  <button type="button" className="mw-step-btn" onClick={() => changeIdle(pct + 1)} aria-label={t("Raise idle")}>+</button>
                </div>
                <div className="mw-slider">
                  <span className="mw-zone" aria-hidden="true" />
                  <input type="range" min={0} max={25} step={1} value={pct} aria-label={t("Idle throttle")} onChange={(ev) => changeIdle(Number(ev.target.value))} />
                  <div className="mw-ticks"><span>0</span><span className="ok">{t("typical 6–10%")}</span><span>25</span></div>
                </div>
                <div className="mw-dim mw-sm">{t("Used by every test spin.")} <span className="mw-mono">MOT_SPIN_ARM {(pct / 100).toFixed(2)}</span></div>
              </div>
              <div className="mw-sec">{t("ESC")}</div>
              <div className="mw-esc">
                <EscRow tone={safetyIssue ? "warn" : "ok"} label={t("Safety switch")} param="BRD_SAFETY_DEFLT" value={safetyIssue ? t("Required") : t("Off")}>
                  {safetyIssue ? (
                    <button type="button" className="mw-btn primary xs" disabled={busy || blocked} onClick={async () => {
                      setBusy(true);
                      const err = await writeList([["BRD_SAFETY_DEFLT", 0]]);
                      setBusy(false);
                      if (err) failNote(err);
                      else setNeedReboot(true);
                    }}>{t("Turn off at boot")}</button>
                  ) : null}
                </EscRow>
                <EscRow tone={dshot ? "ok" : "warn"} label={t("Protocol")} param="MOT_PWM_TYPE" value={protocolName(num(params, "MOT_PWM_TYPE"))}>
                  {!dshot ? <span className="mw-dim mw-sm">{t("Reversing in the ESC needs DShot. With PWM, swap two motor wires instead.")}</span> : null}
                </EscRow>
                <EscRow tone={num(params, "SERVO_DSHOT_ESC") ? "ok" : ""} label={t("ESC firmware")} param="SERVO_DSHOT_ESC" value={escName(num(params, "SERVO_DSHOT_ESC"))} />
                <EscRow tone="" label={t("Reversed in ESC")} param="SERVO_BLH_RVMASK" value={reversedOuts.length ? reversedOuts.map((ch) => `OUT ${ch}`).join(", ") : t("None")} />
              </div>
            </aside>
          </>
        ) : null}
        {confirmClose ? (
          <>
            <div className="mw-scrim" />
            <div className="mw-confirm" role="alertdialog" aria-labelledby="mw-confirm-t">
              <b id="mw-confirm-t">{t("Leave motor setup?")}</b>
              <span>{t("{n} output changes are not saved.", { n: pendingWrites })}</span>
              <div className="mw-row end">
                <button type="button" className="mw-btn text" onClick={() => { setConfirmClose(false); leave(true); }}>{t("Discard")}</button>
                <button type="button" className="mw-btn quiet" onClick={() => setConfirmClose(false)}>{t("Keep editing")}</button>
                <button type="button" className="mw-btn primary" onClick={async () => { setConfirmClose(false); if (await saveOrder()) leave(true); }}>{t("Save & close")}</button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function Toggle({ on, icon, label, sub, onToggle }: { on: boolean; icon: ReactNode; label: string; sub: string; onToggle: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} className={on ? "mw-tile on" : "mw-tile"} onClick={onToggle}>
      <span className="mw-tile-ic">{icon}</span>
      <span className="mw-tile-txt"><b>{label}</b><span>{sub}</span></span>
      <span className="mw-tile-box">{on ? Icon.check("#101214", 12) : null}</span>
    </button>
  );
}

function DirCard({ t, n, yaw, spinning, until, disabled, onSpin, onStop }: {
  t: ReturnType<typeof useT>;
  n: number;
  yaw: -1 | 0 | 1;
  spinning: boolean;
  until?: number;
  disabled: boolean;
  onSpin: () => void;
  onStop: () => void;
}) {
  const cw = yaw < 0;
  return (
    <div className="mw-dir">
      <span className="mw-dir-ic">{spinning && until ? <Countdown until={until} size={40} /> : <RotIcon dir={cw ? 1 : -1} />}</span>
      <div className="mw-grow"><span className="mw-dim mw-sm">{t("Motor {n} should spin", { n })}</span><b>{cw ? t("Clockwise") : t("Counter-clockwise")}</b></div>
      {spinning ? (
        <button type="button" className="mw-btn danger sm" onClick={onStop}>{Icon.stop()}<span>{t("Stop")}</span></button>
      ) : (
        <button type="button" className="mw-btn sm" disabled={disabled} onClick={onSpin}>{Icon.play()}<span>{t("Spin")}</span></button>
      )}
    </div>
  );
}

function Sum({ icon, label, value, warn = false }: { icon: ReactNode; label: string; value: string; warn?: boolean }) {
  return (
    <div className={warn ? "mw-sum warn" : "mw-sum"}>
      {icon}
      <span className="mw-dim mw-sm">{label}</span>
      <b>{value}</b>
    </div>
  );
}

function EscRow({ tone, label, param, value, children }: { tone: "ok" | "warn" | ""; label: string; param: string; value: string; children?: ReactNode }) {
  return (
    <div className={`mw-er ${tone}`}>
      <i className={`mw-er-dot ${tone}`} />
      <div className="mw-er-txt"><span>{label}</span><span className="mw-mono">{param}</span></div>
      <div className={`mw-er-val ${tone}`}>{value}</div>
      {children ? <div className="mw-er-act">{children}</div> : null}
    </div>
  );
}
