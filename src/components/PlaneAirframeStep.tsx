import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { motorFrame } from "../lib/motorFrames";
import { LAYOUT_NAMES, OUTPUTS, classifyLayout, outputPlan, surfacesFor, type Layout, type LayoutKind } from "../lib/planeAirframe";
import { noteUi, sameParam, writeParam } from "../mav/cmd";
import { getSetupSnapshot, getSnapshot, subscribe } from "../mav/store";
import { useStorePicked } from "../mav/view";

const GUIDE = "https://ardupilot.org/plane/docs/rc-output-mapping.html";

const CARDS: { kind: LayoutKind; detail: string }[] = [
  { kind: "conventional", detail: "Aileron · elevator · rudder" },
  { kind: "wing", detail: "Two elevons" },
  { kind: "vtail", detail: "Aileron · two ruddervators" },
  { kind: "other", detail: "Elevon + rudder, flaperons, twin motor" },
];

/** QuadPlane frames the chips can set: Q_FRAME_CLASS / Q_FRAME_TYPE. */
const Q_FRAMES = [
  { label: "Quad X", cls: 1, type: 1 },
  { label: "Quad +", cls: 1, type: 0 },
];

function num(params: Record<string, number>, name: string): number | null {
  const v = params[name];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/** Top view, nose up; the moving surfaces are tinted. */
function PlaneMark({ kind }: { kind: LayoutKind | "quad" }) {
  const sv = (x: number, y: number, w: number, h: number, alt = false) => (
    <rect className={alt ? "pas-sv alt" : "pas-sv"} x={x} y={y} width={w} height={h} rx="1.5" />
  );
  if (kind === "other") return <svg className="pas-mark" viewBox="0 0 120 100" aria-hidden="true"><path className="pas-plus" d="M60 34v32M44 50h32" /></svg>;
  const fuselage = <rect className="pas-body" x="56" y="8" width="8" height="84" rx="4" />;
  const wing = <path className="pas-body" d="M10 40 L110 40 L110 52 L10 52z" />;
  return (
    <svg className="pas-mark" viewBox="0 0 120 100" aria-hidden="true">
      {kind === "wing" ? (
        <>
          <path className="pas-body" d="M60 18 L112 66 L104 74 L60 52 L16 74 L8 66 z" />
          {sv(78, 60, 26, 6)}
          {sv(16, 60, 26, 6)}
        </>
      ) : kind === "vtail" ? (
        <>
          {fuselage}
          {wing}
          {sv(12, 49, 26, 5)}
          {sv(82, 49, 26, 5)}
          <path className="pas-body" d="M60 82 L36 70 L34 75 L60 90 L86 75 L84 70z" />
          {sv(38, 72, 18, 4, true)}
          {sv(64, 72, 18, 4, true)}
        </>
      ) : kind === "quad" ? (
        <>
          {fuselage}
          {wing}
          <path className="pas-boom" d="M30 22v52M90 22v52" />
          {[[30, 22], [90, 22], [30, 74], [90, 74]].map(([x, y]) => <circle key={`${x}${y}`} className="pas-rotor" cx={x} cy={y} r="9" />)}
          <path className="pas-body" d="M38 82h44v8H38z" />
        </>
      ) : (
        <>
          {fuselage}
          {wing}
          {sv(12, 49, 26, 5)}
          {sv(82, 49, 26, 5)}
          <path className="pas-body" d="M38 80h44v8H38z" />
          {sv(40, 86, 40, 4)}
          {sv(58, 70, 4, 22, true)}
        </>
      )}
    </svg>
  );
}

/**
 * Plane airframe: the surface layout picked from pictures, the QuadPlane switch, and the outputs the layout uses.
 * Picking a layout drafts the SERVOn_FUNCTION changes and shows them before Write.
 */
export function PlaneAirframeStep() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const armed = useStorePicked((s) => !!s.armed);
  // While the list is still arriving (after a reboot it takes a while), an output not read yet is unknown, not free:
  // wait for the parameters this step uses.
  const loading = useStorePicked((s) => {
    if (!s.ok) return "";
    const count = s.param_count ?? 0;
    const got = Object.keys(s.params ?? {}).length;
    const needed = Array.from({ length: OUTPUTS }, (_, i) => `SERVO${i + 1}_FUNCTION`);
    const ready = count > 0 && needed.every((name) => name in (s.params ?? {}));
    return ready ? "" : `${got}/${count}`;
  });
  const params = sample.params || {};
  const saved = classifyLayout(params);
  const [pick, setPick] = useState<LayoutKind | null>(saved);
  useEffect(() => setPick(saved), [saved]);

  const qNow = num(params, "Q_ENABLE");
  const qClsNow = num(params, "Q_FRAME_CLASS");
  const qTypeNow = num(params, "Q_FRAME_TYPE");
  const tilt = num(params, "Q_TILT_ENABLE");
  const tailsit = num(params, "Q_TAILSIT_ENABLE");
  const [qOn, setQOn] = useState<boolean>(!!qNow);
  const [qFrame, setQFrame] = useState<{ cls: number | null; type: number | null }>({ cls: qClsNow, type: qTypeNow });
  useEffect(() => setQOn(!!qNow), [qNow]);
  useEffect(() => setQFrame({ cls: qClsNow, type: qTypeNow }), [qClsNow, qTypeNow]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<"" | "saved" | "reboot">("");
  // A reboot note stays until the link drops for that reboot.
  const wasOk = useRef(sample.ok);
  useEffect(() => {
    if (wasOk.current && !sample.ok) setDone("");
    wasOk.current = sample.ok;
  }, [sample.ok]);

  const drawn: Layout | null = pick && pick !== "other" ? pick : null;
  const plan = drawn && pick !== saved ? outputPlan(params, drawn) : null;
  const shown = plan ? plan.rows : surfacesFor(saved).map((s) => {
    let out: number | null = null;
    for (let o = 1; o <= OUTPUTS && out == null; o += 1) if (num(params, `SERVO${o}_FUNCTION`) === s.fn) out = o;
    return { ...s, out, from: s.fn, changed: false };
  });

  const writes: [string, number][] = [...(plan?.writes ?? [])];
  if (qNow != null && qOn !== !!qNow) writes.push(["Q_ENABLE", qOn ? 1 : 0]);
  if (qNow && qOn && qClsNow != null && qFrame.cls != null && qFrame.cls !== qClsNow) writes.push(["Q_FRAME_CLASS", qFrame.cls]);
  if (qNow && qOn && qTypeNow != null && qFrame.type != null && qFrame.type !== qTypeNow) writes.push(["Q_FRAME_TYPE", qFrame.type]);
  const needsReboot = writes.some(([name]) => name.startsWith("Q_"));
  const canWrite = sample.ok && !loading && !armed && writes.length > 0 && !busy && !(plan && plan.missing.length);

  function discard() {
    setError("");
    setPick(saved);
    setQOn(!!qNow);
    setQFrame({ cls: qClsNow, type: qTypeNow });
  }

  async function write() {
    setBusy(true);
    setError("");
    try {
      const live = getSnapshot().params;
      for (const [name, value] of writes) {
        const from = live[name];
        if (typeof from === "number" && sameParam(from, value)) continue;
        const err = await writeParam(name, value);
        if (err) {
          setError(err);
          addLog(t(err), "bad");
          return;
        }
        noteUi([{ kind: "param", name, value, from: typeof from === "number" ? from : null }]);
      }
      setDone(needsReboot ? "reboot" : "saved");
      addLog(t(needsReboot ? "Saved. Reboot the board to apply QuadPlane changes." : "Saved."), "ok");
    } finally {
      setBusy(false);
    }
  }

  const qFrameTitle = qClsNow != null ? motorFrame(qClsNow, qTypeNow)?.title ?? `Q_FRAME_CLASS ${qClsNow}` : "";
  let qLine: string;
  if (qNow == null) qLine = t("This firmware has no QuadPlane support.");
  else if (!qNow && qOn) qLine = t("Sets Q_ENABLE = 1. After Write, reboot the board; the Q_ parameters appear after the reboot.");
  else if (!qNow) qLine = t("Adds VTOL motors. Sets Q_ENABLE = 1, then the board must reboot before the Q_ parameters appear.");
  else if (!qOn) qLine = t("Sets Q_ENABLE = 0 and removes VTOL flight after a reboot.");
  else if (qClsNow == null) qLine = t("QuadPlane is on. Reboot the board so the Q_ parameters appear.");
  else qLine = t("QuadPlane is on: {frame}. The VTOL motors are matched on their own step.", { frame: qFrameTitle });

  return (
    <div className="frs">
      {!sample.ok ? <div className="frs-note info">{t("Connect a vehicle to read its outputs.")}</div> : null}
      {loading ? <div className="frs-note info">{t("Reading parameters from the board ({n}). The layout shows when they have all arrived.", { n: loading })}</div> : null}
      <h4 className="sov-sect">{t("Surfaces")}</h4>
      <div className="pas-cards" role="listbox" aria-label={t("Surface layout")}>
        {CARDS.map((card) => {
          const on = pick === card.kind;
          return (
            <button
              key={card.kind}
              type="button"
              role="option"
              aria-selected={on}
              className={`pas-card${on && !loading && sample.ok ? " on" : ""}${card.kind === "other" ? " other" : ""}`}
              disabled={!!loading || !sample.ok}
              onClick={() => { setError(""); setDone(""); setPick(card.kind); }}
            >
              <PlaneMark kind={card.kind} />
              <b>{t(card.kind === "other" ? "Other" : LAYOUT_NAMES[card.kind])}</b>
              <span>{t(card.detail)}</span>
            </button>
          );
        })}
      </div>
      {pick === "other" ? (
        <div className="frs-note info">
          {saved === "other"
            ? t("These outputs are not one of the three layouts. Set each output on the Outputs step or in Params.")
            : t("Other layouts are set output by output on the Outputs step or in Params. Nothing is written from here.")}
        </div>
      ) : null}
      {sample.ok && !loading && saved == null && pick == null ? <div className="frs-note info">{t("No surface is on an output yet. Pick the layout to assign ArduPlane's default outputs.")}</div> : null}

      <h4 className="sov-sect">{t("Lift")}</h4>
      <div className={`pas-qp${qNow == null ? " off" : ""}`}>
        <PlaneMark kind="quad" />
        <div className="pas-qp-copy">
          <div className="pas-qp-head">
            <b>QuadPlane</b>
            <button
              type="button"
              role="switch"
              aria-checked={qOn}
              aria-label="QuadPlane"
              className={`pas-switch${qOn ? " on" : ""}`}
              disabled={qNow == null}
              onClick={() => { setError(""); setDone(""); setQOn(!qOn); }}
            >
              <i />
            </button>
          </div>
          <span className="pas-qp-line">{qLine}</span>
          <div className="pas-qp-chips">
            {Q_FRAMES.map((f) => {
              const on = !!qNow && qOn && qFrame.cls === f.cls && qFrame.type === f.type && !tilt && !tailsit;
              return (
                <button
                  key={f.label}
                  type="button"
                  className={`frs-pill${on ? " on" : ""}`}
                  disabled={!qNow || !qOn || qClsNow == null || !!tilt || !!tailsit}
                  onClick={() => setQFrame({ cls: f.cls, type: f.type })}
                >
                  {t(f.label)}
                </button>
              );
            })}
            <span className={`frs-pill static${tilt ? " on" : ""}`} title={t("Set in Params: Q_TILT_ENABLE, then its own setup.")}>{t("Tilt-rotor")}</span>
            <span className={`frs-pill static${tailsit ? " on" : ""}`} title={t("Set in Params: Q_TAILSIT_ENABLE, then its own setup.")}>{t("Tailsitter")}</span>
          </div>
        </div>
      </div>

      <h4 className="sov-sect pas-sect">
        <span>{plan ? t("Outputs after Write") : t("Outputs this layout uses")}</span>
        <span className="pas-src">{t("from SERVOn_FUNCTION")}</span>
      </h4>
      <div className="pas-omap">
        {[...shown].sort((a, b) => (a.out ?? 99) - (b.out ?? 99)).map((row) => (
          <div key={row.key} className={`pas-orow${row.changed ? " changed" : ""}${row.out == null ? " missing" : ""}`}>
            <span className="pas-out">{row.out != null ? `OUT ${row.out}` : "—"}</span>
            <b>{t(row.title)}</b>
            <span className="pas-fn">
              {row.changed && row.from != null ? `${row.from} → ` : ""}
              {row.fn}
            </span>
            <span className="pas-ok" aria-hidden="true">{row.out == null ? "!" : row.changed ? "•" : "✓"}</span>
          </div>
        ))}
        {plan?.cleared.length ? (
          <div className="pas-orow changed">
            <span className="pas-out">{plan.cleared.map((o) => `OUT ${o}`).join(", ")}</span>
            <b>{t("Freed")}</b>
            <span className="pas-fn">→ 0</span>
            <span className="pas-ok" aria-hidden="true">•</span>
          </div>
        ) : null}
      </div>
      {plan?.missing.length ? <div className="frs-note err">{t("No free output for: {list}.", { list: plan.missing.map((m) => t(m.title)).join(", ") })}</div> : null}
      {plan ? <div className="frs-note info">{t("After Write, check each surface's direction on the Outputs step.")}</div> : null}
      {done === "reboot" ? <div className="frs-note warn">{t("Saved. Reboot the board to apply QuadPlane changes; the reboot button is in the header.")}</div> : null}
      {done === "saved" ? <div className="frs-note ok">{t("Saved. Check each surface's direction on the Outputs step.")}</div> : null}
      {error ? <div className="frs-note err">{t(error)}</div> : null}

      <div className="frs-foot">
        <a href={GUIDE} target="_blank" rel="noreferrer">{t("Plane: servo functions")} ↗</a>
        <div className="frs-foot-actions">
          {armed ? <span className="frs-why">{t("Disarm to change the airframe.")}</span> : null}
          {writes.length ? (
            <>
              <span className="frs-changes">{writes.length === 1 ? t("1 change") : t("{n} changes", { n: writes.length })}</span>
              <button type="button" className="frs-btn text" onClick={discard}>{t("Discard")}</button>
            </>
          ) : null}
          <button type="button" className="frs-btn primary" disabled={!canWrite} onClick={() => void write()}>
            {busy ? t("Writing…") : writes.length ? t("Write") : t("Saved")}
          </button>
        </div>
      </div>
    </div>
  );
}
