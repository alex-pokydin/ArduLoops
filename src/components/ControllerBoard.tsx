import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useT } from "../i18n/i18n";
import { APP_HTTP } from "../mav/link";
type Controller = {
  board_id: number;
  vehicle_id: string;
  git_identity?: string | null;
  system_id: number;
  board_name?: string | null;
  uid?: string | null;
  key?: string | null;
  comment?: string;
};

function BoardMark({ plane }: { plane: boolean }) {
  if (plane) {
    return (
      <svg viewBox="0 0 96 72" aria-hidden="true">
        <g fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
          <polygon points="48,5 43,18 53,18" />
          <rect x="44.5" y="16" width="7" height="46" rx="2" />
          <polygon points="6,36 48,27 90,36 48,41" />
          <polygon points="32,56 48,52 64,56 48,62" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 96 72" aria-hidden="true">
      <g fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
        <line x1="24" y1="16" x2="72" y2="56" fill="none" />
        <line x1="72" y1="16" x2="24" y2="56" fill="none" />
        <circle cx="24" cy="16" r="11" />
        <circle cx="72" cy="16" r="11" />
        <circle cx="24" cy="56" r="11" />
        <circle cx="72" cy="56" r="11" />
        <rect x="38" y="28" width="20" height="16" rx="3" />
        <polygon points="48,17 42,29 54,29" />
      </g>
    </svg>
  );
}

export function ControllerBoard() {
  const tr = useT();
  const [controller, setController] = useState<Controller | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    const ac = new AbortController();
    void fetch(`${APP_HTTP}/firmware-library`, { cache: "no-store", signal: ac.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((value: { controller?: Controller | null } | null) => {
        const next = value?.controller ?? null;
        setController(next);
        setComment(next?.comment ?? "");
      })
      .catch(() => {});
    return () => ac.abort();
  }, []);

  useEffect(() => load(), [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!controller?.key) return;
    setBusy(true);
    setNote("");
    try {
      const response = await fetch(`${APP_HTTP}/firmware-library/comment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ controller_key: controller.key, comment }),
      });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error((value as { error?: string })?.error ?? `HTTP ${response.status}`);
      setNote(tr("Comment saved"));
      load();
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : tr("Could not save comment"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="work-board">
      <div className="work-mark" aria-hidden="true"><BoardMark plane={controller?.vehicle_id === "plane"} /></div>
      <div className="work-id">
        <b>{controller ? (controller.board_name ?? tr("unknown board")) : "\u00a0"}</b>
        <p>{controller
          ? `${controller.vehicle_id} · #${controller.board_id} · ${tr("System ID {id}", { id: controller.system_id })}${controller.git_identity ? ` · ${controller.git_identity}` : ""}`
          : tr("Vehicle identity is loading. The library will filter images by board and vehicle type.")}</p>
        <p title={controller?.uid ?? controller?.key ?? ""}>{controller?.uid || controller?.key || "\u00a0"}</p>
      </div>
      <form className="work-note board-comment" onSubmit={(event) => void save(event)}>
        <label className="sr-only" htmlFor="controller-comment">{tr("Comment")}</label>
        <textarea id="controller-comment" value={comment} onChange={(event) => setComment(event.target.value)} placeholder={tr("Add a comment")} maxLength={2000} disabled={!controller} />
        <button type="submit" disabled={busy || !controller?.key || comment === (controller?.comment ?? "")} title={note || (busy ? tr("Saving…") : tr("Save comment"))} aria-label={busy ? tr("Saving…") : tr("Save comment")}>
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d="M3.2 8.2 6.4 11.4 12.8 4.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {note ? <span className="sr-only" role="status">{note}</span> : null}
      </form>
    </div>
  );
}
