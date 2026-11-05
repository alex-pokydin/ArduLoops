import { useT } from "../i18n/i18n";
import { canDetach } from "../lib/detach";

/** Header button that moves a floating panel into its own window. Hidden on phones. */
export function DetachButton({ onDetach, className }: { onDetach: () => void; className?: string }) {
  const t = useT();
  if (!canDetach()) return null;
  return (
    <button
      type="button"
      className={className}
      aria-label={t("Open in separate window")}
      title={t("Open in separate window")}
      onClick={onDetach}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        {/* Two windows: the panel leaves this one for another. */}
        <rect x="2" y="5.5" width="8.5" height="8" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.5 5.5V3.8c0-.7.6-1.3 1.3-1.3h5.9c.7 0 1.3.6 1.3 1.3v5.4c0 .7-.6 1.3-1.3 1.3h-2.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </button>
  );
}
