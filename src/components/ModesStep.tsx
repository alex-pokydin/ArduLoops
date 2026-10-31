import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { NEEDS_TEXT, SLOT_BANDS, canFly, modeSlot, modesFor, sources, type Mode } from "../lib/flightModes";
import { STICKS, channelOf } from "../lib/radio";
import { noteUi, sameParam, writeParam } from "../mav/cmd";
import { getLatest, getSetupSnapshot, getSnapshot, subscribe } from "../mav/store";
import { useStorePicked } from "../mav/view";
import { type WizardClose } from "../wizards/close";
import { Icon } from "./MotorSetup";
import { StepFooter, StepNum, pnum, useParamDraft } from "./OutputSetup";
import { SensorWizard } from "./SensorWizard";
import { StepPreArm } from "./StepPreArm";

const GUIDE = "https://ardupilot.org/copter/docs/common-rc-transmitter-flight-mode-configuration.html";
const okPwm = (v: number | undefined): v is number => typeof v === "number" && v >= 800 && v <= 2200;

/** The switch as six equal bands, position 6 on top, with the live PWM marked inside its band. */
function SwitchArt({ pwm, names, live }: { pwm: number | null; names: string[]; live: number | null }) {
  const H = 38;
  const top = (i: number) => 8 + (5 - i) * H;
  const markY = (() => {
    if (pwm == null) return null;
    const i = modeSlot(pwm);
    if (i == null) return null;
    const [lo, hi] = SLOT_BANDS[i];
    const f = Math.max(0, Math.min(1, (pwm - lo) / (hi - lo || 1)));
    return top(i) + (1 - f) * (H - 4) + 2;
  })();
  return (
    <svg viewBox={`0 0 240 ${H * 6 + 16}`} className="md-art" aria-hidden="true">
      <line x1="22" y1="8" x2="22" y2={8 + H * 6} className="md-rail" />
      {SLOT_BANDS.map((_, i) => (
        <g key={i} className={`md-band${live === i ? " on" : ""}`}>
          <rect x="40" y={top(i)} width="190" height={H - 4} rx="8" />
          <text x="54" y={top(i) + H / 2 + 2} className="md-num">{i + 1}</text>
          <text x="76" y={top(i) + H / 2 + 2} className="md-name">{names[i] ?? "—"}</text>
        </g>
      ))}
      {markY != null ? <path d={`M10 ${markY - 7}l14 7-14 7z`} className="md-marker" /> : null}
    </svg>
  );
}

/**
 * Flight modes: the mode switch drawn as its six positions with the live one lit, then three jobs: the switch
 * channel, the six modes, and whether each can fly on this vehicle (GPS, flow, or neither). Modes are a draft.
 */
export function ModesStep({ frame }: { frame: "copter" | "plane" }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const live = useSyncExternalStore(subscribe, getLatest, getLatest);
  const armed = useStorePicked((s) => !!s.armed);
  const params = sample.params || {};
  const draft = useParamDraft(params);
  const [wizard, setWizard] = useState(false);
  const list = modesFor(frame);
  const ch = Math.round(pnum(params, "FLTMODE_CH") ?? 5);
  const pwm = live.rc?.[ch - 1];
  const slot = okPwm(pwm) ? modeSlot(pwm) : null;
  const src = sources(params);
  const values = Array.from({ length: 6 }, (_, i) => draft.value(`FLTMODE${i + 1}`));
  const modeOf = (v: number | null) => (v == null ? undefined : list.find((m) => m.n === Math.round(v)));
  const names = values.map((v) => (v == null ? "—" : t(modeOf(v)?.name ?? "Mode {n}", { n: Math.round(v) })));
  const cannot = values.map((v, i) => [i, modeOf(v)] as [number, Mode | undefined]).filter(([, m]) => !canFly(m, src));
  const safe = values.filter((v) => modeOf(v)?.needs === "none").length;
  const ready = live.ok && !live.armed;
  const loaded = values.every((v) => v != null);

  return (
    <div className="frs">
      <StepPreArm step="modes" />
      {!sample.ok ? <div className="frs-note info">{t("Connect a vehicle to read its flight modes.")}</div> : null}
      <div className="ms-top">
        <div className="ms-art md-col">
          <SwitchArt pwm={okPwm(pwm) ? pwm : null} names={names} live={slot} />
          <span>{okPwm(pwm) ? t("CH{n} {v} µs · position {p}", { n: ch, v: pwm, p: (slot ?? 0) + 1 }) : t("No switch yet.")}</span>
        </div>
        <div className="ms-cards">
          <div className="ms-card">
            <div className="ms-card-head"><b>{t("Flight modes")}</b><span className="ms-fix">{t("Flip the switch to see which row is live")}</span></div>
            <div className="ms-wstep">
              <StepNum n={1} state={slot != null ? "done" : "warn"} />
              <span className="ms-wstep-copy"><b>{t("Switch")}</b><span>{slot != null ? t("Channel {n} · position {p} now", { n: ch, p: slot + 1 }) : t("Channel {n} · nothing moves on it yet", { n: ch })}</span></span>
              <button type="button" className={`frs-btn ${slot == null ? "primary sm" : "quiet"}`} disabled={!ready} onClick={() => setWizard(true)}>{t("Find the switch")}</button>
            </div>
            <div className="ms-wstep">
              <StepNum n={2} state={loaded ? "done" : "todo"} />
              <span className="ms-wstep-copy"><b>{t("Six positions")}</b><span>{loaded ? names.join(" · ") : t("Waiting for the flight mode parameters.")}</span></span>
            </div>
            <div className="ms-wstep">
              <StepNum n={3} state={!loaded ? "todo" : cannot.length || safe === 0 ? "warn" : "done"} />
              <span className="ms-wstep-copy"><b>{t("Can it fly them?")}</b><span>{!loaded ? "" : cannot.length
                ? t("{n} need what this vehicle does not have ({src}).", { n: cannot.length, src: t(src.gps ? "GPS, no flow" : src.flow ? "flow, no GPS" : "no GPS, no flow") })
                : safe === 0 ? t("Every position needs a position source. Keep one that flies without, for when it is lost.") : t("Every position can fly; {n} need no GPS.", { n: safe })}</span></span>
            </div>
          </div>
        </div>
      </div>
      <h4 className="sov-sect pas-sect"><span>{t("Positions")}</span><span className="pas-src">{t("the lit row is where the switch is now")}</span></h4>
      <div className="cps-table" role="table">
        {values.map((v, i) => {
          const m = modeOf(v);
          const ok = canFly(m, src);
          const options = list.some((x) => v != null && x.n === Math.round(v)) || v == null ? list : [{ n: Math.round(v), name: `Mode ${Math.round(v)}`, needs: "none" as const }, ...list];
          return (
            <div key={i} className={`md-tr${slot === i ? " on" : ""}`} role="row">
              <b className="cps-n">{i + 1}</b>
              <span className="mono mw-dim">{i === 0 ? `< ${SLOT_BANDS[0][1] + 1}` : i === 5 ? `${SLOT_BANDS[5][0]}+` : `${SLOT_BANDS[i][0]}–${SLOT_BANDS[i][1]}`}</span>
              {v == null ? <span>—</span> : (
                <select value={Math.round(v)} onChange={(e) => draft.set(`FLTMODE${i + 1}`, Number(e.target.value))}>
                  {options.map((x) => <option key={x.n} value={x.n}>{t(x.name)}</option>)}
                </select>
              )}
              <span className={ok ? "mw-dim" : "md-warn"}>{m ? t(ok ? NEEDS_TEXT[m.needs] : `${NEEDS_TEXT[m.needs]} · not on this vehicle`) : ""}</span>
            </div>
          );
        })}
      </div>
      {wizard ? <ModeSwitchWizard frame={frame} onClose={() => setWizard(false)} /> : null}
      <StepFooter draft={draft} armed={armed} ok={sample.ok} guide={GUIDE} guideLabel="Flight modes" rebootNames={[]} />
    </div>
  );
}

/**
 * Find the mode switch: flip it through its positions; the channel that moves (not a stick) is the switch. Then the
 * six positions, each lit as the switch reaches it, and Write saves FLTMODE_CH and FLTMODE1..6.
 */
export function ModeSwitchWizard({ frame, onClose, fromAssistant }: { frame: "copter" | "plane"; onClose: (report?: WizardClose) => void; fromAssistant?: boolean }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const params = sample.params ?? {};
  const rc = sample.rc ?? [];
  const list = modesFor(frame);
  const src = sources(params);
  const stored = Math.round(pnum(params, "FLTMODE_CH") ?? 5);
  const sticks = useMemo(() => new Set(STICKS.map((s) => channelOf(params, s.key))), [params]);
  const [phase, setPhase] = useState<"flip" | "modes" | "done">("flip");
  const [span, setSpan] = useState<Record<number, [number, number]>>({});
  const [pick, setPick] = useState<number | null>(null);
  const [modes, setModes] = useState<(number | null)[]>(() => Array.from({ length: 6 }, (_, i) => pnum(params, `FLTMODE${i + 1}`)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (phase !== "flip") return;
    setSpan((prev) => {
      let next = prev;
      rc.forEach((v, i) => {
        if (!okPwm(v)) return;
        const [lo, hi] = prev[i + 1] ?? [v, v];
        if (v < lo || v > hi || !prev[i + 1]) {
          if (next === prev) next = { ...prev };
          next[i + 1] = [Math.min(lo, v), Math.max(hi, v)];
        }
      });
      return next;
    });
  }, [rc, phase]);

  // The widest-moving channel that is not a stick, once it has crossed at least two positions.
  const found = Object.entries(span)
    .map(([c, [lo, hi]]) => [Number(c), hi - lo] as [number, number])
    .filter(([c, w]) => !sticks.has(c) && w >= 250)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const ch = pick ?? found ?? stored;
  const pwm = rc[ch - 1];
  const slot = okPwm(pwm) ? modeSlot(pwm) : null;
  const name = (v: number | null) => (v == null ? "—" : t(list.find((m) => m.n === v)?.name ?? "Mode {n}", { n: v }));
  const leave = () => onClose({ outcome: phase === "done" ? "completed" : "cancelled", measures: { FLTMODE_CH: ch, ...Object.fromEntries(modes.map((v, i) => [`FLTMODE${i + 1}`, v])) } });

  async function write() {
    setBusy(true);
    setMessage("");
    const live = getSnapshot().params;
    const pairs: [string, number][] = [["FLTMODE_CH", ch], ...modes.flatMap((v, i) => (v == null ? [] : [[`FLTMODE${i + 1}`, v] as [string, number]]))];
    for (const [k, v] of pairs) {
      const from = live[k];
      if (typeof from === "number" && sameParam(from, v)) continue;
      const err = await writeParam(k, v);
      if (err) {
        setBusy(false);
        setMessage(err);
        return;
      }
      noteUi([{ kind: "param", name: k, value: v, from: typeof from === "number" ? from : null }]);
    }
    setBusy(false);
    setPhase("done");
  }

  const left = (
    <div className="sw-art md-col">
      <SwitchArt pwm={okPwm(pwm) ? pwm : null} names={modes.map(name)} live={slot} />
      <b>{okPwm(pwm) ? t("CH{n} {v} µs · position {p}", { n: ch, v: pwm, p: (slot ?? 0) + 1 }) : t("No switch yet.")}</b>
    </div>
  );
  let body;
  let footer;
  if (phase === "flip") {
    const others = Array.from({ length: Math.max(8, rc.length) }, (_, i) => i + 1).filter((c) => !sticks.has(c));
    body = (
      <>
        <div className="mw-headline"><h3>{t("Flip the mode switch")}</h3><p>{t("Move it through every position. The channel that moves is the switch; the sticks are left out.")}</p></div>
        <div className={`mw-note ${found ? "ok" : "warn"}`}><i className="sw-dot" /><span>{found ? t("Channel {n} moved: that is the switch.", { n: found }) : t("Waiting for a switch to move… (now channel {n})", { n: stored })}</span></div>
        <div className="md-chs">
          {others.map((c) => (
            <button key={c} type="button" className={`md-ch${c === ch ? " on" : ""}`} onClick={() => setPick(c)}>
              <span className="mono">CH{c}</span><span className="mono mw-dim">{okPwm(rc[c - 1]) ? rc[c - 1] : "—"}</span>
            </button>
          ))}
        </div>
        <span className="mw-dim mw-sm">{t("Or tap the channel yourself.")}</span>
      </>
    );
    footer = (<><button type="button" className="mw-btn text" onClick={leave}>{t("Cancel")}</button><button type="button" className="mw-btn primary" onClick={() => setPhase("modes")}><span>{t("Next")}</span>{Icon.chevR()}</button></>);
  } else if (phase === "modes") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Pick a mode for each position")}</h3><p>{t("Flip the switch: the lit row is where it is now.")}</p></div>
        <div className="md-wiz">
          {modes.map((v, i) => {
            const m = list.find((x) => x.n === v);
            return (
              <label key={i} className={`md-wrow${slot === i ? " on" : ""}`}>
                <b className="cps-n">{i + 1}</b>
                <select value={v ?? ""} onChange={(e) => setModes((all) => all.map((x, j) => (j === i ? Number(e.target.value) : x)))}>
                  {v == null ? <option value="">—</option> : null}
                  {list.map((x) => <option key={x.n} value={x.n}>{t(x.name)}</option>)}
                </select>
                <span className={canFly(m, src) ? "mw-dim" : "md-warn"}>{m ? t(NEEDS_TEXT[m.needs]) : ""}</span>
              </label>
            );
          })}
        </div>
      </>
    );
    footer = (<><button type="button" className="mw-btn text" onClick={() => setPhase("flip")}>{t("Back")}</button><button type="button" className="mw-btn primary" disabled={busy || !sample.ok || sample.armed} onClick={() => void write()}>{busy ? t("Writing…") : t("Write")}</button></>);
  } else {
    body = <div className="mw-headline"><h3>{t("Flight modes saved")}</h3><p>{t("Switch on channel {n}. Flip it once more: the lit row follows.", { n: ch })}</p></div>;
    footer = (<><span /><button type="button" className="mw-btn primary" onClick={leave}>{t("Close")}</button></>);
  }
  return (
    <SensorWizard
      title={t("Flight modes")}
      fromAssistant={fromAssistant}
      steps={[t("Switch"), t("Positions"), t("Result")]}
      step={phase === "flip" ? 0 : phase === "modes" ? 1 : 2}
      left={left}
      body={<>{body}{message ? <div className="mw-note warn">{Icon.warn()}<span>{t(message)}</span></div> : null}</>}
      footer={footer}
      blocker={phase === "done" ? null : !sample.ok ? "lost" : sample.armed ? "armed" : null}
      busy={busy}
      onClose={leave}
    />
  );
}
