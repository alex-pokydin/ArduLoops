import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n/i18n";
import type { NodeDef } from "../lib/gains";
import { CUSTOM_ID, ROLE_CLASS, TONE, traceId, traceValue, type CatalogTrace, type Pane } from "../lib/traces";
import { getBuffer, getPlotSpan, isPaused, subscribe } from "../mav/store";
import type { Sample } from "../mav/types";
import { usePicked, useStorePicked, useVehicle, viewBuffer } from "../mav/view";
import { drawPane } from "../plot";
import { PaneHead } from "./Studio";

function digits(unit: string): number {
  if (unit.includes("%")) return 0;
  if (unit.includes("°/s") || unit.includes("m/s")) return 2;
  return 2;
}

function fmt(v: unknown, d: number): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "—";
  return v.toFixed(d);
}

function LegVal({ read, d, unit }: { read: (s: Sample) => number | null; d: number; unit?: string }) {
  const v = usePicked(read);
  return (
    <b className="leg-val">
      {fmt(v, d)}
      {unit ? ` ${unit}` : ""}
    </b>
  );
}

function useLegendFit(ref: { current: HTMLDivElement | null }) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const contentW = () => {
      const kids = el.children;
      if (!kids.length) return 0;
      const a = kids[0].getBoundingClientRect();
      const b = kids[kids.length - 1].getBoundingClientRect();
      return b.right - a.left;
    };
    const measure = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      el.dataset.fit = "full";
      if (contentW() <= w + 1) return;
      el.dataset.fit = "value";
      if (contentW() <= w + 1) return;
      el.dataset.fit = "dot";
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [ref]);
}

export function TracePanes({
  panes,
  blocks,
  checked,
  near,
  onToggle,
  catalog,
  customLines,
  onToggleLine,
}: {
  panes: Pane[];
  blocks: NodeDef[];
  checked: string[];
  near: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  catalog: CatalogTrace[];
  customLines: string[];
  onToggleLine: (id: string, on: boolean) => void;
}) {
  const t = useT();
  const vehicle = useVehicle();
  const refs = useRef<Array<HTMLCanvasElement | null>>([]);
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const paused = isPaused();
  const span = useSyncExternalStore(subscribe, getPlotSpan, getPlotSpan);
  const frozen = !usePicked((s) => s.ok);

  useEffect(() => {
    const pull = () => viewBuffer(vehicle);
    const paint = () => {
      const buf = pull();
      panesRef.current.forEach((pane, i) => {
        const c = refs.current[i];
        const ctx = c?.getContext("2d");
        if (c && ctx) drawPane(c, ctx, buf, pane);
      });
    };
    if (frozen) {
      paint();
      const onResize = () => paint();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      paint();
    };
    loop();
    const onResize = () => paint();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [vehicle, frozen, panes.length, span]);

  if (!panes.length) {
    return (
      <>
        <PaneHead>
          <WatchPicker blocks={blocks} checked={checked} near={near} panes={panes} onToggle={onToggle} />
        </PaneHead>
        <p className="tune-empty">{t("This block has no live MAVLink trace on the stand yet.")}</p>
      </>
    );
  }

  return (
    <>
      <PaneHead>
        <WatchPicker blocks={blocks} checked={checked} near={near} panes={panes} onToggle={onToggle} />
      </PaneHead>
    <div className="plots">
      {panes.map((pane, i) => (
        <PaneBlock
          key={pane.custom ? "custom" : (pane.fromIds?.join("+") || pane.title) + pane.traces.map((tr) => traceId(tr)).join(",")}
          pane={pane}
          blocks={blocks}
          frozen={frozen}
          paused={paused}
          lines={
            pane.custom
              ? { catalog, picked: customLines, onToggle: onToggleLine }
              : undefined
          }
          canvasRef={(el) => {
            refs.current[i] = el;
          }}
        />
      ))}
    </div>
    </>
  );
}

function cardTitle(blocks: NodeDef[], id: string, t: (k: string) => string): string {
  const n = blocks.find((b) => b.id === id);
  return t(n?.title ?? id);
}

function WatchPicker({
  blocks,
  checked,
  near,
  panes,
  onToggle,
}: {
  blocks: NodeDef[];
  checked: string[];
  near: Set<string>;
  panes: Pane[];
  onToggle: (id: string, on: boolean) => void;
}) {
  const t = useT();
  const box = useRef<HTMLDetailsElement>(null);
  const customOn = checked.includes(CUSTOM_ID);
  const ids = checked.filter((id) => id !== CUSTOM_ID);
  const n = ids.length;
  const plots = panes.filter((p) => !p.custom).length;
  const primary = blocks.find((b) => ids.includes(b.id));
  const label =
    n === 0
      ? t("Watch")
      : n === 1
        ? t(primary?.title ?? "Watch")
        : plots > 0 && plots !== n
          ? t("{n} blocks · {p} plots", { n, p: plots })
          : t("{n} blocks", { n });

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
      className="watch-sel"
      onKeyDown={(ev) => {
        if (ev.code === "Space") ev.stopPropagation();
      }}
    >
      <summary title={t("Blocks this mode closes")}>{label}</summary>
      <div className="watch-menu" role="group" aria-label={t("Blocks this mode closes")}>
        {blocks.length ? (
          blocks.map((b) => {
            const on = checked.includes(b.id);
            const pane = panes.find((p) => p.fromIds?.includes(b.id));
            const owner = pane?.fromIds?.[0];
            const share =
              on && owner && owner !== b.id
                ? t("same plot as {block}", { block: cardTitle(blocks, owner, t) })
                : null;
            return (
              <label key={b.id} className={[on ? "on" : "", near.has(b.id) ? "near" : ""].filter(Boolean).join(" ") || undefined}>
                <input
                  type="checkbox"
                  checked={on}
                  title={near.has(b.id) ? t("in / out of the selected card") : undefined}
                  onChange={(ev) => onToggle(b.id, ev.target.checked)}
                />
                <span>{t(b.title)}</span>
                {share ? <i>{share}</i> : null}
              </label>
            );
          })
        ) : (
          <p>{t("No vehicle yet")}</p>
        )}
        <hr />
        <label className={customOn ? "on" : undefined}>
          <input
            type="checkbox"
            checked={customOn}
            onChange={(ev) => onToggle(CUSTOM_ID, ev.target.checked)}
          />
          <span>{t("Custom")}</span>
          <i>{t("pick any live line")}</i>
        </label>
      </div>
    </details>
  );
}

function clipBox(el: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if (oy !== "auto" && oy !== "hidden" && oy !== "scroll" && oy !== "clip") continue;
    const b = n.getBoundingClientRect();
    top = Math.max(top, b.top);
    bottom = Math.min(bottom, b.bottom);
  }
  return { top, bottom };
}

function menuPlace(el: HTMLElement): { up: boolean; max: number } {
  const r = (el.querySelector("summary") ?? el).getBoundingClientRect();
  const clip = clipBox(el);
  const gap = 4;
  const inset = 8;
  const below = clip.bottom - inset - (r.bottom + gap);
  const above = r.top - gap - (clip.top + inset);
  const up = below < 280 && above > below;
  return { up, max: Math.max(0, Math.floor(up ? above : below)) };
}

function LinePicker({
  catalog,
  picked,
  onToggle,
}: {
  catalog: CatalogTrace[];
  picked: string[];
  onToggle: (id: string, on: boolean) => void;
}) {
  const t = useT();
  const box = useRef<HTMLDetailsElement>(null);
  const qRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ up: false, max: 420 });
  const n = picked.length;
  const needle = q.trim().toLowerCase();
  const visible = needle
    ? catalog.filter((tr) => tr.label.toLowerCase().includes(needle) || tr.id.toLowerCase().includes(needle))
    : catalog;
  const live = visible.filter((tr) => tr.group === "live");
  const params = visible.filter((tr) => tr.group === "param");

  useLayoutEffect(() => {
    if (!open) return;
    const el = box.current;
    if (!el) return;
    const fit = () => setPlace(menuPlace(el));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open]);

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
      className="watch-sel"
      onToggle={(ev) => {
        const on = ev.currentTarget.open;
        setOpen(on);
        if (on) {
          setPlace(menuPlace(ev.currentTarget));
          queueMicrotask(() => qRef.current?.focus());
        } else setQ("");
      }}
      onKeyDown={(ev) => {
        if (ev.code === "Space") ev.stopPropagation();
      }}
    >
      <summary title={t("Live lines on this sample")}>
        {n ? t("{n} lines", { n }) : t("Lines")}
      </summary>
      <div
        className={place.up ? "watch-menu lines up" : "watch-menu lines"}
        style={{ maxHeight: place.max }}
        role="group"
        aria-label={t("Live lines on this sample")}
      >
        <input
          ref={qRef}
          className="watch-search"
          value={q}
          spellCheck={false}
          placeholder={t("Search")}
          aria-label={t("Search")}
          onChange={(ev) => setQ(ev.target.value)}
          onKeyDown={(ev) => ev.stopPropagation()}
        />
        <div className="watch-list">
          {live.length ? (
            <div>
              <p>{t("Live")} · {live.length}</p>
              {live.map((tr) => {
                const on = picked.includes(tr.id);
                return (
                  <label key={tr.id} className={on ? "on" : undefined}>
                    <input type="checkbox" checked={on} onChange={(ev) => onToggle(tr.id, ev.target.checked)} />
                    <span>{tr.label}</span>
                    {tr.unit ? <i>{tr.unit}</i> : null}
                  </label>
                );
              })}
            </div>
          ) : null}
          {params.length ? (
            <div>
              <p>{t("Parameters")} · {params.length}</p>
              {params.map((tr) => {
                const on = picked.includes(tr.id);
                return (
                  <label key={tr.id} className={on ? "on" : undefined}>
                    <input type="checkbox" checked={on} onChange={(ev) => onToggle(tr.id, ev.target.checked)} />
                    <span>{tr.label}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
          {!visible.length ? <p>{needle ? t("No matches") : t("No vehicle yet")}</p> : null}
        </div>
      </div>
    </details>
  );
}

export function PlotStack({ panes }: { panes: Pane[] }) {
  const t = useT();
  const refs = useRef<Array<HTMLCanvasElement | null>>([]);
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const paused = useSyncExternalStore(subscribe, isPaused, isPaused);
  const span = useSyncExternalStore(subscribe, getPlotSpan, getPlotSpan);
  const frozen = !useStorePicked((s) => s.ok);
  const sig = panes.map((pane) => pane.title + pane.traces.map(traceId).join(",")).join("|");

  useEffect(() => {
    const paint = () => {
      const buf = getBuffer();
      panesRef.current.forEach((pane, i) => {
        const c = refs.current[i];
        const ctx = c?.getContext("2d");
        if (c && ctx) drawPane(c, ctx, buf, pane);
      });
    };
    if (frozen) {
      paint();
      window.addEventListener("resize", paint);
      return () => window.removeEventListener("resize", paint);
    }
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      paint();
    };
    loop();
    window.addEventListener("resize", paint);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", paint);
    };
  }, [frozen, span, sig]);

  return (
    <div className="plots">
      {panes.map((pane, i) => (
        <div className="plot-card" key={traceId(pane.traces[0] ?? { role: "actual", label: String(i) }) + i}>
          <div className="plot-head">
            <b title={pane.title}>{pane.title}</b>
            {pane.hint ? <span>{t(pane.hint)}</span> : null}
          </div>
          <div className={frozen ? "plot idle" : paused ? "plot paused" : "plot"}>
            <canvas ref={(el) => { refs.current[i] = el; }} />
          </div>
          <div className="caption">
            <PlotLegend pane={pane} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StoreLegVal({ read, d }: { read: (s: Sample) => number | null; d: number }) {
  const v = useStorePicked(read);
  return <b className="leg-val">{fmt(v, d)}</b>;
}

function PlotLegend({ pane }: { pane: Pane }) {
  const d = digits(pane.unit);
  const legendRef = useRef<HTMLDivElement>(null);
  useLegendFit(legendRef);
  return (
    <div ref={legendRef} className="legend">
      {pane.traces.map((tr, i) => (
        <span key={traceId(tr)} className="leg" title={tr.label}>
          <i className={pane.custom ? TONE[i % TONE.length] : ROLE_CLASS[tr.role]} />
          <span className="leg-name">{tr.label}</span>
          <StoreLegVal d={d} read={(s) => traceValue(s, tr)} />
        </span>
      ))}
    </div>
  );
}

function PaneBlock({
  pane,
  blocks,
  frozen,
  paused,
  lines,
  canvasRef,
}: {
  pane: Pane;
  blocks: NodeDef[];
  frozen: boolean;
  paused: boolean;
  lines?: {
    catalog: CatalogTrace[];
    picked: string[];
    onToggle: (id: string, on: boolean) => void;
  };
  canvasRef: (el: HTMLCanvasElement | null) => void;
}) {
  const t = useT();
  const d = digits(pane.unit);
  const legendRef = useRef<HTMLDivElement>(null);
  useLegendFit(legendRef);
  const names = (pane.fromIds ?? [])
    .map((id) => cardTitle(blocks, id, t))
    .filter(Boolean);
  const head = names.length ? names.join(" · ") : t(pane.title);
  return (
    <div className="plot-card">
      <div className="plot-head">
        <b title={names.length > 1 ? t("This plot is the live I/O of: {blocks}", { blocks: names.join(", ") }) : undefined}>
          {head}
        </b>
        <span>{t(pane.hint)}</span>
        {lines ? (
          <LinePicker catalog={lines.catalog} picked={lines.picked} onToggle={lines.onToggle} />
        ) : null}
      </div>
      <div className={frozen ? "plot idle" : paused ? "plot paused" : "plot"}>
        <canvas ref={canvasRef} />
      </div>
      <div className="caption">
        <div ref={legendRef} className="legend">
          {pane.traces.map((tr, i) => (
            <span key={traceId(tr)} className="leg" title={tr.label}>
              <i className={pane.custom ? TONE[i % TONE.length] : ROLE_CLASS[tr.role]} />
              <span className="leg-name">{tr.label}</span>
              <LegVal d={d} read={(s) => traceValue(s, tr)} />
            </span>
          ))}
          {pane.hud?.includes("aspd") ? (
            <span className="leg" title="VFR_HUD.airspeed">
              <span className="leg-name">VFR_HUD.airspeed</span>
              <LegVal d={1} unit="m/s" read={(s) => s.aspd ?? null} />
            </span>
          ) : null}
          {pane.hud?.includes("gspd") ? (
            <span className="leg" title="VFR_HUD.groundspeed">
              <span className="leg-name">VFR_HUD.groundspeed</span>
              <LegVal d={1} unit="m/s" read={(s) => s.gspd ?? null} />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
