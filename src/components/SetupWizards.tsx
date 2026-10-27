import { useEffect, useState, useSyncExternalStore } from "react";
import { ModeSetup, modeSlot } from "./ModeSetup";
import { MotorDiagram } from "./MotorDiagram";
import { MotorSetup, type MotorScope } from "./MotorSetup";
import { CLASS_NAMES, frameFromParams, motorFrame, motorFunction, motorOfFunction } from "../lib/motorFrames";
import { LAYOUT_NAMES, classifyLayout, surfacesFor } from "../lib/planeAirframe";
import { RcSetup } from "./RcSetup";
import { compassGlance } from "./CompassPanel";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { noteUi, sameParam, writeParam } from "../mav/cmd";
import { getSetupSnapshot, getSnapshot, subscribe } from "../mav/store";

/**
 * ArduPilot's own value names for the failsafe parameters (Parameters.cpp, AP_BattMonitor_Params.cpp),
 * shared by the step summary and the wizard so every stored value has a name.
 */
const FS_NAMES = {
  copterRadio: { 0: "Disabled", 1: "Return home", 2: "Keep the mission in Auto", 3: "Land", 4: "SmartRTL or RTL", 5: "SmartRTL or Land", 6: "Auto landing or RTL", 7: "Brake or Land" },
  copterBatt: { 0: "Warn only", 1: "Land", 2: "Return home", 3: "SmartRTL or RTL", 4: "SmartRTL or Land", 5: "Terminate", 6: "Auto landing or RTL", 7: "Brake or Land" },
  planeRadio: { 0: "Disabled", 1: "Enabled", 2: "Detect only" },
  planeShort: { 0: "Circle, or keep the mission", 1: "Circle", 2: "Level, throttle off", 3: "Disabled", 4: "FBWB" },
  planeLong: { 0: "Keep going", 1: "Return home", 2: "Glide", 3: "Parachute", 4: "Auto", 5: "Autoland" },
  planeBatt: { 0: "Warn only", 1: "Return home", 2: "Land", 3: "Terminate", 4: "QLand", 5: "Parachute", 6: "Loiter to QLand", 7: "Autoland or RTL" },
} satisfies Record<string, Record<number, string>>;

function fsName(names: Record<number, string>, value: number): string {
  return names[value] ?? String(value);
}

/** The usual choices, plus the stored value when it is another one, so the current setting is always shown. */
function fsOptions(names: Record<number, string>, usual: number[], current: number | null): { label: string; value: number }[] {
  const values = current != null && !usual.includes(current) ? [...usual, current] : usual;
  return values.map((value) => ({ label: fsName(names, value), value }));
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

export function MotorWizard() {
  const t = useT();
  const sample = useSample();
  const params = sample.params;
  const frame = frameFromParams(params);
  const [open, setOpen] = useState<MotorScope | null | false>(false);
  const placed = new Set<number>();
  for (let ch = 1; ch <= 16; ch += 1) {
    const fn = param(params, `SERVO${ch}_FUNCTION`);
    const motor = fn == null ? null : motorOfFunction(fn);
    if (motor != null) placed.add(motor);
  }
  const matched = frame ? frame.spots.filter((s) => placed.has(s.n)).length : 0;
  const arm = param(params, "MOT_SPIN_ARM");
  const rvmask = Math.round(param(params, "SERVO_BLH_RVMASK") ?? 0);
  const reversed = Array.from({ length: 16 }, (_, i) => i + 1).filter((ch) => rvmask & (1 << (ch - 1)));
  const safety = param(params, "BRD_SAFETY_DEFLT");
  const safetyOn = safety != null && safety !== 0;
  const row = (tone: "ok" | "warn" | "", name: string, value: string) => (
    <div className="mw-sr">
      <i className={`mw-er-dot ${tone}`} />
      <span className="mw-grow">{name}</span>
      <span className={`mw-sr-v ${tone}`}>{value}</span>
    </div>
  );
  return (
    <div className="wiz mw-entry">
      {frame ? (
        <div className="mw-entry-body">
          <div className="mw-entry-art">
            <MotorDiagram
              frame={frame}
              size={150}
              marks={Object.fromEntries(frame.spots.map((s) => [s.n, placed.has(s.n) ? "done" : "pending"]))}
              arrows
              label={(n) => t("Motor {n}", { n })}
              servoLabel={t("Servo")}
            />
          </div>
          <div className="mw-entry-rows">
            <div className="mw-sr head"><b>{frame.title}</b></div>
            {row(matched === frame.spots.length ? "ok" : "warn", t("Outputs"), t("{n} of {total} matched", { n: matched, total: frame.spots.length }))}
            {row("", t("Reversed in ESC"), reversed.length ? reversed.map((ch) => `OUT ${ch}`).join(", ") : t("None"))}
            {row("", t("Idle"), arm != null ? `${Math.round(arm * 100)}%` : "—")}
            {row(safetyOn ? "warn" : "ok", t("Safety switch"), safetyOn ? t("Required") : t("Off"))}
          </div>
        </div>
      ) : (
        <p className="wiz-msg">{t("Pick a frame first. This step follows the frame already on the vehicle.")}</p>
      )}
      <div className="wiz-apply">
        <button type="button" className="wiz-go" disabled={!sample.ok || !frame} onClick={() => setOpen(null)}>{t("Set up the motors")}</button>
        <button type="button" className="wiz-quiet" disabled={!sample.ok || !frame} onClick={() => setOpen({ steps: ["order"] })}>{t("Match outputs")}</button>
        <button type="button" className="wiz-quiet" disabled={!sample.ok || !frame} onClick={() => setOpen({ steps: ["direction"] })}>{t("Check direction")}</button>
      </div>
      {open !== false ? <MotorSetup scope={open ?? undefined} onClose={() => setOpen(false)} /> : null}
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
  kind: "frame" | "motors" | "radio" | "level" | "compass" | "modes" | "failsafe" | "battery" | "servos" | "airspeed" | "airframe",
  vehicle: "copter" | "plane",
  params: Record<string, number>,
  rc: number[],
): { text: string; live: boolean } {
  if (kind === "frame") {
    const cls = whole(param(params, "FRAME_CLASS"));
    const type = whole(param(params, "FRAME_TYPE"));
    if (cls == null) return { text: "", live: false };
    // 0 is Undefined: ArduPilot refuses to arm until a class is set.
    if (cls === 0) return { text: "Undefined", live: false };
    return { text: motorFrame(cls, type)?.title ?? CLASS_NAMES[cls] ?? "Other frame", live: true };
  }
  if (kind === "motors") {
    const frame = motorFrame(whole(param(params, "FRAME_CLASS")), whole(param(params, "FRAME_TYPE")));
    if (!frame) return { text: "", live: false };
    const used = new Set<number>();
    for (let channel = 1; channel <= 32; channel += 1) {
      const fn = whole(param(params, `SERVO${channel}_FUNCTION`));
      if (fn != null) used.add(fn);
    }
    const named = frame.spots.every((spot) => used.has(motorFunction(spot.n)));
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
    const batt = whole(param(params, "BATT_FS_LOW_ACT"));
    const battText = batt == null ? "" : fsName(vehicle === "plane" ? FS_NAMES.planeBatt : FS_NAMES.copterBatt, batt);
    let radioText: string;
    let live: boolean;
    if (vehicle === "plane") {
      // THR_FAILSAFE switches the radio failsafe on; FS_LONG_ACTN is what the plane then does.
      const on = whole(param(params, "THR_FAILSAFE"));
      const long = whole(param(params, "FS_LONG_ACTN"));
      if (on == null || long == null) return { text: "", live: false };
      live = on === 1;
      radioText = on === 1 ? fsName(FS_NAMES.planeLong, long) : fsName(FS_NAMES.planeRadio, on);
    } else {
      const radio = whole(param(params, "FS_THR_ENABLE"));
      if (radio == null) return { text: "", live: false };
      live = radio !== 0;
      radioText = fsName(FS_NAMES.copterRadio, radio);
    }
    // Without a battery monitor ArduPilot hides BATT_FS_LOW_ACT; the radio failsafe still counts.
    return { text: batt == null ? radioText : `${radioText} · ${battText}`, live };
  }
  if (kind === "battery") {
    if (whole(param(params, "BATT_MONITOR")) === 0) return { text: "No battery monitor", live: false };
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
    const surfaces = surfacesFor(classifyLayout(params));
    const found = surfaces.filter((surface) => {
      for (let i = 1; i <= 16; i++) if (whole(param(params, `SERVO${i}_FUNCTION`)) === surface.fn) return true;
      return false;
    }).length;
    return { text: found ? `${found}/${surfaces.length}` : "Not on an output yet.", live: found === surfaces.length };
  }
  if (kind === "airspeed") {
    const type = whole(param(params, "ARSPD_TYPE"));
    if (type == null) return { text: "", live: false };
    return { text: type === 0 ? "No airspeed sensor" : "Leave the sensor", live: true };
  }
  if (kind === "level") {
    // ArduPilot's defaults are offset 0 and scale 1; anything else was written by a calibration.
    const axes = ["X", "Y", "Z"];
    const offs = axes.map((a) => param(params, `INS_ACCOFFS_${a}`));
    const scal = axes.map((a) => param(params, `INS_ACCSCAL_${a}`));
    if ([...offs, ...scal].some((v) => v == null)) return { text: "", live: false };
    const calibrated = offs.some((v) => v !== 0) || scal.some((v) => v !== 1);
    return { text: calibrated ? "Calibrated" : "Not calibrated", live: calibrated };
  }
  if (kind === "airframe") {
    const layout = classifyLayout(params);
    if (layout == null) return { text: "No surfaces yet", live: false };
    const q = whole(param(params, "Q_ENABLE"));
    return { text: q ? `${LAYOUT_NAMES[layout]} · QuadPlane` : LAYOUT_NAMES[layout], live: true };
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
  const plane = frame === "plane";
  const radioName = plane ? "FS_SHORT_ACTN" : "FS_THR_ENABLE";
  const longName = plane ? "FS_LONG_ACTN" : "";
  const onNow = plane ? whole(param(sample.params, "THR_FAILSAFE")) : null;
  const radioNow = whole(param(sample.params, radioName));
  const longNow = longName ? whole(param(sample.params, longName)) : null;
  // Without a battery monitor ArduPilot hides BATT_FS_LOW_ACT; the radio failsafe can still be saved.
  const battNow = whole(param(sample.params, "BATT_FS_LOW_ACT"));
  const onOptions = fsOptions(FS_NAMES.planeRadio, [1, 0], onNow);
  const radioOptions = plane ? fsOptions(FS_NAMES.planeShort, [0, 1, 2, 3], radioNow) : fsOptions(FS_NAMES.copterRadio, [0, 1, 3], radioNow);
  const longOptions = fsOptions(FS_NAMES.planeLong, [0, 1, 2], longNow);
  const batteryOptions = plane ? fsOptions(FS_NAMES.planeBatt, [0, 1, 2], battNow) : fsOptions(FS_NAMES.copterBatt, [0, 1, 2], battNow);
  const [on, setOn] = useState(onNow);
  const [radio, setRadio] = useState(radioNow);
  const [long, setLong] = useState(longNow);
  const [batt, setBatt] = useState(battNow);
  useEffect(() => { setOn(onNow); }, [onNow]);
  useEffect(() => { setRadio(radioNow); }, [radioNow]);
  useEffect(() => { setLong(longNow); }, [longNow]);
  useEffect(() => { setBatt(battNow); }, [battNow]);
  const [busy, setBusy] = useState(false);
  const dirty = radio !== radioNow || (plane && (on !== onNow || long !== longNow)) || batt !== battNow;
  return (
    <div className="wiz">
      {plane ? <ChoiceRow title="Radio failsafe" value={on} options={onOptions} onPick={setOn} /> : null}
      <ChoiceRow title={plane ? "Short radio loss" : "Radio lost"} value={radio} options={radioOptions} onPick={setRadio} />
      {plane ? <ChoiceRow title="Long radio loss" value={long} options={longOptions} onPick={setLong} /> : null}
      {battNow != null ? <ChoiceRow title="Battery low" value={batt} options={batteryOptions} onPick={setBatt} /> : null}
      <ApplyButton
        label="Save failsafe"
        busy={busy}
        disabled={!sample.ok || !dirty || radioNow == null || radio == null || (plane && (onNow == null || on == null || longNow == null || long == null))}
        onApply={async () => {
          if (radio == null) return null;
          setBusy(true);
          try {
            const pairs: [string, number][] = [[radioName, radio]];
            if (batt != null && batt !== battNow) pairs.push(["BATT_FS_LOW_ACT", batt]);
            if (plane && on != null) pairs.push(["THR_FAILSAFE", on]);
            if (plane && long != null) pairs.push(["FS_LONG_ACTN", long]);
            const err = await writeList(pairs);
            if (!err) {
              const measures: WizardMeasures = { [radioName]: radio };
              if (batt != null) measures.BATT_FS_LOW_ACT = batt;
              if (plane && on != null) measures.THR_FAILSAFE = on;
              if (plane && long != null) measures.FS_LONG_ACTN = long;
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

function servoMeasures(found: { key: string; title: string; output: number; reversed: boolean }[], flip: Record<string, boolean>, assigned: Map<string, number>): WizardMeasures {
  const measures: WizardMeasures = {};
  for (const surface of found) {
    const key = surface.key;
    const output = surface.output || assigned.get(surface.title) || 0;
    measures[`${key}_output`] = output || null;
    measures[`${key}_reversed`] = (flip[surface.title] ?? surface.reversed) ? 1 : 0;
  }
  return measures;
}

export function ServoWizard({ onDone }: { onDone?: (measures: WizardMeasures) => void } = {}) {
  const t = useT();
  const sample = useSample();
  const found = surfacesFor(classifyLayout(sample.params)).map((surface) => {
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
          label="Assign the surfaces"
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

