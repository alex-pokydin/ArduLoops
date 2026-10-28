import { useEffect, useRef, useState } from "react";
import { type LogRow } from "./components/Aside";
import { Assistant } from "./components/Assistant";
import { SetupStatusFeed } from "./components/HardwareSetup";
import { LinkChip } from "./components/LinkChip";
import { LabDialog, type AppRelease } from "./components/LabDialog";
import { StudioRecorder } from "./components/StudioRecorder";
import { SimRail } from "./components/SimRail";
import { CopterApp } from "./copter/App";
import { useT } from "./i18n/i18n";
import { externalPage, openExternal } from "./lib/open";
import { addLog, setLogHandler } from "./log";
import { send } from "./mav/cmd";
import { APP_HTTP, formatLink, loadLink, loadLinkHistory, parseLink, rememberLink, saveLink, type LinkKind } from "./mav/link";
import {
  downloadParm,
  LAB_KEYS,
  loadLabSnapshot,
  pickLiveLab,
  saveLabSnapshot,
} from "./mav/labInit";
import { isSitl } from "./mav/sim";
import { getLatest, isPaused, setPaused, startStream } from "./mav/store";
import { useStorePicked, VehicleView } from "./mav/view";
import type { Sample } from "./mav/types";
import { PlaneApp } from "./plane/App";

function stamp(): string {
  const d = new Date();
  return (
    String(d.getMinutes()).padStart(2, "0") +
    ":" +
    String(d.getSeconds()).padStart(2, "0")
  );
}

type Shell = "home" | "copter" | "plane";

type ShellFace = {
  ok: boolean;
  rebooting: boolean;
  frame: string;
  detail: string;
  armed: boolean;
  sitl: boolean;
  known: boolean;
  initDone: number;
  initTotal: number;
};

function shellFace(s: Sample): ShellFace {
  const sitl = isSitl(s.params) || !!s.sitl_running;
  return {
    ok: s.ok,
    rebooting: !!s.rebooting,
    frame: s.frame,
    detail: s.detail || "",
    armed: !!s.armed,
    sitl,
    known: sitl || Object.keys(s.params || {}).length > 0,
    initDone: s.init_done || 0,
    initTotal: s.init_total || 0,
  };
}

function sameFace(a: ShellFace, b: ShellFace): boolean {
  return (
    a.ok === b.ok &&
    a.rebooting === b.rebooting &&
    a.frame === b.frame &&
    a.detail === b.detail &&
    a.armed === b.armed &&
    a.sitl === b.sitl &&
    a.known === b.known &&
    a.initDone === b.initDone &&
    a.initTotal === b.initTotal
  );
}

const SHELLS: Shell[] = ["home", "copter", "plane"];

function frameFromUrl(): Shell | null {
  if (typeof window === "undefined") return null;
  const f = new URLSearchParams(window.location.search).get("frame");
  if (f === "copter" || f === "plane") return f;
  return null;
}

function writeFrameUrl(shell: Shell) {
  const u = new URL(window.location.href);
  if (shell === "home") u.searchParams.delete("frame");
  else u.searchParams.set("frame", shell);
  window.history.replaceState({}, "", u);
}

function homeHref(): string {
  const u = new URL(window.location.href);
  u.searchParams.delete("frame");
  return `${u.pathname}${u.search}${u.hash}`;
}

function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

function fetchAppRelease(refresh: boolean): Promise<AppRelease | null> {
  const q = refresh ? "?refresh=1" : "";
  return fetch(`${APP_HTTP}/app${q}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((body: AppRelease) => (body?.current ? body : null))
    .catch(() => null);
}

type SerialPort = { name: string; label: string };

function serialPortRows(rows: unknown): SerialPort[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (typeof row === "string" && row) return [{ name: row, label: row }];
    if (!row || typeof row !== "object") return [];
    const name = "name" in row && typeof row.name === "string" ? row.name : "";
    const label = "label" in row && typeof row.label === "string" && row.label ? row.label : name;
    return name ? [{ name, label }] : [];
  });
}

function samePorts(a: SerialPort[], b: SerialPort[]): boolean {
  return a.length === b.length && a.every((port, i) => port.name === b[i]?.name && port.label === b[i]?.label);
}

function ShellPicker({
  value,
  idle,
  title,
  onPick,
}: {
  value: Shell;
  idle: boolean;
  title: string;
  onPick: (next: Shell) => void;
}) {
  const t = useT();
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onPtr = (ev: PointerEvent) => {
      const el = box.current;
      if (!el?.open) return;
      if (ev.target instanceof Node && el.contains(ev.target)) return;
      el.open = false;
    };
    window.addEventListener("pointerdown", onPtr);
    return () => window.removeEventListener("pointerdown", onPtr);
  }, []);
  return (
    <details
      ref={box}
      className={idle ? "hdr-shell idle" : "hdr-shell"}
    >
      <summary aria-label={t("View")} title={title}>
        {value === "home" ? t("Home") : t(value)}
      </summary>
      <div className="hdr-shell-menu" role="listbox" aria-label={t("View")}>
        {SHELLS.map((v) => (
          <button
            key={v}
            type="button"
            role="option"
            aria-selected={value === v}
            className={value === v ? "on" : undefined}
            onClick={() => {
              onPick(v);
              if (box.current) box.current.open = false;
            }}
          >
            {v === "home" ? t("Home") : t(v)}
          </button>
        ))}
      </div>
    </details>
  );
}

export function App() {
  const t = useT();
  const face = useStorePicked(shellFace, sameFace);
  const [log, setLog] = useState<LogRow[]>([]);
  const [linkKind, setLinkKind] = useState<LinkKind>(() => parseLink(loadLink()).kind);
  const [linkValue, setLinkValue] = useState(() => parseLink(loadLink()).value);
  const [serialPorts, setSerialPorts] = useState<{ name: string; label: string }[]>([]);
  const [linkHist, setLinkHist] = useState(loadLinkHistory);
  const [labOpen, setLabOpen] = useState(false);
  const [sitlOpen, setSitlOpen] = useState(false);
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [pick, setPick] = useState<Shell | null>(() => frameFromUrl());
  const refreshSerialPorts = useRef<() => void>(() => {});
  const paused = isPaused();
  const lastLive = useRef<Shell | null>(null);
  const seen: Shell | null = face.ok && (face.frame === "plane" || face.frame === "copter") ? face.frame : null;
  if (seen) lastLive.current = seen;
  // A reboot this app sent drops the link for a few seconds. Keep the screen until the board is back.
  const live: Shell | null = seen ?? (face.rebooting ? lastLive.current : null);
  const shell: Shell = pick ?? live ?? "home";
  const plane = shell === "plane";
  const shellAlive = shell !== "home" && live === shell;

  useEffect(() => {
    setLogHandler((msg, kind) => {
      setLog((rows) => {
        const next = [...rows, { t: stamp(), msg, kind: kind || "dim" }];
        return next.length > 80 ? next.slice(-80) : next;
      });
    });
    return startStream();
  }, []);

  useEffect(() => {
    const onPop = () => setPick(frameFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const node = ev.target;
      if (!(node instanceof Element)) return;
      const link = node.closest("a");
      const href = link?.href || "";
      if (!link || !externalPage(href)) return;
      ev.preventDefault();
      openExternal(href);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    let stopped = false;
    const load = (refresh: boolean) => {
      void fetchAppRelease(refresh).then((body) => {
        if (!stopped && body) setRelease(body);
      });
    };
    load(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load(false);
    }, 6 * 60 * 60 * 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!labOpen) return;
    let stopped = false;
    const load = (refresh: boolean) => {
      void fetchAppRelease(refresh).then((body) => {
        if (!stopped && body) setRelease(body);
      });
    };
    load(true);
    const timer = window.setInterval(() => load(false), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [labOpen]);

  useEffect(() => {
    if (linkKind !== "serial" || isAndroid()) return;
    let stopped = false;
    let flight = false;
    let again = false;
    const load = () => {
      if (stopped) return;
      if (flight) {
        again = true;
        return;
      }
      flight = true;
      void fetch(`${APP_HTTP}/ports`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((rows: unknown) => {
          if (stopped) return;
          const ports = serialPortRows(rows);
          setSerialPorts((prev) => (samePorts(prev, ports) ? prev : ports));
          setLinkValue((cur) => {
            const [name, baud = "115200"] = cur.split("@");
            if (name && ports.some((p) => p.name === name)) return cur;
            return ports[0] ? `${ports[0].name}@${baud || "115200"}` : cur;
          });
        })
        .catch(() => {})
        .finally(() => {
          flight = false;
          if (again && !stopped) {
            again = false;
            load();
          }
        });
    };
    refreshSerialPorts.current = load;
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 2000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      refreshSerialPorts.current = () => {};
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [linkKind]);

  useEffect(() => {
    if (!face.ok) return;
    const url = face.detail.trim();
    if (!/^(tcpout|tcp:|udp)/i.test(url)) return;
    setLinkHist(rememberLink(url));
    const parsed = parseLink(url);
    setLinkKind(parsed.kind);
    setLinkValue(parsed.value);
  }, [face.ok, face.detail]);

  function togglePause() {
    const next = !isPaused();
    setPaused(next);
    addLog(next ? t("Display paused") : t("Display running"), "cmd");
  }

  function applyLink(kind: LinkKind, value: string) {
    const url = formatLink(kind, value);
    if (kind === "serial" && !value.split("@")[0]) return;
    setLinkKind(kind);
    setLinkValue(parseLink(url).value);
    saveLink(url);
    send({ op: "connect", url });
    addLog(t("Link {url}", { url }), "cmd");
  }

  function onLinkKind(kind: LinkKind) {
    setLinkKind(kind);
    setLinkValue((cur) => {
      if (kind === "udp") return /^\d+$/.test(cur) || cur.includes(".") ? cur : "14550";
      if (kind === "serial") return cur.includes("@") ? cur : "@115200";
      return cur.includes(":") && !cur.includes("@") ? cur : "127.0.0.1:5760";
    });
  }

  function onDisconnect() {
    send({ op: "disconnect" });
    addLog(t("Link off"), "cmd");
  }

  function onLabSave() {
    const now = getLatest();
    if (!now.ok) return;
    const live = pickLiveLab(now.params);
    const n = Object.keys(live).length;
    if (n < 8) {
      addLog(t("Export · parameters have not arrived yet, wait"), "bad");
      return;
    }
    const next = { ...loadLabSnapshot(), ...live };
    saveLabSnapshot(next);
    downloadParm(next);
    addLog(t("Stand · wrote {n} of {total}", { n, total: LAB_KEYS.length }), "ok");
  }

  const linked = face.ok;
  const sitl = face.sitl;
  const sourceKnown = face.known;
  const initDone = face.initDone;
  const initTotal = face.initTotal;
  const initPct = initTotal > 0 ? Math.min(100, Math.round((100 * initDone) / initTotal)) : 0;
  const android = isAndroid();

  function onShell(next: Shell) {
    setPick(next);
    writeFrameUrl(next);
    addLog(next === "home" ? t("Home") : t(next), "cmd");
  }

  return (
    <div className={["app", android ? "android" : "", !android && sitlOpen ? "sitl-open" : ""].filter(Boolean).join(" ")}>
      {android ? null : (
      <SimRail
        open={sitlOpen}
        onSitlLink={(url) => {
          const parsed = parseLink(url);
          setLinkKind(parsed.kind);
          setLinkValue(parsed.value);
          saveLink(url);
        }}
      />
      )}
      <header>
        {android ? null : (
          <button
            type="button"
            className={sitlOpen ? "sitl-btn on" : "sitl-btn"}
            aria-pressed={sitlOpen}
            aria-expanded={sitlOpen}
            onClick={() => setSitlOpen((on) => !on)}
            title={t("Simulation")}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
            {t("SITL")}
            {linked && sitl ? <i className="sitl-live" aria-hidden="true" /> : null}
          </button>
        )}
        <div className="hdr-title">
          <h1>
            <a
              className="hdr-brand"
              href={homeHref()}
              aria-current={shell === "home" ? "page" : undefined}
              title={t("Home")}
              onClick={(ev) => {
                if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
                ev.preventDefault();
                if (shell !== "home") onShell("home");
              }}
            >
              <img className="hdr-mark" src="/app-icon.png" alt="" />
              <span className="hdr-name">ArduLoops</span>
            </a>
            <span className="hdr-dot" aria-hidden="true">·</span>
            <ShellPicker
              value={shell}
              idle={!(shellAlive || shell === "home")}
              title={
                shell === "home"
                  ? t("View")
                  : shellAlive
                    ? t("View")
                    : t("Idle · this frame is not on the link")
              }
              onPick={onShell}
            />
          </h1>
        </div>
        <p className="sub">
          {shell === "home"
            ? t("Link a vehicle. HEARTBEAT picks copter or plane. The wiki is the protocol — this stand shows the loops.")
            : !shellAlive
              ? plane
                ? t("No plane on this link. Grey until HEARTBEAT says plane.")
                : t("No copter on this link. Grey until HEARTBEAT says copter.")
              : plane
                ? t("We want an angle. The stick does not move the servo — FF does, scaled by airspeed.")
                : t("We want an angle. We don't command the angle — we command the rate that takes us there.")}
        </p>
        <div className="hdr-right">
          <LinkChip
            linked={linked}
            detail={face.detail}
            rebooting={face.rebooting}
            armed={face.armed}
            live={live === "home" ? null : live}
            shell={shell}
            sitl={sitl}
            sourceKnown={sourceKnown}
            kind={linkKind}
            value={linkValue}
            serialPorts={serialPorts}
            history={linkHist}
            android={android}
            onKind={onLinkKind}
            onValue={setLinkValue}
            onRefreshPorts={() => refreshSerialPorts.current()}
            onLink={applyLink}
            onStop={onDisconnect}
            onShowFrame={(frame) => {
              if (shell !== frame) onShell(frame);
            }}
          />
          {linked ? (
            <button
              type="button"
              className={paused ? "pause-btn on" : "pause-btn"}
              aria-pressed={paused}
              aria-label={paused ? t("Resume") : t("Pause")}
              title={paused ? t("Resume") : t("Pause")}
              onClick={togglePause}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                {paused ? (
                  <path fill="currentColor" d="M7 5l12 7-12 7z" />
                ) : (
                  <path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z" />
                )}
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className="lab-btn"
            onClick={() => setLabOpen(true)}
            title={release?.newer ? t("Options, update available") : t("Options")}
            aria-label={release?.newer ? t("Options, update available") : t("Options")}
          >
            {release?.newer ? <i className="lab-upd" aria-hidden="true" /> : null}
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54A.49.49 0 0 0 14.9 2h-3.8a.49.49 0 0 0-.48.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L3.74 8.48a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.39.3.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.25.42.48.42h3.8c.24 0 .44-.18.48-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
              />
            </svg>
          </button>
        </div>
      </header>
      {initTotal > 0 ? (
        <div className="init-strip" role="progressbar" aria-valuemin={0} aria-valuemax={initTotal} aria-valuenow={initDone}>
          <i style={{ width: `${initPct}%` }} />
        </div>
      ) : null}
      <LabDialog
        open={labOpen}
        linked={linked}
        release={release}
        onClose={() => setLabOpen(false)}
        onSave={onLabSave}
      />
          {shell === "home" ? null : plane ? (
        <VehicleView vehicle="plane">
          <PlaneApp log={log} />
        </VehicleView>
      ) : (
        <VehicleView vehicle="copter">
          <CopterApp log={log} />
        </VehicleView>
      )}
      {/* The Setup verdicts for setup_status, from the vehicle on the link, whatever the user is looking at. */}
      <VehicleView vehicle={live === "plane" ? "plane" : "copter"}>
        <SetupStatusFeed />
      </VehicleView>
      <Assistant home={shell === "home"} onOpenOptions={() => setLabOpen(true)} onOpenHome={() => onShell("home")} />
      {import.meta.env.DEV && <StudioRecorder />}
    </div>
  );
}
