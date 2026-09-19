import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n/i18n";
import type { Axis } from "../mav/axis";
import { createCraftView, type CraftView, type CraftViewCam } from "./craft3d";

const MSG_MS = 60_000;
const SEV = /^(EMERGENCY|ALERT|CRITICAL|ERROR|WARNING|NOTICE|INFO|DEBUG)\s+/i;

function msgTone(text: string): string {
  const sev = text.split(/\s/, 1)[0]?.toUpperCase();
  if (sev === "EMERGENCY" || sev === "ALERT" || sev === "CRITICAL" || sev === "ERROR") return "bad";
  if (sev === "WARNING") return "warn";
  return "";
}

type PlaneCam = "rear" | "side" | "top";

function viewCam(vehicle: "copter" | "plane", cam: PlaneCam, axis: Axis, live3d: boolean): CraftViewCam {
  if (live3d) return "iso";
  if (vehicle === "plane") return cam;
  if (axis === "pitch" || axis === "d") return "side";
  if (axis === "yaw") return "top";
  return "rear";
}

export function camStickAxis(cam: PlaneCam): Axis {
  if (cam === "side") return "pitch";
  if (cam === "top") return "yaw";
  return "roll";
}

export function Craft({
  roll,
  pitch,
  yaw,
  tarRoll,
  tarPitch,
  tarYaw,
  grounded,
  alt,
  altLabel,
  altClass,
  axis,
  live3d,
  status,
  vehicle = "copter",
  alive = true,
  onCam,
}: {
  roll: number;
  pitch: number;
  yaw: number;
  tarRoll: number;
  tarPitch: number;
  tarYaw: number;
  grounded: boolean;
  alt: number | null;
  altLabel: ReactNode;
  altClass: string;
  axis: Axis;
  live3d: boolean;
  status: string;
  vehicle?: "copter" | "plane";
  alive?: boolean;
  onCam?: (cam: PlaneCam) => void;
}) {
  const t = useT();
  const [cam, setCam] = useState<PlaneCam>("rear");
  const [ticker, setTicker] = useState("");
  const [overflow, setOverflow] = useState(0);
  const prevStatus = useRef<string | undefined>(undefined);
  const msgBox = useRef<HTMLDivElement>(null);
  const msgLine = useRef<HTMLSpanElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<CraftView | null>(null);
  const view = viewCam(vehicle, cam, axis, live3d);
  const [topish, setTopish] = useState(false);
  const top = topish;
  const aliveRef = useRef(alive);
  aliveRef.current = alive;

  useEffect(() => {
    onCam?.(cam);
  }, [cam, onCam]);

  useLayoutEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    const craft = createCraftView(canvas, { onBackdrop: setTopish });
    viewRef.current = craft;
    craft.setAlive(aliveRef.current);
    const host = canvas.parentElement ?? canvas;
    const ro = new ResizeObserver(() => craft.resize());
    ro.observe(host);
    craft.resize();
    return () => {
      ro.disconnect();
      craft.dispose();
      viewRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    viewRef.current?.setCam(view);
  }, [view]);

  useLayoutEffect(() => {
    const craft = viewRef.current;
    if (!craft) return;
    craft.setVehicle(vehicle);
    craft.setAlive(alive);
    craft.setGrounded(alive && grounded);
    if (alive) {
      craft.setPose({ roll, pitch, yaw }, { roll: tarRoll, pitch: tarPitch, yaw: tarYaw });
    } else {
      craft.setPose({ roll: 0, pitch: 0, yaw: 0 }, { roll: 0, pitch: 0, yaw: 0 });
    }
  }, [vehicle, alive, grounded, roll, pitch, yaw, tarRoll, tarPitch, tarYaw]);

  useEffect(() => {
    const next = status.trim();
    if (prevStatus.current === undefined) {
      prevStatus.current = next;
      return;
    }
    if (next === prevStatus.current) return;
    prevStatus.current = next;
    if (!next) return;
    setTicker(next);
    setOverflow(0);
    const hide = window.setTimeout(() => {
      setTicker("");
      setOverflow(0);
    }, MSG_MS);
    return () => window.clearTimeout(hide);
  }, [status]);
  useLayoutEffect(() => {
    const box = msgBox.current;
    const line = msgLine.current;
    if (!box || !line || !ticker) {
      setOverflow(0);
      return;
    }
    const extra = line.scrollWidth - box.clientWidth;
    setOverflow(extra > 2 ? extra : 0);
  }, [ticker]);

  const viewCap =
    live3d
      ? "3D"
      : axis === "d" && vehicle === "copter"
        ? t("side view · height")
        : view === "side"
          ? t("side view")
          : view === "top"
            ? t("top view")
            : t("rear view");
  const cap = !alive ? t("Idle") : grounded ? t("On the ground") : viewCap;
  return (
    <div className={[!alive ? "craft idle" : grounded ? "craft grounded" : "craft", top ? "top" : ""].filter(Boolean).join(" ")}>
      {vehicle === "plane" && alive ? (
        <div className="craft-cams" role="group" aria-label={t("Camera")}>
          {(["rear", "side", "top"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={cam === id ? "on" : undefined}
              aria-pressed={cam === id}
              title={
                id === "rear"
                  ? t("rear view")
                  : id === "side"
                    ? t("side view")
                    : t("top view")
              }
              onClick={() => {
                setCam(id);
                viewRef.current?.setCam(id);
              }}
            >
              {id === "rear" ? t("rear") : id === "side" ? t("side") : t("top")}
            </button>
          ))}
        </div>
      ) : (
        <span className="cap">{cap}</span>
      )}
      <div className="alt-read">
        <b>
          {alt == null || Number.isNaN(alt) ? "—" : alt.toFixed(1)}
          <em>{t("m")}</em>
        </b>
        <span className={altClass}>{altLabel}</span>
      </div>
      <div className="craft-bg">
        <svg viewBox="0 0 200 120" aria-hidden="true">
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={grounded ? "#4a2218" : "#173044"} />
              <stop offset="100%" stopColor={grounded ? "#5c3820" : "#1e3a4a"} />
            </linearGradient>
            <linearGradient id="gnd" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={grounded ? "#6b4a1e" : "#2a3326"} />
              <stop offset="100%" stopColor={grounded ? "#2a2014" : "#1b2018"} />
            </linearGradient>
          </defs>
          {top ? (
            <>
              <rect width="200" height="120" fill="#1b2018" />
              <line x1="100" y1="8" x2="100" y2="112" stroke="#2a3326" strokeWidth="1" />
              <line x1="8" y1="60" x2="192" y2="60" stroke="#2a3326" strokeWidth="1" />
              <text x="100" y="18" textAnchor="middle" fill="#6b7884" fontSize="9">
                N
              </text>
            </>
          ) : (
            <>
              <rect width="200" height="60" fill="url(#sky)" />
              <rect y="60" width="200" height="60" fill="url(#gnd)" />
              <line
                x1="6"
                y1="60"
                x2="194"
                y2="60"
                stroke={grounded ? "#ffb74d" : "#8b98a8"}
                strokeWidth={grounded ? 2 : 1}
                strokeDasharray={grounded ? undefined : "5 4"}
              />
            </>
          )}
        </svg>
        <canvas
          ref={glRef}
          className="craft-gl"
          tabIndex={0}
          title={t("Drag to orbit. Buttons snap the view.")}
          aria-label={t("Drag to orbit. Buttons snap the view.")}
        />
      </div>
      {ticker ? (
        <div
          ref={msgBox}
          className={["craft-msg", msgTone(ticker), overflow ? "scroll" : ""].filter(Boolean).join(" ")}
          title={ticker}
        >
          <span
            ref={msgLine}
            key={ticker}
            style={overflow ? { ["--shift" as string]: `-${overflow}px` } : undefined}
          >
            {SEV.test(ticker) ? ticker.replace(SEV, "") : ticker}
          </span>
        </div>
      ) : null}
    </div>
  );
}
