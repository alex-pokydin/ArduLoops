import { Children, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useT } from "../i18n/i18n";

const STORE = "arduloops.aside.w";
const MIN = 220;
const MAX = 560;

function loadWidth(): number | null {
  const n = Number(localStorage.getItem(STORE));
  if (!Number.isFinite(n) || n < MIN || n > MAX) return null;
  return Math.round(n);
}

function saveWidth(n: number) {
  try {
    localStorage.setItem(STORE, String(n));
  } catch {
    /* ignore */
  }
}

function asideWidth(main: HTMLElement, clientX: number, originLeft: number, originX: number): number {
  const box = main.getBoundingClientRect();
  const pad = Number.parseFloat(getComputedStyle(main).paddingRight) || 0;
  const max = Math.min(MAX, Math.max(300, box.width * 0.55));
  const left = originLeft + (clientX - originX);
  return Math.round(Math.min(max, Math.max(MIN, box.right - pad - left)));
}

export function MainSplit({ children }: { children: ReactNode }) {
  const t = useT();
  const [width, setWidth] = useState<number | null>(loadWidth);
  const mainRef = useRef<HTMLElement>(null);
  const drag = useRef<{ originLeft: number; originX: number; last: number; frame: number } | null>(null);
  const [left, right] = Children.toArray(children);

  useEffect(() => {
    // While dragging, write the grid tracks straight to <main> once per frame. React state and --aside-w change
    // only on release: the panes do not re-render, and an inherited custom property would restyle every node.
    function move(ev: globalThis.PointerEvent) {
      const start = drag.current;
      const main = mainRef.current;
      if (!start || !main) return;
      start.last = asideWidth(main, ev.clientX, start.originLeft, start.originX);
      if (start.frame) return;
      start.frame = requestAnimationFrame(() => {
        start.frame = 0;
        main.style.gridTemplateColumns = `minmax(0, 1fr) 12px ${start.last}px`;
      });
    }
    function up() {
      const start = drag.current;
      if (!start) return;
      drag.current = null;
      if (start.frame) cancelAnimationFrame(start.frame);
      document.body.classList.remove("split-drag");
      const main = mainRef.current;
      if (main && start.last) {
        main.style.setProperty("--aside-w", `${start.last}px`);
        setWidth(start.last);
        saveWidth(start.last);
      }
      if (main) main.style.gridTemplateColumns = "";
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  function onPointerDown(ev: PointerEvent<HTMLButtonElement>) {
    const main = mainRef.current;
    const aside = main?.querySelector(":scope > aside:last-of-type");
    if (!main || !(aside instanceof HTMLElement)) return;
    ev.preventDefault();
    drag.current = {
      originLeft: aside.getBoundingClientRect().left,
      originX: ev.clientX,
      last: 0,
      frame: 0,
    };
    document.body.classList.add("split-drag");
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      /* untrusted / synthetic pointer */
    }
  }

  return (
    <main ref={mainRef} style={width != null ? ({ ["--aside-w"]: `${width}px` } as CSSProperties) : undefined}>
      {left}
      <button
        type="button"
        className="aside-grip"
        aria-label={t("Resize side panel")}
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
      />
      {right}
    </main>
  );
}
