import { useEffect, useState, type ReactNode } from "react";
import { type Lang, useT, useLang, setLang } from "../i18n/i18n";
import { APP_HTTP } from "../mav/link";

export function LabDialog({
  open,
  linked,
  frame,
  onClose,
  onInit,
  onSave,
}: {
  open: boolean;
  linked: boolean;
  frame: "copter" | "plane" | "";
  onClose: () => void;
  onInit: () => void;
  onSave: () => void;
}): ReactNode {
  const t = useT();
  const lang = useLang();
  const vehicle = frame === "plane" ? "plane" : "copter";
  const [mcpCopied, setMcpCopied] = useState(false);

  async function copyMcp() {
    let text = JSON.stringify(
      {
        mcpServers: {
          arduloops: { command: "arduloops.exe", args: ["--mcp"] },
        },
      },
      null,
      2,
    );
    try {
      const r = await fetch(`${APP_HTTP}/mcp.json`, { cache: "no-store" });
      if (r.ok) text = await r.text();
    } catch {
      /* use fallback */
    }
    try {
      await navigator.clipboard.writeText(text.trim());
      setMcpCopied(true);
      window.setTimeout(() => setMcpCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lab-dialog-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="lab-dialog-title">{t("Options")}</h2>
          <button type="button" className="modal-x" onClick={onClose} title={t("Close")}>
            ×
          </button>
        </div>
        <ul className="opt-list">
          <li className="opt">
            <div className="opt-body">
              <b>{t("Language")}</b>
            </div>
            <select
              aria-label={t("Language")}
              value={lang}
              onChange={(ev) => setLang(ev.target.value as Lang)}
            >
              <option value="uk">Українська</option>
              <option value="en">English</option>
            </select>
          </li>
          <li className="opt">
            <div className="opt-body">
              <b>{t("MCP")}</b>
              <span>
                {t("Cursor uses the same MAVLink as this window. Start ArduLoops, then paste the config.")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void copyMcp()}
              title={t("Copy Cursor MCP config")}
            >
              {mcpCopied ? t("Copied") : t("Copy")}
            </button>
          </li>
          {linked ? (
            <>
              <li className="opt">
                <div className="opt-body">
                  <b>{t("Init · {vehicle}", { vehicle: t(vehicle) })}</b>
                  <span>
                    {vehicle === "plane"
                      ? t("Dummy SITL IMU cal, then reboot.")
                      : t("Quad X and dummy SITL IMU cal, then reboot.")}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onInit}
                  title={t("Apply the SITL stand for this vehicle and reboot the autopilot (MAVLink). The link will drop briefly.")}
                >
                  {t("Init")}
                </button>
              </li>
              <li className="opt">
                <div className="opt-body">
                  <b>{t("Export")}</b>
                  <span>{t("Write live parameters to a .parm file.")}</span>
                </div>
                <button type="button" onClick={onSave} title={t("Export current parameters as a .parm file")}>
                  {t("Export")}
                </button>
              </li>
            </>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
