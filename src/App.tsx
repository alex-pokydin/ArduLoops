import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { Aside, type LogRow } from "./components/Aside";
import { Cascade } from "./components/Cascade";
import { LabDialog } from "./components/LabDialog";
import { Loop } from "./components/Loop";
import { PlaneStub } from "./components/PlaneStub";
import { Scope } from "./components/Scope";
import { useT } from "./i18n/i18n";
import { addLog, setLogHandler } from "./log";
import { send } from "./mav/cmd";
import { loadLink, saveLink } from "./mav/link";
import {
  downloadParm,
  LAB_KEYS,
  loadLabSnapshot,
  pickLiveLab,
  runtimeLabParams,
  saveLabSnapshot,
} from "./mav/labInit";
import { type Axis } from "./mav/axis";
import { AxisSwitch } from "./components/AxisSwitch";
import { getSnapshot, isPaused, setPaused, startStream, subscribe } from "./mav/store";

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

function isIdleDetail(detail: string | undefined): boolean {
  return (
    detail === "відключено" ||
    detail === "немає лінку" ||
    detail === "Disconnected" ||
    detail === "No link"
  );
}

export function App() {
  const t = useT();
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [tab, setTab] = useState<"scope" | "map" | "loop">("scope");
  const [sel, setSel] = useState<string | null>("atc_rat");
  const [axis, setAxis] = useState<Axis>("roll");
  const [live3d, setLive3d] = useState(false);
  const [log, setLog] = useState<LogRow[]>([]);
  const [linkUrl, setLinkUrl] = useState(loadLink);
  const [labOpen, setLabOpen] = useState(false);
  const paused = isPaused();

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
      if (tag && /INPUT|TEXTAREA|BUTTON|SELECT/.test(tag)) return;
      ev.preventDefault();
      togglePause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused]);

  function togglePause() {
    const next = !isPaused();
    setPaused(next);
    addLog(next ? t("Plots paused") : t("Plots running"), "cmd");
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
    if (s.armed) {
      addLog(t("Init · disarm first"), "bad");
      return;
    }
    const vehicle = s.frame === "plane" ? "plane" : "copter";
    const params = runtimeLabParams(loadLabSnapshot(), vehicle);
    send({ op: "init", params });
    addLog(
      t("Init · {n} parameters · {vehicle} · reboot", {
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

  function onAxis(next: Axis) {
    setAxis(next);
    addLog(t("Axis · {axis}", { axis: t(next) }), "cmd");
  }

  function onLive3d(on: boolean) {
    setLive3d(on);
    addLog(on ? t("Model · 3D") : t("Model · one axis"), "cmd");
  }

  const hz = s.att_hz || 0;
  const linked = s.ok;
  const linkBad = !linked && !isIdleDetail(s.detail);
  const frameName = s.frame ? t(s.frame) : "";
  const linkHint = "tcpout:host:port, tcp:host:port, udpin:0.0.0.0:14550";

  return (
    <>
      <header>
        <h1>ArduLoops{frameName ? ` · ${frameName}` : ""}</h1>
        <p className="sub">
          {s.frame === "plane"
            ? t("The wing cascade is still a stub. RLL_ / PTCH_ / L1 / TECS will appear later.")
            : t("We want an angle. We don't command the angle — we command the rate that takes us there.")}
        </p>
        <div className="hdr-right">
          {linked ? (
            <div className="link on">
              <span className="status" title={s.detail || undefined}>
                <b>{t("Link")}</b>
                {hz ? ` · ATT ${hz} Hz` : ""}
              </span>
              <button type="button" onClick={onDisconnect} title={t("Disconnect")}>
                {t("Stop")}
              </button>
            </div>
          ) : (
            <form className="link" onSubmit={onLink}>
              <input
                className={linkBad ? "bad" : undefined}
                value={linkUrl}
                onChange={(ev) => setLinkUrl(ev.target.value)}
                spellCheck={false}
                aria-invalid={linkBad || undefined}
                aria-label="MAVLink"
                title={linkHint}
                placeholder="tcpout:127.0.0.1:5763"
              />
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
      <LabDialog
        open={labOpen}
        linked={linked}
        frame={s.frame}
        onClose={() => setLabOpen(false)}
        onInit={onLabInit}
        onSave={onLabSave}
      />
      <main>
        <section className="scope">
          <nav className="tabs" aria-label={t("View")}>
            <a
              href="#scope"
              className={tab === "scope" ? "on" : undefined}
              aria-current={tab === "scope" ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setTab("scope");
              }}
            >
              {t("Plot")}
            </a>
            <span className="sep" aria-hidden="true">
              ·
            </span>
            <a
              href="#map"
              className={tab === "map" ? "on" : undefined}
              aria-current={tab === "map" ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setTab("map");
              }}
            >
              {t("Cascade")}
            </a>
            <span className="sep" aria-hidden="true">
              ·
            </span>
            <a
              href="#loop"
              className={tab === "loop" ? "on" : undefined}
              aria-current={tab === "loop" ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setTab("loop");
              }}
            >
              {t("Loop")}
            </a>
            <AxisSwitch axis={axis} onAxis={onAxis} live3d={live3d} onLive3d={onLive3d} />
          </nav>
          {s.frame === "plane" && tab !== "scope" ? (
            <PlaneStub />
          ) : tab === "scope" ? (
            <Scope axis={axis} onPause={togglePause} />
          ) : tab === "map" ? (
            <Cascade sel={sel} onSel={setSel} axis={axis} />
          ) : (
            <Loop sel={sel} axis={axis} />
          )}
        </section>
        <Aside log={log} sel={sel} onSel={setSel} axis={axis} live3d={live3d} />
      </main>
    </>
  );
}
