import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { Aside, type LogRow } from "./components/Aside";
import { Cascade } from "./components/Cascade";
import { Loop } from "./components/Loop";
import { PlaneStub } from "./components/PlaneStub";
import { Scope } from "./components/Scope";
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
import { axisLabel, type Axis } from "./mav/axis";
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

export function App() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [tab, setTab] = useState<"scope" | "map" | "loop">("scope");
  const [sel, setSel] = useState<string | null>("atc_rat");
  const [axis, setAxis] = useState<Axis>("roll");
  const [live3d, setLive3d] = useState(false);
  const [log, setLog] = useState<LogRow[]>([]);
  const [linkUrl, setLinkUrl] = useState(loadLink);
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
    addLog(next ? "графіки на паузі" : "графіки далі", "cmd");
  }

  function onLink(ev: FormEvent) {
    ev.preventDefault();
    const url = linkUrl.trim();
    saveLink(url);
    send({ op: "connect", url });
    addLog("лінк " + url, "cmd");
  }

  function onDisconnect() {
    send({ op: "disconnect" });
    addLog("лінк вимкнено", "cmd");
  }

  function onLabInit() {
    if (!linked) return;
    if (s.armed) {
      addLog("ініт · спочатку disarm", "bad");
      return;
    }
    if (s.frame === "plane") {
      addLog("ініт · лише коптер", "bad");
      return;
    }
    const params = runtimeLabParams(loadLabSnapshot());
    send({ op: "init", params });
    addLog(
      "ініт · " + Object.keys(params).length + " параметрів · Quad X + INS · ребут",
      "cmd",
    );
  }

  function onLabSave() {
    if (!linked) return;
    const live = pickLiveLab(s.params);
    const n = Object.keys(live).length;
    if (n < 8) {
      addLog("запис · параметри ще не прийшли, зачекайте", "bad");
      return;
    }
    const next = { ...loadLabSnapshot(), ...live };
    saveLabSnapshot(next);
    downloadParm(next);
    addLog("стандарт · записано " + n + " з " + LAB_KEYS.length, "ok");
  }

  function onAxis(next: Axis) {
    setAxis(next);
    addLog("вісь · " + axisLabel(next), "cmd");
  }

  function onLive3d(on: boolean) {
    setLive3d(on);
    addLog(on ? "модель · 3D" : "модель · одна вісь", "cmd");
  }

  const hz = s.att_hz || 0;
  const linked = s.ok;
  const idle = !linked && (s.detail === "відключено" || s.detail === "немає лінку");
  const banner = linked ? !hz : !idle;

  return (
    <>
      <header>
        <h1>ArduLoops{s.frame ? ` · ${s.frame}` : ""}</h1>
        <p className="sub">
          {s.frame === "plane"
            ? "Каскад крила ще заглушка. RLL_ / PTCH_ / L1 / TECS з’являться пізніше."
            : "Хочемо кут. Керуємо не кутом, а швидкістю, якою туди крутимось."}
        </p>
        <div className="hdr-right">
          {linked ? (
            <div className="link on">
              <span className="status" title={s.detail || undefined}>
                <b>лінк</b>
                {hz ? ` · ATT ${hz} Hz` : ""}
              </span>
              <button type="button" onClick={onDisconnect} title="Від’єднати">
                стоп
              </button>
            </div>
          ) : (
            <form className="link" onSubmit={onLink}>
              <input
                value={linkUrl}
                onChange={(ev) => setLinkUrl(ev.target.value)}
                spellCheck={false}
                aria-label="MAVLink"
                title="tcpout:host:port, tcp:host:port, udpin:0.0.0.0:14550"
                placeholder="tcpout:127.0.0.1:5763"
              />
              <button type="submit">лінк</button>
            </form>
          )}
          <div className="lab-btns">
            <button
              type="button"
              disabled={!linked}
              onClick={onLabInit}
              title="Застосувати стандарт лаби і ребутнути автопілот (MAVLink). Лінк коротко впаде."
            >
              ініт
            </button>
            <button
              type="button"
              disabled={!linked}
              onClick={onLabSave}
              title="Записати поточні параметри як стандарт лаби і зберегти .parm"
            >
              запис
            </button>
          </div>
        </div>
      </header>
      <div className={banner ? "banner show" : "banner"}>
        {linked
          ? "Лінк є, але кут не надходить (ATT 0 Hz). Графік плоский, поки SITL не надсилає ATTITUDE."
          : "Немає MAVLink: " + (s.detail || "SITL не знайдено") + ". Перевірте адресу й симуляцію."}
      </div>
      <main>
        <section className="scope">
          <nav className="tabs" aria-label="вид">
            <a
              href="#scope"
              className={tab === "scope" ? "on" : undefined}
              aria-current={tab === "scope" ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setTab("scope");
              }}
            >
              графік
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
              каскад
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
              контур
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
