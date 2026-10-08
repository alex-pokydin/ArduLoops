import { useEffect, useState, useSyncExternalStore } from "react";
import { ModeSetup, modeSlot } from "./ModeSetup";
import { MotorSetup } from "./MotorSetup";
import { RcSetup } from "./RcSetup";
import { compassGlance } from "./CompassPanel";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { noteUi, sameParam, writeParam } from "../mav/cmd";
import { getSetupSnapshot, getSnapshot, subscribe } from "../mav/store";

type FrameId = "x" | "plus" | "bf" | "hex" | "octo" | "y6";

const FRAMES: { id: FrameId; title: string; cls: number; type: number; count: number; motors: readonly number[] | null }[] = [
  { id: "x", title: "Quad X", cls: 1, type: 1, count: 4, motors: [45, -135, -45, 135] },
  { id: "plus", title: "Quad +", cls: 1, type: 0, count: 4, motors: [90, -90, 0, 180] },
  { id: "bf", title: "Quad X Betaflight", cls: 1, type: 18, count: 4, motors: [135, 45, -135, -45] },
  { id: "hex", title: "Hex X", cls: 2, type: 1, count: 6, motors: null },
  { id: "octo", title: "Octo X", cls: 3, type: 1, count: 8, motors: null },
  { id: "y6", title: "Y6", cls: 5, type: 1, count: 6, motors: null },
];

export function motorFrame(params: Record<string, number> | undefined): { id: string; count: number } | null {
  const cls = params?.FRAME_CLASS;
  const kind = params?.FRAME_TYPE;
  if (cls == null || kind == null) return null;
  const found = FRAMES.find((frame) => frame.cls === Math.round(cls) && frame.type === Math.round(kind));
  return found ? { id: found.id, count: found.count } : null;
}

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

const SURFACES: { title: string; fn: number }[] = [
  { title: "Aileron", fn: 4 },
  { title: "Elevator", fn: 19 },
  { title: "Throttle", fn: 70 },
  { title: "Rudder", fn: 21 },
];

function useSample() {
  return useSyncExternalStore(subscribe, getSetupSnapshot, getSetupSnapshot);
}

function param(params: Record<string, number>, name: string): number | null {
  const value = params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function whole(value: number | null): number | null {
  return value == null ? null : Math.round(value);
}

function dot(angle: number, r = 18): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: 32 + Math.sin(rad) * r, y: 32 - Math.cos(rad) * r };
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

function FrameGlyph({ motors, count }: { motors: readonly number[] | null; count: number }) {
  const angles = motors ?? Array.from({ length: count }, (_, i) => (i * 360) / count);
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <polygon points="32,6 37,14 27,14" fill="currentColor" />
      {angles.map((angle, index) => {
        const p = dot(angle);
        return <circle key={index} cx={p.x} cy={p.y} r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />;
      })}
    </svg>
  );
}

function ApplyButton({
  label,
  disabled,
  busy,
  onApply,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  onApply: () => Promise<string | null>;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  return (
    <div className="wiz-apply">
      <button
        type="button"
        className="wiz-go"
        disabled={disabled || busy}
        onClick={() => {
          setNote("");
          void onApply().then((err) => {
            if (err) {
              setNote(err);
              addLog(t(err), "bad");
              return;
            }
            setNote("Saved.");
            addLog(t("Saved."), "ok");
          });
        }}
      >
        {busy ? t("Writing…") : t(label)}
      </button>
      {note ? <p className="wiz-msg" role="status">{t(note)}</p> : null}
    </div>
  );
}

export function FrameWizard() {
  const t = useT();
  const sample = useSample();
  const cls = whole(param(sample.params, "FRAME_CLASS"));
  const type = whole(param(sample.params, "FRAME_TYPE"));
  const known = FRAMES.find((frame) => frame.cls === cls && frame.type === type) ?? null;
  const [pick, setPick] = useState<FrameId | null>(known?.id ?? null);
  useEffect(() => {
    setPick(known?.id ?? null);
  }, [known?.id]);
  const chosen = FRAMES.find((frame) => frame.id === pick) ?? null;
  const same = chosen != null && chosen.cls === cls && chosen.type === type;
  const [busy, setBusy] = useState(false);
  return (
    <div className="wiz">
      <div className="wiz-cards" role="listbox" aria-label={t("Frame")}>
        {FRAMES.map((frame) => (
          <button
            key={frame.id}
            type="button"
            role="option"
            aria-selected={pick === frame.id}
            className={pick === frame.id ? "wiz-card on" : "wiz-card"}
            onClick={() => setPick(frame.id)}
          >
            <FrameGlyph motors={frame.motors} count={frame.count} />
            <b>{t(frame.title)}</b>
          </button>
        ))}
      </div>
      <ApplyButton
        label="Use this frame"
        busy={busy}
        disabled={!sample.ok || !chosen || same || cls == null}
        onApply={async () => {
          if (!chosen) return null;
          setBusy(true);
          try {
            return await writeList([
              ["FRAME_CLASS", chosen.cls],
              ["FRAME_TYPE", chosen.type],
            ]);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

export function MotorWizard() {
  const t = useT();
  const sample = useSample();
  const cls = whole(param(sample.params, "FRAME_CLASS"));
  const type = whole(param(sample.params, "FRAME_TYPE"));
  const frame = FRAMES.find((item) => item.cls === cls && item.type === type) ?? null;
  const count = frame?.count ?? null;
  const angles = frame?.motors ?? null;
  const bound = count != null && Array.from({ length: count }, (_, i) => {
    for (let channel = 1; channel <= 16; channel += 1) {
      if (whole(param(sample.params, `SERVO${channel}_FUNCTION`)) === 33 + i) return true;
    }
    return false;
  }).every(Boolean);
  const [setup, setSetup] = useState(false);
  return (
    <div className="wiz">
      {angles ? (
        <svg className="wiz-motors" viewBox="0 0 64 64" aria-hidden="true">
          <polygon points="32,4 38,14 26,14" fill="currentColor" />
          {angles.map((angle, index) => {
            const p = dot(angle, 20);
            return (
              <g key={index}>
                <circle cx={p.x} cy={p.y} r="7" fill="#141a22" stroke="currentColor" />
                <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize="8" fill="currentColor">{index + 1}</text>
              </g>
            );
          })}
        </svg>
      ) : count == null ? (
        <p className="wiz-msg">{t("Pick a frame first. This step follows the frame already on the vehicle.")}</p>
      ) : null}
      <p className="wiz-msg">{bound ? t("Outputs already match this frame.") : t("The setup spins each output. Tap the arm that turned.")}</p>
      <div className="wiz-apply">
        <button type="button" className="wiz-go" disabled={!sample.ok || !frame} onClick={() => setSetup(true)}>{t("Set up the motors")}</button>
      </div>
      {setup && frame ? <MotorSetup frame={frame.id} count={frame.count} onClose={() => setSetup(false)} /> : null}
    </div>
  );
}

export function RadioWizard() {
  const t = useT();
  const sample = useSample();
  const [open, setOpen] = useState(false);
  return (
    <div className="wiz">
      <p className="wiz-msg">{t("The setup watches every channel, then saves the ends and can reverse one stick.")}</p>
      <div className="wiz-apply">
        <button type="button" className="wiz-go" disabled={!sample.ok} onClick={() => setOpen(true)}>{t("Set up the radio")}</button>
      </div>
      {open ? <RcSetup onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

export function stepGlance(
  kind: "frame" | "motors" | "radio" | "level" | "compass" | "modes" | "failsafe" | "battery" | "servos" | "airspeed",
  vehicle: "copter" | "plane",
  params: Record<string, number>,
  rc: number[],
): { text: string; live: boolean } {
  if (kind === "frame") {
    const cls = whole(param(params, "FRAME_CLASS"));
    const type = whole(param(params, "FRAME_TYPE"));
    const known = FRAMES.find((frame) => frame.cls === cls && frame.type === type);
    if (cls == null) return { text: "", live: false };
    return { text: known?.title ?? "Other frame", live: true };
  }
  if (kind === "motors") {
    const cls = whole(param(params, "FRAME_CLASS"));
    const type = whole(param(params, "FRAME_TYPE"));
    const frame = FRAMES.find((item) => item.cls === cls && item.type === type);
    if (!frame) return { text: "", live: false };
    const named = Array.from({ length: frame.count }, (_, i) => {
      for (let channel = 1; channel <= 16; channel += 1) {
        if (whole(param(params, `SERVO${channel}_FUNCTION`)) === 33 + i) return true;
      }
      return false;
    }).every(Boolean);
    return { text: named ? "Outputs named" : "Outputs not named", live: named };
  }
  if (kind === "radio") {
    const live = rc.some((value) => value >= 800 && value <= 2200);
    return { text: live ? "Sticks are arriving." : "No sticks yet.", live };
  }
  if (kind === "modes") {
    const channel = whole(param(params, "FLTMODE_CH")) ?? 5;
    const slot = modeSlot(rc[channel - 1] ?? 0);
    if (slot == null) return { text: "No switch yet.", live: false };
    const value = whole(param(params, `FLTMODE${slot + 1}`));
    const choices = vehicle === "plane" ? PLANE_MODES : COPTER_MODES;
    const name = choices.find(([, n]) => n === value)?.[0];
    return { text: name ?? (value == null ? "" : String(value)), live: true };
  }
  if (kind === "failsafe") {
    const radioName = vehicle === "plane" ? "FS_SHORT_ACTN" : "FS_THR_ENABLE";
    const radio = whole(param(params, radioName));
    const batt = whole(param(params, "BATT_FS_LOW_ACT"));
    if (radio == null || batt == null) return { text: "", live: false };
    const radioText = vehicle === "plane"
      ? ({ 1: "Circle", 2: "Level, throttle off", 3: "Disabled" } as Record<number, string>)[radio] ?? String(radio)
      : ({ 0: "Disabled", 1: "Return home", 3: "Land" } as Record<number, string>)[radio] ?? String(radio);
    const battText = vehicle === "plane"
      ? ({ 0: "Warn only", 1: "Return home", 2: "Land" } as Record<number, string>)[batt] ?? String(batt)
      : ({ 0: "Warn only", 1: "Land", 2: "Return home" } as Record<number, string>)[batt] ?? String(batt);
    return { text: `${radioText} · ${battText}`, live: vehicle === "plane" ? radio !== 3 : radio !== 0 };
  }
  if (kind === "battery") {
    const cap = whole(param(params, "BATT_CAPACITY"));
    if (cap == null) return { text: "", live: false };
    return { text: `${cap} mAh`, live: cap > 0 };
  }
  if (kind === "servos") {
    if (vehicle === "copter") {
      let named = 0;
      let seen = false;
      for (let i = 1; i <= 16; i++) {
        const fn = whole(param(params, `SERVO${i}_FUNCTION`));
        if (fn == null) continue;
        seen = true;
        if (fn !== 0) named++;
      }
      if (!seen) return { text: "", live: false };
      return { text: `${named}/16`, live: named > 0 };
    }
    const found = SURFACES.filter((surface) => {
      for (let i = 1; i <= 16; i++) if (whole(param(params, `SERVO${i}_FUNCTION`)) === surface.fn) return true;
      return false;
    }).length;
    return { text: found ? `${found}/4` : "Not on an output yet.", live: found === 4 };
  }
  if (kind === "airspeed") {
    const type = whole(param(params, "ARSPD_TYPE"));
    if (type == null) return { text: "", live: false };
    return { text: type === 0 ? "No airspeed sensor" : "Leave the sensor", live: true };
  }
  if (kind === "compass") return compassGlance(params);
  return { text: "", live: false };
}

export function ModeWizard({ frame }: { frame: "copter" | "plane" }) {
  const t = useT();
  const sample = useSample();
  const [open, setOpen] = useState(false);
  return (
    <div className="wiz">
      <p className="wiz-msg">{t("The lit slot is where the switch is now.")}</p>
      <div className="wiz-apply">
        <button type="button" className="wiz-go" disabled={!sample.ok} onClick={() => setOpen(true)}>{t("Set up flight modes")}</button>
      </div>
      {open ? <ModeSetup frame={frame} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function ChoiceRow({
  title,
  value,
  options,
  onPick,
}: {
  title: string;
  value: number | null;
  options: { label: string; value: number }[];
  onPick: (value: number) => void;
}) {
  const t = useT();
  return (
    <div className="wiz-choice">
      <b>{t(title)}</b>
      <div className="wiz-cards">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? "wiz-card on" : "wiz-card"}
            onClick={() => onPick(option.value)}
          >
            <b>{t(option.label)}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

type WizardMeasures = Record<string, number | string | null>;

export function FailsafeWizard({ frame, onDone }: { frame: "copter" | "plane"; onDone?: (measures: WizardMeasures) => void }) {
  const sample = useSample();
  const radioName = frame === "plane" ? "FS_SHORT_ACTN" : "FS_THR_ENABLE";
  const longName = frame === "plane" ? "FS_LONG_ACTN" : "";
  const radioOptions = frame === "plane"
    ? [{ label: "Circle", value: 1 }, { label: "Level, throttle off", value: 2 }, { label: "Disabled", value: 3 }]
    : [{ label: "Disabled", value: 0 }, { label: "Return home", value: 1 }, { label: "Land", value: 3 }];
  const longOptions = [{ label: "Keep going", value: 0 }, { label: "Return home", value: 1 }, { label: "Glide", value: 2 }];
  const batteryOptions = frame === "plane"
    ? [{ label: "Warn only", value: 0 }, { label: "Return home", value: 1 }, { label: "Land", value: 2 }]
    : [{ label: "Warn only", value: 0 }, { label: "Land", value: 1 }, { label: "Return home", value: 2 }];
  const radioNow = whole(param(sample.params, radioName));
  const longNow = longName ? whole(param(sample.params, longName)) : null;
  const battNow = whole(param(sample.params, "BATT_FS_LOW_ACT"));
  const [radio, setRadio] = useState(radioNow);
  const [long, setLong] = useState(longNow);
  const [batt, setBatt] = useState(battNow);
  useEffect(() => { setRadio(radioNow); }, [radioNow]);
  useEffect(() => { setLong(longNow); }, [longNow]);
  useEffect(() => { setBatt(battNow); }, [battNow]);
  const [busy, setBusy] = useState(false);
  const dirty = radio !== radioNow || (frame === "plane" && long !== longNow) || batt !== battNow;
  return (
    <div className="wiz">
      <ChoiceRow title={frame === "plane" ? "Short radio loss" : "Radio lost"} value={radio} options={radioOptions} onPick={setRadio} />
      {frame === "plane" ? <ChoiceRow title="Long radio loss" value={long} options={longOptions} onPick={setLong} /> : null}
      <ChoiceRow title="Battery low" value={batt} options={batteryOptions} onPick={setBatt} />
      <ApplyButton
        label="Save failsafe"
        busy={busy}
        disabled={!sample.ok || !dirty || radioNow == null || battNow == null || radio == null || batt == null || (frame === "plane" && (longNow == null || long == null))}
        onApply={async () => {
          if (radio == null || batt == null) return null;
          setBusy(true);
          try {
            const pairs: [string, number][] = [[radioName, radio], ["BATT_FS_LOW_ACT", batt]];
            if (frame === "plane" && long != null) pairs.push(["FS_LONG_ACTN", long]);
            const err = await writeList(pairs);
            if (!err) {
              const measures: WizardMeasures = { [radioName]: radio, BATT_FS_LOW_ACT: batt };
              if (frame === "plane" && long != null) measures.FS_LONG_ACTN = long;
              onDone?.(measures);
            }
            return err;
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function servoMeasures(found: { title: string; output: number; reversed: boolean }[], flip: Record<string, boolean>, assigned: Map<string, number>): WizardMeasures {
  const measures: WizardMeasures = {};
  for (const surface of found) {
    const key = surface.title.toLowerCase();
    const output = surface.output || assigned.get(surface.title) || 0;
    measures[`${key}_output`] = output || null;
    measures[`${key}_reversed`] = (flip[surface.title] ?? surface.reversed) ? 1 : 0;
  }
  return measures;
}

export function ServoWizard({ onDone }: { onDone?: (measures: WizardMeasures) => void } = {}) {
  const t = useT();
  const sample = useSample();
  const found = SURFACES.map((surface) => {
    let output = 0;
    for (let i = 1; i <= 16; i++) {
      if (whole(param(sample.params, `SERVO${i}_FUNCTION`)) === surface.fn) { output = i; break; }
    }
    return { ...surface, output, reversed: output ? whole(param(sample.params, `SERVO${output}_REVERSED`)) === 1 : false };
  });
  const missing = found.some((surface) => !surface.output);
  const [flip, setFlip] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const dirty = found.some((surface) => surface.output && (flip[surface.title] ?? surface.reversed) !== surface.reversed);
  return (
    <div className="wiz">
      <div className="wiz-surfaces">
        {found.map((surface) => {
          const on = flip[surface.title] ?? surface.reversed;
          return (
            <div key={surface.title} className="wiz-slot">
              <b>{t(surface.title)}</b>
              <span>{surface.output ? t("Output {n}", { n: surface.output }) : t("Not on an output yet.")}</span>
              {surface.output ? (
                <button type="button" className={on ? "wiz-card on" : "wiz-card"} onClick={() => setFlip((all) => ({ ...all, [surface.title]: !on }))}>
                  <b>{on ? t("Reverse") : t("Normal")}</b>
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {missing ? (
        <ApplyButton
          label="Assign the four surfaces"
          busy={busy}
          disabled={!sample.ok}
          onApply={async () => {
            setBusy(true);
            try {
              const used = new Set<number>();
              const pairs: [string, number][] = [];
              for (const surface of found) {
                if (surface.output) continue;
                for (let i = 1; i <= 16; i++) {
                  if (used.has(i)) continue;
                  if (whole(param(getSnapshot().params, `SERVO${i}_FUNCTION`)) !== 0) continue;
                  pairs.push([`SERVO${i}_FUNCTION`, surface.fn]);
                  used.add(i);
                  break;
                }
              }
              if (pairs.length < found.filter((surface) => !surface.output).length) return "No free output for a surface.";
              const err = await writeList(pairs);
              if (!err) {
                const assigned = new Map(pairs.map(([name, fn]) => [found.find((surface) => surface.fn === fn)?.title ?? "", Number(name.replace(/\D/g, ""))]));
                onDone?.(servoMeasures(found, flip, assigned));
              }
              return err;
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : (
        <ApplyButton
          label="Save surface directions"
          busy={busy}
          disabled={!sample.ok || !dirty}
          onApply={async () => {
            setBusy(true);
            try {
              const pairs = found.flatMap((surface) => {
                if (!surface.output) return [];
                const on = flip[surface.title] ?? surface.reversed;
                return [[`SERVO${surface.output}_REVERSED`, on ? 1 : 0] as [string, number]];
              });
              const err = await writeList(pairs);
              if (!err) onDone?.(servoMeasures(found, flip, new Map()));
              return err;
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

export function AirspeedWizard({ onDone }: { onDone?: (measures: WizardMeasures) => void } = {}) {
  const sample = useSample();
  const type = whole(param(sample.params, "ARSPD_TYPE"));
  const [pick, setPick] = useState(type === 0 ? 0 : 1);
  useEffect(() => { setPick(type === 0 ? 0 : 1); }, [type]);
  const [busy, setBusy] = useState(false);
  return (
    <div className="wiz">
      <ChoiceRow
        title="Airspeed"
        value={pick}
        options={[{ label: "No airspeed sensor", value: 0 }, { label: "Leave the sensor", value: 1 }]}
        onPick={setPick}
      />
      <ApplyButton
        label="Save airspeed"
        busy={busy}
        disabled={!sample.ok || type == null || (pick === 0) === (type === 0)}
        onApply={async () => {
          if (pick !== 0) {
            onDone?.({ ARSPD_TYPE: type });
            return null;
          }
          setBusy(true);
          try {
            const err = await writeList([["ARSPD_TYPE", 0]]);
            if (!err) onDone?.({ ARSPD_TYPE: 0 });
            return err;
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

