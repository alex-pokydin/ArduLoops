import standCopter from "./stand-copter.parm?raw";
import standPlane from "./stand-plane.parm?raw";

/** Stock stand dump + lab overlay. No sensor IDs. */
export function parseParmFile(
  text: string,
  allow?: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const parts = line.split(/[,\s=]+/);
    if (parts.length < 2) continue;
    const name = parts[0];
    const val = Number(parts[1]);
    if (!name || !Number.isFinite(val)) continue;
    if (allow && allow[name] == null) continue;
    out[name] = val;
  }
  return out;
}

export const COPTER_STAND = parseParmFile(standCopter);
export const PLANE_STAND = parseParmFile(standPlane);
export const LAB_INIT = COPTER_STAND;
export const LAB_KEYS = [
  ...new Set([...Object.keys(COPTER_STAND), ...Object.keys(PLANE_STAND)]),
];

/** Init writes the stand dump. Frame applies live (no reboot). */
export function runtimeLabParams(
  frame: "copter" | "plane" | "" = "copter",
): Record<string, number> {
  return { ...(frame === "plane" ? PLANE_STAND : COPTER_STAND) };
}

const STORE = "arduloops.lab-init";

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return "0";
  if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
  return String(Number(v.toPrecision(7)));
}

export function formatParm(params: Record<string, number>): string {
  const lines = [
    "# ArduLoops · stand (stock copter.parm + lab overlay)",
    "# Init writes this dump. FRAME_CLASS applies live (no reboot).",
    "",
  ];
  for (const key of LAB_KEYS) {
    if (params[key] == null || !Number.isFinite(params[key])) continue;
    lines.push(key.padEnd(16) + " " + fmtNum(params[key]));
  }
  return lines.join("\n") + "\n";
}

export function parseParm(text: string): Record<string, number> {
  const allow: Record<string, number> = {};
  for (const key of LAB_KEYS) allow[key] = 1;
  return parseParmFile(text, allow);
}

export function loadLabSnapshot(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return { ...LAB_INIT };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const extra: Record<string, number> = {};
    for (const key of LAB_KEYS) {
      const v = Number(parsed[key]);
      if (Number.isFinite(v)) extra[key] = v;
    }
    return { ...LAB_INIT, ...extra };
  } catch {
    return { ...LAB_INIT };
  }
}

export function saveLabSnapshot(params: Record<string, number>): void {
  localStorage.setItem(STORE, JSON.stringify(params));
}

export function downloadParm(params: Record<string, number>): void {
  const blob = new Blob([formatParm(params)], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "arduloops-lab.parm";
  a.click();
  URL.revokeObjectURL(a.href);
}

export function pickLiveLab(
  live: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!live) return out;
  for (const key of LAB_KEYS) {
    const v = live[key];
    if (v != null && Number.isFinite(v)) out[key] = v;
  }
  return out;
}
