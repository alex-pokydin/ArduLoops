import { useEffect, useState, type ReactNode } from "react";
import { type Lang, useT, useLang, setLang } from "../i18n/i18n";
import { ai, type AiAccount, type AiStatus } from "../assistant/api";
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
  const [account, setAccount] = useState<AiAccount | null>(null);
  const [ownKey, setOwnKey] = useState(false);
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

  function applyAi(s: AiStatus) {
    setAiConfigured(s.configured);
    setAccount(s.account || null);
    const provider = s.active?.provider || "disabled";
    setSavedProvider(provider);
    setAiProvider(provider);
    setAiState(s.active?.status || "");
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
      applyAi(s);
      if (s.configured && s.active?.provider && s.active.provider !== "disabled") setOwnKey(true);
      setAiKey("");
    }).catch(() => {});
    const timer = window.setInterval(() => {
      void ai.status().then((s) => {
        setAccount(s.account || null);
        setAiConfigured(s.configured);
      }).catch(() => {});
    }, 2000);
    return () => window.clearInterval(timer);
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
              <div className="ai-title">
                <b>{t("AI assistant")}</b>
                {account?.signed_in ? (
                  <button type="button" onClick={() => void ai.logout().then(applyAi).catch((err: Error) => setAiState(err.message))}>
                    {t("Sign out")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="google-signin"
                    onClick={() => {
                      void ai.loginUrl().then((res) => {
                        window.open(res.url, "arduloops-auth", "width=480,height=720");
                      }).catch((err: Error) => setAiState(err.message));
                    }}
                  >
                    <GoogleMark />
                    {t("Sign in with Google")}
                  </button>
                )}
              </div>
              <span>
                {account?.signed_in
                  ? t("Signed in as {email}.", { email: account.email || "" })
                  : t("Sign in to activate the ArduLoops assistant. Your own key still works.")}
                {account?.signed_in && account.limit != null
                  ? ` ${t("{left} of {limit} requests left today.", { left: Math.max(0, account.limit - (account.used || 0)), limit: account.limit })}`
                  : ""}
                {aiConfigured && savedProvider && aiProvider !== savedProvider && aiProvider !== "disabled" ? (
                  <> {t("Chats stay on this computer. The next message sends their selected context to this provider.")}</>
                ) : null}
              </span>
            </div>
            {account?.signed_in ? (
              <div className="ai-opt">
                <select aria-label={t("AI assistant")} value={aiProvider} onChange={(ev) => { setAiProvider(ev.target.value); setAiState(""); }}>
                  <option value="disabled">{t("Disabled")}</option>
                  <option value="gemini">Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="xai">xAI</option>
                </select>
                {aiProvider !== "disabled" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAiState(t("checking"));
                      void ai.saveProvider(aiProvider, "", "hosted").then((res) => {
                        applyAi(res);
                        setAiState(res.ok === false ? (res.status || "network unavailable") : "ready");
                        setAiKey("");
                      }).catch((err: Error) => setAiState(err.message));
                    }}
                  >
                    {t("Use ArduLoops")}
                  </button>
                ) : null}
                <button type="button" onClick={() => void ai.checkout("start").then((res) => window.open(res.url)).catch((err: Error) => setAiState(err.message))}>
                  {t("Start · 30 a day")}
                </button>
                <button type="button" onClick={() => void ai.checkout("plus").then((res) => window.open(res.url)).catch((err: Error) => setAiState(err.message))}>
                  {t("Plus · 100 a day")}
                </button>
                <button type="button" onClick={() => void ai.portal().then((res) => window.open(res.url)).catch((err: Error) => setAiState(err.message))}>
                  {t("Manage subscription")}
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className={ownKey ? "own-key-toggle on" : "own-key-toggle"}
              aria-expanded={ownKey}
              onClick={() => setOwnKey((open) => !open)}
            >
              {t("Use my own key")}
            </button>
            <div className="ai-opt own-key" hidden={!ownKey}>
              {account?.signed_in ? null : (
                <select aria-label={t("AI assistant")} value={aiProvider} onChange={(ev) => { setAiProvider(ev.target.value); setAiState(""); }}>
                  <option value="disabled">{t("Disabled")}</option>
                  <option value="gemini">Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="xai">xAI</option>
                </select>
              )}
              {aiProvider !== "disabled" ? (
                <>
                  <input
                    type="password"
                    autoComplete="off"
                    aria-label={t("API key")}
                    placeholder={aiConfigured ? t("Replace key") : t("API key")}
                    value={aiKey}
                    onChange={(ev) => setAiKey(ev.target.value)}
                  />
                  {KEY_PAGES[aiProvider] ? (
                    <a
                      href={KEY_PAGES[aiProvider]}
                      onClick={(ev) => {
                        ev.preventDefault();
                        openExternal(KEY_PAGES[aiProvider]);
                      }}
                    >
                      {t("Create a key")}
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setAiState(t("checking"));
                      void ai.saveProvider(aiProvider, aiKey, "check").then((res) => {
                        const failed = res.ok === false;
                        setAiState(failed ? (res.status || "network unavailable") : "ready");
                        applyAi(res);
                        setAiKey("");
                      }).catch((err: Error) => setAiState(err.message));
                    }}
                  >
                    {t("Check")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void ai.saveProvider("disabled", "", "disable").then(applyAi).catch((err: Error) => setAiState(err.message));
                  }}
                >
                  {t("Save")}
                </button>
              )}
              {aiConfigured && aiProvider !== "disabled" ? (
                <button type="button" onClick={() => void ai.saveProvider(aiProvider, "", "remove").then(applyAi).then(() => { setAiConfigured(false); setAiState(""); })}>
                  {t("Remove")}
                </button>
              ) : null}
              {aiState ? <span className="own-key-note">{t(aiState)}</span> : null}
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

function openExternal(url: string) {
  void fetch(`${APP_HTTP}/open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  }).then((res) => {
    if (!res.ok) window.open(url, "_blank", "noopener");
  }).catch(() => {
    window.open(url, "_blank", "noopener");
  });
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="14" height="14" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
