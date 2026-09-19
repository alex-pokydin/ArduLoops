import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { type LogRow } from "./components/Aside";
import { Disconnected } from "./components/Disconnected";
import { LabDialog } from "./components/LabDialog";
import { SimRail } from "./components/SimRail";
import { CopterApp } from "./copter/App";
import { tDetail, useT } from "./i18n/i18n";
import { addLog, setLogHandler } from "./log";
import { send } from "./mav/cmd";
import { loadLink, loadLinkHistory, rememberLink, saveLink } from "./mav/link";
import {
  downloadParm,
  LAB_KEYS,
  loadLabSnapshot,
  pickLiveLab,
  runtimeLabParams,
  saveLabSnapshot,
} from "./mav/labInit";
import { isSitl } from "./mav/sim";
import { getSnapshot, isPaused, setPaused, startStream, subscribe } from "./mav/store";
import { VehicleView } from "./mav/view";
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
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [log, setLog] = useState<LogRow[]>([]);
  const [linkUrl, setLinkUrl] = useState(loadLink);
  const [linkHist, setLinkHist] = useState(loadLinkHistory);
  const [linkMenu, setLinkMenu] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const [sitlOpen, setSitlOpen] = useState(false);
  const [pick, setPick] = useState<Shell | null>(() => frameFromUrl());
  const linkCombo = useRef<HTMLDivElement | null>(null);
  const paused = isPaused();
  const live: Shell | null = s.ok && (s.frame === "plane" || s.frame === "copter") ? s.frame : null;
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
    if (!s.ok) return;
    const url = (s.detail || "").trim();
    if (!/^(tcpout|tcp:|udp)/i.test(url)) return;
    setLinkHist(rememberLink(url));
    setLinkUrl((prev) => (prev === url ? prev : url));
  }, [s.ok, s.detail]);

  useEffect(() => {
    if (!linkMenu) return;
    const onDoc = (ev: MouseEvent) => {
      if (!linkCombo.current?.contains(ev.target as Node)) setLinkMenu(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setLinkMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [linkMenu]);

  function togglePause() {
    const next = !isPaused();
    setPaused(next);
    addLog(next ? t("Display paused") : t("Display running"), "cmd");
  }

  function onLink(ev: FormEvent) {
    ev.preventDefault();
    const url = linkUrl.trim();
    saveLink(url);
    send({ op: "connect", url });
    addLog(t("Link {url}", { url }), "cmd");
  }

  function onDisconnect() {
    send({ op: "disconnect" });
    addLog(t("Link off"), "cmd");
  }

  function onLabInit() {
    if (!linked) return;
    if ((s.init_total || 0) > 0) return;
    if (s.armed) {
      addLog(t("Init · disarm first"), "bad");
      return;
    }
    const vehicle = s.frame === "plane" ? "plane" : "copter";
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
    if (!linked) return;
    const live = pickLiveLab(s.params);
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

  const hz = s.att_hz || 0;
  const linked = s.ok;
  const sitl = isSitl(s.params) || !!s.sitl_running;
  const sourceKnown = sitl || Object.keys(s.params || {}).length > 0;
  const initDone = s.init_done || 0;
  const initTotal = s.init_total || 0;
  const initPct = initTotal > 0 ? Math.min(100, Math.round((100 * initDone) / initTotal)) : 0;
  const linkWait = isWaitDetail(s.detail);
  const linkBad = !linked && !isIdleDetail(s.detail) && !linkWait;
  const linkHint = "tcpout:host:port, tcp:host:port, udpin:0.0.0.0:14550, udpout:host:port";

  function onShell(next: Shell) {
    setPick(next);
    writeFrameUrl(next);
    addLog(next === "home" ? t("Home") : t(next), "cmd");
  }

  return (
    <div className={sitlOpen ? "app sitl-open" : "app"}>
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
      <SimRail
        sample={s}
        open={sitlOpen}
        onSitlLink={(url) => {
          setLinkUrl(url);
          saveLink(url);
        }}
      />
      <header>
        <div className="hdr-title">
          <h1>
            ArduLoops
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
                    s.detail,
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
                  <>
                    {live ? " · " : ""}
                    <span className={sitl ? "src sitl" : "src board"}>{sitl ? t("SITL") : t("board")}</span>
                  </>
                ) : null}
                {hz ? `${live || sourceKnown ? " · " : ""}ATT ${hz} Hz` : ""}
              </span>
              <button type="button" onClick={onDisconnect} title={t("Disconnect")}>
                {t("Stop")}
              </button>
            </div>
          ) : (
            <form className="link" onSubmit={onLink}>
              <div className="link-combo" ref={linkCombo}>
                <input
                  className={linkBad ? "bad" : undefined}
                  value={linkUrl}
                  onChange={(ev) => setLinkUrl(ev.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={linkBad || undefined}
                  aria-label="MAVLink"
                  title={linkBad || linkWait ? tDetail(s.detail) : linkHint}
                  placeholder="tcpout:127.0.0.1:5763"
                />
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
                      <li key={u} role="option" aria-selected={u === linkUrl}>
                        <button
                          type="button"
                          onClick={() => {
                            setLinkUrl(u);
                            setLinkMenu(false);
                          }}
                        >
                          {u}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <button type="submit">{t("Link")}</button>
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
        frame={s.frame}
        initDone={initDone}
        initTotal={initTotal}
        onClose={() => setLabOpen(false)}
        onInit={onLabInit}
        onSave={onLabSave}
      />
          {shell === "home" ? (
        <Disconnected />
      ) : plane ? (
        <VehicleView vehicle="plane">
          <PlaneApp log={log} />
        </VehicleView>
      ) : (
        <VehicleView vehicle="copter">
          <CopterApp log={log} />
        </VehicleView>
      )}
    </div>
  );
}
