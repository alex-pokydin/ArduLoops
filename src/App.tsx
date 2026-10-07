import { useEffect, useRef, useState, type FormEvent } from "react";
import { type LogRow } from "./components/Aside";
import { Assistant } from "./components/Assistant";
import { LabDialog } from "./components/LabDialog";
import { SimRail } from "./components/SimRail";
import { CopterApp } from "./copter/App";
import { tDetail, useT } from "./i18n/i18n";
import { addLog, setLogHandler } from "./log";
import { send } from "./mav/cmd";
import { APP_HTTP, formatLink, linkLabel, loadLink, loadLinkHistory, parseLink, rememberLink, saveLink, type LinkKind } from "./mav/link";
import {
  downloadParm,
  LAB_KEYS,
  loadLabSnapshot,
  pickLiveLab,
  runtimeLabParams,
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
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0") +
    ":" +
    String(d.getSeconds()).padStart(2, "0")
  );
}

type Shell = "home" | "copter" | "plane";

type ShellFace = {
  ok: boolean;
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
    a.frame === b.frame &&
    a.detail === b.detail &&
    a.armed === b.armed &&
    a.sitl === b.sitl &&
    a.known === b.known &&
    a.initDone === b.initDone &&
    a.initTotal === b.initTotal
  );
}

function AttRate() {
  const text = useStorePicked((s) => {
    if (!s.ok || !s.att_hz) return "";
    const live = s.frame === "plane" || s.frame === "copter";
    const sitl = isSitl(s.params) || !!s.sitl_running;
    const known = sitl || Object.keys(s.params || {}).length > 0;
    return `${live || known ? " · " : ""}ATT ${s.att_hz} Hz`;
  });
  return text ? <>{text}</> : null;
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

function portChoice(name: string, label: string): string {
  const port = name.trim();
  let title = label.trim();
  const wrapped = `(${port})`;
  if (title.toLowerCase().endsWith(wrapped.toLowerCase())) {
    title = title.slice(0, title.length - wrapped.length).trim().replace(/[\s—-]+$/, "");
  } else if (title.toLowerCase().startsWith(port.toLowerCase())) {
    title = title.slice(port.length).replace(/^[\s—-]+/, "");
  }
  if (!title || title.toLowerCase() === port.toLowerCase()) return port;
  return `${port} — ${title}`;
}

function samePorts(a: SerialPort[], b: SerialPort[]): boolean {
  return a.length === b.length && a.every((port, i) => port.name === b[i]?.name && port.label === b[i]?.label);
}

function isIdleDetail(detail: string | undefined): boolean {
  return (
    detail === "відключено" ||
    detail === "немає лінку" ||
    detail === "Disconnected" ||
    detail === "No link"
  );
}

function isWaitDetail(detail: string | undefined): boolean {
  return /^чекаємо HEARTBEAT \(/i.test(detail || "") || /^Waiting HEARTBEAT \(/i.test(detail || "");
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
      onKeyDown={(ev) => {
        if (ev.code === "Space") ev.stopPropagation();
      }}
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
  const [linkMenu, setLinkMenu] = useState(false);
  const [portOpen, setPortOpen] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const [sitlOpen, setSitlOpen] = useState(false);
  const [pick, setPick] = useState<Shell | null>(() => frameFromUrl());
  const linkCombo = useRef<HTMLDivElement | null>(null);
  const refreshSerialPorts = useRef<() => void>(() => {});
  const paused = isPaused();
  const live: Shell | null = face.ok && (face.frame === "plane" || face.frame === "copter") ? face.frame : null;
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
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code !== "Space") return;
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag && /INPUT|TEXTAREA|BUTTON|SELECT|SUMMARY/.test(tag)) return;
      ev.preventDefault();
      togglePause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused]);

  useEffect(() => {
    const onPop = () => setPick(frameFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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

  useEffect(() => {
    if (!linkMenu && !portOpen) return;
    const onDoc = (ev: MouseEvent) => {
      if (!linkCombo.current?.contains(ev.target as Node)) {
        setLinkMenu(false);
        setPortOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setLinkMenu(false);
        setPortOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [linkMenu, portOpen]);

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

  function onLink(ev: FormEvent) {
    ev.preventDefault();
    applyLink(linkKind, linkValue);
  }

  function onDisconnect() {
    send({ op: "disconnect" });
    addLog(t("Link off"), "cmd");
  }

  function onLabInit() {
    const now = getLatest();
    if (!now.ok) return;
    if ((now.init_total || 0) > 0) return;
    if (now.armed) {
      addLog(t("Init · disarm first"), "bad");
      return;
    }
    const vehicle = now.frame === "plane" ? "plane" : "copter";
    const params = runtimeLabParams(vehicle);
    send({ op: "init", params });
    addLog(
      t("Init · {n} parameters · {vehicle}", {
        n: Object.keys(params).length,
        vehicle: t(vehicle),
      }),
      "cmd",
    );
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
  const linkBad = !linked && !isIdleDetail(face.detail) && !isWaitDetail(face.detail);
  const android = isAndroid();

  function onShell(next: Shell) {
    setPick(next);
    writeFrameUrl(next);
    addLog(next === "home" ? t("Home") : t(next), "cmd");
  }

  return (
    <div className={["app", android ? "android" : "", !android && sitlOpen ? "sitl-open" : ""].filter(Boolean).join(" ")}>
      {android ? null : (
      <div className="sitl-dock">
        <button
          type="button"
          className={sitlOpen ? "sitl-btn on" : "sitl-btn"}
          aria-pressed={sitlOpen}
          aria-expanded={sitlOpen}
          onClick={() => setSitlOpen((on) => !on)}
          title={t("Simulation")}
        >
          {t("SITL")}
        </button>
      </div>
      )}
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
          <button
            type="button"
            className={paused ? "pause-btn on" : "pause-btn"}
            aria-pressed={paused}
            onClick={togglePause}
            title={t("Space")}
          >
            {paused ? t("Resume") : t("Pause")}
          </button>
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
          {linked ? (
            <div className="link on">
              <span
                className="status"
                title={
                  [
                    face.detail,
                    live ? `HEARTBEAT ${live}` : null,
                    sourceKnown ? (sitl ? t("SITL") : t("board")) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
              >
                {live ? (
                  <button
                    type="button"
                    className={shell === live ? "frame-go on" : "frame-go"}
                    aria-current={shell === live ? "page" : undefined}
                    title={t("Show {frame}", { frame: t(live) })}
                    onClick={() => {
                      if (shell !== live) onShell(live);
                    }}
                  >
                    {t(live)}
                  </button>
                ) : null}
                {sourceKnown ? (
                  <span className="src-bit">
                    {live ? " · " : ""}
                    <span className={sitl ? "src sitl" : "src board"}>{sitl ? t("SITL") : t("board")}</span>
                  </span>
                ) : null}
                <AttRate />
              </span>
              <button type="button" onClick={onDisconnect} title={t("Disconnect")}>
                {t("Stop")}
              </button>
            </div>
          ) : (
            <form className="link" onSubmit={onLink}>
              <select
                className="link-kind"
                aria-label="MAVLink"
                value={linkKind}
                onChange={(ev) => {
                  const kind = ev.target.value as LinkKind;
                  setLinkKind(kind);
                  setLinkValue((cur) => {
                    if (kind === "udp") return /^\d+$/.test(cur) || cur.includes(".") ? cur : "14550";
                    if (kind === "serial") return cur.includes("@") ? cur : "@115200";
                    return cur.includes(":") && !cur.includes("@") ? cur : "127.0.0.1:5760";
                  });
                }}
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                {android ? null : <option value="serial">SER</option>}
              </select>
              <div className="link-combo" ref={linkCombo}>
                {linkKind === "serial" ? (
                  <>
                    <button
                      type="button"
                      className={portOpen ? "port-pick on" : "port-pick"}
                      aria-label="Serial port"
                      aria-haspopup="listbox"
                      aria-expanded={portOpen}
                      title={portChoice(linkValue.split("@")[0], serialPorts.find((port) => port.name === linkValue.split("@")[0])?.label || linkValue.split("@")[0])}
                      onPointerDown={() => refreshSerialPorts.current()}
                      onClick={() => { setLinkMenu(false); setPortOpen((open) => !open); }}
                    >
                      {linkValue.split("@")[0] || "—"}
                    </button>
                    {portOpen ? (
                      <ul className="link-menu port-menu" role="listbox" aria-label="Serial port">
                        {(serialPorts.length ? serialPorts : [{ name: linkValue.split("@")[0], label: linkValue.split("@")[0] }]).filter((port) => port.name).map((port) => {
                          const choice = portChoice(port.name, port.label);
                          const on = port.name === linkValue.split("@")[0];
                          return (
                            <li key={port.name} role="option" aria-selected={on}>
                              <button
                                type="button"
                                onClick={() => {
                                  setLinkValue(`${port.name}@${linkValue.split("@")[1] || "115200"}`);
                                  setPortOpen(false);
                                }}
                              >
                                {choice}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                    <input
                      className="baud"
                      value={linkValue.split("@")[1] || "115200"}
                      onChange={(ev) => setLinkValue(`${linkValue.split("@")[0]}@${ev.target.value.replace(/\D/g, "")}`)}
                      inputMode="numeric"
                      aria-label="Baud"
                      placeholder="115200"
                    />
                  </>
                ) : (
                <input
                  className={[linkKind === "udp" && !linkValue.includes(":") ? "port" : "", linkBad ? "bad" : ""].filter(Boolean).join(" ") || undefined}
                  value={linkValue}
                  onChange={(ev) => setLinkValue(ev.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={linkBad || undefined}
                  aria-label={linkKind === "udp" ? "UDP port or host:port" : "TCP host:port"}
                  placeholder={linkKind === "udp" ? "14550" : "127.0.0.1:5760"}
                />
                )}
                {linkHist.length ? (
                  <button
                    type="button"
                    className={linkMenu ? "link-hist on" : "link-hist"}
                    aria-label={t("Recent links")}
                    aria-expanded={linkMenu}
                    aria-haspopup="listbox"
                    title={t("Recent links")}
                    onClick={() => setLinkMenu((on) => !on)}
                  />
                ) : null}
                {linkMenu && linkHist.length ? (
                  <ul className="link-menu" role="listbox">
                    {linkHist.map((u) => (
                      <li key={u} role="option" aria-selected={formatLink(linkKind, linkValue) === u}>
                        <button
                          type="button"
                          onClick={() => {
                            const parsed = parseLink(u);
                            setLinkMenu(false);
                            applyLink(parsed.kind, parsed.value);
                          }}
                        >
                          {linkLabel(u)}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <button
                type="submit"
                className={isWaitDetail(face.detail) ? "link-go wait" : "link-go"}
                title={isWaitDetail(face.detail) ? tDetail(face.detail) : undefined}
                aria-busy={isWaitDetail(face.detail) || undefined}
              >
                <i className="link-spin" aria-hidden="true" />
                {t("Link")}
              </button>
            </form>
          )}
          <button
            type="button"
            className="lab-btn"
            onClick={() => setLabOpen(true)}
            title={t("Options")}
            aria-label={t("Options")}
          >
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
        frame={face.frame === "plane" || face.frame === "copter" ? face.frame : ""}
        initDone={initDone}
        initTotal={initTotal}
        onClose={() => setLabOpen(false)}
        onInit={onLabInit}
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
      <Assistant home={shell === "home"} onOpenOptions={() => setLabOpen(true)} onOpenHome={() => onShell("home")} />
    </div>
  );
}
