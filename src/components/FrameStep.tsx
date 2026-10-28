import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useViewDraft } from "../lib/setupView";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { FRAME_DEFS } from "../lib/motorFrameData";
import { CLASS_NAMES, motorFrame, type MotorFrame } from "../lib/motorFrames";
import { noteUi, sameParam, writeParam } from "../mav/cmd";
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
 * Copter frame: class as pictures, then the type as chips under the picked class.
 * Edits are a draft; Write saves FRAME_CLASS and FRAME_TYPE, which take effect after a reboot.
 */
export function FrameStep() {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
  const armed = useStorePicked((s) => !!s.armed);
  const params = sample.params || {};
  const savedCls = num(params, "FRAME_CLASS");
  const savedType = num(params, "FRAME_TYPE");
  const drawable = savedCls != null && CLASSES.includes(savedCls);
  const savedFrame = savedCls != null ? motorFrame(savedCls, savedType) : null;
  const [cls, setCls] = useState<number | null>(drawable ? savedCls : null);
  const [type, setType] = useState<number | null>(savedType);
  useEffect(() => {
    setCls(drawable ? savedCls : null);
    setType(savedType);
  }, [savedCls, savedType, drawable]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A written frame is used only after a reboot; the note stays until the link drops for that reboot.
  const [rebootFor, setRebootFor] = useState("");
  const wasOk = useRef(sample.ok);
  useEffect(() => {
    if (wasOk.current && !sample.ok) setRebootFor("");
    wasOk.current = sample.ok;
  }, [sample.ok]);

  const choices = cls != null ? typesOf(cls) : [];
  const picked = choices.find((c) => !c.any && c.type === type) ?? choices.find((c) => c.any) ?? null;
  const pickedFrame = cls != null ? motorFrame(cls, picked?.any ? (type ?? ANY_TYPE) : type) : null;
  // Y6 and Tri accept any type: keep the saved one unless the class changes.
  const nextType = cls == null ? null : picked?.any ? (cls === savedCls && savedType != null ? savedType : ANY_TYPE) : type;
  const changes = cls == null || nextType == null ? 0 : Number(cls !== savedCls) + Number(nextType !== savedType);
  const canWrite = sample.ok && !armed && changes > 0 && !busy;
  useViewDraft([
    ...(cls != null && cls !== savedCls ? [{ param: "FRAME_CLASS", from: savedCls, to: cls }] : []),
    ...(nextType != null && nextType !== savedType ? [{ param: "FRAME_TYPE", from: savedType, to: nextType }] : []),
  ]);

  function pickClass(next: number) {
    setError("");
    setCls(next);
    if (next === savedCls) setType(savedType);
    else setType(choiceFor(next, defaultType(next))?.type ?? defaultType(next));
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
      setRebootFor(title);
      addLog(t("Saved {frame}. Reboot the board to use it.", { frame: title }), "ok");
    } finally {
      setBusy(false);
    }
  }

  let saved: string;
  if (savedCls == null) saved = t("Waiting for the frame parameters.");
  else if (!drawable) saved = t("Saved: {name} (FRAME_CLASS {n}). This page draws motor-matrix frames; set this one in Params.", { name: CLASS_NAMES[savedCls] ?? "?", n: savedCls });
  else saved = t("Saved: {frame}. Changing the class or type needs a reboot, and the motor step must be done again.", { frame: savedFrame?.title ?? CLASS_NAMES[savedCls] });

  return (
    <div className="frs">
      <div className="frs-cards" role="listbox" aria-label={t("Frame class")}>
        {CLASSES.map((c) => {
          const on = c === cls;
          const frame = on ? pickedFrame : motorFrame(c, defaultType(c));
          return (
            <button key={c} type="button" role="option" aria-selected={on} className={`frs-card${on ? " on" : ""}`} onClick={() => pickClass(c)}>
              <FrameMark frame={frame} on={on} />
              <b>{t(CLASS_NAMES[c])}</b>
              <span>FRAME_CLASS {c}</span>
            </button>
          );
        })}
      </div>

      {cls != null ? (
        <>
          <h4 className="sov-sect">{t("{cls} · type", { cls: t(CLASS_NAMES[cls]) })}</h4>
          {cls === 7 ? (
            <p className="frs-hint">{t("Tri has one layout: three motors and a yaw servo. FRAME_TYPE is not used.")}</p>
          ) : (
            <div className="frs-types" role="listbox" aria-label={t("Frame type")}>
              {choices.map((c) => (
                <button
                  key={`${c.type}${c.any ? "*" : ""}`}
                  type="button"
                  role="option"
                  aria-selected={picked === c}
                  className={`frs-pill${picked === c ? " on" : ""}`}
                  title={c.any ? CLASS_NAMES[cls] : `FRAME_TYPE ${c.type}`}
                  onClick={() => { setError(""); setType(c.type); }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}

      {rebootFor ? (
        <div className="frs-note warn">{t("Saved {frame}. Reboot the board to use it; the reboot button is in the header.", { frame: rebootFor })}</div>
      ) : (
        <div className="frs-note info">{saved}</div>
      )}
      {error ? <div className="frs-note err">{t(error)}</div> : null}
      <div className="frs-bk">{t("Helicopters use their own firmware. Single, coax and bicopter frames use servos and are set in Params.")}</div>

      <div className="frs-foot">
        <a href={GUIDE} target="_blank" rel="noreferrer">{t("Frame type configuration")} ↗</a>
        <div className="frs-foot-actions">
          {armed ? <span className="frs-why">{t("Disarm to change the frame.")}</span> : null}
          {changes ? (
            <>
              <span className="frs-changes">{changes === 1 ? t("1 change") : t("{n} changes", { n: changes })}</span>
              <button type="button" className="frs-btn text" onClick={() => { setError(""); setCls(drawable ? savedCls : null); setType(savedType); }}>{t("Discard")}</button>
            </>
          ) : null}
          <button type="button" className="frs-btn primary" disabled={!canWrite} onClick={() => void write()}>
            {busy ? t("Writing…") : changes ? t("Write") : t("Saved")}
          </button>
        </div>
      </div>
    </div>
  );
}
