import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { Icon } from "./MotorSetup";

export type ViewerImage = { src: string; alt: string };

let shown: { images: ViewerImage[]; index: number } | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const set = (next: typeof shown) => {
  shown = next;
  listeners.forEach((fn) => fn());
};

/** Show `images[index]` full screen; the others are a step away with the arrows. */
export function openImageViewer(images: ViewerImage[], index: number) {
  if (images.length) set({ images, index: Math.max(0, Math.min(index, images.length - 1)) });
}

/** A click on an image inside `root` opens it, with every image in `root` as the set. */
export function openImageIn(root: Element | null, img: HTMLImageElement) {
  const all = [...(root?.querySelectorAll("img") ?? [img])] as HTMLImageElement[];
  openImageViewer(all.map((el) => ({ src: el.currentSrc || el.src, alt: el.alt || el.title })), Math.max(0, all.indexOf(img)));
}

type View = { s: number; x: number; y: number };
const MAX_SCALE = 8;
const STEP = 1.25;

/**
 * Full-screen image view: the image fits the screen; the wheel (or + and −) zooms around the pointer, dragging pans,
 * a double click switches between fit and 1:1. Arrows step through the set, Esc closes.
 */
export function ImageViewerHost() {
  const t = useT();
  const state = useSyncExternalStore(subscribe, () => shown);
  const stage = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; v: View } | null>(null);
  const image = state ? state.images[state.index] : null;

  const fitView = useCallback((w: number, h: number): View => {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return { s: 1, x: 0, y: 0 };
    const s = Math.min(1, (box.width - 32) / w, (box.height - 32) / h);
    return { s, x: (box.width - w * s) / 2, y: (box.height - h * s) / 2 };
  }, []);

  useEffect(() => {
    setSize(null);
  }, [image?.src]);

  const close = useCallback(() => set(null), []);
  const step = useCallback((d: number) => {
    if (!shown) return;
    const n = shown.images.length;
    set({ ...shown, index: (shown.index + d + n) % n });
  }, []);

  // Zoom to scale `s` keeping the screen point (cx, cy) on the same spot of the image.
  const zoomTo = useCallback((s: number, cx?: number, cy?: number) => {
    setView((v) => {
      const box = stage.current?.getBoundingClientRect();
      const px = cx ?? (box ? box.width / 2 : 0);
      const py = cy ?? (box ? box.height / 2 : 0);
      const min = size ? Math.min(fitView(size.w, size.h).s, 1) : 0.1;
      const next = Math.max(min, Math.min(MAX_SCALE, s));
      return { s: next, x: px - ((px - v.x) * next) / v.s, y: py - ((py - v.y) * next) / v.s };
    });
  }, [fitView, size]);

  useEffect(() => {
    if (!state) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
      else if (ev.key === "ArrowRight") step(1);
      else if (ev.key === "ArrowLeft") step(-1);
      else if (ev.key === "+" || ev.key === "=") zoomTo(view.s * STEP);
      else if (ev.key === "-") zoomTo(view.s / STEP);
      else if (ev.key === "0" && size) setView(fitView(size.w, size.h));
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state, close, step, zoomTo, view.s, size, fitView]);

  if (!state || !image) return null;

  const local = (ev: { clientX: number; clientY: number }) => {
    const box = stage.current?.getBoundingClientRect();
    return { x: ev.clientX - (box?.left ?? 0), y: ev.clientY - (box?.top ?? 0) };
  };
  const onWheel = (ev: ReactWheelEvent) => {
    const p = local(ev);
    zoomTo(view.s * (ev.deltaY < 0 ? STEP : 1 / STEP), p.x, p.y);
  };
  const onDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest("button")) return;
    drag.current = { x: ev.clientX, y: ev.clientY, v: view };
    ev.currentTarget.setPointerCapture(ev.pointerId);
  };
  const onMove = (ev: ReactPointerEvent) => {
    const d = drag.current;
    if (d) setView({ ...d.v, x: d.v.x + ev.clientX - d.x, y: d.v.y + ev.clientY - d.y });
  };
  const onUp = (ev: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    // A click on the dark area around the image closes, like the other windows.
    if (d && Math.abs(ev.clientX - d.x) + Math.abs(ev.clientY - d.y) < 4 && ev.target === stage.current) close();
  };
  const onDouble = (ev: ReactMouseEvent) => {
    if (!size) return;
    const fit = fitView(size.w, size.h);
    const p = local(ev);
    if (view.s > fit.s * 1.01) setView(fit);
    else zoomTo(Math.max(1, fit.s * 2.5), p.x, p.y);
  };
  const fit = size ? fitView(size.w, size.h) : null;
  const many = state.images.length > 1;

  return createPortal(
    <div className="iv" role="dialog" aria-modal="true" aria-label={image.alt || t("Image")}>
      <div className="iv-bar">
        <span className="iv-title">{image.alt}</span>
        {many ? <span className="iv-count">{state.index + 1} / {state.images.length}</span> : null}
        <span className="iv-gap" />
        <button type="button" className="mw-icon" onClick={() => zoomTo(view.s / STEP)} aria-label={t("Zoom out")} title={t("Zoom out")}>−</button>
        <span className="iv-pct">{Math.round(view.s * 100)}%</span>
        <button type="button" className="mw-icon" onClick={() => zoomTo(view.s * STEP)} aria-label={t("Zoom in")} title={t("Zoom in")}>+</button>
        <button type="button" className="frs-btn quiet" onClick={() => fit && setView(fit)}>{t("Fit")}</button>
        <button type="button" className="frs-btn quiet" onClick={() => zoomTo(1)}>1:1</button>
        <a className="bd-ext" href={image.src} target="_blank" rel="noreferrer">{t("Original")} ↗</a>
        <button type="button" className="mw-icon" onClick={close} aria-label={t("Close")} title={t("Close")}>{Icon.x()}</button>
      </div>
      <div
        ref={stage}
        className="iv-stage"
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={onDouble}
      >
        <img
          key={image.src}
          src={image.src}
          alt={image.alt}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, visibility: size ? "visible" : "hidden" }}
          onLoad={(ev) => {
            const el = ev.currentTarget;
            const next = { w: el.naturalWidth, h: el.naturalHeight };
            setSize(next);
            setView(fitView(next.w, next.h));
          }}
        />
        {many ? (
          <>
            <button type="button" className="iv-nav prev" onClick={() => step(-1)} aria-label={t("Previous image")}>‹</button>
            <button type="button" className="iv-nav next" onClick={() => step(1)} aria-label={t("Next image")}>›</button>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
