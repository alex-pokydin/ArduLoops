import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { tDetail, useT } from "../i18n/i18n";
import { formatLink, linkLabel, parseLink, type LinkKind } from "../mav/link";
import { useStorePicked } from "../mav/view";

type Frame = "copter" | "plane";
type ChipState = "off" | "wait" | "boot" | "bad" | "on" | "other";
export type SerialPort = { name: string; label: string };

export function isIdleDetail(detail: string | undefined): boolean {
  return (
    detail === "відключено" ||
    detail === "немає лінку" ||
    detail === "Disconnected" ||
    detail === "No link"
  );
}

export function isWaitDetail(detail: string | undefined): boolean {
  return /^чекаємо HEARTBEAT \(/i.test(detail || "") || /^Waiting HEARTBEAT \(/i.test(detail || "");
}

function isBootDetail(detail: string | undefined): boolean {
  return detail === "ребут…" || detail === "Rebooting…";
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

/** One or two words for the chip. The panel shows the whole bridge detail. */
function shortReason(detail: string, t: ReturnType<typeof useT>): string {
  if (/^(порт зайнятий|port in use) \(/i.test(detail)) return t("Port in use");
  if (/^(немає|No) HEARTBEAT \(/i.test(detail)) return t("No HEARTBEAT");
  if (/^(немає|No) MAVLink \(/i.test(detail)) return t("No MAVLink");
  if (detail.includes("ATTITUDE")) return t("No ATTITUDE");
  if (/USB/i.test(detail)) return t("USB busy");
  return tDetail(detail);
}

type Telemetry = { hz: number; got: number; total: number };

function sameTelemetry(a: Telemetry, b: Telemetry): boolean {
  return a.hz === b.hz && a.got === b.got && a.total === b.total;
}

export function LinkChip({
  linked,
  detail,
  rebooting,
  armed,
  live,
  shell,
  sitl,
  sourceKnown,
  kind,
  value,
  serialPorts,
  history,
  android,
  onKind,
  onValue,
  onRefreshPorts,
  onLink,
  onStop,
  onShowFrame,
}: {
  linked: boolean;
  detail: string;
  rebooting: boolean;
  armed: boolean;
  live: Frame | null;
  shell: "home" | Frame;
  sitl: boolean;
  sourceKnown: boolean;
  kind: LinkKind;
  value: string;
  serialPorts: SerialPort[];
  history: string[];
  android: boolean;
  onKind: (kind: LinkKind) => void;
  onValue: (value: string) => void;
  onRefreshPorts: () => void;
  onLink: (kind: LinkKind, value: string) => void;
  onStop: () => void;
  onShowFrame: (frame: Frame) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 48, right: 16 });
  const chip = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLButtonElement>(null);
  const tel = useStorePicked<Telemetry>(
    (s) => ({
      hz: s.ok ? s.att_hz || 0 : 0,
      got: s.ok ? Object.keys(s.params || {}).length : 0,
      total: s.ok ? s.param_count || 0 : 0,
    }),
    sameTelemetry,
  );

  const state: ChipState = linked
    ? live && shell !== "home" && shell !== live
      ? "other"
      : "on"
    : rebooting || isBootDetail(detail)
      ? "boot"
      : isWaitDetail(detail)
        ? "wait"
        : !detail || isIdleDetail(detail)
          ? "off"
          : "bad";
  const url = formatLink(kind, value);
  const [port, baud = "115200"] = value.split("@");
  const loading = linked && tel.total > 0 && tel.got < tel.total;
  const pct = loading ? Math.min(100, (100 * tel.got) / tel.total) : 0;
  const source = sourceKnown ? (sitl ? t("SITL") : t("board")) : null;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = chip.current?.getBoundingClientRect();
      if (box) setPos({ top: Math.round(box.bottom + 6), right: Math.max(8, Math.round(window.innerWidth - box.right)) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus({ preventScroll: true });
    const onDown = (ev: PointerEvent) => {
      const node = ev.target as Node;
      if (chip.current?.contains(node) || panel.current?.contains(node)) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      setOpen(false);
      main.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function connect(nextKind: LinkKind, nextValue: string) {
    onLink(nextKind, nextValue);
    setOpen(false);
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    connect(kind, value);
  }

  let label: ReactNode;
  let action: { text: string; run: () => void } | null = null;
  if (state === "on") {
    label = (
      <>
        {live ? <span className="lc-frame">{t(live)}</span> : null}
        {source ? <span className={sitl ? "lc-src sitl" : "lc-src board"}>{source}</span> : null}
        {tel.hz ? <span className="lc-hz">{tel.hz} Hz</span> : null}
        {!live && !source && !tel.hz ? <span>{t("Linked")}</span> : null}
      </>
    );
  } else if (state === "other" && live) {
    label = <span>{t("{frame} on link", { frame: t(live) })}</span>;
    action = { text: t("Show {frame}", { frame: t(live) }), run: () => onShowFrame(live) };
  } else if (state === "wait") {
    label = <span>{t("Waiting HEARTBEAT")}</span>;
  } else if (state === "boot") {
    label = <span>{t("Rebooting…")}</span>;
  } else if (state === "bad") {
    label = <span>{shortReason(detail, t)}</span>;
    action = { text: t("Retry"), run: () => onLink(kind, value) };
  } else {
    label = <span className="lc-url">{linkLabel(url)}</span>;
    action = { text: t("Link"), run: () => onLink(kind, value) };
  }

  const title =
    state === "on" || state === "other"
      ? t("Linked · {frame}", { frame: live ? t(live) : "MAVLink" })
      : state === "wait"
        ? t("Waiting for HEARTBEAT")
        : state === "boot"
          ? t("Rebooting…")
          : state === "bad"
            ? t("No link")
            : t("Not linked");
  const sub = state === "on" || state === "other" ? detail || url : state === "off" ? url : tDetail(detail);

  return (
    <>
      <div ref={chip} className={`lc ${state}${armed && linked ? " armed" : ""}${open ? " open" : ""}`}>
        <button
          ref={main}
          type="button"
          className="lc-main"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${t("Connection")}: ${title}`}
          title={sub}
          onClick={() => setOpen((on) => !on)}
        >
          {state === "wait" || state === "boot" ? <i className="lc-spin" aria-hidden="true" /> : <i className="lc-dot" aria-hidden="true" />}
          <span className="lc-text">{label}</span>
          <i className="lc-caret" aria-hidden="true" />
          {loading ? (
            <span
              className="lc-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={tel.total}
              aria-valuenow={tel.got}
              aria-label={t("Parameters {received} of {total}", { received: tel.got, total: tel.total })}
            >
              <span style={{ width: `${pct}%` }} />
            </span>
          ) : null}
        </button>
        {action ? (
          <button type="button" className="lc-act" onClick={action.run}>
            {action.text}
          </button>
        ) : null}
      </div>
      {open
        ? createPortal(
            <>
              <div className="lc-back" aria-hidden="true" onClick={() => setOpen(false)} />
              <div
                ref={panel}
                className={`lc-panel ${state}`}
                role="dialog"
                aria-label={t("Connection")}
                tabIndex={-1}
                style={{ "--lc-top": `${pos.top}px`, "--lc-right": `${pos.right}px` } as CSSProperties}
              >
                <i className="lc-grab" aria-hidden="true" />
                <div className="lc-head">
                  {state === "wait" || state === "boot" ? <i className="lc-spin" aria-hidden="true" /> : <i className="lc-dot" aria-hidden="true" />}
                  <div>
                    <b>
                      {title}
                      {armed && linked ? <span className="lc-armed"> · {t("armed")}</span> : null}
                    </b>
                    <span>{sub}</span>
                  </div>
                </div>
                {linked ? (
                  <div className="lc-tiles">
                    <div>
                      <span>{t("Source")}</span>
                      <b className={source ? (sitl ? "lc-src sitl" : "lc-src board") : undefined}>{source || "—"}</b>
                    </div>
                    <div>
                      <span>{t("Attitude")}</span>
                      <b>{tel.hz ? `${tel.hz} Hz` : "—"}</b>
                    </div>
                    <div>
                      <span>{t("Params")}</span>
                      <b>{tel.total ? (loading ? `${tel.got}/${tel.total}` : tel.total) : tel.got || "—"}</b>
                    </div>
                  </div>
                ) : null}
                {state === "other" && live ? (
                  <button type="button" className="lc-wide" onClick={() => { onShowFrame(live); setOpen(false); }}>
                    {t("Show {frame}", { frame: t(live) })}
                  </button>
                ) : null}
                <form className="lc-form" onSubmit={onSubmit}>
                  <div className="lc-row">
                    <select aria-label="MAVLink" value={kind} onChange={(ev) => onKind(ev.target.value as LinkKind)}>
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                      {android ? null : <option value="serial">SER</option>}
                    </select>
                    {kind === "serial" ? (
                      <>
                        <select
                          className="lc-port"
                          aria-label={t("Serial port")}
                          value={port}
                          onPointerDown={onRefreshPorts}
                          onFocus={onRefreshPorts}
                          onChange={(ev) => onValue(`${ev.target.value}@${baud}`)}
                        >
                          {(serialPorts.length ? serialPorts : [{ name: port, label: port || "—" }]).map((p) => (
                            <option key={p.name || "none"} value={p.name}>
                              {portChoice(p.name, p.label) || "—"}
                            </option>
                          ))}
                        </select>
                        <input
                          className="lc-baud"
                          value={baud}
                          onChange={(ev) => onValue(`${port}@${ev.target.value.replace(/\D/g, "")}`)}
                          inputMode="numeric"
                          aria-label={t("Baud")}
                          placeholder="115200"
                        />
                      </>
                    ) : (
                      <input
                        value={value}
                        onChange={(ev) => onValue(ev.target.value)}
                        spellCheck={false}
                        autoComplete="off"
                        aria-label={kind === "udp" ? t("UDP port or host:port") : t("TCP host:port")}
                        placeholder={kind === "udp" ? "14550" : "127.0.0.1:5760"}
                      />
                    )}
                  </div>
                  {history.length ? (
                    <div className="lc-recent">
                      <span>{t("Recent links")}</span>
                      <ul>
                        {history.map((u) => {
                          const on = linked && u === detail;
                          return (
                            <li key={u}>
                              <button
                                type="button"
                                aria-current={on || undefined}
                                onClick={() => {
                                  const parsed = parseLink(u);
                                  connect(parsed.kind, parsed.value);
                                }}
                              >
                                <span>{linkLabel(u)}</span>
                                {on ? <em>{t("current")}</em> : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                  <div className="lc-btns">
                    {state === "off" ? null : (
                      <button type="button" className="lc-stop" onClick={() => { onStop(); setOpen(false); }}>
                        {t("Stop")}
                      </button>
                    )}
                    <button type="submit" className="lc-go">
                      {state === "off" || state === "bad" ? t("Link") : t("Reconnect")}
                    </button>
                  </div>
                </form>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
