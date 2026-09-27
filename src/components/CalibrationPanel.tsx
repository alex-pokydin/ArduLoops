import { useEffect, useState } from "react";
import { APP_HTTP } from "../mav/link";
import { useT } from "../i18n/i18n";

export function CalibrationPanel() {
  const t = useT();
  const [ready, setReady] = useState(false);
  const [kind, setKind] = useState<"level" | "gyro" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`${APP_HTTP}/state`, { signal: controller.signal });
        const s = await response.json();
        if (active) setReady(response.ok && s.ok && !s.armed && Date.now() / 1000 - s.heartbeat_at < 3);
      } catch { if (active) setReady(false); }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => { active = false; clearInterval(timer); controller.abort(); };
  }, []);
  async function start() {
    if (!ready || busy || !kind) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${APP_HTTP}/calibrate?kind=${kind}`, { method: "POST" });
      const result = await response.json();
      setMessage(result.message);
    } catch { setMessage("Connection lost during calibration"); }
    finally { setBusy(false); setKind(null); }
  }
  return <section className="controller-calibration" aria-label={t("Calibration")}>
    <h3>{t("Calibration")}</h3>
    <p>{t("Remove propellers and disarm before calibration.")}</p>
    <div className="calibration-actions">
      <button type="button" disabled={!ready || busy} onClick={() => { setKind("level"); setMessage(""); }}>{t("Calibrate level")}</button>
      <button type="button" disabled={!ready || busy} onClick={() => { setKind("gyro"); setMessage(""); }}>{t("Calibrate gyroscope")}</button>
    </div>
    {!ready && !busy && <p>{t("Calibration requires a fresh disarmed connection")}</p>}
    {kind && <div className="calibration-confirm">
      <p>{kind === "level" ? t("Place the motor plane level in both axes. Keep the vehicle still. This updates the level reference, not the full accelerometer calibration.") : t("Keep the vehicle completely still until calibration finishes.")}</p>
      <button type="button" disabled={!ready || busy} onClick={() => void start()}>{busy ? t("Calibrating…") : t("Start calibration")}</button>{" "}
      <button type="button" disabled={busy} onClick={() => setKind(null)}>{t("Cancel")}</button>
    </div>}
    <p role="status" aria-live="polite">{message ? t(message) : busy ? t("Calibrating…") : ""}</p>
  </section>;
}
