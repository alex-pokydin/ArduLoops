import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useT } from "../i18n/i18n";
import { joinNote, markShape, splitNote } from "../lib/vehicleHeader";
import {
  BLADES, CELL_VOLTS, CHEMISTRIES, COPTER_PROPS, EMPTY_PROFILE, PLANE_PROPS, PLANE_TYPES, STYLES,
  guessCells, profileChips, propLabel, readProfile, type FlyingStyle, type VehicleProfile,
} from "../lib/vehicleProfile";
import { APP_HTTP } from "../mav/link";
import { usePicked } from "../mav/view";

/**
 * The assistant's profile card (`profile_widget`). It starts from what the model filled in, then the board.
 * Save sends the profile and the whole note back as the card's answer; nothing is stored before that.
 */
export function ProfileCard({ payload, pending, busy, onSave, onSkip }: {
  payload: string;
  pending: boolean;
  busy: boolean;
  onSave: (answer: string) => void;
  onSkip: () => void;
}) {
  const t = useT();
  let asked: { profile?: unknown; comment?: string } = {};
  try {
    asked = JSON.parse(payload) as typeof asked;
  } catch {
    /* the card starts empty */
  }
  // The note as stored now; `known` false when it could not be read, so Save leaves the note alone.
  const [note, setNote] = useState<{ comment: string; known: boolean } | null>(null);
  useEffect(() => {
    if (!pending) return;
    const ac = new AbortController();
    void fetch(`${APP_HTTP}/firmware-library`, { cache: "no-store", signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((v: { controller?: { comment?: string } | null }) => setNote({ comment: v?.controller?.comment ?? "", known: !!v?.controller }))
      .catch(() => {
        if (!ac.signal.aborted) setNote({ comment: "", known: false });
      });
    return () => ac.abort();
  }, [pending]);
  const comment = note?.comment ?? "";
  const start = useProfileStart(readProfile(asked.profile), comment);
  if (!pending) {
    const saved = readProfile(asked.profile);
    const line = saved ? profileChips(saved, start.vehicle, t).join(" · ") : "";
    return <p className="proposal-note">{line || t("Vehicle profile")}</p>;
  }
  if (!note) return <p className="proposal-note">{t("Reading the board…")}</p>;
  return (
    <ProfileForm
      start={start}
      busy={busy}
      noteless={!note.known}
      saveLabel={t("Save profile")}
      onSave={(profile, body) => onSave(JSON.stringify(note.known ? { profile, comment: joinNote(splitNote(comment).title, body) } : { profile }))}
      onSkip={onSkip}
    />
  );
}

type Translate = ReturnType<typeof useT>;

/** The frame as the header names it: copter from FRAME_CLASS / FRAME_TYPE, plane from the surface layout. */
export function frameLabel(t: Translate, vehicle: "copter" | "plane" | "", params: Record<string, number>): { name: string; source: string } {
  const shape = markShape(vehicle, params);
  if (shape.kind === "plane") {
    const name = shape.quad ? "QuadPlane" : shape.layout === "wing" ? t("Flying wing") : shape.layout === "vtail" ? t("V-tail") : t("Conventional");
    return { name, source: t("SERVOn_FUNCTION and Q_ENABLE") };
  }
  return { name: shape.kind === "copter" ? shape.title : "", source: "FRAME_CLASS · FRAME_TYPE" };
}

export type ProfileStart = {
  vehicle: "copter" | "plane" | "";
  profile: VehicleProfile;
  /** The note body ("Anything else"); the name line is kept as it is. */
  note: string;
  frameName: string;
  frameSource: string;
  /** Where the cell count came from when the profile had none. */
  cellsHint: string;
  /** Where the capacity came from when the profile had none. */
  capacityHint: string;
  /** Plane: what the board says about an airspeed sensor, or empty. */
  airspeed: string;
};

/**
 * Where the form starts: the saved profile, and for what it lacks, what the board says
 * (cells from MOT_BAT_VOLT_MAX or the pack voltage, capacity from BATT_CAPACITY).
 */
export function useProfileStart(saved: VehicleProfile | null, comment: string): ProfileStart {
  const t = useT();
  const key = usePicked((s) => {
    const p = s.params ?? {};
    const servo = Array.from({ length: 16 }, (_, i) => p[`SERVO${i + 1}_FUNCTION`] ?? "").join(",");
    const mv = s.live_nums?.["SYS_STATUS.voltage_battery"];
    return [
      s.frame, p.FRAME_CLASS ?? "", p.FRAME_TYPE ?? "", p.Q_ENABLE ?? "", servo, p.BATT_CAPACITY ?? "", p.MOT_BAT_VOLT_MAX ?? "",
      typeof mv === "number" && mv > 0 && mv < 65535 ? (mv / 1000).toFixed(1) : "", p.ARSPD_TYPE ?? "", p.ARSPD_USE ?? "",
    ].join("|");
  });
  const [frame, cls, type, q, servo, cap, vmax, volts, arspdType, arspdUse] = key.split("|");
  const vehicle = frame === "plane" || frame === "copter" ? frame : "";
  const params: Record<string, number> = {};
  const put = (name: string, raw: string) => { if (raw !== "") params[name] = Number(raw); };
  put("FRAME_CLASS", cls);
  put("FRAME_TYPE", type);
  put("Q_ENABLE", q);
  servo.split(",").forEach((raw, i) => put(`SERVO${i + 1}_FUNCTION`, raw));
  const label = frameLabel(t, vehicle, params);
  const profile = { ...EMPTY_PROFILE, ...(saved ?? {}) };
  let cellsHint = "";
  if (profile.cells == null) {
    const guess = guessCells(volts === "" ? null : Number(volts), vmax === "" ? null : Number(vmax));
    if (guess) {
      profile.cells = guess.cells;
      cellsHint = guess.from === "max"
        ? t("{n}S from MOT_BAT_VOLT_MAX {v} V", { n: guess.cells, v: guess.volts })
        : t("{n}S guessed from {v} V now", { n: guess.cells, v: guess.volts });
    }
  }
  let capacityHint = "";
  const boardCap = cap === "" ? null : Number(cap);
  if (profile.capacity_mah == null && boardCap != null && boardCap > 0) {
    profile.capacity_mah = boardCap;
    capacityHint = t("capacity from BATT_CAPACITY");
  }
  const airspeed = vehicle !== "plane" || arspdType === ""
    ? ""
    : Number(arspdType) === 0
      ? t("No sensor (ARSPD_TYPE 0)")
      : Number(arspdUse) > 0
        ? t("Fitted and used (ARSPD_TYPE {n})", { n: arspdType })
        : t("Fitted, not used (ARSPD_USE 0)");
  const note = splitNote(comment);
  return { vehicle, profile, note: note.title ? note.body : comment.trim(), frameName: label.name, frameSource: label.source, cellsHint, capacityHint, airspeed };
}

function Row({ label, need, top, children }: { label: string; need?: boolean; top?: boolean; children: ReactNode }) {
  const t = useT();
  return (
    <div className={`pf-row${top ? " top" : ""}`}>
      <span className="pf-l">
        {label}
        {need ? <i className="pf-need" title={t("Needed for the starting values")}>{t("needed")}</i> : null}
      </span>
      <div className="pf-v">{children}</div>
    </div>
  );
}

/**
 * The vehicle profile form. Copter: props and blades, battery, weight, frame size, motors, how it flies.
 * Plane: span, props, battery, weight, motors, type, and the airspeed sensor as the board reports it.
 * "needed" marks what the copter's starting values are computed from. Frame is read from the board, not asked.
 */
export function ProfileForm({
  start,
  blocked,
  busy,
  error,
  saveLabel,
  noteless,
  onSave,
  onSkip,
}: {
  start: ProfileStart;
  /** Why Save is off (a simulator has no board id), or empty. */
  blocked?: string;
  busy?: boolean;
  error?: string;
  saveLabel?: string;
  /** The note could not be read: no "Anything else" row, and Save leaves the note as it is. */
  noteless?: boolean;
  onSave: (profile: VehicleProfile, note: string) => void;
  onSkip: () => void;
}) {
  const t = useT();
  const plane = start.vehicle === "plane";
  const [p, setP] = useState<VehicleProfile>(start.profile);
  const [note, setNote] = useState(start.note);
  const set = (patch: Partial<VehicleProfile>) => setP((cur) => ({ ...cur, ...patch }));
  const num = (raw: string) => {
    const n = Number(raw);
    return raw.trim() === "" || !Number.isFinite(n) ? null : n;
  };
  const shortcuts = plane ? PLANE_PROPS : COPTER_PROPS;
  const toggleStyle = (s: FlyingStyle) => set({ style: p.style.includes(s) ? p.style.filter((x) => x !== s) : [...p.style, s] });
  const volts = p.chemistry ? CELL_VOLTS[p.chemistry] : null;
  // Li-ion packs vary, so their per-cell voltages are shown to edit; other chemistries use the usual pair.
  const showVolts = p.chemistry === "liion" || p.cell_v_max != null || p.cell_v_min != null;
  function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!blocked) onSave({ ...p, motors: p.motors.trim() }, note);
  }
  const numField = (value: number | null, unit: string, label: string, onChange: (v: number | null) => void, step = 1, width = 64) => (
    <label className="pf-num">
      <input type="number" min={0} step={step} value={value ?? ""} aria-label={label} style={{ width }} onChange={(e) => onChange(num(e.target.value))} />
      <span>{unit}</span>
    </label>
  );
  return (
    <form className="pf" onSubmit={submit}>
      <Row label={t("Frame")}>
        {start.frameName ? <span className="pf-frame"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>{start.frameName}</span> : <span className="pf-dim">—</span>}
        <span className="pf-h">{t("read from {src}", { src: start.frameSource })}</span>
      </Row>
      {plane ? (
        <Row label={t("Wingspan")}>
          {numField(p.span_mm, "mm", t("Wingspan"), (v) => set({ span_mm: v }), 10, 72)}
        </Row>
      ) : null}
      <Row label={t("Props")} need={!plane}>
        <span className="pf-line">
          <span className="pf-pills" role="group" aria-label={t("Props")}>
            {shortcuts.map((size) => (
              <button type="button" key={size} className={p.props_in === size ? "on" : ""} aria-pressed={p.props_in === size} onClick={() => set({ props_in: p.props_in === size ? null : size })}>
                {propLabel(size)}
              </button>
            ))}
          </span>
          {numField(p.props_in, "″", t("Prop diameter"), (v) => set({ props_in: v }), 0.1, 44)}
        </span>
        {plane ? null : (
          <span className="pf-line">
            <span className="pf-sub">{t("Blades")}</span>
            <span className="pf-seg" role="group" aria-label={t("Blades")}>
              {BLADES.map((n) => (
                <button type="button" key={n} className={p.blades === n ? "on" : ""} aria-pressed={p.blades === n} onClick={() => set({ blades: p.blades === n ? null : n })}>{n === 5 ? "5+" : n}</button>
              ))}
            </span>
            <span className="pf-h">{t("for the notch filter")}</span>
          </span>
        )}
      </Row>
      <Row label={t("Battery")} need={!plane}>
        <span className="pf-line">
          <span className="pf-step">
            <button type="button" aria-label={t("Fewer cells")} disabled={(p.cells ?? 1) <= 1} onClick={() => set({ cells: Math.max(1, (p.cells ?? 2) - 1) })}>−</button>
            <b>{p.cells != null ? `${p.cells}S` : "—"}</b>
            <button type="button" aria-label={t("More cells")} disabled={(p.cells ?? 0) >= 16} onClick={() => set({ cells: Math.min(16, (p.cells ?? 0) + 1) })}>+</button>
          </span>
          <span className="pf-seg" role="group" aria-label={t("Chemistry")}>
            {CHEMISTRIES.map(([c, label]) => (
              <button type="button" key={c} className={p.chemistry === c ? "on" : ""} aria-pressed={p.chemistry === c}
                onClick={() => set(p.chemistry === c ? { chemistry: null, cell_v_max: null, cell_v_min: null } : { chemistry: c, cell_v_max: null, cell_v_min: null })}>{label}</button>
            ))}
          </span>
          {numField(p.capacity_mah, "mAh", t("Capacity"), (v) => set({ capacity_mah: v }), 50)}
        </span>
        {showVolts && volts ? (
          <span className="pf-line">
            <span className="pf-sub">{t("Per cell")}</span>
            {numField(p.cell_v_max ?? volts.max, t("V full"), t("Full cell voltage"), (v) => set({ cell_v_max: v }), 0.05, 44)}
            {numField(p.cell_v_min ?? volts.min, t("V empty"), t("Empty cell voltage"), (v) => set({ cell_v_min: v }), 0.05, 44)}
          </span>
        ) : volts ? (
          <span className="pf-h">{t("{max} V full · {min} V empty per cell", { max: volts.max.toFixed(2), min: volts.min.toFixed(1) })}</span>
        ) : null}
        {start.cellsHint || start.capacityHint ? <span className="pf-h">{[start.cellsHint, start.capacityHint].filter(Boolean).join(" · ")}</span> : null}
      </Row>
      <Row label={t("Weight")}>
        {numField(p.weight_g, "g", t("Weight"), (v) => set({ weight_g: v }), 10)}
        <span className="pf-h">{t("ready to fly, with battery")}</span>
      </Row>
      {plane ? null : (
        <Row label={t("Frame size")}>
          {numField(p.span_mm, "mm", t("Frame size"), (v) => set({ span_mm: v }), 5)}
          <span className="pf-h">{t("motor to motor, across the diagonal")}</span>
        </Row>
      )}
      <Row label={t("Motors")}>
        <input className="pf-text" value={p.motors} maxLength={80} placeholder={plane ? "2814 900KV" : "2207 1950KV"} aria-label={t("Motors")} onChange={(e) => set({ motors: e.target.value })} />
        <span className="pf-h">{t("optional")}</span>
      </Row>
      {plane ? (
        <Row label={t("Type")}>
          <span className="pf-pills" role="group" aria-label={t("Type")}>
            {PLANE_TYPES.map(([k, label]) => (
              <button type="button" key={k} className={p.plane_type === k ? "on" : ""} aria-pressed={p.plane_type === k} onClick={() => set({ plane_type: p.plane_type === k ? null : k })}>{t(label)}</button>
            ))}
          </span>
        </Row>
      ) : (
        <Row label={t("Flying")}>
          <span className="pf-pills" role="group" aria-label={t("Flying")}>
            {STYLES.map(([s, label]) => (
              <button type="button" key={s} className={p.style.includes(s) ? "on" : ""} aria-pressed={p.style.includes(s)} onClick={() => toggleStyle(s)}>{t(label)}</button>
            ))}
          </span>
        </Row>
      )}
      {plane && start.airspeed ? (
        <Row label={t("Airspeed")}>
          <span className="pf-frame">{start.airspeed}</span>
          <span className="pf-h">{t("read from the board; set on the Airspeed step")}</span>
        </Row>
      ) : null}
      {noteless ? null : (
        <Row label={t("Anything else")} top>
          <textarea className="pf-text" rows={2} value={note} maxLength={1900} placeholder={t("What this vehicle is, what changed, what to watch.")} aria-label={t("Anything else")} onChange={(e) => setNote(e.target.value)} />
          <span className="pf-h">{t("This is the board note under the name.")}</span>
        </Row>
      )}
      <div className="pf-foot">
        <span className={error ? "pf-err" : "pf-h"}>{error || blocked || t("Saved with the board id, next to the note.")}</span>
        <button type="button" className="vb-text" onClick={onSkip}>{t("Skip")}</button>
        <button type="submit" className="vb-primary" disabled={busy || !!blocked}>{busy ? t("Saving…") : saveLabel ?? t("Save")}</button>
      </div>
    </form>
  );
}
