import { memo, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { send as sendCmd } from "../mav/cmd";
import { APP_HTTP } from "../mav/link";
import { downloadParamBackup } from "../mav/paramBackup";
import { openSetupOverview } from "../lib/setupNav";
import { prearmAsk } from "../lib/setupSteps";
import { FixButton } from "./HardwareSetup";
import { ProfileForm, useProfileStart } from "./ProfileForm";
import { hasProfile, profileChips, readProfile, type VehicleProfile } from "../lib/vehicleProfile";
import type { Sample } from "../mav/types";
import { usePicked, useVehicle } from "../mav/view";
import { NOTE_TITLE_MAX, flightVersion, genericMark, joinNote, markShape, preArmState, splitNote, type MarkShape } from "../lib/vehicleHeader";

type Controller = {
  board_id: number;
  vehicle_id: string;
  git_identity?: string | null;
  flight_version?: number | null;
  system_id: number;
  board_name?: string | null;
  uid?: string | null;
  key?: string | null;
  comment?: string;
  profile?: unknown;
};

const NOTE_MAX = 2000;

function linkIsSimulator(sample: Sample): boolean {
  return !!sample.sitl_running
    || sample.truth_lat != null
    || sample.truth_lon != null
    || Object.keys(sample.params).some((name) => name.startsWith("SIM_"));
}

function num(sample: Sample, key: string): number | null {
  const value = sample.live_nums?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The mark follows the frame: copter arms from motorFrames, plane from its surface layout. */
function VehicleMark({ shape }: { shape: MarkShape }) {
  const g = { fill: "currentColor", fillOpacity: 0.14, stroke: "currentColor", strokeWidth: 1.9, strokeLinejoin: "round" as const };
  if (shape.kind === "plane") {
    const fuselage = <><polygon points="48,5 43,18 53,18" /><rect x="44.5" y="16" width="7" height="46" rx="2" /></>;
    const wing = <polygon points="6,36 48,27 90,36 48,41" />;
    return (
      <svg viewBox="0 0 96 72" aria-hidden="true"><g {...g}>
        {shape.layout === "wing" ? (
          <><polygon points="48,10 92,50 84,58 48,40 12,58 4,50" /><polygon points="48,10 44,20 52,20" /></>
        ) : (
          <>
            {fuselage}{wing}
            {shape.layout === "vtail" ? <polygon points="48,58 30,50 28,54 48,64 68,54 66,50" /> : <polygon points="32,56 48,52 64,56 48,62" />}
          </>
        )}
        {shape.quad ? (
          <>
            <line x1="22" y1="22" x2="22" y2="50" fill="none" /><line x1="74" y1="22" x2="74" y2="50" fill="none" />
            <circle cx="22" cy="16" r="7" /><circle cx="74" cy="16" r="7" /><circle cx="22" cy="56" r="7" /><circle cx="74" cy="56" r="7" />
          </>
        ) : null}
      </g></svg>
    );
  }
  if (shape.kind === "unknown") {
    return (
      <svg viewBox="0 0 96 72" aria-hidden="true"><g {...g}>
        <rect x="34" y="24" width="28" height="24" rx="4" />
        <text x="48" y="41" textAnchor="middle" fontSize="14" fill="currentColor" fillOpacity={1} stroke="none">?</text>
      </g></svg>
    );
  }
  const n = shape.arms.length;
  const r = shape.arms.some((arm) => arm.coax) ? 9 : n > 6 ? 7 : n > 4 ? 8.5 : 11;
  const at = (arm: { x: number; y: number }) => ({ x: 48 + arm.x * 32, y: 36 - arm.y * 25 });
  return (
    <svg viewBox="0 0 96 72" aria-hidden="true"><g {...g}>
      {shape.arms.map((arm, i) => { const p = at(arm); return <line key={`a${i}`} x1="48" y1="36" x2={p.x} y2={p.y} fill="none" />; })}
      {shape.arms.map((arm, i) => {
        const p = at(arm);
        return (
          <g key={`m${i}`}>
            <circle cx={p.x} cy={p.y} r={r} />
            {arm.coax ? <circle cx={p.x} cy={p.y} r={r - 4} fill="none" /> : null}
          </g>
        );
      })}
      {shape.tail ? <rect x="42" y={36 + 25 + r - 2} width="12" height="6" rx="1.5" /> : null}
      <rect x="40" y="29" width="16" height="14" rx="3" />
      <polygon points="48,22 43,30 53,30" />
    </g></svg>
  );
}

type Tone = "ok" | "amber" | "hot" | "mute";

function Tile({ label, value, sub, tone, wide, title, onOpen }: { label: string; value: string; sub?: string; tone: Tone; wide?: boolean; title?: string; onOpen?: () => void }) {
  const body = (
    <>
      <span className="vb-tl"><i />{label}</span>
      <b>{value}</b>
      {sub ? <span className="vb-ts">{sub}</span> : null}
    </>
  );
  if (onOpen) {
    return <button type="button" className={`vb-tile vb-open ${tone}${wide ? " wide" : ""}`} title={title} onClick={onOpen}>{body}</button>;
  }
  return <div className={`vb-tile ${tone}${wide ? " wide" : ""}`} title={title}>{body}</div>;
}

const PreArmTile = memo(function PreArmTile() {
  const t = useT();
  const key = usePicked((s) => {
    if (!s.ok) return "off";
    const state = preArmState({
      armed: s.armed,
      lines: s.prearm ?? [],
      now: s.heartbeat_at ?? Date.now() / 1000,
      present: num(s, "SYS_STATUS.onboard_control_sensors_present"),
      health: num(s, "SYS_STATUS.onboard_control_sensors_health"),
    });
    return JSON.stringify(state);
  });
  if (key === "off") return <Tile wide label={t("Pre-arm")} value="—" sub={t("No link")} tone="mute" />;
  const state = JSON.parse(key) as ReturnType<typeof preArmState>;
  if (state.kind === "armed") return <Tile wide label={t("Pre-arm")} value={t("Armed")} sub={t("Checks passed at arming")} tone="ok" onOpen={openSetupOverview} />;
  if (state.kind === "ready") return <Tile wide label={t("Pre-arm")} value={t("Ready to arm")} sub={t("All checks pass")} tone="ok" onOpen={openSetupOverview} />;
  if (state.kind === "failing") return <PreArmFailing lines={state.lines} />;
  return <Tile wide label={t("Pre-arm")} value={t("No report yet")} sub={t("The vehicle repeats failures about every 30 s")} tone="mute" onOpen={openSetupOverview} />;
});

/** Failing checks: the tile opens a list of the lines, each with Fix, and a way to the Setup Overview. */
function PreArmFailing({ lines }: { lines: string[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (ev: PointerEvent) => {
      if (!(ev.target instanceof Node) || !wrap.current?.contains(ev.target)) setOpen(false);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  const more = lines.length > 1 ? ` · +${lines.length - 1}` : "";
  return (
    <div className="vb-pa-wrap" ref={wrap}>
      <button type="button" className="vb-tile vb-open hot wide" aria-expanded={open} aria-haspopup="dialog" title={lines.join("\n")} onClick={() => setOpen((v) => !v)}>
        <span className="vb-tl"><i />{t("Pre-arm")}</span>
        <b>{t("{n} failing", { n: lines.length })}</b>
        <span className="vb-ts">{`${lines[0]}${more}`}</span>
      </button>
      {open ? (
        <div className="vb-pa" role="dialog" aria-label={t("Pre-arm checks")}>
          <div className="vb-pa-head">{t("Pre-arm · {n} failing", { n: lines.length })}</div>
          {lines.map((line) => (
            <div className="vb-pa-row" key={line}>
              <span>{line.replace(/^PreArm:\s*/, "")}</span>
              <FixButton small text={t(prearmAsk(line), { line: /^PreArm:/.test(line) ? line : `PreArm: ${line}` })} focus={line.slice(0, 32)} onSent={() => setOpen(false)} />
            </div>
          ))}
          <button type="button" className="vb-pa-more" onClick={() => { setOpen(false); openSetupOverview(); }}>{t("Open the Setup overview")} →</button>
        </div>
      ) : null}
    </div>
  );
}

const FIX_NAMES: Record<number, string> = { 2: "2D", 3: "3D", 4: "DGPS", 5: "RTK float", 6: "RTK" };

const GpsTile = memo(function GpsTile() {
  const t = useT();
  const key = usePicked((s) => {
    if (!s.ok) return "off";
    // No GPS configured (GPS1_TYPE, GPS_TYPE before 4.6, and GPS2_TYPE all 0): the tile says so instead of "No fix".
    const type1 = s.params?.GPS1_TYPE ?? s.params?.GPS_TYPE;
    if (type1 === 0 && !s.params?.GPS2_TYPE) return "none";
    return `${s.gps_fix ?? ""}|${s.gps_sats ?? ""}|${num(s, "GPS_RAW_INT.eph") ?? ""}`;
  });
  if (key === "off") return <Tile label={t("GPS")} value="—" tone="mute" />;
  if (key === "none") return <Tile label={t("GPS")} value={t("Off")} sub={t("No GPS set")} tone="mute" />;
  const [fixRaw, satsRaw, ephRaw] = key.split("|");
  const fix = fixRaw === "" ? null : Number(fixRaw);
  const sats = satsRaw === "" ? null : Number(satsRaw);
  const eph = ephRaw === "" ? null : Number(ephRaw);
  const name = fix != null && FIX_NAMES[fix] ? FIX_NAMES[fix] : t("No fix");
  const value = sats != null ? `${name} · ${sats}` : name;
  const hdop = eph != null && eph < 65535 ? t("HDOP {v}", { v: (eph / 100).toFixed(1) }) : undefined;
  return <Tile label={t("GPS")} value={value} sub={hdop} tone={fix != null && fix >= 3 ? "ok" : fix === 2 ? "amber" : "hot"} />;
});

const EkfTile = memo(function EkfTile() {
  const t = useT();
  const key = usePicked((s) => {
    if (!s.ok) return "off";
    const flags = num(s, "EKF_STATUS_REPORT.flags");
    const vars = ["velocity_variance", "pos_horiz_variance", "pos_vert_variance", "compass_variance"].map((f) => num(s, `EKF_STATUS_REPORT.${f}`)).filter((v): v is number => v != null);
    const worst = vars.length ? Math.max(...vars) : null;
    return `${flags ?? ""}|${worst == null ? "" : worst.toFixed(2)}|${s.params?.AHRS_EKF_TYPE ?? ""}`;
  });
  if (key === "off") return <Tile label={t("EKF")} value="—" tone="mute" />;
  const [flagsRaw, worstRaw, typeRaw] = key.split("|");
  if (flagsRaw === "" && worstRaw === "") return <Tile label={t("EKF")} value="—" sub={t("No EKF report yet")} tone="mute" />;
  const flags = flagsRaw === "" ? null : Number(flagsRaw);
  const worst = worstRaw === "" ? null : Number(worstRaw);
  // EKF_ATTITUDE (1) set and EKF_UNINITIALIZED (1024) clear: the filter is running.
  const running = flags == null ? true : (flags & 1) !== 0 && (flags & 1024) === 0;
  const tone: Tone = !running || (worst != null && worst >= 0.8) ? "hot" : worst != null && worst >= 0.5 ? "amber" : "ok";
  const sub = [typeRaw ? `EKF${typeRaw}` : "", worst != null ? t("var {v}", { v: worst.toFixed(2) }) : ""].filter(Boolean).join(" · ");
  return <Tile label={t("EKF")} value={running ? t("OK") : t("Not ready")} sub={sub} tone={tone} />;
});

const BatteryTile = memo(function BatteryTile() {
  const t = useT();
  const key = usePicked((s) => (s.ok ? `${num(s, "SYS_STATUS.voltage_battery") ?? ""}|${num(s, "SYS_STATUS.battery_remaining") ?? ""}|${s.params?.BATT_ARM_VOLT ?? ""}|${s.params?.BATT_MONITOR ?? ""}` : "off"));
  if (key === "off") return <Tile label={t("Battery")} value="—" tone="mute" />;
  const [mvRaw, pctRaw, armRaw, monitorRaw] = key.split("|");
  const mv = mvRaw === "" ? null : Number(mvRaw);
  // SYS_STATUS sends 0 or UINT16_MAX when no battery monitor is configured.
  if (monitorRaw === "0" || mv == null || mv <= 0 || mv >= 65535) return <Tile label={t("Battery")} value="—" sub={t("No monitor")} title={t("No battery monitor")} tone="mute" />;
  const volts = mv / 1000;
  // A monitor reading under 1 V has no pack on it (powered over USB) or a wrong voltage pin; its percentage means nothing.
  if (volts < 1) return <Tile label={t("Battery")} value={`${volts.toFixed(1)} V`} sub={t("No voltage read")} title={t("No pack connected, or the voltage pin or multiplier is wrong")} tone="amber" />;
  const pct = pctRaw === "" ? -1 : Number(pctRaw);
  const arm = armRaw === "" ? 0 : Number(armRaw);
  const tone: Tone = arm > 0 && volts < arm ? "amber" : "ok";
  return <Tile label={t("Battery")} value={`${volts.toFixed(1)} V`} sub={pct >= 0 ? `${pct} %` : undefined} tone={tone} title={arm > 0 ? t("Arms above {v} V", { v: arm }) : undefined} />;
});

const RcTile = memo(function RcTile() {
  const t = useT();
  const key = usePicked((s) => {
    if (!s.ok) return "off";
    const live = (s.rc ?? []).filter((v) => v >= 800 && v <= 2200).length;
    return `${live}|${num(s, "RC_CHANNELS.chancount") ?? ""}|${num(s, "RC_CHANNELS.rssi") ?? ""}`;
  });
  if (key === "off") return <Tile label={t("RC")} value="—" tone="mute" />;
  const [liveRaw, countRaw, rssiRaw] = key.split("|");
  const live = Number(liveRaw);
  const count = countRaw === "" ? live : Number(countRaw);
  const rssi = rssiRaw === "" ? null : Number(rssiRaw);
  // RC_CHANNELS.chancount 0: no receiver is sending, whatever the channel values hold.
  if (!live || count === 0) return <Tile label={t("RC")} value={t("No signal")} tone="hot" />;
  const sub = [t("{n} ch", { n: count }), rssi != null && rssi < 255 ? t("RSSI {v} %", { v: Math.round((rssi / 254) * 100) }) : ""].filter(Boolean).join(" · ");
  return <Tile label={t("RC")} value={t("OK")} sub={sub} tone="ok" />;
});

const AirspeedTile = memo(function AirspeedTile() {
  const t = useT();
  const key = usePicked((s) => (s.ok ? (s.aspd == null ? "" : s.aspd.toFixed(1)) : "off"));
  if (key === "off") return <Tile label={t("Airspeed")} value="—" tone="mute" />;
  return <Tile label={t("Airspeed")} value={key || "—"} sub="m/s" tone={key ? "ok" : "mute"} />;
});

function NoteEditor({ initial, focus, onClose, onSaved, controllerKey }: { initial: string; focus: "name" | "note"; onClose: () => void; onSaved: () => void; controllerKey: string }) {
  const t = useT();
  const start = splitNote(initial);
  const [name, setName] = useState(start.title);
  const [body, setBody] = useState(start.title ? start.body : (initial ?? "").trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLFormElement>(null);
  const comment = joinNote(name, body);
  useEffect(() => {
    function away(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    }
    function esc(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${APP_HTTP}/firmware-library/comment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ controller_key: controllerKey, comment }),
      });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error((value as { error?: string })?.error ?? `HTTP ${response.status}`);
      addLog(t("Note saved"), "ok");
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not save comment"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={box} className="vb-pop" onSubmit={(event) => void save(event)}>
      <label className="vb-pop-label" htmlFor="vb-name">{t("Name")}</label>
      <input id="vb-name" autoFocus={focus === "name"} value={name} maxLength={NOTE_TITLE_MAX}
        onChange={(event) => setName(event.target.value.replace(/[\r\n]+/g, " "))} placeholder={t("5″ freestyle quad")} />
      <label className="vb-pop-label" htmlFor="vb-note">{t("Note")}</label>
      <textarea id="vb-note" autoFocus={focus === "note"} value={body} maxLength={NOTE_MAX - name.length - 1}
        onChange={(event) => setBody(event.target.value)} placeholder={t("What this vehicle is, what changed, what to watch.")} />
      <div className="vb-pop-row">
        <span className="vb-pop-hint">{error || t("Saved with the board id · {n} / {max}", { n: comment.length, max: NOTE_MAX })}</span>
        <button type="button" className="vb-text" onClick={onClose}>{t("Cancel")}</button>
        <button type="submit" className="vb-primary" disabled={busy || comment === (initial ?? "").trim()}>{busy ? t("Saving…") : t("Save")}</button>
      </div>
    </form>
  );
}

/** The vehicle profile form under the header. Save stores the profile and the note body; the name line stays. */
function ProfileEditor({ controller, onClose, onSaved, blocked }: { controller: Controller | null; onClose: () => void; onSaved: () => void; blocked: string }) {
  const t = useT();
  const comment = controller?.comment ?? "";
  const start = useProfileStart(readProfile(controller?.profile), comment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function away(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    }
    function esc(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  async function save(profile: VehicleProfile, note: string) {
    if (!controller?.key) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${APP_HTTP}/firmware-library/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ controller_key: controller.key, profile, comment: joinNote(splitNote(comment).title, note) }),
      });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error((value as { error?: string })?.error ?? `HTTP ${response.status}`);
      addLog(t("Vehicle profile saved"), "ok");
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not save the profile"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div ref={box} className="vb-pop vb-prof" role="dialog" aria-label={t("Vehicle profile")}>
      <div className="vb-prof-head">
        <b>{t("Vehicle profile")}</b>
        <span>{t("A few facts the board cannot tell: they set the starting values and help the assistant.")}</span>
      </div>
      <ProfileForm start={start} blocked={blocked} busy={busy} error={error} onSave={(p, n) => void save(p, n)} onSkip={onClose} />
    </div>
  );
}

function Actions({ controller }: { controller: Controller | null }) {
  const t = useT();
  const link = usePicked((s) => `${s.ok ? 1 : 0}${s.armed ? 1 : 0}${s.rebooting ? 1 : 0}`);
  const ok = link[0] === "1";
  const armed = link[1] === "1";
  const rebooting = link[2] === "1";
  const [confirm, setConfirm] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!confirm) return;
    const timer = window.setTimeout(() => setConfirm(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirm]);
  useEffect(() => {
    if (!menu) return;
    function away(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(false);
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [menu]);
  function backup() {
    const result = downloadParamBackup();
    if (result.saved) addLog(t("Saved {count} parameters", { count: result.count }), "cmd");
    else addLog(t("Parameter list is incomplete. Wait until every parameter arrives, then back up again."), "bad");
  }
  function reboot() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    sendCmd({ op: "reboot" });
    addLog(t("Reboot requested"), "cmd");
  }
  const id = controller?.uid || controller?.key || "";
  const rebootTitle = !ok ? t("Needs the link") : armed ? t("Disarm first") : confirm ? t("Click again to reboot") : t("Reboot");
  return (
    <div className="vb-actions">
      <button type="button" className="vb-icon" disabled={!ok} onClick={backup} title={ok ? t("Back up parameters") : t("Needs the link")} aria-label={t("Back up parameters")}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M4.8 7l3.2 3.2L11.2 7M3 13h10" /></svg>
      </button>
      <button type="button" className={confirm ? "vb-icon confirm" : "vb-icon"} disabled={!ok || armed || rebooting} onClick={reboot} title={rebootTitle} aria-label={t("Reboot")}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.8 8a4.8 4.8 0 1 1-1.5-3.5" /><path d="M12 2.2v2.8H9.2" /></svg>
        {confirm ? <span>{t("Reboot now?")}</span> : null}
      </button>
      <div className="vb-more" ref={menuRef}>
        <button type="button" className="vb-icon ghost" onClick={() => setMenu((v) => !v)} aria-label={t("More")} aria-expanded={menu}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></svg>
        </button>
        {menu ? (
          <div className="vb-menu" role="menu">
            <button type="button" role="menuitem" disabled={!id} onClick={() => { void navigator.clipboard?.writeText(id); addLog(t("Board id copied"), "ok"); setMenu(false); }}>{t("Copy board id")}</button>
            <span className="vb-menu-info">{controller ? t("System ID {id}", { id: controller.system_id }) : t("No board id")}</span>
            {controller?.git_identity ? <span className="vb-menu-info">git {controller.git_identity}</span> : null}
            {id ? <span className="vb-menu-info mono" title={id}>{id}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ControllerBoard() {
  const t = useT();
  const view = useVehicle();
  const identity = usePicked((s) => `${s.ok ? 1 : 0}|${s.board_name ?? ""}|${s.boot_uid ?? ""}|${s.frame}`);
  const structure = usePicked(
    (s) => {
      const p = s.params ?? {};
      const servo = Array.from({ length: 16 }, (_, i) => p[`SERVO${i + 1}_FUNCTION`] ?? "").join(",");
      return `${s.frame}|${p.FRAME_CLASS ?? ""}|${p.FRAME_TYPE ?? ""}|${p.Q_ENABLE ?? ""}|${servo}|${p.BATT_CAPACITY ?? ""}|${linkIsSimulator(s) ? 1 : 0}|${s.armed ? 1 : 0}|${s.ok ? 1 : 0}`;
    },
  );
  const [controller, setController] = useState<Controller | null>(null);
  const [editing, setEditing] = useState<"name" | "note" | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const load = useCallback(() => {
    const ac = new AbortController();
    void fetch(`${APP_HTTP}/firmware-library`, { cache: "no-store", signal: ac.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: { controller?: Controller | null } | null) => setController(value?.controller ?? null))
      .catch(() => {});
    return () => ac.abort();
  }, []);
  useEffect(() => load(), [load, identity]);

  const parts = structure.split("|");
  const heartbeatFrame = parts[0] as "copter" | "plane" | "";
  const servo = parts[4].split(",");
  const params: Record<string, number> = {};
  const setNum = (name: string, raw: string) => { if (raw !== "") params[name] = Number(raw); };
  setNum("FRAME_CLASS", parts[1]);
  setNum("FRAME_TYPE", parts[2]);
  setNum("Q_ENABLE", parts[3]);
  servo.forEach((raw, i) => setNum(`SERVO${i + 1}_FUNCTION`, raw));
  const capacity = parts[5] === "" ? null : Number(parts[5]);
  const simulator = parts[6] === "1";
  const armed = parts[7] === "1";
  const linked = parts[8] === "1";

  if (!linked) {
    // No link: the header stays, but says nothing about any vehicle (not even the last one seen).
    return (
      <div className="vboard">
        <div className="vb-in">
          <div className="vb-id">
            <span className="vb-mark mute"><VehicleMark shape={genericMark(view)} /></span>
            <div className="vb-text-col"><div className="vb-line"><b className="vb-title ghost">{t("No vehicle")}</b></div></div>
          </div>
          <div className="vb-tiles mute">
            <PreArmTile />
            <GpsTile />
            <EkfTile />
            <BatteryTile />
            {view === "plane" ? <AirspeedTile /> : <RcTile />}
          </div>
          <Actions controller={null} />
        </div>
      </div>
    );
  }
  const vehicle = (heartbeatFrame || view) as "copter" | "plane" | "";
  const shape = markShape(vehicle, params);
  const note = splitNote(controller?.comment);
  const canEdit = !!controller?.key;
  const version = flightVersion(controller?.flight_version);
  const vehicleWord = vehicle === "plane" ? "Plane" : vehicle === "copter" ? "Copter" : "";
  const boardLine = [
    simulator ? "SITL" : controller?.board_name || (controller ? t("Board {id}", { id: controller.board_id }) : ""),
    [vehicleWord, version].filter(Boolean).join(" "),
  ].filter(Boolean).join(" · ");
  const frameName = shape.kind === "plane"
    ? (shape.quad ? "QuadPlane" : shape.layout === "wing" ? t("Flying wing") : shape.layout === "vtail" ? t("V-tail") : t("Conventional"))
    : shape.kind === "copter" ? shape.title : "";
  const frameSource = shape.kind === "plane" ? t("SERVOn_FUNCTION and Q_ENABLE") : "FRAME_CLASS · FRAME_TYPE";
  const profile = readProfile(controller?.profile);
  const profiled = hasProfile(profile);
  const chips = profile ? profileChips(profile, vehicle, t) : [];
  // The board's BATT_CAPACITY wins; the profile's capacity shows only when the board has none.
  const shownCapacity = capacity != null && capacity > 0 ? capacity : profile?.capacity_mah ?? null;
  const capacityFromBoard = capacity != null && capacity > 0;
  const profileBlocked = canEdit ? "" : t("Simulators have no board id yet, so a profile cannot be saved.");

  return (
    <div className="vboard">
      <div className="vb-in">
        <div className="vb-id">
          <span className="vb-mark" title={frameName || undefined}><VehicleMark shape={shape} /></span>
          <div className="vb-text-col">
            <div className="vb-line">
              {note.title ? <b className="vb-title" title={note.title}>{note.title}</b> : canEdit
                ? <button type="button" className="vb-title ghost" onClick={() => setEditing("name")}>{t("Name this vehicle")}</button>
                : <b className="vb-title ghost">{t("Name this vehicle")}</b>}
              {simulator ? <span className="vb-state sim">SITL</span> : null}
              {armed ? <span className="vb-state armed">{t("ARMED")}</span> : null}
              <button type="button" className="vb-pencil" disabled={!canEdit} onClick={() => setEditing(note.title ? "note" : "name")}
                title={canEdit ? t("Edit note") : t("Simulators have no board id yet, so a note cannot be saved.")} aria-label={t("Edit note")}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.8l2.7 2.7-7.6 7.6H2.9v-2.7z" /></svg>
              </button>
              {boardLine ? <span className="vb-board" title={controller?.git_identity ? `git ${controller.git_identity}` : undefined}>{boardLine}</span> : null}
            </div>
            {note.body ? <p className="vb-note" title={note.body}>{note.body}</p> : !note.title && canEdit ? <p className="vb-note ghost">{t("Add a note: what this vehicle is, what changed, what to watch.")}</p> : null}
            <div className="vb-chips">
              {frameName ? <span className="vb-chip board" title={t("From the board: {src}", { src: frameSource })}>{frameName}</span> : null}
              {chips.slice(0, 2).map((text) => (
                <button type="button" key={text} className="vb-chip prof" title={t("From your vehicle profile")} onClick={() => setProfileOpen(true)}>{text}</button>
              ))}
              {shownCapacity != null ? (
                capacityFromBoard
                  ? <span className="vb-chip board" title={t("From the board: {src}", { src: "BATT_CAPACITY" })}>{shownCapacity} mAh</span>
                  : <button type="button" className="vb-chip prof" title={t("From your vehicle profile")} onClick={() => setProfileOpen(true)}>{shownCapacity} mAh</button>
              ) : null}
              {chips.slice(2).map((text) => (
                <button type="button" key={text} className="vb-chip prof" title={t("From your vehicle profile")} onClick={() => setProfileOpen(true)}>{text}</button>
              ))}
              {profiled ? null : (
                <button type="button" className="vb-chip add" title={t("Props, cells, weight and how it flies")} onClick={() => setProfileOpen(true)}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z" /></svg>
                  {t("Vehicle profile")}
                </button>
              )}
            </div>
          </div>
          {profileOpen ? <ProfileEditor controller={controller} blocked={profileBlocked} onClose={() => setProfileOpen(false)} onSaved={load} /> : null}
          {editing && controller?.key ? <NoteEditor initial={controller.comment ?? ""} focus={editing} controllerKey={controller.key} onClose={() => setEditing(null)} onSaved={load} /> : null}
        </div>
        <div className="vb-tiles">
          <PreArmTile />
          <GpsTile />
          <EkfTile />
          <BatteryTile />
          {vehicle === "plane" ? <AirspeedTile /> : <RcTile />}
        </div>
        <Actions controller={controller} />
      </div>
    </div>
  );
}
