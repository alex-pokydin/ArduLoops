import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { noteUi, send, writeParam } from "../mav/cmd";
import { getLatest, subscribe } from "../mav/store";
import { currentMatrix, fitMount, mean, orientLabel, vlen, type MountFit, type V3 } from "./compass-orient";

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

/** Which slice of the turn this field belongs to. The horizontal part swings once per revolution. */
function magSector(field: V3): number | null {
  const horiz = Math.hypot(field[0], field[1]);
  if (horiz < 40) return null;
  const deg = Math.atan2(field[1], field[0]) * (180 / Math.PI);
  return Math.floor((((deg + 180) % 360) / 360) * SECTORS) % SECTORS;
}

function num(params: Record<string, number>, name: string): number | null {
  const value = params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function orientParam(n: number): string {
  return n === 1 ? "COMPASS_ORIENT" : `COMPASS_ORIENT${n}`;
}

function offsetOf(params: Record<string, number>, n: number): V3 {
  const stem = n === 1 ? "COMPASS_OFS" : `COMPASS_OFS${n}`;
  return [num(params, `${stem}_X`) ?? 0, num(params, `${stem}_Y`) ?? 0, num(params, `${stem}_Z`) ?? 0];
}

function bodyField(live: Record<string, number> | undefined, n: number, ofs: V3, scale: number | null): V3 | null {
  const message = n === 1 ? "SCALED_IMU" : `SCALED_IMU${n}`;
  const x = live?.[`${message}.xmag`];
  const y = live?.[`${message}.ymag`];
  const z = live?.[`${message}.zmag`];
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  if (![x, y, z].every((value) => Number.isFinite(value))) return null;
  let v: V3 = [x - ofs[0], y - ofs[1], z - ofs[2]];
  if (scale != null && scale > 0.2) v = [v[0] / scale, v[1] / scale, v[2] / scale];
  return vlen(v) >= 1 ? v : null;
}

function latitude(live: Record<string, number> | undefined): number | null {
  const raw = live?.["GLOBAL_POSITION_INT.lat"];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw === 0) return null;
  return Math.abs(raw) > 90 ? raw / 1e7 : raw;
}

type Phase = "off" | "north" | "spin" | "done" | "reboot" | "wait" | "check" | "finish";

const STEPS = ["Nose north", "Full turn", "Angles", "Reboot", "Check the heading", "Finished"] as const;

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

function railAt(phase: Phase, customSaved: boolean): number {
  if (phase === "north") return 0;
  if (phase === "spin") return 1;
  if (phase === "done" && !customSaved) return 2;
  if (phase === "done" || phase === "reboot" || phase === "wait") return 3;
  if (phase === "check") return 4;
  return 5;
}

export type OrientHandle = { open: () => void };

export const CompassOrient = forwardRef<OrientHandle>(function CompassOrient(_props, ref) {
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
    if (phase === "off") return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !busy) setPhase("off");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, busy]);

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
    const scaleName = compass === 1 ? "COMPASS_SCALE" : `COMPASS_SCALE${compass}`;
    const field = bodyField(sample.live_nums, compass, offsetOf(params, compass), num(params, scaleName));
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
    };
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

  if (compass == null) return null;
  const external = num(params, compass === 1 ? "COMPASS_EXTERNAL" : `COMPASS_EXTERNAL${compass}`);
  if (external === 0) {
    return <p className="mag-line">{t("An internal compass follows the board orientation.")}</p>;
  }

  const at = railAt(phase, customSaved);
  const skipReboot = !customSaved && (phase === "check" || phase === "finish");
  const stored = customAngles(params, orient);
  const shown = fit ?? stored;
  const angles = shown ? t("Roll {roll}° · pitch {pitch}° · yaw {yaw}°", {
    roll: shown.roll.toFixed(1),
    pitch: shown.pitch.toFixed(1),
    yaw: shown.yaw.toFixed(1),
  }) : "";

  return (
    <>
      {phase !== "off" ? createPortal(
        <div className="modal-back" role="presentation">
          <div className="modal orient-wizard" role="dialog" aria-modal="true" aria-labelledby="orient-title">
            <div className="modal-head">
              <h2 id="orient-title">{t("Mount angle")}</h2>
              <button type="button" className="modal-x" disabled={busy} onClick={() => setPhase("off")} aria-label={t("Close")} title={t("Close")}>×</button>
            </div>
            <ol className="orient-steps">
              {STEPS.map((name, index) => (
                <li key={name} className={index === at ? "on" : index < at ? (index === 3 && skipReboot ? "skip" : "done") : ""}>{t(name)}</li>
              ))}
            </ol>
            {phase === "north" ? (
              <>
                <p className="mag-line">{t("The fixed orientations are 45° steps. This measures the actual roll, pitch, and yaw of the compass on the board.")}</p>
                <p className="mag-line">{t("Lay a phone a step away from the vehicle, flat, showing north. Turn the vehicle until its nose matches the phone. Hold it level and still.")}</p>
                <p className={levelNow ? "mag-line ok" : "mag-line warn"}>{t(levelNow ? "The board is level. Hold still." : "Hold the board level and still.")}</p>
              </>
            ) : null}
            {phase === "spin" ? (
              <>
                <p className="mag-line">{t("Keep the board level and turn it slowly in a full circle, back to north.")}</p>
                <p className={levelNow ? "mag-line ok" : "mag-line warn"}>{t(levelNow ? "{n} of 12 around the circle" : "Back to level.", { n: filled })}</p>
                <div className="mag-bits mag-ring" aria-hidden="true">
                  {on.map((lit, index) => <i key={index} className={lit ? "on" : ""} />)}
                </div>
              </>
            ) : null}
            {phase === "done" && fail ? <p className="mag-line warn">{t(fail)}</p> : null}
            {phase === "done" && fit && !customSaved ? (
              <>
                <p className="mag-line">{angles}</p>
                <p className="mag-line">{t("Closest fixed orientation is {name}, {deg}° away.", {
                  name: orientLabel(fit.nearestId),
                  deg: fit.nearestDeg.toFixed(0),
                })}</p>
                <p className="mag-line">{t(lat == null
                  ? "No latitude yet, so the vertical field is taken as down."
                  : lat >= 0
                    ? "Vertical field is taken as down because the latitude is north."
                    : "Vertical field is taken as up because the latitude is south.")}</p>
                <div className="wiz-apply">
                  {fit.nearestDeg <= 8 ? (
                    <button type="button" className="wiz-go" disabled={busy} onClick={() => void saveNamed()}>{t("Use {name}", { name: orientLabel(fit.nearestId) })}</button>
                  ) : null}
                  <button type="button" className={fit.nearestDeg <= 8 ? "wiz-quiet" : "wiz-go"} disabled={busy} onClick={() => void saveCustom()}>{t("Save the exact angles")}</button>
                </div>
              </>
            ) : null}
            {phase === "reboot" || (phase === "done" && customSaved && fit) ? (
              <>
                <p className="mag-line">{angles}</p>
                <p className="mag-line">{t("Custom angles are stored. Reboot the board so it uses them.")}</p>
                <div className="wiz-apply">
                  <button type="button" className="wiz-go" disabled={busy} onClick={reboot}>{t("Reboot the board")}</button>
                  <button type="button" className="wiz-quiet" onClick={goCheck}>{t("Next")}</button>
                </div>
              </>
            ) : null}
            {phase === "wait" ? (
              <>
                <p className="mag-line">{t(sample.ok
                  ? "Waiting for the board to restart."
                  : "The board dropped off. Open the link again when it is back.")}</p>
                <div className="wiz-apply">
                  <button type="button" className="wiz-go" onClick={goCheck}>{t("Next")}</button>
                </div>
              </>
            ) : null}
            {phase === "check" ? (
              <>
                <p className="mag-line">{t("Hold the board level, nose north, and still. The heading and the field should agree.")}</p>
                {check ? (
                  <>
                    <p className={check.level ? "mag-line ok" : "mag-line warn"}>{t(check.level ? "The board is level." : "Hold the board level.")}</p>
                    <p className={check.heading ? "mag-line ok" : "mag-line warn"}>{t(check.heading ? "Heading {yaw}°. The nose reads north." : "Heading {yaw}°. Turn the nose to north.", { yaw: check.yaw.toFixed(0) })}</p>
                    <p className={check.forward ? "mag-line ok" : "mag-line warn"}>{t(check.forward ? "The field points along the nose." : "The field does not point along the nose.")}</p>
                    <p className={check.down ? "mag-line ok" : "mag-line warn"}>{t(check.down ? "The vertical field points the right way." : "The vertical field points the wrong way.")}</p>
                    {check.forward && check.down && !check.heading ? (
                      <p className="mag-line">{t("The field matches the nose. Wait for the heading.")}</p>
                    ) : null}
                  </>
                ) : null}
                <div className="wiz-apply">
                  <button type="button" className="wiz-quiet" onClick={begin}>{t("Measure again")}</button>
                </div>
              </>
            ) : null}
            {phase === "finish" ? (
              <>
                <p className="mag-line ok">{t("The mount angle is in use. Heading and field agree with the nose.")}</p>
                <div className="wiz-apply">
                  <button type="button" className="wiz-go" onClick={() => setPhase("off")}>{t("Close")}</button>
                </div>
              </>
            ) : null}
            {note ? <p className="mag-line" role="status">{t(note)}</p> : null}
            {phase !== "finish" ? (
              <div className="wiz-apply">
                <button type="button" className="wiz-quiet" disabled={busy} onClick={() => setPhase("off")}>{t("Cancel")}</button>
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
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
