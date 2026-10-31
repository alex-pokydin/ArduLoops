import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { checkOfLine, checksFor, readSkipped, skipValue } from "../lib/armingChecks";
import { PREARM_FRESH_S } from "../lib/vehicleHeader";
import { noteUi, writeParam } from "../mav/cmd";
import { useStorePicked } from "../mav/view";
import { Icon } from "./MotorSetup";

type Live = {
  ok: boolean;
  armed: boolean;
  frame: "copter" | "plane";
  /** ARMING_SKIPCHK or ARMING_CHECK as read, "" before it arrives. */
  skip: string;
  fail: string[];
  wouldFail: string[];
};

function useLive(): Live {
  return useStorePicked(
    (s) => {
      const now = s.heartbeat_at ?? 0;
      const fresh = (list?: { text: string; at: number }[]) => (s.ok && !s.armed ? (list ?? []).filter((line) => now - line.at <= PREARM_FRESH_S).map((line) => line.text) : []);
      const p = s.params ?? {};
      return {
        ok: !!s.ok,
        armed: !!s.armed,
        frame: s.frame === "plane" ? "plane" : "copter",
        skip: typeof p.ARMING_SKIPCHK === "number" ? `S${p.ARMING_SKIPCHK}` : typeof p.ARMING_CHECK === "number" ? `C${p.ARMING_CHECK}` : "",
        fail: fresh(s.prearm),
        wouldFail: fresh(s.prearm_skipped),
      };
    },
    (a, b) => a.ok === b.ok && a.armed === b.armed && a.frame === b.frame && a.skip === b.skip && a.fail.join("\n") === b.fail.join("\n") && a.wouldFail.join("\n") === b.wouldFail.join("\n"),
  );
}

function paramsOf(skip: string): Record<string, number> {
  if (!skip) return {};
  return skip[0] === "S" ? { ARMING_SKIPCHK: Number(skip.slice(1)) } : { ARMING_CHECK: Number(skip.slice(1)) };
}

/**
 * Header of the Overview's pre-arm section: a count, Choose checks, and a note naming skipped checks, which never
 * send a blocking PreArm line. Both buttons open the checks window; Turn back on opens it with those ticked.
 */
export function PreArmHead({ failing }: { failing: number }) {
  const t = useT();
  const live = useLive();
  const checks = checksFor(live.frame);
  const state = readSkipped(paramsOf(live.skip), checks);
  const skipped = state ? checks.filter((c) => state.skipped.has(c.bit)) : [];
  const [open, setOpen] = useState<null | { tick: number[] }>(null);
  const names = skipped.map((c) => t(c.name)).join(", ");
  return (
    <>
      <h4 className="sov-sect pas-sect">
        <span>{t("Pre-arm checks")}</span>
        <span className="ac-head">
          {live.ok ? (
            <span className="pas-src">
              {live.armed ? t("armed · checks ran at arming") : failing ? t("{n} failing", { n: failing }) : t("none failing")}
              {skipped.length ? ` · ${t("{n} skipped", { n: skipped.length })}` : ""}
            </span>
          ) : null}
          {live.ok && state ? <button type="button" className="ac-link" onClick={() => setOpen({ tick: [] })}>{t("Choose checks")}</button> : null}
        </span>
      </h4>
      {live.ok && skipped.length ? (
        <div className="ac-note">
          <span>{t(skipped.length > 1 ? "{names} are skipped: they run but do not stop arming." : "{names} is skipped: it runs but does not stop arming.", { names })}</span>
          <button type="button" className="ac-link" onClick={() => setOpen({ tick: skipped.map((c) => c.bit) })}>{t("Turn back on")}</button>
        </div>
      ) : null}
      {open ? <ArmingChecksWindow tick={open.tick} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/**
 * One checkbox per arming check: checked = it stops arming when it fails. Each row says what it covers and its
 * state now. Write sends one parameter, ARMING_SKIPCHK or ARMING_CHECK, whichever the board has.
 */
export function ArmingChecksWindow({ tick = [], onClose }: { tick?: number[]; onClose: () => void }) {
  const t = useT();
  const live = useLive();
  const checks = checksFor(live.frame);
  const state = readSkipped(paramsOf(live.skip), checks);
  const [skip, setSkip] = useState<Set<number>>(() => {
    const next = new Set(state?.skipped ?? []);
    for (const bit of tick) next.delete(bit);
    return next;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const failing = useMemo(() => new Set(live.fail.map((line) => checkOfLine(line, checks)).filter((bit): bit is number => bit != null)), [live.fail, checks]);
  const wouldFail = useMemo(() => new Set(live.wouldFail.map((line) => checkOfLine(line, checks)).filter((bit): bit is number => bit != null)), [live.wouldFail, checks]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  if (!state) return null;
  const changed = checks.filter((c) => state.skipped.has(c.bit) !== skip.has(c.bit));
  const value = skipValue(state, skip, checks);

  async function write() {
    if (!state) return;
    setBusy(true);
    setError("");
    const err = await writeParam(state.param, value);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    noteUi([{ kind: "param", name: state.param, value, from: state.raw }]);
    onClose();
  }

  const toggle = (bit: number) => {
    const next = new Set(skip);
    if (next.has(bit)) next.delete(bit);
    else next.add(bit);
    setSkip(next);
  };

  return createPortal(
    <div className="modal-back" role="presentation">
      <div className="modal ac-modal" role="dialog" aria-modal="true" aria-labelledby="ac-title">
        <div className="ac-top">
          <div className="ac-title">
            <h2 id="ac-title">{t("Arming checks")}</h2>
            <span>{t("A checked check stops arming when it fails. An unchecked one still runs and reports; it just does not stop arming.")}</span>
          </div>
          <button type="button" className="mw-icon" disabled={busy} onClick={onClose} aria-label={t("Close")} title={t("Close")}>{Icon.x()}</button>
        </div>
        <div className="ac-list">
          {checks.map((c) => {
            const on = !skip.has(c.bit);
            const was = !state.skipped.has(c.bit);
            const now = !live.ok || live.armed ? ["", "—"] : state.skipped.has(c.bit) ? (wouldFail.has(c.bit) ? ["warn", "would fail"] : ["warn", "skipped"]) : failing.has(c.bit) ? ["fail", "failing"] : ["done", "passes"];
            return (
              <label key={c.bit} className={`ac-row${on !== was ? " changed" : ""}${on ? "" : " off"}`}>
                <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(c.bit)} />
                <span className="ac-name"><b>{t(c.name)}</b><span>{t(c.what)}</span></span>
                <span className={`ac-now ${now[0]}`}><i />{t(now[1])}</span>
              </label>
            );
          })}
        </div>
        {error ? <div className="mw-note warn">{Icon.warn()}<span>{t(error)}</span></div> : null}
        <div className="ac-foot">
          <span className="ac-foot-left">
            <button type="button" className="mw-btn text" disabled={busy || skip.size === 0} onClick={() => setSkip(new Set())}>{t("Check all")}</button>
            <span className="ac-param">{changed.length ? `${state.param} ${state.raw} → ${value}` : state.param}</span>
          </span>
          <span className="ac-foot-right">
            <button type="button" className="mw-btn text" disabled={busy} onClick={onClose}>{t("Cancel")}</button>
            <button type="button" className="mw-btn primary" disabled={busy || !changed.length || !live.ok || live.armed} onClick={() => void write()}>
              {busy ? t("Writing…") : changed.length ? t("Write {n} changes", { n: changed.length }) : t("Write")}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
