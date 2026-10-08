import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../i18n/i18n";
import { addLog } from "../log";
import { noteUi, send, uploadMission, type MissionItem } from "../mav/cmd";
import { getSnapshot, subscribe } from "../mav/store";
import type { Sample } from "../mav/types";
import { usePicked, useVehicle } from "../mav/view";
import { WorkspaceTabs, type WorkspaceId } from "./WorkspaceTabs";

const M_PER_DEG = 111_320;
const TRAIL_CAP = 700;

type LatLon = { lat: number; lon: number };
type Finish = "rtl" | "loiter";
type Plan = { points: LatLon[]; alt: number; finish: Finish };
type View = { lat: number; lon: number; mpp: number };
type Pose = {
  ok: boolean;
  mode: string;
  lat: number | null;
  lon: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  truthLat: number | null;
  truthLon: number | null;
  homeLat: number | null;
  homeLon: number | null;
  alt: number | null;
  gspd: number | null;
  hdg: number | null;
  yaw: number;
  sats: number | null;
  wpSeq: number | null;
};

const KNOWN = new Set([
  "Mission uploaded",
  "Mission cleared",
  "Mission upload timed out",
  "No link",
  "Bad mission",
  "Too many waypoints",
  "Mission rejected",
  "Connection lost during mission upload",
]);

type TrailPt = LatLon & { truth: LatLon | null; gps: LatLon | null };
const trail: TrailPt[] = [];
let trailFrame = "";
let trailHooked = false;

function isLat(p: unknown): p is LatLon {
  if (!p || typeof p !== "object") return false;
  const lat = (p as LatLon).lat;
  const lon = (p as LatLon).lon;
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function toEnu(lat: number, lon: number, origin: LatLon): { e: number; n: number } {
  const north = (lat - origin.lat) * M_PER_DEG;
  const east = (lon - origin.lon) * M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180);
  return { e: east, n: north };
}

function fromEnu(east: number, north: number, origin: LatLon): LatLon {
  const lat = origin.lat + north / M_PER_DEG;
  const cos = Math.cos((origin.lat * Math.PI) / 180) || 1e-6;
  const lon = origin.lon + east / (M_PER_DEG * cos);
  return { lat, lon };
}

function dist(a: LatLon, b: LatLon): number {
  const d = toEnu(b.lat, b.lon, a);
  return Math.hypot(d.e, d.n);
}

function pair(lat: number | null | undefined, lon: number | null | undefined): LatLon | null {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

function noteSample(s: Sample): void {
  const board = pair(s.lat, s.lon);
  if (!s.ok || !board) return;
  if (s.frame && trailFrame && s.frame !== trailFrame) trail.length = 0;
  if (s.frame) trailFrame = s.frame;
  const truth = pair(s.truth_lat, s.truth_lon);
  const gps = pair(s.gps_lat, s.gps_lon);
  const last = trail[trail.length - 1];
  if (last) {
    if (dist(last, board) > 2000) trail.length = 0;
    else {
      const boardStill = dist(last, board) < 0.3;
      const truthStill = !truth || !last.truth || dist(last.truth, truth) < 0.3;
      const gpsStill = !gps || !last.gps || dist(last.gps, gps) < 0.3;
      if (boardStill && truthStill && gpsStill) return;
    }
  }
  trail.push({ ...board, truth, gps });
  if (trail.length > TRAIL_CAP) trail.splice(0, trail.length - TRAIL_CAP);
}

function hookTrail(): void {
  if (trailHooked) return;
  trailHooked = true;
  subscribe(() => noteSample(getSnapshot()));
}
hookTrail();

function pickPose(s: Sample): Pose {
  return {
    ok: s.ok,
    mode: s.mode,
    lat: s.lat ?? null,
    lon: s.lon ?? null,
    gpsLat: s.gps_lat ?? null,
    gpsLon: s.gps_lon ?? null,
    truthLat: s.truth_lat ?? null,
    truthLon: s.truth_lon ?? null,
    homeLat: s.home_lat ?? null,
    homeLon: s.home_lon ?? null,
    alt: s.alt,
    gspd: s.gspd,
    hdg: s.hdg,
    yaw: s.yaw,
    sats: s.gps_sats ?? null,
    wpSeq: s.wp_seq ?? null,
  };
}

function near(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) < 1e-6;
}

function poseEq(a: Pose, b: Pose): boolean {
  return (
    a.ok === b.ok &&
    a.mode === b.mode &&
    a.sats === b.sats &&
    a.wpSeq === b.wpSeq &&
    near(a.lat, b.lat) &&
    near(a.lon, b.lon) &&
    near(a.gpsLat, b.gpsLat) &&
    near(a.gpsLon, b.gpsLon) &&
    near(a.truthLat, b.truthLat) &&
    near(a.truthLon, b.truthLon) &&
    near(a.homeLat, b.homeLat) &&
    near(a.homeLon, b.homeLon) &&
    near(a.alt, b.alt) &&
    near(a.gspd, b.gspd) &&
    near(a.hdg, b.hdg) &&
    Math.abs(a.yaw - b.yaw) < 2
  );
}

function originOf(pose: Pose): LatLon | null {
  return pair(pose.homeLat, pose.homeLon) ?? pair(pose.lat, pose.lon);
}

function storeKey(vehicle: string): string {
  return "arduloops.mission.v1." + vehicle;
}

function loadPlan(vehicle: "copter" | "plane"): Plan {
  const alt = vehicle === "plane" ? 60 : 20;
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(vehicle)) || "") as Partial<Plan>;
    const points = Array.isArray(raw.points) ? raw.points.filter(isLat).slice(0, 40) : [];
    const nextAlt = Number(raw.alt);
    return {
      points,
      alt: Number.isFinite(nextAlt) ? Math.min(vehicle === "plane" ? 400 : 120, Math.max(2, nextAlt)) : alt,
      finish: raw.finish === "loiter" ? "loiter" : "rtl",
    };
  } catch {
    return { points: [], alt, finish: "rtl" };
  }
}

function project(lat: number, lon: number, view: View, w: number, h: number): { x: number; y: number } {
  const d = toEnu(lat, lon, view);
  return { x: w / 2 + d.e / view.mpp, y: h / 2 - d.n / view.mpp };
}

function unproject(x: number, y: number, view: View, w: number, h: number): LatLon {
  return fromEnu((x - w / 2) * view.mpp, (h / 2 - y) * view.mpp, view);
}

// New center so the lat/lon under (x, y) stays under that pixel. cos uses the
// new center's latitude, matching toEnu.
function zoomAbout(view: View, x: number, y: number, w: number, h: number, nextMpp: number): View {
  const under = unproject(x, y, view, w, h);
  const north = (h / 2 - y) * nextMpp;
  const east = (x - w / 2) * nextMpp;
  const lat = under.lat - north / M_PER_DEG;
  const cos = Math.cos((lat * Math.PI) / 180) || 1e-6;
  const lon = under.lon - east / (M_PER_DEG * cos);
  return { lat, lon, mpp: nextMpp };
}

function wheelSteps(ev: WheelEvent, height: number): number {
  let dy = ev.deltaY;
  if (ev.deltaMode === 1) dy *= 100;
  else if (ev.deltaMode === 2) dy *= height;
  if (!Number.isFinite(dy) || dy === 0) return 0;
  return Math.max(-6, Math.min(6, dy / 100));
}

function gridStep(mpp: number): number {
  const target = mpp * 90;
  const pow = 10 ** Math.floor(Math.log10(Math.max(target, 1e-3)));
  const n = target / pow;
  const m = n < 2 ? 1 : n < 5 ? 2 : 5;
  return m * pow;
}

function readCells(value: number | null, int: number, frac: number, signed: boolean, zero: boolean): string[] {
  const cells: string[] = [];
  const blank = value == null || !Number.isFinite(value);
  const neg = !blank && value < 0;
  if (signed) cells.push(blank || !neg ? "\u2007" : "-");
  if (blank) {
    for (let i = 0; i < int; i++) cells.push("\u2007");
    if (frac > 0) {
      cells.push("\u2007");
      for (let i = 0; i < frac; i++) cells.push("\u2007");
    }
    return cells;
  }
  const [whole, fraction] = Math.abs(value).toFixed(frac).split(".");
  const digits = whole.length > int ? whole : zero ? whole.padStart(int, "0") : whole.padStart(int, "\u2007");
  for (const ch of digits) cells.push(ch);
  if (frac > 0) {
    cells.push(".");
    for (const ch of fraction) cells.push(ch);
  }
  return cells;
}

function ReadNum({
  value,
  int,
  frac = 0,
  signed = false,
  zero = false,
}: {
  value: number | null;
  int: number;
  frac?: number;
  signed?: boolean;
  zero?: boolean;
}) {
  const cells = readCells(value, int, frac, signed, zero);
  const label = value == null || !Number.isFinite(value) ? undefined : (value < 0 ? "-" : "") + Math.abs(value).toFixed(frac);
  return (
    <span className="mission-num" aria-label={label}>
      {cells.map((ch, i) => (
        <span key={i} className="mission-cell" aria-hidden="true">
          {ch}
        </span>
      ))}
    </span>
  );
}

function missionItems(origin: LatLon, points: LatLon[], alt: number, finish: Finish): MissionItem[] {
  const items: MissionItem[] = [
    { kind: "waypoint", lat: origin.lat, lon: origin.lon, alt: 0 },
    { kind: "takeoff", lat: origin.lat, lon: origin.lon, alt },
  ];
  points.forEach((p, i) => {
    const last = i === points.length - 1;
    items.push({
      kind: finish === "loiter" && last ? "loiter" : "waypoint",
      lat: p.lat,
      lon: p.lon,
      alt,
    });
  });
  if (finish === "loiter" && points.length === 0) {
    items.push({ kind: "loiter", lat: origin.lat, lon: origin.lon, alt });
  }
  if (finish === "rtl") items.push({ kind: "rtl", lat: 0, lon: 0, alt: 0 });
  return items;
}

export function MissionView({
  current,
  ids,
  onWorkspace,
}: {
  current: WorkspaceId;
  ids: WorkspaceId[];
  onWorkspace: (id: WorkspaceId) => void;
}) {
  const t = useT();
  const vehicle = useVehicle();
  const pose = usePicked(pickPose, poseEq);
  const [plan, setPlan] = useState<Plan>(() => loadPlan(vehicle));
  const [view, setView] = useState<View | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [noteBad, setNoteBad] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef(view);
  const sizeRef = useRef(size);
  const opened = useRef(false);
  const drag = useRef<{ x: number; y: number; moved: boolean; point: number | null } | null>(null);
  const onWheelRef = useRef<(ev: WheelEvent) => void>(() => {});
  viewRef.current = view;
  sizeRef.current = size;

  onWheelRef.current = (ev: WheelEvent) => {
    const current = viewRef.current;
    const box = sizeRef.current;
    const svg = svgRef.current;
    if (!current || !svg || box.w < 40 || box.h < 40) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    ev.preventDefault();
    const steps = wheelSteps(ev, box.h);
    if (!steps) return;
    const nextMpp = Math.min(50, Math.max(0.15, current.mpp * Math.exp(steps * Math.log(1.12))));
    if (nextMpp === current.mpp) return;
    const x = ((ev.clientX - rect.left) / rect.width) * box.w;
    const y = ((ev.clientY - rect.top) / rect.height) * box.h;
    const next = zoomAbout(current, x, y, box.w, box.h, nextMpp);
    viewRef.current = next;
    setView(next);
  };

  const leg = vehicle === "plane" ? 250 : 80;
  const side = vehicle === "plane" ? 200 : 60;
  const origin = originOf(pose);
  const board = pair(pose.lat, pose.lon);
  const gps = pair(pose.gpsLat, pose.gpsLon);
  const truth = pair(pose.truthLat, pose.truthLon);
  const home = pair(pose.homeLat, pose.homeLon);

  useEffect(() => {
    try {
      localStorage.setItem(storeKey(vehicle), JSON.stringify(plan));
    } catch {
      /* ignore */
    }
  }, [plan, vehicle]);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const sync = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function fitTo(pts: LatLon[]) {
    const kept = pts.filter(isLat);
    if (!kept.length) return;
    const { w, h } = sizeRef.current;
    let lat = 0;
    let lon = 0;
    for (const p of kept) {
      lat += p.lat;
      lon += p.lon;
    }
    lat /= kept.length;
    lon /= kept.length;
    const c = { lat, lon };
    let max = 25;
    for (const p of kept) {
      const d = toEnu(p.lat, p.lon, c);
      max = Math.max(max, Math.abs(d.e), Math.abs(d.n));
    }
    const span = Math.max(80, Math.min(w, h));
    const mpp = (max * 2.6) / span;
    setView({ lat, lon, mpp: Math.min(50, Math.max(0.15, mpp)) });
  }

  useEffect(() => {
    if (opened.current || size.w < 40) return;
    const pts = [origin, ...plan.points, board].filter(isLat);
    if (!pts.length) return;
    opened.current = true;
    fitTo(pts);
  }, [size.w, size.h, pose.lat, pose.homeLat, plan.points.length]);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => onWheelRef.current(ev);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function localXY(ev: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function hitPoint(x: number, y: number): number | null {
    const current = viewRef.current;
    const box = sizeRef.current;
    if (!current) return null;
    let best: number | null = null;
    let bestD = 14;
    plan.points.forEach((p, i) => {
      const at = project(p.lat, p.lon, current, box.w, box.h);
      const d = Math.hypot(at.x - x, at.y - y);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  function onPointerDown(ev: ReactPointerEvent<SVGSVGElement>) {
    if (!viewRef.current) return;
    const at = localXY(ev);
    if (!at) return;
    drag.current = { x: ev.clientX, y: ev.clientY, moved: false, point: hitPoint(at.x, at.y) };
    ev.currentTarget.setPointerCapture(ev.pointerId);
  }

  function onPointerMove(ev: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    const current = viewRef.current;
    const box = sizeRef.current;
    if (!d || !current || box.w < 40) return;
    const dx = ev.clientX - d.x;
    const dy = ev.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    d.x = ev.clientX;
    d.y = ev.clientY;
    if (d.point != null) {
      const at = localXY(ev);
      if (!at) return;
      const next = unproject(at.x, at.y, current, box.w, box.h);
      const idx = d.point;
      setPlan((p) => ({ ...p, points: p.points.map((pt, i) => (i === idx ? next : pt)) }));
      return;
    }
    const shifted = fromEnu(-dx * current.mpp, dy * current.mpp, current);
    setView({ ...current, lat: shifted.lat, lon: shifted.lon });
  }

  function onPointerUp(ev: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    drag.current = null;
    const current = viewRef.current;
    const box = sizeRef.current;
    if (!d || d.moved || d.point != null || !current || box.w < 40) return;
    const at = localXY(ev);
    if (!at) return;
    const next = unproject(at.x, at.y, current, box.w, box.h);
    setPlan((p) => ({ ...p, points: [...p.points, next].slice(0, 40) }));
  }

  function onNorth() {
    if (!origin) return;
    const points = [fromEnu(0, leg, origin)];
    setPlan((p) => ({ ...p, points, finish: "rtl" }));
    fitTo([origin, ...points]);
  }

  function onSquare() {
    if (!origin) return;
    const points = [fromEnu(0, side, origin), fromEnu(side, side, origin), fromEnu(side, 0, origin)];
    setPlan((p) => ({ ...p, points, finish: "rtl" }));
    fitTo([origin, ...points]);
  }

  function onLoiter() {
    if (!origin) return;
    setPlan((p) => ({ ...p, points: [], finish: "loiter" }));
    fitTo([origin, board].filter(isLat));
  }

  function say(message: string, bad: boolean) {
    setNote(message);
    setNoteBad(bad);
    addLog(KNOWN.has(message) ? t(message) : message, bad ? "bad" : "ok");
  }

  async function onUpload() {
    if (!origin || busy) return;
    setBusy(true);
    const err = await uploadMission(missionItems(origin, plan.points, plan.alt, plan.finish));
    setBusy(false);
    say(err ?? "Mission uploaded", err != null);
  }

  async function onErase() {
    if (!pose.ok || busy) return;
    setBusy(true);
    const err = await uploadMission([]);
    setBusy(false);
    say(err ?? "Mission cleared", err != null);
  }

  function onMode(mode: "AUTO" | "RTL") {
    send({ op: "mode", mode });
    noteUi([{ kind: "mode", from: pose.mode, mode }]);
    addLog(t("Mode {mode}", { mode }), "cmd");
  }

  const truthM = board && truth ? dist(board, truth) : null;
  const gpsM = board && gps ? dist(board, gps) : null;
  const offM = truthM ?? gpsM;
  const offHot = (offM ?? 0) > 2;
  const hdg = pose.hdg == null ? null : ((Math.round(pose.hdg) % 360) + 360) % 360;
  const noteText = note ? (KNOWN.has(note) ? t(note) : note) : null;
  const route = [origin, ...plan.points, plan.finish === "rtl" ? origin : null].filter(isLat);

  return (
    <section className="scope work mission">
      <div className="work-bar">
        <WorkspaceTabs current={current} ids={ids} onSelect={onWorkspace} />
        <div className="mission-acts">
          <button type="button" className="cyan" disabled={!origin || busy} onClick={() => void onUpload()}>
            {busy ? t("Uploading…") : t("Upload mission")}
          </button>
          <button type="button" disabled={!pose.ok || busy} onClick={() => onMode("AUTO")} title={t("Start the mission")}>
            AUTO
          </button>
          <button type="button" disabled={!pose.ok || busy} onClick={() => onMode("RTL")} title={t("Return home")}>
            RTL
          </button>
        </div>
      </div>
      <div className="mission-body">
        <div className="mission-map" ref={mapRef}>
          <svg
            ref={svgRef}
            width={Math.max(size.w, 1)}
            height={Math.max(size.h, 1)}
            viewBox={`0 0 ${Math.max(size.w, 1)} ${Math.max(size.h, 1)}`}
            role="application"
            aria-label={t("mission")}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {view && size.w > 40 ? (
              <MapArt
                view={view}
                w={size.w}
                h={size.h}
                route={route}
                points={plan.points}
                finish={plan.finish}
                home={home}
                board={board}
                gps={gps}
                truth={truth}
                yaw={pose.yaw}
                wpSeq={pose.mode === "AUTO" ? pose.wpSeq : null}
              />
            ) : null}
          </svg>
          <button type="button" className="mission-fit" onClick={() => fitTo([origin, board, truth, gps, ...plan.points].filter(isLat))}>
            {t("Fit map")}
          </button>
          <div className="mission-read">
            <span className="mission-mode">{pose.mode}</span>
            <span>
              <ReadNum value={pose.alt} int={3} frac={1} signed />
              {t("m")}
            </span>
            <span>
              <ReadNum value={pose.gspd} int={2} frac={1} signed />
              {t("m/s")}
            </span>
            <span>
              <ReadNum value={hdg} int={3} zero />°
            </span>
            <span>
              <ReadNum value={pose.sats} int={2} />
              {t("sats")}
            </span>
            <span>
              <span className="mission-kind">
                <span className="ghost">{t("item")}</span>
                <span>{pose.mode === "AUTO" ? t("item") : "\u00a0"}</span>
              </span>
              <ReadNum value={pose.mode === "AUTO" ? pose.wpSeq : null} int={2} />
            </span>
            <span className={offHot ? "off" : undefined}>
              <span className="mission-kind">
                <span className="ghost">{t("off truth")}</span>
                <span className="ghost">{t("off GPS")}</span>
                <span>{truthM != null ? t("off truth") : gpsM != null ? t("off GPS") : "\u00a0"}</span>
              </span>
              <ReadNum value={offM} int={4} frac={1} />
              {t("m")}
            </span>
          </div>
          {!view ? <p className="mission-empty">{t("No position yet.")}</p> : null}
        </div>
        <aside className="mission-side">
          <label>
            {t("Altitude, m")}
            <input
              type="number"
              min={2}
              max={vehicle === "plane" ? 400 : 120}
              step={1}
              value={plan.alt}
              onChange={(ev) => {
                const n = Number(ev.target.value);
                if (!Number.isFinite(n)) return;
                setPlan((p) => ({ ...p, alt: n }));
              }}
            />
          </label>
          <div className="mission-presets">
            <button type="button" disabled={!origin} onClick={onLoiter} title={t("Loiter here")}>
              {t("Loiter here")}
            </button>
            <button type="button" disabled={!origin} onClick={onNorth} title={t("{v} m", { v: leg })}>
              {t("North leg")}
            </button>
            <button type="button" disabled={!origin} onClick={onSquare} title={t("{v} m", { v: side })}>
              {t("Square")}
            </button>
          </div>
          <label className="mission-rtl">
            <input
              type="checkbox"
              checked={plan.finish === "rtl"}
              onChange={(ev) => setPlan((p) => ({ ...p, finish: ev.target.checked ? "rtl" : "loiter" }))}
            />
            {t("End with RTL")}
          </label>
          <div className="mission-pts-head">
            <b>{t("Waypoints")}</b>
            <button type="button" disabled={!plan.points.length} onClick={() => setPlan((p) => ({ ...p, points: [] }))}>
              {t("Clear points")}
            </button>
          </div>
          <ol className="mission-pts">
            {plan.points.map((p, i) => {
              const rel = origin ? toEnu(p.lat, p.lon, origin) : null;
              const live = pose.mode === "AUTO" && pose.wpSeq === i + 2;
              return (
                <li key={i} className={live ? "on" : undefined}>
                  <span>
                    {t("Waypoint {n}", { n: i + 1 })}
                    {rel ? ` · ${Math.round(rel.n)} N ${Math.round(rel.e)} E` : ""}
                  </span>
                  <button
                    type="button"
                    aria-label={t("Remove waypoint")}
                    onClick={() => setPlan((prev) => ({ ...prev, points: prev.points.filter((_, j) => j !== i) }))}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mission-hint">{t("Click the map to add a waypoint.")}</p>
          <ul className="mission-legend">
            <li><i className="swatch board" />{t("board")}</li>
            <li><i className="swatch gps" />{t("GPS fix")}</li>
            <li><i className="swatch truth" />{t("true position")}</li>
            <li><i className="swatch home" />{t("home")}</li>
          </ul>
          <button type="button" disabled={!pose.ok || busy} onClick={() => void onErase()}>
            {t("Erase mission")}
          </button>
          {noteText ? <p className={noteBad ? "mission-msg bad" : "mission-msg"}>{noteText}</p> : null}
          <p className="mission-hint">
            {t("Arm from the side, then AUTO. Jam and glitch sit on the simulation rail: the board follows the GPS fix, and truth is where the vehicle actually is.")}
          </p>
        </aside>
      </div>
    </section>
  );
}

function MapArt({
  view,
  w,
  h,
  route,
  points,
  finish,
  home,
  board,
  gps,
  truth,
  yaw,
  wpSeq,
}: {
  view: View;
  w: number;
  h: number;
  route: LatLon[];
  points: LatLon[];
  finish: Finish;
  home: LatLon | null;
  board: LatLon | null;
  gps: LatLon | null;
  truth: LatLon | null;
  yaw: number;
  wpSeq: number | null;
}) {
  const step = gridStep(view.mpp);
  const anchor = home ?? board ?? view;
  const o = toEnu(anchor.lat, anchor.lon, view);
  const halfE = (w / 2) * view.mpp;
  const halfN = (h / 2) * view.mpp;
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const e0 = Math.floor((-halfE - o.e) / step) * step;
  const e1 = halfE - o.e;
  for (let e = e0; e <= e1 && lines.length < 80; e += step) {
    const x = w / 2 + (o.e + e) / view.mpp;
    lines.push({ x1: x, y1: 0, x2: x, y2: h });
  }
  const n0 = Math.floor((-halfN - o.n) / step) * step;
  const n1 = halfN - o.n;
  for (let n = n0; n <= n1 && lines.length < 80; n += step) {
    const y = h / 2 - (o.n + n) / view.mpp;
    lines.push({ x1: 0, y1: y, x2: w, y2: y });
  }
  const xy = (p: LatLon) => project(p.lat, p.lon, view, w, h);
  const routePts = route.map(xy).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const boardTrail = trail.map((p) => xy(p)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const truthTrail = trail
    .filter((p) => p.truth)
    .map((p) => xy(p.truth as LatLon))
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const bar = Math.max(24, step / view.mpp);
  const boardAt = board ? xy(board) : null;
  const truthAt = truth ? xy(truth) : null;
  const gpsAt = gps ? xy(gps) : null;

  return (
    <>
      {lines.map((ln, i) => (
        <line key={i} x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2} stroke="#24303a" strokeWidth="1" />
      ))}
      <text x={w / 2} y={16} textAnchor="middle" fill="#8b98a8" fontSize="11">N</text>
      {truthTrail ? <polyline points={truthTrail} fill="none" stroke="#81c784" strokeWidth="1.5" opacity="0.8" /> : null}
      {boardTrail ? <polyline points={boardTrail} fill="none" stroke="#4fc3f7" strokeWidth="1.5" opacity="0.55" /> : null}
      {routePts ? <polyline points={routePts} fill="none" stroke="#e8eef4" strokeWidth="1.4" strokeDasharray="5 4" /> : null}
      {boardAt && truthAt && dist(board as LatLon, truth as LatLon) > 1 ? (
        <line x1={boardAt.x} y1={boardAt.y} x2={truthAt.x} y2={truthAt.y} stroke="#ef5350" strokeWidth="1.2" strokeDasharray="3 3" />
      ) : null}
      {boardAt && gpsAt && dist(board as LatLon, gps as LatLon) > 1 ? (
        <line x1={boardAt.x} y1={boardAt.y} x2={gpsAt.x} y2={gpsAt.y} stroke="#ffb74d" strokeWidth="1" strokeDasharray="2 3" />
      ) : null}
      {home ? <HomeMark at={xy(home)} hot={wpSeq === 0 || (finish === "rtl" && wpSeq === points.length + 2)} /> : null}
      {points.map((p, i) => {
        const at = xy(p);
        const hot = wpSeq === i + 2;
        const hold = finish === "loiter" && i === points.length - 1;
        return (
          <g key={i}>
            <circle cx={at.x} cy={at.y} r={hold ? 7 : 5} fill={hot ? "#4fc3f7" : "#e8eef4"} stroke={hold ? "#ffb74d" : "#101214"} strokeWidth="1.5" />
            <text x={at.x + 8} y={at.y - 6} fill="#8b98a8" fontSize="11">{i + 1}</text>
          </g>
        );
      })}
      {gpsAt ? <circle cx={gpsAt.x} cy={gpsAt.y} r="4" fill="#ffb74d" /> : null}
      {truthAt ? <circle cx={truthAt.x} cy={truthAt.y} r="6" fill="none" stroke="#81c784" strokeWidth="2" /> : null}
      {boardAt ? (
        <g transform={`translate(${boardAt.x} ${boardAt.y}) rotate(${yaw})`}>
          <polygon points="0,-9 6,7 -6,7" fill="#4fc3f7" />
        </g>
      ) : null}
      <line x1={w - 12 - bar} y1={h - 16} x2={w - 12} y2={h - 16} stroke="#e8eef4" strokeWidth="2" />
      <text x={w - 12 - bar} y={h - 20} fill="#8b98a8" fontSize="11">{step >= 1000 ? `${step / 1000} km` : `${step} m`}</text>
    </>
  );
}

function HomeMark({ at, hot }: { at: { x: number; y: number }; hot: boolean }) {
  const s = 5;
  return (
    <polygon
      points={`${at.x},${at.y - s} ${at.x + s},${at.y} ${at.x},${at.y + s} ${at.x - s},${at.y}`}
      fill={hot ? "#4fc3f7" : "#8b98a8"}
    />
  );
}
