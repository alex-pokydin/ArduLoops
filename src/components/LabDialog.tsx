import { useEffect, useState, type ReactNode } from "react";
import { type Lang, useT, useLang, setLang } from "../i18n/i18n";
import { ai, type AiAccount, type AiStatus } from "../assistant/api";
import { openExternal } from "../lib/open";
import { APP_HTTP } from "../mav/link";
import { PLOT_SPANS, getPlotSpan, setPlotSpan, type PlotSpan } from "../mav/store";
import { CLOUD_ACCOUNT_URL, defaultLoginUrl } from "../config";

const KEY_PAGES: Record<string, string> = {
  gemini: "https://aistudio.google.com/apikey",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  xai: "https://console.x.ai/team/default/api-keys",
};
const PROVIDER_NAME: Record<string, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
  xai: "xAI",
};

function checkNote(status: string): string {
  if (status === "invalid key") return "This key was rejected.";
  if (status === "quota exceeded") return "This key has no quota left.";
  if (status === "model unavailable") return "This model is not available for this key.";
  if (status === "network unavailable") return "The provider did not answer.";
  return status || "The provider did not answer.";
}


export type AppRelease = {
  current: string;
  latest: string;
  newer: boolean;
  url: string;
};

export function LabDialog({
  open,
  linked,
  release,
  onClose,
  onSave,
}: {
  open: boolean;
  linked: boolean;
  release: AppRelease | null;
  onClose: () => void;
  onSave: () => void;
}): ReactNode {
  const t = useT();
  const lang = useLang();
  const [mcpCopied, setMcpCopied] = useState(false);
  const [aiProvider, setAiProvider] = useState("disabled");
  const [aiKey, setAiKey] = useState("");
  const [aiState, setAiState] = useState("");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [account, setAccount] = useState<AiAccount | null>(null);
  const [ownKey, setOwnKey] = useState(false);
  const [savedProvider, setSavedProvider] = useState("");
  const [loginUrl, setLoginUrl] = useState(defaultLoginUrl);
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
      setOwnKey(!!s.own_key);
      setAiKey("");
    }).catch(() => {});
    void ai.loginUrl().then((res) => {
      if (res.url) setLoginUrl(res.url);
    }).catch(() => {});
    const timer = window.setInterval(() => {
      void ai.status().then((s) => {
        setAccount(s.account || null);
        setAiConfigured(s.configured);
        if (s.account?.signed_in) setAiState("");
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
              <b>{t("Version")}</b>
            </div>
            <span className="opt-val">
              {release?.current ?? ""}
              {release?.newer ? (
                <>
                  {" ("}
                  <a
                    href={release.url}
                    title={t("Open the latest GitHub release")}
                    onClick={(ev) => {
                      ev.preventDefault();
                      openExternal(release.url);
                    }}
                  >
                    {release.latest}
                  </a>
                  {")"}
                </>
              ) : null}
            </span>
          </li>
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
            <li className="opt">
              <div className="opt-body">
                <b>{t("Export")}</b>
                <span>{t("Write live parameters to a .parm file.")}</span>
              </div>
              <button type="button" onClick={onSave} title={t("Export current parameters as a .parm file")}>
                {t("Export")}
              </button>
            </li>
          ) : null}
          <li className="opt ai-row">
            <div className="opt-body">
              <div className="ai-title">
                <span className="ai-heading">
                  <b>{t("AI assistant")}</b>
                  {account?.signed_in ? " " : null}
                  {account?.signed_in ? (
                    <a
                      className="cabinet-link"
                      href={CLOUD_ACCOUNT_URL}
                      onClick={(ev) => {
                        ev.preventDefault();
                        void ai.cabinet()
                          .then((res) => openExternal(res.url))
                          .catch(() => openExternal(CLOUD_ACCOUNT_URL));
                      }}
                    >
                      {t("ArduLoops Cloud")}
                    </a>
                  ) : null}
                </span>
                {account?.signed_in ? (
                  <button type="button" onClick={() => void ai.logout().then(applyAi).catch((err: Error) => setAiState(err.message))}>
                    {t("Sign out")}
                  </button>
                ) : (
                  <a
                    className="google-signin"
                    href={loginUrl || defaultLoginUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(ev) => {
                      ev.preventDefault();
                      setAiState(t("Complete sign-in in the browser."));
                      const target = loginUrl || defaultLoginUrl();
                      openExternal(target);
                    }}
                  >
                    <GoogleMark />
                    {t("Sign in with Google")}
                  </a>
                )}
              </div>
              <span>
                {account?.signed_in
                  ? t("Signed in as {email}.", { email: account.email || "" })
                  : t("Sign in to activate the ArduLoops assistant. Your own key still works.")}
                {account?.signed_in && account.limit != null
                  ? ` ${t("{left} of {limit} requests left today.", { left: Math.max(0, account.limit - (account.used || 0)), limit: account.limit })}`
                  : ""}
                {!account?.signed_in && aiState && aiState !== "ready" && aiState !== "checking"
                  ? ` ${t(aiState)}`
                  : ""}
                {aiConfigured && savedProvider && aiProvider !== savedProvider && aiProvider !== "disabled" ? (
                  <> {t("Chats stay on this computer. The next message sends their selected context to this provider.")}</>
                ) : null}
              </span>
            </div>
            <button
              type="button"
              className={ownKey ? "own-key-toggle on" : "own-key-toggle"}
              aria-expanded={ownKey}
              onClick={() => setOwnKey((open) => !open)}
            >
              {t("Use my own key")}
            </button>
            <div className="ai-opt own-key" hidden={!ownKey}>
              {account?.signed_in ? (
                <span className="own-key-note">{t("Sign out of Cloud to use your own key.")}</span>
              ) : aiConfigured && aiProvider !== "disabled" ? (
                <span className="own-key-on">
                  <span>{t("Assistant is on. Provider {provider}.", { provider: PROVIDER_NAME[aiProvider] || aiProvider })}</span>
                  <button type="button" onClick={() => void ai.saveProvider(aiProvider, "", "remove").then(applyAi).then(() => { setAiConfigured(false); setAiState(""); })}>
                    {t("Remove key")}
                  </button>
                </span>
              ) : (
                <>
                  <select aria-label={t("AI assistant")} value={aiProvider} onChange={(ev) => {
                    const next = ev.target.value;
                    setAiProvider(next);
                    setAiState("");
                    if (next === "disabled") {
                      void ai.saveProvider("disabled", "", "disable").then(applyAi).catch((err: Error) => setAiState(err.message));
                    }
                  }}>
                    <option value="disabled">{t("Disabled")}</option>
                    <option value="gemini">Gemini</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="xai">xAI</option>
                  </select>
                  {aiProvider !== "disabled" ? (
                    <>
                      <span className="own-key-line">
                        <input
                          type="password"
                          autoComplete="off"
                          aria-label={t("API key")}
                          placeholder={aiConfigured ? t("Replace key") : t("API key")}
                          value={aiKey}
                          onChange={(ev) => setAiKey(ev.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setAiState("checking");
                            void ai.saveProvider(aiProvider, aiKey, "check").then((res) => {
                              if (res.ok === false) {
                                setAiState(checkNote(res.status || ""));
                                return;
                              }
                              applyAi(res);
                              setAiKey("");
                              setAiState("");
                            }).catch((err: Error) => setAiState(err.message));
                          }}
                        >
                          {t("Check")}
                        </button>
                      </span>
                      {KEY_PAGES[aiProvider] ? (
                        <a
                          href={KEY_PAGES[aiProvider]}
                          onClick={(ev) => {
                            ev.preventDefault();
                            openExternal(KEY_PAGES[aiProvider]);
                          }}
                        >
                          {t("Create a {provider} key", { provider: PROVIDER_NAME[aiProvider] || aiProvider })}
                        </a>
                      ) : null}
                    </>
                  ) : null}
                  {aiState && aiState !== "ready" ? <span className="own-key-note">{t(aiState)}</span> : null}
                </>
              )}
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
