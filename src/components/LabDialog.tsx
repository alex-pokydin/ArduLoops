import { useEffect, useState, type ReactNode } from "react";
import { type Lang, useT, useLang, setLang } from "../i18n/i18n";
import { ai } from "../assistant/api";
import { APP_HTTP } from "../mav/link";
import { PLOT_SPANS, getPlotSpan, setPlotSpan, type PlotSpan } from "../mav/store";

const KEY_PAGES: Record<string, string> = {
  gemini: "https://aistudio.google.com/apikey",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  xai: "https://console.x.ai/team/default/api-keys",
};

export function LabDialog({
  open,
  linked,
  frame,
  initDone,
  initTotal,
  onClose,
  onInit,
  onSave,
}: {
  open: boolean;
  linked: boolean;
  frame: "copter" | "plane" | "";
  initDone: number;
  initTotal: number;
  onClose: () => void;
  onInit: () => void;
  onSave: () => void;
}): ReactNode {
  const t = useT();
  const lang = useLang();
  const vehicle = frame === "plane" ? "plane" : "copter";
  const initing = initTotal > 0;
  const pct = initing ? Math.min(100, Math.round((100 * initDone) / initTotal)) : 0;
  const [mcpCopied, setMcpCopied] = useState(false);
  const [aiProvider, setAiProvider] = useState("disabled");
  const [aiKey, setAiKey] = useState("");
  const [aiState, setAiState] = useState("");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [savedProvider, setSavedProvider] = useState("");
  const [span, setSpan] = useState<PlotSpan>(getPlotSpan);
  const [tlogOn, setTlogOn] = useState(false);
  const [tlogPath, setTlogPath] = useState("");
  const [tlogDir, setTlogDir] = useState("");
  const [tlogNote, setTlogNote] = useState("");

  async function saveTlog(enabled: boolean, path: string) {
    try {
      const r = await fetch(`${APP_HTTP}/tlog`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, path }),
      });
      const body = await r.json() as { enabled?: boolean; path?: string; dir?: string; error?: string };
      if (!r.ok) {
        setTlogNote(body.error || "Could not save the telemetry log settings.");
        return;
      }
      setTlogOn(!!body.enabled);
      setTlogPath(body.path || "");
      setTlogDir(body.dir || "");
      setTlogNote("");
    } catch {
      setTlogNote("Could not save the telemetry log settings.");
    }
  }

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
    setSpan(getPlotSpan());
    void fetch(`${APP_HTTP}/tlog`, { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { enabled?: boolean; path?: string; dir?: string }) => {
        setTlogOn(!!body.enabled);
        setTlogPath(body.path || "");
        setTlogDir(body.dir || "");
        setTlogNote("");
      })
      .catch(() => {});
    void ai.status().then((s) => {
      setAiConfigured(s.configured);
      const provider = s.active?.provider || "disabled";
      setSavedProvider(provider);
      setAiProvider(provider);
      setAiState(s.active?.status || "");
      setAiKey("");
    }).catch(() => {});
  }, [open]);

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
              <b>{t("Plot window")}</b>
              <span>{t("How far back the traces go. The stand keeps up to a minute so a longer window already has history.")}</span>
            </div>
            <select
              aria-label={t("Plot window")}
              value={span}
              onChange={(ev) => {
                const n = Number(ev.target.value) as PlotSpan;
                setSpan(n);
                setPlotSpan(n);
              }}
            >
              {PLOT_SPANS.map((n) => (
                <option key={n} value={n}>
                  {t("{n} s", { n })}
                </option>
              ))}
            </select>
          </li>
          {linked ? (
            <>
              <li className="opt">
                <div className="opt-body">
                  <b>{t("Init · {vehicle}", { vehicle: t(vehicle) })}</b>
                  <span>
                    {initing
                      ? t("Init · {done}/{total}", { done: initDone, total: initTotal })
                      : t("Stock dump + lab. Writes the stand — arm-ready.")}
                  </span>
                  {initing ? (
                    <div
                      className="init-meter"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={initTotal}
                      aria-valuenow={initDone}
                    >
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={onInit}
                  disabled={initing}
                  title={t("Write the lab stand dump so a blank board can arm.")}
                >
                  {initing ? `${pct}%` : t("Init")}
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
          <li className="opt ai-row">
            <div className="opt-body">
              <b>{t("AI assistant")}</b>
              <span>
                {aiConfigured ? t("Local storage (reduced protection). The key is not shown again.") : t("Choose a provider, then check the key. A check can use a little API quota.")}
                {aiConfigured && savedProvider && aiProvider !== savedProvider && aiProvider !== "disabled" ? (
                  <> {t("Chats stay on this computer. The next message sends their selected context to this provider.")}</>
                ) : null}
                {KEY_PAGES[aiProvider] ? (
                  <>
                    {" "}
                    <a href={KEY_PAGES[aiProvider]} target="_blank" rel="noreferrer">{t("Create a key")}</a>
                  </>
                ) : null}
              </span>
              {aiState ? <span>{t(aiState)}</span> : null}
            </div>
            <div className="ai-opt">
              <select aria-label={t("AI assistant")} value={aiProvider} onChange={(ev) => { setAiProvider(ev.target.value); setAiState(""); }}>
                <option value="disabled">{t("Disabled")}</option>
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="xai">xAI</option>
              </select>
              {aiProvider !== "disabled" ? (
                <input
                  type="password"
                  autoComplete="off"
                  aria-label={t("API key")}
                  placeholder={aiConfigured ? t("Replace key") : t("API key")}
                  value={aiKey}
                  onChange={(ev) => setAiKey(ev.target.value)}
                />
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setAiState(t("checking"));
                  const op = aiProvider === "disabled" ? "disable" : "check";
                  void ai.saveProvider(aiProvider, aiKey, op).then((res) => {
                    const failed = res.ok === false;
                    setAiState(failed ? (res.status || "network unavailable") : "ready");
                    setAiConfigured(!failed && aiProvider !== "disabled");
                    setAiKey("");
                  }).catch((err: Error) => setAiState(err.message));
                }}
              >
                {aiProvider === "disabled" ? t("Save") : t("Check")}
              </button>
              {aiConfigured && aiProvider !== "disabled" ? (
                <button type="button" onClick={() => void ai.saveProvider(aiProvider, "", "remove").then(() => { setAiConfigured(false); setAiState(""); })}>
                  {t("Remove")}
                </button>
              ) : null}
            </div>
          </li>
          <li className="opt ai-row">
            <div className="opt-body">
              <b>{t("Telemetry log")}</b>
              <span>{t("Record the MAVLink stream as a Mission Planner .tlog while the link is up.")}</span>
              {tlogNote ? <span>{t(tlogNote)}</span> : null}
            </div>
            <div className="ai-opt">
              <input
                type="checkbox"
                aria-label={t("Telemetry log")}
                checked={tlogOn}
                onChange={(ev) => {
                  const on = ev.target.checked;
                  setTlogOn(on);
                  void saveTlog(on, tlogPath);
                }}
              />
              <input
                className="tlog-path"
                aria-label={t("Folder")}
                placeholder={tlogDir}
                value={tlogPath}
                onChange={(ev) => setTlogPath(ev.target.value)}
                onBlur={() => void saveTlog(tlogOn, tlogPath)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
                }}
              />
            </div>
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
        </ul>
      </div>
    </div>
  );
}
