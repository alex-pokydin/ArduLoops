import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { editVehicle, useVehicleFacts } from "./ControllerBoard";
import { MotorDiagram } from "./MotorDiagram";
import { Icon } from "./MotorSetup";
import { StepNum } from "./OutputSetup";
import { SensorWizard } from "./SensorWizard";
import { type WizardClose } from "../wizards/close";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { FRAME_DEFS } from "../lib/motorFrameData";
import { CLASS_NAMES, motorFrame, type MotorFrame } from "../lib/motorFrames";
import { noteUi, sameParam, send as sendCmd, writeParam } from "../mav/cmd";
import { getSetupSnapshot, getSnapshot, subscribe } from "../mav/store";
import { useStorePicked } from "../mav/view";

const GUIDE = "https://ardupilot.org/copter/docs/frame-type-configuration.html";

/** The motor-matrix classes this page draws, in the design's order. */
const CLASSES = [1, 2, 3, 4, 5, 12, 7, 14];

/** Y6 and Tri take any FRAME_TYPE ("*" in the data); ArduPilot's default type is written for them. */
const ANY_TYPE = 1;

type Choice = { type: number; label: string; any: boolean };

/** FRAME_TYPE choices for a class, labelled as the generated titles without the class name. */
function typesOf(cls: number): Choice[] {
  const name = CLASS_NAMES[cls];
  return Object.entries(FRAME_DEFS)
    .filter(([key]) => key.startsWith(`${cls}/`))
    .map(([key, def]) => {
      const raw = key.split("/")[1];
      const any = raw === "*";
      let label = def.title.startsWith(`${name} `) ? def.title.slice(name.length + 1) : def.title;
      if (cls === 5) label = any ? "A" : label.replace(/^Y6/, "");
      return { type: any ? ANY_TYPE : Number(raw), label, any };
    })
    .sort((a, b) => Number(b.any) - Number(a.any) || a.type - b.type);
}

/** The choice a saved type falls under: its own entry, or the class's "any type" entry. */
function choiceFor(cls: number, type: number | null): Choice | null {
  const list = typesOf(cls);
  return list.find((c) => !c.any && c.type === type) ?? list.find((c) => c.any) ?? null;
}

/** The layout a class card shows when it is not picked: X when the class has one. */
function defaultType(cls: number): number {
  const list = typesOf(cls);
  return (list.find((c) => c.type === 1) ?? list[0]).type;
}

function num(params: Record<string, number>, name: string): number | null {
  const v = params[name];
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/** Small top view from ArduPilot's motor geometry: nose up, coaxial pairs as a double ring. */
function FrameMark({ frame, on }: { frame: MotorFrame | null; on: boolean }) {
  if (!frame) return <svg className="frs-mark" viewBox="0 0 64 64" aria-hidden="true" />;
  const arms = new Map<string, { x: number; y: number; coax: boolean }>();
  for (const s of frame.spots) {
    const key = `${s.armX.toFixed(2)},${s.armY.toFixed(2)}`;
    arms.set(key, { x: s.armX, y: s.armY, coax: arms.has(key) || !!s.layer });
  }
  const many = arms.size > 6;
  const r = many ? 4 : 5.5;
  return (
    <svg className={`frs-mark${on ? " on" : ""}`} viewBox="0 0 64 64" aria-hidden="true">
      <path className="frs-nose" d="M32 4l5 7H27z" />
      {[...arms.values()].map((a, i) => (
        <line key={`l${i}`} className="frs-arm" x1="32" y1="34" x2={32 + a.x * 20} y2={34 - a.y * 20} />
      ))}
      <rect className="frs-body" x="27" y="29" width="10" height="10" rx="2" />
      {[...arms.values()].map((a, i) => (
        <g key={`m${i}`}>
          <circle className="frs-motor" cx={32 + a.x * 20} cy={34 - a.y * 20} r={r} />
          {a.coax ? <circle className="frs-motor" cx={32 + a.x * 20} cy={34 - a.y * 20} r={r - 2.2} /> : null}
        </g>
      ))}
      {frame.servo ? <rect className="frs-servo" x="29" y="52" width="6" height="6" rx="1" /> : null}
    </svg>
  );
}

/**
 * Copter frame in the common step layout: the saved frame drawn on the left (motor numbers and spin as ArduPilot
 * numbers them), and three numbered jobs: 1 class, 2 type, 3 the vehicle profile. Class and type are picked in a
 * wizard window that writes FRAME_CLASS and FRAME_TYPE and offers the reboot they need.
 */
export function FrameStep() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const params = sample.params || {};
  const savedCls = num(params, "FRAME_CLASS");
  const savedType = num(params, "FRAME_TYPE");
  const drawable = savedCls != null && CLASSES.includes(savedCls);
  const savedFrame = savedCls != null ? motorFrame(savedCls, savedType) : null;
  const saved = drawable ? choiceFor(savedCls as number, savedType) : null;
  const facts = useVehicleFacts();
  const [wizard, setWizard] = useState<"class" | "type" | null>(null);
  const armed = useStorePicked((s) => !!s.armed);
  const ready = sample.ok && !armed;

  const row = (n: number, state: "done" | "warn" | "todo", title: string, detail: string, which: "class" | "type" | null, primary = false) => (
    <div className="ms-wstep">
      <StepNum n={n} state={state} />
      <span className="ms-wstep-copy"><b>{t(title)}</b><span>{detail}</span></span>
      {which ? <button type="button" className={`frs-btn ${primary ? "primary sm" : "quiet"}`} disabled={!ready} onClick={() => setWizard(which)}>{t(primary ? "Pick" : "Change")}</button> : null}
    </div>
  );

  return (
    <div className="frs">
      {!sample.ok ? <div className="frs-note info">{t("Connect a vehicle to read its frame.")}</div> : null}
      {sample.ok && savedCls != null && !drawable ? (
        <div className="frs-note warn">{t("Saved: {name} (FRAME_CLASS {n}). This page draws motor-matrix frames; set this one in Params.", { name: CLASS_NAMES[savedCls] ?? "?", n: savedCls })}</div>
      ) : null}
      <div className="ms-top">
        <div className="ms-art fs-art">
          {savedFrame && drawable ? (
            <MotorDiagram
              frame={savedFrame}
              size={220}
              marks={Object.fromEntries(savedFrame.spots.map((s) => [s.n, "pending"]))}
              arrows
              label={(n) => t("Motor {n}", { n })}
              servoLabel={t("Servo")}
            />
          ) : <div className="fs-empty">{t("No frame yet")}</div>}
          <span>{savedFrame && drawable ? savedFrame.title : sample.ok ? t("Pick a frame class") : ""}</span>
        </div>
        <div className="ms-cards">
          <div className="ms-card">
            <div className="ms-card-head"><b>{t("Frame")}</b><span className="ms-fix">{t("A change needs a reboot")}</span></div>
            {row(1, drawable ? "done" : "todo", "Class", drawable ? `${t(CLASS_NAMES[savedCls as number])} · FRAME_CLASS ${savedCls}` : t("How many arms"), "class", !drawable)}
            {row(2, drawable ? "done" : "todo", "Type", drawable && saved ? `${saved.label} · ${savedCls === 7 ? t("not used") : `FRAME_TYPE ${savedType}`}` : t("How the motors are laid out"), drawable && savedCls !== 7 ? "type" : null)}
            <div className="ms-wstep">
              <StepNum n={3} state={facts.profiled ? "done" : "todo"} />
              <span className="ms-wstep-copy"><b>{t("Vehicle profile")}</b><span>{facts.chips.length ? facts.chips.join(" · ") : t("Props, cells, weight and how it flies")}</span></span>
              <button type="button" className={`frs-btn ${facts.profiled ? "quiet" : "primary sm"}`} disabled={!facts.canEdit} onClick={() => editVehicle("profile")}>{t(facts.profiled ? "Edit" : "Add")}</button>
            </div>
            <span className="ms-hint">{savedCls === 7 ? t("Tri has one layout: three motors and a yaw servo. FRAME_TYPE is not used.") : t("A new frame means the motor step must be done again.")}</span>
          </div>
        </div>
      </div>
      {sample.ok && !drawable ? <div className="frs-bk">{t("Helicopters use their own firmware. Single, coax and bicopter frames use servos and are set in Params.")}</div> : null}
      <div className="frs-foot">
        <a href={GUIDE} target="_blank" rel="noreferrer">{t("Frame type configuration")} ↗</a>
      </div>
      {wizard ? <FrameWizard start={wizard} onClose={() => setWizard(null)} /> : null}
    </div>
  );
}

/**
 * Pick the class, then the type, then write both; the board uses them after a reboot. The picked frame is drawn on
 * the left as it changes. Opened from Type, it starts there with the saved class.
 */
export function FrameWizard({ start, onClose, fromAssistant }: { start: "class" | "type"; onClose: (report?: WizardClose) => void; fromAssistant?: boolean }) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const armed = useStorePicked((s) => !!s.armed);
  const params = sample.params || {};
  const savedCls = num(params, "FRAME_CLASS");
  const savedType = num(params, "FRAME_TYPE");
  const [cls, setCls] = useState<number | null>(savedCls != null && CLASSES.includes(savedCls) ? savedCls : null);
  const [type, setType] = useState<number | null>(savedType);
  const [phase, setPhase] = useState<"class" | "type" | "write" | "done">(start === "type" && cls != null ? "type" : "class");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [written, setWritten] = useState("");
  const wasOk = useRef(sample.ok);
  useEffect(() => {
    // The board dropped for its reboot: the job is done.
    if (phase === "done" && wasOk.current && !sample.ok) close();
    wasOk.current = sample.ok;
  }, [sample.ok, phase, onClose]);

  const choices = cls != null ? typesOf(cls) : [];
  const picked = choices.find((c) => !c.any && c.type === type) ?? choices.find((c) => c.any) ?? null;
  // Y6 and Tri accept any type: keep the saved one unless the class changes.
  const nextType = cls == null ? null : picked?.any ? (cls === savedCls && savedType != null ? savedType : ANY_TYPE) : type;
  const frame = cls != null ? motorFrame(cls, nextType) : null;
  const close = () => onClose({ outcome: phase === "done" ? "completed" : "cancelled", measures: { FRAME_CLASS: phase === "done" ? cls : savedCls, FRAME_TYPE: phase === "done" ? nextType : savedType, written: phase === "done" ? 1 : 0, reboot_needed: phase === "done" ? 1 : 0 } });
  const changes = cls == null || nextType == null ? 0 : Number(cls !== savedCls) + Number(nextType !== savedType);

  function pickClass(next: number) {
    setError("");
    setCls(next);
    setType(next === savedCls ? savedType : choiceFor(next, defaultType(next))?.type ?? defaultType(next));
  }

  async function write() {
    if (cls == null || nextType == null) return;
    setBusy(true);
    setError("");
    try {
      const live = getSnapshot().params;
      for (const [name, value] of [["FRAME_CLASS", cls], ["FRAME_TYPE", nextType]] as [string, number][]) {
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
      const title = motorFrame(cls, nextType)?.title ?? CLASS_NAMES[cls];
      setWritten(title);
      addLog(t("Saved {frame}. Reboot the board to use it.", { frame: title }), "ok");
      setPhase("done");
    } finally {
      setBusy(false);
    }
  }

  const left = (
    <div className="sw-art">
      {frame ? (
        <MotorDiagram frame={frame} size={240} marks={Object.fromEntries(frame.spots.map((s) => [s.n, "pending"]))} arrows label={(n) => t("Motor {n}", { n })} servoLabel={t("Servo")} />
      ) : <div className="fs-empty">{t("Pick a frame class")}</div>}
      <b>{frame?.title ?? ""}</b>
    </div>
  );
  let body;
  let footer;
  if (phase === "class") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("How many arms?")}</h3><p>{t("Count the motors. Coaxial pairs, one above the other, are Y6 or OctaQuad.")}</p></div>
        <div className="frs-cards fs-classes" role="listbox" aria-label={t("Frame class")}>
          {CLASSES.map((c) => {
            const on = c === cls;
            return (
              <button key={c} type="button" role="option" aria-selected={on} className={`frs-card${on ? " on" : ""}`} onClick={() => pickClass(c)}>
                <FrameMark frame={on ? frame : motorFrame(c, defaultType(c))} on={on} />
                <b>{t(CLASS_NAMES[c])}</b>
                <span>FRAME_CLASS {c}</span>
              </button>
            );
          })}
        </div>
        <span className="mw-dim mw-sm">{t("Helicopters use their own firmware. Single, coax and bicopter frames use servos and are set in Params.")}</span>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={close}>{t("Cancel")}</button>
        <button type="button" className="mw-btn primary" disabled={cls == null} onClick={() => setPhase(cls === 7 ? "write" : "type")}><span>{t("Next")}</span>{Icon.chevR()}</button>
      </>
    );
  } else if (phase === "type") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("How are the motors laid out?")}</h3><p>{t("Match the picture to the vehicle, nose up: where motor 1 sits and which way each spins.")}</p></div>
        <div className="frs-types" role="listbox" aria-label={t("Frame type")}>
          {choices.map((c) => (
            <button
              key={`${c.type}${c.any ? "*" : ""}`}
              type="button"
              role="option"
              aria-selected={picked === c}
              className={`frs-pill${picked === c ? " on" : ""}`}
              title={c.any ? CLASS_NAMES[cls as number] : `FRAME_TYPE ${c.type}`}
              onClick={() => { setError(""); setType(c.type); }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <span className="mw-dim mw-sm">{t("BF X and the reversed types follow Betaflight's motor order, for a frame set up that way.")}</span>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={() => setPhase("class")}>{t("Back")}</button>
        <button type="button" className="mw-btn primary" disabled={nextType == null} onClick={() => setPhase("write")}><span>{t("Next")}</span>{Icon.chevR()}</button>
      </>
    );
  } else if (phase === "write") {
    body = (
      <>
        <div className="mw-headline">
          <h3>{changes ? t("Write {frame}?", { frame: frame?.title ?? "" }) : t("This is the frame already set")}</h3>
          <p>{t(changes ? "The board uses a new frame after a reboot. The motor order and directions then need checking again." : "Nothing to change.")}</p>
        </div>
        <div className="mw-sums">
          <div className="mw-sum"><span className="mw-dim mw-sm">FRAME_CLASS</span><b>{`${savedCls ?? "—"} → ${cls}`}</b></div>
          <div className="mw-sum"><span className="mw-dim mw-sm">FRAME_TYPE</span><b>{`${savedType ?? "—"} → ${nextType}`}</b></div>
        </div>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={() => setPhase(cls === 7 ? "class" : "type")}>{t("Back")}</button>
        {changes ? (
          <button type="button" className="mw-btn primary" disabled={busy || !sample.ok || armed} onClick={() => void write()}>{busy ? t("Writing…") : t("Write")}</button>
        ) : <button type="button" className="mw-btn primary" onClick={close}>{t("Close")}</button>}
      </>
    );
  } else {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Saved {frame}", { frame: written })}</h3><p>{t("Reboot the board to use it, then check the motors on the Motors & outputs step.")}</p></div>
        <div className="mw-note warn">{Icon.warn()}<span>{t("Until the reboot the board still flies the old frame.")}</span></div>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={close}>{t("Finish")}</button>
        <button type="button" className="mw-btn warn-solid" disabled={!sample.ok || armed} onClick={() => { sendCmd({ op: "reboot" }); addLog(t("Reboot requested"), "cmd"); close(); }}>{Icon.power()}<span>{t("Reboot & finish")}</span></button>
      </>
    );
  }
  return (
    <SensorWizard
      title={t("Frame")}
      fromAssistant={fromAssistant}
      steps={[t("Class"), t("Type"), t("Write")]}
      step={phase === "class" ? 0 : phase === "type" ? 1 : 2}
      left={left}
      body={<>{body}{error ? <div className="mw-note warn">{Icon.warn()}<span>{t(error)}</span></div> : null}</>}
      footer={footer}
      blocker={phase === "done" ? null : sample.ok ? (armed ? "armed" : null) : "lost"}
      busy={busy}
      onClose={close}
    />
  );
}
