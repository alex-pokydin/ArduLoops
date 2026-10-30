import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import { noteUi, send, writeParam } from "../mav/cmd";
import { getLatest, subscribe } from "../mav/store";
import type { WizardClose } from "../wizards/close";
import { currentMatrix, fitMount, mean, namedMatrix, orientLabel, toEuler, vlen, type MountFit, type V3 } from "./compass-orient";
import { Icon } from "./MotorSetup";
import { BoardTop, NorthDial, SensorWizard } from "./SensorWizard";

const SECTORS = 12;
const LEVEL = 12;

function turnRate(
  prev: { roll: number; pitch: number; yaw: number } | null,
  roll: number,
  pitch: number,
  yaw: number,
  dt: number,
): number {
  if (!prev || dt <= 0) return 0;
  let dy = yaw - prev.yaw;
  if (dy > 180) dy -= 360;
  if (dy < -180) dy += 360;
  return Math.hypot(roll - prev.roll, pitch - prev.pitch, dy) / dt;
}

/**
 * Which slice of the turn this field belongs to. The horizontal part swings once per revolution, opposite to the
 * vehicle: north seen from the body is at −heading. Numbered by that heading, so slice i is drawn where the nose is.
 */
function magSector(field: V3): number | null {
  const horiz = Math.hypot(field[0], field[1]);
  if (horiz < 40) return null;
  const heading = -Math.atan2(field[1], field[0]) * (180 / Math.PI);
  return Math.floor((((heading % 360) + 360) % 360) / (360 / SECTORS)) % SECTORS;
}

function num(params: Record<string, number>, name: string): number | null {
  const value = params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function orientParam(n: number): string {
  return n === 1 ? "COMPASS_ORIENT" : `COMPASS_ORIENT${n}`;
}

/**
 * Body-frame field of compass n from SCALED_IMU. ArduPilot sends it already corrected (`Compass::get_field`: offsets,
 * diagonals, scale and orientation applied), so it is used as it is; subtracting the offsets again would push the
 * circle off centre and a full turn would barely move its direction.
 */
function bodyField(live: Record<string, number> | undefined, n: number): V3 | null {
  const message = n === 1 ? "SCALED_IMU" : `SCALED_IMU${n}`;
  const x = live?.[`${message}.xmag`];
  const y = live?.[`${message}.ymag`];
  const z = live?.[`${message}.zmag`];
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  if (![x, y, z].every((value) => Number.isFinite(value))) return null;
  const v: V3 = [x, y, z];
  return vlen(v) >= 1 ? v : null;
}

function latitude(live: Record<string, number> | undefined): number | null {
  const raw = live?.["GLOBAL_POSITION_INT.lat"];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw === 0) return null;
  return Math.abs(raw) > 90 ? raw / 1e7 : raw;
}

/** `ready` waits for Start, so the vehicle can be placed before anything is measured. */
type Phase = "off" | "ready" | "north" | "spin" | "done" | "reboot" | "wait" | "check" | "finish";


type Check = {
  level: boolean;
  heading: boolean;
  forward: boolean;
  down: boolean;
  yaw: number;
};

function assess(roll: number, pitch: number, yaw: number, field: V3 | null, downPositive: boolean): Check {
  let head = yaw;
  if (head > 180) head -= 360;
  if (head < -180) head += 360;
  let forward = false;
  if (field && Math.hypot(field[0], field[1]) >= 40) {
    forward = Math.abs(Math.atan2(field[1], field[0]) * (180 / Math.PI)) <= 25;
  }
  const down = field != null && (downPositive ? field[2] > 40 : field[2] < -40);
  return {
    level: Math.abs(roll) < LEVEL && Math.abs(pitch) < LEVEL,
    heading: Math.abs(head) <= 25,
    forward,
    down,
    yaw: head,
  };
}

function railAt(phase: Phase): number {
  if (phase === "ready" || phase === "north") return 0;
  if (phase === "spin") return 1;
  if (phase === "done" || phase === "reboot" || phase === "wait") return 2;
  return 3;
}

/** Yaw of a named orientation, for the board drawn from above. */
function yawOf(id: number): number {
  const m = namedMatrix(id);
  return m ? toEuler(m).yaw : 0;
}

export type OrientHandle = { open: () => void };

/**
 * Measures how an external compass is mounted: nose north, then a level full turn. The fit is the nearest named
 * COMPASS_ORIENT, or the exact angles as a custom rotation. Opened from the Compass step (`open`), or by the assistant
 * (`autoOpen`), which gets the result in `onClose`.
 */
export const CompassOrient = forwardRef<OrientHandle, { autoOpen?: boolean; fromAssistant?: boolean; onClose?: (report?: WizardClose) => void }>(function CompassOrient({ autoOpen, fromAssistant, onClose }, ref) {
  const t = useT();
  const sample = useSyncExternalStore(subscribe, getLatest, getLatest);
  const [phase, setPhase] = useState<Phase>("off");
  const [filled, setFilled] = useState(0);
  const [on, setOn] = useState<boolean[]>(() => Array(SECTORS).fill(false));
  const [levelNow, setLevelNow] = useState(false);
  const [fit, setFit] = useState<MountFit | null>(null);
  const [fail, setFail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [customSaved, setCustomSaved] = useState(false);
  /** Degrees turned during the full turn: the vehicle (EKF yaw) and the compass field in the body frame. */
  const [turned, setTurned] = useState({ vehicle: 0, field: 0 });
  const bag = useRef({
    seen: -1,
    lastT: 0,
    still: 0,
    sawDrop: false,
    hb: 0,
    att: null as { roll: number; pitch: number; yaw: number } | null,
    north: [] as V3[],
    northMean: null as V3 | null,
    sectors: Array.from({ length: SECTORS }, () => [] as V3[]),
    spinYaw: null as number | null,
    spinField: null as number | null,
    vehicleTurn: 0,
    fieldTurn: 0,
  });
  const [check, setCheck] = useState<Check | null>(null);
  const params = sample.params ?? {};
  const compass = [1, 2, 3].find((n) => {
    const dev = num(params, n === 1 ? "COMPASS_DEV_ID" : `COMPASS_DEV_ID${n}`);
    const external = num(params, n === 1 ? "COMPASS_EXTERNAL" : `COMPASS_EXTERNAL${n}`);
    return dev != null && dev !== 0 && external != null && external !== 0;
  }) ?? null;
  const orient = compass == null ? null : num(params, orientParam(compass));
  const lat = latitude(sample.live_nums);

  useEffect(() => {
    if (phase === "wait") {
      if (!sample.ok) bag.current.sawDrop = true;
      const gap = bag.current.lastT > 0 ? sample.t - bag.current.lastT : 0;
      if (gap > 1.5) bag.current.sawDrop = true;
      bag.current.lastT = sample.t;
      if (!(bag.current.sawDrop && sample.ok)) return;
      goCheck();
      return;
    }
    if ((phase !== "north" && phase !== "spin" && phase !== "check") || compass == null) return;
    if (bag.current.seen === sample.t) return;
    const dt = bag.current.lastT > 0 ? Math.min(0.4, Math.max(0, sample.t - bag.current.lastT)) : 0;
    bag.current.seen = sample.t;
    bag.current.lastT = sample.t;
    const field = bodyField(sample.live_nums, compass);
    const level = Math.abs(sample.roll) < LEVEL && Math.abs(sample.pitch) < LEVEL;
    setLevelNow(level);
    if (phase === "north") {
      const still = level && turnRate(bag.current.att, sample.roll, sample.pitch, sample.yaw, dt) < 8;
      bag.current.att = { roll: sample.roll, pitch: sample.pitch, yaw: sample.yaw };
      if (!still || !field || dt <= 0) {
        bag.current.still = 0;
        bag.current.north = [];
        return;
      }
      bag.current.still += dt;
      bag.current.north.push(field);
      if (bag.current.still < 0.7) return;
      bag.current.northMean = mean(bag.current.north);
      bag.current.sectors = Array.from({ length: SECTORS }, () => [] as V3[]);
      setOn(Array(SECTORS).fill(false));
      setFilled(0);
      setPhase("spin");
      return;
    }
    if (phase === "check") {
      const report = assess(sample.roll, sample.pitch, sample.yaw, field, lat == null || lat >= 0);
      setCheck(report);
      const still = report.level && report.heading && report.forward && report.down
        && turnRate(bag.current.att, sample.roll, sample.pitch, sample.yaw, dt) < 8;
      bag.current.att = { roll: sample.roll, pitch: sample.pitch, yaw: sample.yaw };
      if (!still || dt <= 0) {
        bag.current.still = 0;
        return;
      }
      bag.current.still += dt;
      if (bag.current.still >= 0.7) setPhase("finish");
      return;
    }
    // Track both turns, so a compass that does not turn with the vehicle (a GPS puck on a cable, say) is named.
    const gap = (a: number, b: number) => ((a - b + 540) % 360) - 180;
    if (Number.isFinite(sample.yaw)) {
      if (bag.current.spinYaw != null) bag.current.vehicleTurn += Math.abs(gap(sample.yaw, bag.current.spinYaw));
      bag.current.spinYaw = sample.yaw;
    }
    if (field && Math.hypot(field[0], field[1]) >= 40) {
      const ang = (Math.atan2(field[1], field[0]) * 180) / Math.PI;
      if (bag.current.spinField != null) bag.current.fieldTurn += Math.abs(gap(ang, bag.current.spinField));
      bag.current.spinField = ang;
    }
    setTurned({ vehicle: Math.round(bag.current.vehicleTurn), field: Math.round(bag.current.fieldTurn) });
    if (!level || !field) return;
    const sector = magSector(field);
    if (sector == null) return;
    const bucket = bag.current.sectors[sector];
    if (bucket.length < 4) bucket.push(field);
    const count = bag.current.sectors.filter((row) => row.length > 0).length;
    setFilled(count);
    setOn((prev) => {
      if (prev[sector]) return prev;
      const next = prev.slice();
      next[sector] = true;
      return next;
    });
    if (count < SECTORS || !bag.current.northMean) return;
    const points = bag.current.sectors.map((row) => mean(row));
    const next = fitMount(points, bag.current.northMean, currentMatrix(orient ?? 0, customAngles(params, orient)), lat == null || lat >= 0);
    if (!next) {
      setFail("The turn did not show enough of the field.");
      setPhase("done");
      return;
    }
    setFit(next);
    setFail("");
    setPhase("done");
  }, [sample, phase, compass, orient, lat, params]);

  function emptyBag() {
    bag.current = {
      seen: -1,
      lastT: 0,
      still: 0,
      sawDrop: false,
      hb: 0,
      att: null,
      north: [],
      northMean: null,
      sectors: Array.from({ length: SECTORS }, () => []),
      spinYaw: null,
      spinField: null,
      vehicleTurn: 0,
      fieldTurn: 0,
    };
    setTurned({ vehicle: 0, field: 0 });
  }

  function begin() {
    emptyBag();
    setFit(null);
    setFail("");
    setNote("");
    setCustomSaved(false);
    setCheck(null);
    setOn(Array(SECTORS).fill(false));
    setFilled(0);
    setPhase("ready");
  }

  function startNorth() {
    emptyBag();
    setPhase("north");
  }

  useImperativeHandle(ref, () => ({
    open() {
      if (phase !== "off") return;
      begin();
    },
  }), [phase]);

  async function saveNamed() {
    if (!fit || compass == null || busy) return;
    const name = orientParam(compass);
    setBusy(true);
    setNote("");
    const err = await writeParam(name, fit.nearestId);
    setBusy(false);
    if (err) {
      setNote(err);
      return;
    }
    noteUi([{ kind: "param", name, value: fit.nearestId, from: orient }]);
    bag.current.still = 0;
    bag.current.att = null;
    bag.current.seen = -1;
    setCheck(null);
    setPhase("check");
  }

  async function saveCustom() {
    if (!fit || compass == null || busy) return;
    const group = compass === 1 ? "CUST_ROT1_" : "CUST_ROT2_";
    const orientValue = compass === 1 ? 101 : 102;
    const writes: [string, number][] = [
      ["CUST_ROT_ENABLE", 1],
      [`${group}ROLL`, Math.round(fit.roll * 10) / 10],
      [`${group}PITCH`, Math.round(fit.pitch * 10) / 10],
      [`${group}YAW`, Math.round(fit.yaw * 10) / 10],
      [orientParam(compass), orientValue],
    ];
    setBusy(true);
    setNote("");
    for (const [name, value] of writes) {
      const err = await writeParam(name, value);
      if (err) {
        setBusy(false);
        setNote(err);
        return;
      }
      noteUi([{ kind: "param", name, value, from: num(params, name) }]);
    }
    setBusy(false);
    setCustomSaved(true);
    setPhase("reboot");
  }

  function reboot() {
    bag.current.sawDrop = !sample.ok;
    bag.current.hb = sample.heartbeat_at ?? 0;
    bag.current.seen = -1;
    bag.current.lastT = 0;
    send({ op: "reboot" });
    setPhase("wait");
  }

  function goCheck() {
    bag.current.still = 0;
    bag.current.att = null;
    bag.current.seen = -1;
    setCheck(null);
    setPhase("check");
  }

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  function close() {
    const now = phaseRef.current;
    const best = fitRef.current;
    setPhase("off");
    onClose?.({
      outcome: now === "finish" ? "completed" : now === "done" && !best ? "failed" : "cancelled",
      measures: {
        phase: now,
        compass,
        current: orient,
        current_name: orient != null ? orientLabel(Math.round(orient)) : null,
        nearest: best ? best.nearestId : null,
        nearest_name: best ? orientLabel(best.nearestId) : null,
        nearest_deg: best ? Math.round(best.nearestDeg) : null,
        roll: best ? Math.round(best.roll * 10) / 10 : null,
        pitch: best ? Math.round(best.pitch * 10) / 10 : null,
        yaw: best ? Math.round(best.yaw * 10) / 10 : null,
        custom: customSaved ? 1 : 0,
      },
    });
  }

  // From the assistant the window opens at once; without an external compass there is nothing to measure.
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current || !sample.ok || !Object.keys(params).length) return;
    opened.current = true;
    if (compass == null) onClose?.({ outcome: "failed", measures: { reason: "no external compass; an internal compass follows AHRS_ORIENTATION" } });
    else begin();
  });

  if (compass == null || phase === "off") return null;
  const craft = sample.frame === "plane" ? "plane" : "copter";
  const stored = customAngles(params, orient);
  const shown = fit ?? stored;
  const angles = shown ? t("Roll {roll}° · pitch {pitch}° · yaw {yaw}°", {
    roll: shown.roll.toFixed(1),
    pitch: shown.pitch.toFixed(1),
    yaw: shown.yaw.toFixed(1),
  }) : "";
  const heading = Number.isFinite(sample.yaw) ? sample.yaw : 0;
  const line = (ok: boolean, text: string) => <div className={`mw-note ${ok ? "ok" : "warn"}`}><i className="sw-dot" /><span>{text}</span></div>;

  let left = <NorthDial heading={heading} sectors={Array(SECTORS).fill(false)} craft={craft} />;
  let body;
  let footer = (
    <>
      <button type="button" className="mw-btn text" disabled={busy} onClick={close}>{t("Cancel")}</button>
      <span />
    </>
  );
  if (phase === "ready") {
    const levelLive = sample.ok && Math.abs(sample.roll) < LEVEL && Math.abs(sample.pitch) < LEVEL;
    body = (
      <>
        <div className="mw-headline"><h3>{t("Point the nose north")}</h3><p>{t("Lay a phone a step away from the vehicle, flat, showing north. Turn the vehicle until its nose matches the phone. Hold it level and still.")}</p></div>
        {line(levelLive, t(levelLive ? "The board is level." : "Hold the board level."))}
        <span className="mw-dim mw-sm">{t("Nothing is measured until Start. Then hold it still for a second, and turn it one full circle.")}</span>
        <span className="mw-dim mw-sm">{t("The fixed orientations are 45° steps. This measures the actual roll, pitch, and yaw of the compass on the board.")}</span>
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={close}>{t("Cancel")}</button>
        <button type="button" className="mw-btn primary" disabled={!sample.ok} onClick={startNorth}><span>{t("Start")}</span>{Icon.chevR()}</button>
      </>
    );
  } else if (phase === "north") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Hold it still")}</h3><p>{t("Nose north, level. The north reading is taken after a second still.")}</p></div>
        {line(levelNow, t(levelNow ? "The board is level. Hold still." : "Hold the board level and still."))}
      </>
    );
  } else if (phase === "spin") {
    left = <NorthDial heading={heading} sectors={on} craft={craft} />;
    body = (
      <>
        <div className="mw-headline"><h3>{t("Turn it one full circle")}</h3><p>{t("Keep the board level and turn it slowly in a full circle, back to north.")}</p></div>
        {line(levelNow, t(levelNow ? "{n} of 12 around the circle" : "Back to level.", { n: filled }))}
        <span className="mw-dim mw-sm">{t("Turned {a}° · compass field turned {b}°", { a: turned.vehicle, b: turned.field })}</span>
        {turned.vehicle >= 120 && turned.field < turned.vehicle / 4 ? (
          <div className="mw-note warn">{Icon.warn()}<span>{t("The vehicle turns but the compass field does not. The compass must turn with the vehicle: is it fixed to the frame, or on a cable lying still?")}</span></div>
        ) : null}
        {turned.field >= 120 && filled <= 2 ? (
          <div className="mw-note warn">{Icon.warn()}<span>{t("The field turns, but a sector counts only while the board is within 12° of level. Keep it flat as you turn.")}</span></div>
        ) : null}
      </>
    );
  } else if (phase === "done" && fit && !customSaved) {
    const same = orient != null && Math.round(orient) === fit.nearestId && fit.nearestDeg <= 8;
    left = (
      <div className="sw-pair">
        <BoardTop yaw={yawOf(Math.round(orient ?? 0))} tone="dim" label={t("Set now")} value={orientLabel(Math.round(orient ?? 0))} />
        {Icon.chevR("var(--dim)", 20)}
        <BoardTop yaw={yawOf(fit.nearestId)} tone={same ? "ok" : "warn"} label={t("Measured")} value={orientLabel(fit.nearestId)} />
      </div>
    );
    body = (
      <>
        <div className="mw-headline">
          <h3>{same ? t("Compass {n} is mounted as set", { n: compass }) : t("Compass {n} is mounted {name}", { n: compass, name: orientLabel(fit.nearestId) })}</h3>
          <p>{t("Closest fixed orientation is {name}, {deg}° away.", { name: orientLabel(fit.nearestId), deg: fit.nearestDeg.toFixed(0) })}</p>
        </div>
        <span className="mw-dim mw-sm">{angles}</span>
        <span className="mw-dim mw-sm">{t(lat == null
          ? "No latitude yet, so the vertical field is taken as down."
          : lat >= 0
            ? "Vertical field is taken as down because the latitude is north."
            : "Vertical field is taken as up because the latitude is south.")}</span>
        {fit.nearestDeg > 8 ? <div className="mw-note info"><span>{t("No fixed orientation is close. Save the exact angles as a custom rotation.")}</span></div> : null}
      </>
    );
    // Within 8° of a fixed orientation, that one is the next step; otherwise the exact angles are.
    footer = fit.nearestDeg <= 8 ? (
      <>
        <button type="button" className="mw-btn text" disabled={busy} onClick={() => void saveCustom()}>{t("Save the exact angles")}</button>
        <button type="button" className="mw-btn primary" disabled={busy} onClick={() => void saveNamed()}>{t("Use {name}", { name: orientLabel(fit.nearestId) })}</button>
      </>
    ) : (
      <>
        <button type="button" className="mw-btn text" disabled={busy} onClick={begin}>{t("Measure again")}</button>
        <button type="button" className="mw-btn primary" disabled={busy} onClick={() => void saveCustom()}>{t("Save the exact angles")}</button>
      </>
    );
  } else if (phase === "done") {
    body = (
      <div className="mw-headline"><h3>{t("No fit")}</h3><p>{t(fail || "The turn did not show enough of the field.")}</p></div>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={close}>{t("Close")}</button>
        <button type="button" className="mw-btn primary" onClick={begin}>{t("Measure again")}</button>
      </>
    );
  } else if (phase === "reboot" || phase === "wait") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Reboot to use it")}</h3><p>{t("Custom angles are stored. Reboot the board so it uses them.")}</p></div>
        <span className="mw-dim mw-sm">{angles}</span>
        {phase === "wait" ? <span className="mw-dim mw-sm">{t(sample.ok ? "Waiting for the board to restart." : "The board dropped off. Open the link again when it is back.")}</span> : null}
      </>
    );
    footer = phase === "reboot" ? (
      <>
        <button type="button" className="mw-btn text" onClick={goCheck}>{t("Next")}</button>
        <button type="button" className="mw-btn warn-solid" disabled={busy} onClick={reboot}>{Icon.power()}<span>{t("Reboot the board")}</span></button>
      </>
    ) : (
      <>
        <span />
        <button type="button" className="mw-btn primary" onClick={goCheck}>{t("Next")}</button>
      </>
    );
  } else if (phase === "check") {
    body = (
      <>
        <div className="mw-headline"><h3>{t("Check the heading")}</h3><p>{t("Hold the board level, nose north, and still. The heading and the field should agree.")}</p></div>
        {check ? (
          <>
            {line(check.level, t(check.level ? "The board is level." : "Hold the board level."))}
            {line(check.heading, t(check.heading ? "Heading {yaw}°. The nose reads north." : "Heading {yaw}°. Turn the nose to north.", { yaw: check.yaw.toFixed(0) }))}
            {line(check.forward, t(check.forward ? "The field points along the nose." : "The field does not point along the nose."))}
            {line(check.down, t(check.down ? "The vertical field points the right way." : "The vertical field points the wrong way."))}
          </>
        ) : null}
      </>
    );
    footer = (
      <>
        <button type="button" className="mw-btn text" onClick={close}>{t("Cancel")}</button>
        <button type="button" className="mw-btn quiet" onClick={begin}>{t("Measure again")}</button>
      </>
    );
  } else {
    left = <NorthDial heading={heading} sectors={Array(SECTORS).fill(true)} craft={craft} />;
    body = (
      <div className="mw-headline"><h3>{t("Orientation checked")}</h3><p>{t("The mount angle is in use. Heading and field agree with the nose.")}</p></div>
    );
    footer = (
      <>
        <span />
        <button type="button" className="mw-btn primary" onClick={close}>{t("Close")}</button>
      </>
    );
  }

  return (
    <SensorWizard
      title={t("Compass orientation")}
      fromAssistant={fromAssistant}
      steps={[t("Nose north"), t("Full turn"), t("Result"), t("Check")]}
      step={railAt(phase)}
      left={left}
      body={<>{body}{note ? <div className="mw-note warn">{Icon.warn()}<span>{t(note)}</span></div> : null}</>}
      footer={footer}
      blocker={phase === "north" || phase === "spin" || phase === "check" ? (!sample.ok ? "lost" : null) : null}
      busy={busy}
      onClose={close}
    />
  );
});

function customAngles(params: Record<string, number>, orient: number | null): { roll: number; pitch: number; yaw: number } | null {
  const group = orient === 102 ? "CUST_ROT2_" : "CUST_ROT1_";
  const roll = num(params, `${group}ROLL`);
  const pitch = num(params, `${group}PITCH`);
  const yaw = num(params, `${group}YAW`);
  if (roll == null || pitch == null || yaw == null) return null;
  return { roll, pitch, yaw };
}
