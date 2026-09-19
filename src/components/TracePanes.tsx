import { useEffect, useRef } from "react";
import { useT } from "../i18n/i18n";
import type { NodeDef } from "../lib/gains";
import { ROLE_CLASS, type Pane } from "../lib/traces";
import { isPaused } from "../mav/store";
import type { Sample } from "../mav/types";
import { useVehicle, useViewSample, viewBuffer } from "../mav/view";
import { drawPane } from "../plot";

function digits(unit: string): number {
  if (unit.includes("%")) return 0;
  if (unit.includes("°/s") || unit.includes("m/s")) return 2;
  return 2;
}

function fmt(v: unknown, d: number): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "—";
  return v.toFixed(d);
}

export function TracePanes({
  panes,
  onPause,
  blocks,
  checked,
  near,
  onToggle,
}: {
  panes: Pane[];
  onPause: () => void;
  blocks: NodeDef[];
  checked: string[];
  near: Set<string>;
  onToggle: (id: string, on: boolean) => void;
}) {
  const t = useT();
  const vehicle = useVehicle();
  const s = useViewSample();
  const refs = useRef<Array<HTMLCanvasElement | null>>([]);
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const paused = isPaused();
  const frozen = !s.ok;

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
  }, [vehicle, frozen, panes.length]);

  if (!panes.length) {
    return <p className="tune-empty">{t("This block has no live MAVLink trace on the stand yet.")}</p>;
  }

  return (
    <>
      {panes.map((pane, i) => (
        <PaneBlock
          key={(pane.fromIds?.join("+") || pane.title) + pane.traces.map((tr) => tr.key).join(",")}
          pane={pane}
          blocks={blocks}
          sample={s}
          frozen={frozen}
          paused={paused}
          pauseBtn={i === 0}
          onPause={onPause}
          watch={
            i === 0
              ? { blocks, checked, near, onToggle, panes }
              : undefined
          }
          canvasRef={(el) => {
            refs.current[i] = el;
          }}
        />
      ))}
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
  const n = checked.length;
  const plots = panes.length;
  const primary = blocks.find((b) => checked.includes(b.id));
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
      </div>
    </details>
  );
}

function PaneBlock({
  pane,
  blocks,
  sample,
  frozen,
  paused,
  pauseBtn,
  onPause,
  watch,
  canvasRef,
}: {
  pane: Pane;
  blocks: NodeDef[];
  sample: Sample;
  frozen: boolean;
  paused: boolean;
  pauseBtn: boolean;
  onPause: () => void;
  watch?: {
    blocks: NodeDef[];
    checked: string[];
    near: Set<string>;
    panes: Pane[];
    onToggle: (id: string, on: boolean) => void;
  };
  canvasRef: (el: HTMLCanvasElement | null) => void;
}) {
  const t = useT();
  const d = digits(pane.unit);
  const names = (pane.fromIds ?? [])
    .map((id) => cardTitle(blocks, id, t))
    .filter(Boolean);
  const head = names.length ? names.join(" · ") : t(pane.title);
  return (
    <>
      <div className="plot-head">
        <b title={names.length > 1 ? t("This plot is the live I/O of: {blocks}", { blocks: names.join(", ") }) : undefined}>
          {head}
        </b>
        <span>{t(pane.hint)}</span>
        {watch ? (
          <WatchPicker
            blocks={watch.blocks}
            checked={watch.checked}
            near={watch.near}
            panes={watch.panes}
            onToggle={watch.onToggle}
          />
        ) : null}
        {pauseBtn ? (
          <button type="button" className={paused ? "pause-btn on" : "pause-btn"} onClick={onPause} title={t("Space")}>
            {paused ? t("Resume") : t("Pause")}
          </button>
        ) : null}
      </div>
      <div className={frozen ? "plot idle" : paused ? "plot paused" : "plot"}>
        <canvas ref={canvasRef} />
      </div>
      <div className="caption">
        <div className="legend">
          {pane.traces.map((tr) => (
            <span key={tr.key}>
              <i className={ROLE_CLASS[tr.role]} />
              {tr.label} <b>{fmt(sample[tr.key], d)}</b>
            </span>
          ))}
          {pane.gap ? (
            <span>
              <i className="gap" />
              {t("error gap")}
            </span>
          ) : null}
          {pane.hud?.includes("aspd") ? (
            <span>
              VFR_HUD.airspeed <b>{fmt(sample.aspd, 1)}</b> m/s
            </span>
          ) : null}
          {pane.hud?.includes("gspd") ? (
            <span>
              VFR_HUD.groundspeed <b>{fmt(sample.gspd, 1)}</b> m/s
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}
