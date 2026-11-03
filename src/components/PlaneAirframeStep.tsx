import { useState, useSyncExternalStore } from "react";
import { editVehicle, useVehicleFacts } from "./ControllerBoard";
import { Icon } from "./MotorSetup";
import { StepNum } from "./OutputSetup";
import { SensorWizard } from "./SensorWizard";
import { type WizardClose } from "../wizards/close";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { motorFrame } from "../lib/motorFrames";
import { LAYOUT_NAMES, OUTPUTS, classifyLayout, outputPlan, surfacesFor, type Layout, type LayoutKind, type PlanRow } from "../lib/planeAirframe";
import { noteUi, sameParam, send as sendCmd, writeParam } from "../mav/cmd";
import { getSetupSnapshot, getSnapshot, subscribe } from "../mav/store";
import { useStorePicked } from "../mav/view";

const GUIDE = "https://ardupilot.org/plane/docs/servo-functions.html";

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

/** Where each surface's output tag sits on the large drawing (viewBox 0 -12 120 112). */
const TAG_AT: Record<string, [number, number][]> = {
  aileron: [[25, 58], [95, 58]],
  elevator: [[50, 96]],
  rudder: [[70, 74]],
  elevon_left: [[29, 74]],
  elevon_right: [[91, 74]],
  vtail_left: [[44, 85]],
  vtail_right: [[76, 85]],
  throttle: [[72, 8]],
};

function num(params: Record<string, number>, name: string): number | null {
  const v = params[name];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/** Top view, nose up; the moving surfaces are tinted. */
function PlaneMark({ kind, large }: { kind: LayoutKind | "quad"; large?: boolean }) {
  const sv = (x: number, y: number, w: number, h: number, alt = false) => (
    <rect className={alt ? "pas-sv alt" : "pas-sv"} x={x} y={y} width={w} height={h} rx="1.5" />
  );
  if (kind === "other") return <svg className="pas-mark" viewBox="0 0 120 100" aria-hidden="true"><path className="pas-plus" d="M60 34v32M44 50h32" /></svg>;
  const fuselage = <rect className="pas-body" x="56" y="8" width="8" height="84" rx="4" />;
  const wing = <path className="pas-body" d="M10 40 L110 40 L110 52 L10 52z" />;
  const shape = kind === "wing" ? (
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
  );
  if (!large) return <svg className="pas-mark" viewBox="0 0 120 100" aria-hidden="true">{shape}</svg>;
  return <>{shape}</>;
}

/** Which output each surface of a layout is on: the plan's when a change is drafted, else read from SERVOn_FUNCTION. */
function outputsOf(params: Record<string, number>, kind: LayoutKind | null): PlanRow[] {
  return surfacesFor(kind).map((s) => {
    let out: number | null = null;
    for (let o = 1; o <= OUTPUTS && out == null; o += 1) if (num(params, `SERVO${o}_FUNCTION`) === s.fn) out = o;
    return { ...s, out, from: s.fn, changed: false };
  });
}

/** The airframe large, nose up, each surface and the motor tagged with its output, as the copter page numbers its motors. */
function AirframeArt({ kind, rows }: { kind: LayoutKind | null; rows: PlanRow[] }) {
  const t = useT();
  if (!kind || kind === "other") return <div className="fs-empty">{t(kind === "other" ? "Other layout" : "No layout yet")}</div>;
  return (
    <svg className="pas-art" viewBox="0 -12 120 112" role="img" aria-label={t(LAYOUT_NAMES[kind])}>
      <path className="pas-nose" d="M60 -10l4 6h-8z" />
      <PlaneMark kind={kind} large />
      {rows.flatMap((row) => (TAG_AT[row.key] ?? []).map(([x, y], i) => (
        <g key={`${row.key}${i}`} className={`pas-tag${row.out == null ? " missing" : row.changed ? " changed" : ""}`}>
          <title>{`${t(row.title)} · ${row.out != null ? `OUT ${row.out}` : t("no output")}`}</title>
          <circle cx={x} cy={y} r="6.5" />
          <text x={x} y={y + 2.6}>{row.out ?? "—"}</text>
        </g>
      )))}
    </svg>
  );
}

function useAirframeLoading(): string {
  // While the list is still arriving (after a reboot it takes a while), an output not read yet is unknown, not free:
  // wait for the parameters this step uses.
  return useStorePicked((s) => {
    if (!s.ok) return "";
    const count = s.param_count ?? 0;
    const got = Object.keys(s.params ?? {}).length;
    const needed = Array.from({ length: OUTPUTS }, (_, i) => `SERVO${i + 1}_FUNCTION`);
    const ready = count > 0 && needed.every((name) => name in (s.params ?? {}));
    return ready ? "" : `${got}/${count}`;
  });
}

/**
 * Plane airframe in the common step layout, like the copter Frame step: the saved airframe drawn on the left with each
 * surface's output, and three numbered rows: 1 surfaces, 2 lift (QuadPlane), 3 the vehicle profile. Surfaces and lift are
 * changed in the Airframe wizard, which writes the output functions and Q_ENABLE (with the reboot QuadPlane needs).
 */
export function PlaneAirframeStep() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const armed = useStorePicked((s) => !!s.armed);
  const loading = useAirframeLoading();
  const facts = useVehicleFacts();
  const [wizard, setWizard] = useState<"surfaces" | "lift" | null>(null);
  const params = sample.params || {};
  const saved = classifyLayout(params);
  const rows = outputsOf(params, saved);
  // The setup view can show a plane while the link is a copter: write only to a plane.
  const plane = sample.ok && sample.frame === "plane";
  const ready = plane && !armed && !loading;

  const qNow = num(params, "Q_ENABLE");
  const qClsNow = num(params, "Q_FRAME_CLASS");
  const qTypeNow = num(params, "Q_FRAME_TYPE");
  const tilt = num(params, "Q_TILT_ENABLE");
  const tailsit = num(params, "Q_TAILSIT_ENABLE");
  const qFrameTitle = qClsNow != null ? motorFrame(qClsNow, qTypeNow)?.title ?? `Q_FRAME_CLASS ${qClsNow}` : "";

  const surfacesLine = !plane || loading ? t("How the surfaces are laid out")
    : saved == null ? t("No surface is on an output yet.")
      : saved === "other" ? t("Not one of the three layouts · set output by output on the Outputs step")
        : `${t(LAYOUT_NAMES[saved])} · ${rows.filter((r) => r.key !== "throttle").map((r) => `${t(r.title)} ${r.out != null ? `OUT ${r.out}` : "—"}`).join(", ")}`;
  const liftLine = !plane ? t("Whether it takes off like a copter")
    : qNow == null ? t("This firmware has no QuadPlane support.")
    : !qNow ? t("Plane only · Q_ENABLE 0")
      : qClsNow == null ? t("QuadPlane is on. Reboot the board so the Q_ parameters appear.")
        : `${t("QuadPlane")} · ${tilt ? t("Tilt-rotor") : tailsit ? t("Tailsitter") : qFrameTitle} · Q_ENABLE 1`;

  return (
    <div className="frs">
      {!plane ? <div className="frs-note info">{t("Connect a plane to read its outputs.")}</div> : null}
      {loading ? <div className="frs-note info">{t("Reading parameters from the board ({n}). The layout shows when they have all arrived.", { n: loading })}</div> : null}
      <div className="ms-top">
        <div className="ms-art fs-art">
          <AirframeArt kind={plane && !loading ? saved : null} rows={rows} />
          <span>{plane && !loading && saved && saved !== "other" ? `${t(LAYOUT_NAMES[saved])} · ${rows.filter((r) => r.out != null).map((r) => `OUT ${r.out}`).sort().join(", ")}` : ""}</span>
        </div>
        <div className="ms-cards">
          <div className="ms-card">
            <div className="ms-card-head"><b>{t("Airframe")}</b><span className="ms-fix">{t("QuadPlane needs a reboot")}</span></div>
            <div className="ms-wstep">
              <StepNum n={1} state={!plane ? "todo" : saved && saved !== "other" ? "done" : saved === "other" ? "warn" : "todo"} />
              <span className="ms-wstep-copy"><b>{t("Surfaces")}</b><span>{surfacesLine}</span></span>
              <button type="button" className={`frs-btn ${plane && saved == null ? "primary sm" : "quiet"}`} disabled={!ready} onClick={() => setWizard("surfaces")}>{t(plane && saved == null ? "Pick" : "Change")}</button>
            </div>
            <div className="ms-wstep">
              <StepNum n={2} state={!plane ? "todo" : qNow && qClsNow == null ? "warn" : "done"} />
              <span className="ms-wstep-copy"><b>{t("Lift")}</b><span>{liftLine}</span></span>
              {plane && qNow != null ? <button type="button" className="frs-btn quiet" disabled={!ready} onClick={() => setWizard("lift")}>{t("Change")}</button> : null}
            </div>
            <div className="ms-wstep">
              <StepNum n={3} state={facts.profiled ? "done" : "todo"} />
              <span className="ms-wstep-copy"><b>{t("Vehicle profile")}</b><span>{facts.chips.length ? facts.chips.join(" · ") : t("Wingspan, cells, weight and what kind of plane")}</span></span>
              <button type="button" className={`frs-btn ${facts.profiled ? "quiet" : "primary sm"}`} disabled={!facts.canEdit} onClick={() => editVehicle("profile")}>{t(facts.profiled ? "Edit" : "Add")}</button>
            </div>
            <span className="ms-hint">{t("A new layout means each surface's direction must be checked again on the Outputs step.")}</span>
          </div>
        </div>
      </div>
      {armed ? <div className="frs-note info">{t("Disarm to change the airframe.")}</div> : null}
      <div className="frs-foot">
        <a href={GUIDE} target="_blank" rel="noreferrer">{t("Plane: servo functions")} ↗</a>
      </div>
      {wizard ? <AirframeWizard start={wizard} onClose={() => setWizard(null)} /> : null}
    </div>
  );
}

/**
 * Pick the surface layout, then QuadPlane, then write: the output functions follow the layout (functions already on an
 * output stay, throttle never moves, leftover surface outputs are freed) and Q_ENABLE needs a reboot, so a QuadPlane change
 * ends in Save & reboot. Opened from Lift, it starts there with the saved layout.
 */
export function AirframeWizard({ start, onClose, fromAssistant }: { start: "surfaces" | "lift"; onClose: (report?: WizardClose) => void; fromAssistant?: boolean }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const armed = useStorePicked((s) => !!s.armed);
  const loading = useAirframeLoading();
  const params = sample.params || {};
  const saved = classifyLayout(params);
  const qNow = num(params, "Q_ENABLE");
  const qClsNow = num(params, "Q_FRAME_CLASS");
  const qTypeNow = num(params, "Q_FRAME_TYPE");
  const tilt = num(params, "Q_TILT_ENABLE");
  const tailsit = num(params, "Q_TAILSIT_ENABLE");

  const [pick, setPick] = useState<LayoutKind | null>(saved);
  const [qOn, setQOn] = useState<boolean>(!!qNow);
  const [qFrame, setQFrame] = useState<{ cls: number | null; type: number | null }>({ cls: qClsNow, type: qTypeNow });
  const [phase, setPhase] = useState<"surfaces" | "lift" | "write">(start === "lift" && qNow != null ? "lift" : "surfaces");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const drawn: Layout | null = pick && pick !== "other" ? pick : null;
  const plan = drawn && pick !== saved ? outputPlan(params, drawn) : null;
  const rows = plan ? plan.rows : outputsOf(params, pick);
  const writes: [string, number][] = [...(plan?.writes ?? [])];
  if (qNow != null && qOn !== !!qNow) writes.push(["Q_ENABLE", qOn ? 1 : 0]);
  if (qNow && qOn && qClsNow != null && qFrame.cls != null && qFrame.cls !== qClsNow) writes.push(["Q_FRAME_CLASS", qFrame.cls]);
  if (qNow && qOn && qTypeNow != null && qFrame.type != null && qFrame.type !== qTypeNow) writes.push(["Q_FRAME_TYPE", qFrame.type]);
  const needsReboot = writes.some(([name]) => name.startsWith("Q_"));
  const blocked = !!plan?.missing.length;

  const close = (written = false, rebooted = false) => onClose({
    outcome: written ? "completed" : "cancelled",
    measures: { layout: written ? pick : saved, Q_ENABLE: written && qNow != null ? (qOn ? 1 : 0) : qNow, written: written ? 1 : 0, rebooted: rebooted ? 1 : 0 },
  });

  async function save() {
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
      addLog(t(needsReboot ? "Saved. Rebooting the board to apply QuadPlane changes." : "Saved. Check each surface's direction on the Outputs step."), "ok");
      // QuadPlane changes apply at boot, so the write ends in a reboot.
      if (needsReboot) sendCmd({ op: "reboot" });
      close(true, needsReboot);
    } finally {
      setBusy(false);
    }
  }

  let qLine: string;
  if (qNow == null) qLine = t("This firmware has no QuadPlane support.");
  else if (!qNow && qOn) qLine = t("Sets Q_ENABLE = 1. The board reboots on Save, and the Q_ parameters appear after the reboot.");
  else if (!qNow) qLine = t("Adds VTOL motors. Sets Q_ENABLE = 1, then the board must reboot before the Q_ parameters appear.");
  else if (!qOn) qLine = t("Sets Q_ENABLE = 0 and removes VTOL flight after a reboot.");
  else if (qClsNow == null) qLine = t("QuadPlane is on. Reboot the board so the Q_ parameters appear.");
  else qLine = t("QuadPlane is on: {frame}. The VTOL motors are matched on the Outputs step.", { frame: motorFrame(qClsNow, qTypeNow)?.title ?? `Q_FRAME_CLASS ${qClsNow}` });

  const left = (
    <div className="sw-art">
      <AirframeArt kind={pick} rows={rows} />
      <b>{pick ? t(pick === "other" ? "Other" : LAYOUT_NAMES[pick]) : ""}</b>
    </div>
  );
  const lift = qNow != null;
  let body;
  let footer;
  if (phase === "surfaces") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Which surfaces does it have?")}</h3><p>{t("Look at the tail and the wing. The outputs follow the layout.")}</p></div>
        {loading ? <div className="mw-note">{t("Reading parameters from the board ({n}). The layout shows when they have all arrived.", { n: loading })}</div> : null}
        <div className="pas-cards" role="listbox" aria-label={t("Surface layout")}>
          {CARDS.map((card) => (
            <button key={card.kind} type="button" role="option" aria-selected={pick === card.kind} className={`pas-card${pick === card.kind ? " on" : ""}${card.kind === "other" ? " other" : ""}`} disabled={!!loading} onClick={() => { setError(""); setPick(card.kind); }}>
              <PlaneMark kind={card.kind} />
              <b>{t(card.kind === "other" ? "Other" : LAYOUT_NAMES[card.kind])}</b>
              <span>{t(card.detail)}</span>
            </button>
          ))}
        </div>
        <span className="mw-dim mw-sm">
          {pick === "other" && saved === "other"
            ? t("These outputs are not one of the three layouts. Set each output on the Outputs step or in Params.")
            : t("Other layouts are set output by output on the Outputs step or in Params. Nothing is written from here.")}
        </span>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={() => close()}>{t("Cancel")}</button>
        <button type="button" className="mw-btn primary" disabled={pick == null || !!loading} onClick={() => setPhase(lift ? "lift" : "write")}><span>{t("Next")}</span>{Icon.chevR()}</button>
      </>
    );
  } else if (phase === "lift") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Does it take off like a copter?")}</h3><p>{t("QuadPlane adds VTOL motors. ArduPlane reads it at boot, so a change ends in a reboot.")}</p></div>
        <div className="pas-qp">
          <PlaneMark kind="quad" />
          <div className="pas-qp-copy">
            <div className="pas-qp-head">
              <b>QuadPlane</b>
              <button type="button" role="switch" aria-checked={qOn} aria-label="QuadPlane" className={`pas-switch${qOn ? " on" : ""}`} onClick={() => { setError(""); setQOn(!qOn); }}><i /></button>
            </div>
            <span className="pas-qp-line">{qLine}</span>
            <div className="pas-qp-chips">
              {Q_FRAMES.map((f) => {
                const on = !!qNow && qOn && qFrame.cls === f.cls && qFrame.type === f.type && !tilt && !tailsit;
                return (
                  <button key={f.label} type="button" className={`frs-pill${on ? " on" : ""}`} disabled={!qNow || !qOn || qClsNow == null || !!tilt || !!tailsit} onClick={() => setQFrame({ cls: f.cls, type: f.type })}>
                    {t(f.label)}
                  </button>
                );
              })}
              <span className={`frs-pill static${tilt ? " on" : ""}`} title={t("Set in Params: Q_TILT_ENABLE, then its own setup.")}>{t("Tilt-rotor")}</span>
              <span className={`frs-pill static${tailsit ? " on" : ""}`} title={t("Set in Params: Q_TAILSIT_ENABLE, then its own setup.")}>{t("Tailsitter")}</span>
            </div>
          </div>
        </div>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={() => setPhase("surfaces")}>{t("Back")}</button>
        <button type="button" className="mw-btn primary" onClick={() => setPhase("write")}><span>{t("Next")}</span>{Icon.chevR()}</button>
      </>
    );
  } else {
    const qWrites = writes.filter(([name]) => name.startsWith("Q_"));
    body = (
      <>
        <div className="mw-headline">
          <h3>{writes.length ? t("Write these changes?") : t("This is the airframe already set")}</h3>
          <p>{t(writes.length ? (needsReboot ? "Save & reboot writes them and restarts the board. Then check each surface's direction on the Outputs step." : "Write saves them. Then check each surface's direction on the Outputs step.") : "Nothing to change.")}</p>
        </div>
        {plan ? (
          <div className="pas-omap">
            {[...plan.rows].sort((a, b) => (a.out ?? 99) - (b.out ?? 99)).map((row) => (
              <div key={row.key} className={`pas-orow${row.changed ? " changed" : ""}${row.out == null ? " missing" : ""}`}>
                <span className="pas-out">{row.out != null ? `OUT ${row.out}` : "—"}</span>
                <b>{t(row.title)}</b>
                <span className="pas-fn">{row.changed && row.from != null ? `${row.from} → ` : ""}{row.fn}</span>
                <span className="pas-ok" aria-hidden="true">{row.out == null ? "!" : row.changed ? "•" : "✓"}</span>
              </div>
            ))}
            {plan.cleared.length ? (
              <div className="pas-orow changed">
                <span className="pas-out">{plan.cleared.map((o) => `OUT ${o}`).join(", ")}</span>
                <b>{t("Freed")}</b>
                <span className="pas-fn">→ 0</span>
                <span className="pas-ok" aria-hidden="true">•</span>
              </div>
            ) : null}
          </div>
        ) : null}
        {qWrites.length ? (
          <div className="mw-sums">
            {qWrites.map(([name, to]) => <div key={name} className="mw-sum"><span className="mw-dim mw-sm">{name}</span><b>{`${num(params, name) ?? "—"} → ${to}`}</b></div>)}
          </div>
        ) : null}
        {blocked ? <div className="mw-note warn">{Icon.warn()}<span>{t("No free output for: {list}.", { list: plan!.missing.map((m) => t(m.title)).join(", ") })}</span></div> : null}
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={() => setPhase(lift ? "lift" : "surfaces")}>{t("Back")}</button>
        {writes.length ? (
          <button type="button" className={`mw-btn ${needsReboot ? "warn-solid" : "primary"}`} disabled={busy || blocked || !sample.ok || sample.frame !== "plane" || armed} onClick={() => void save()}>
            {needsReboot ? Icon.power() : null}<span>{busy ? t("Writing…") : needsReboot ? t("Save & reboot") : t("Write")}</span>
          </button>
        ) : <button type="button" className="mw-btn primary" onClick={() => close()}>{t("Close")}</button>}
      </>
    );
  }
  return (
    <SensorWizard
      title={t("Airframe")}
      fromAssistant={fromAssistant}
      steps={[t("Surfaces"), t("Lift"), t("Write")]}
      step={phase === "surfaces" ? 0 : phase === "lift" ? 1 : 2}
      left={left}
      body={<>{body}{error ? <div className="mw-note warn">{Icon.warn()}<span>{t(error)}</span></div> : null}</>}
      footer={footer}
      blocker={sample.ok && sample.frame === "plane" ? (armed ? "armed" : null) : "lost"}
      busy={busy}
      onClose={() => close()}
    />
  );
}
