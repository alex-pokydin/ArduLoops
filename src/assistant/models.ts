export const DEFAULT_MODELS: Record<string, string[]> = {
  gemini: ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.5-flash-lite"],
  openai: ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna", "gpt-6-astra"],
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  xai: ["grok-4.7", "grok-4.6", "grok-4.5"],
};

export type ModelDevEntry = {
  id: string;
  family?: string;
  tool_call?: boolean;
  release_date?: string;
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
};

const CACHE_KEY = "arduloops_models_cache_v1";

export function formatUsd(usd?: number): string {
  if (usd == null || usd <= 0) return "";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n?: number): string {
  if (!n || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function selectProviderModels(provider: string, list: ModelDevEntry[]): string[] {
  const filtered = list.filter(
    (m) =>
      m.id &&
      m.tool_call &&
      m.cost?.input != null &&
      !m.id.includes("research") &&
      !m.id.includes("customtools") &&
      !m.id.includes("image") &&
      !m.id.match(/-\d{8}$/),
  );

  filtered.sort((a, b) => (b.release_date || "").localeCompare(a.release_date || ""));

  if (provider === "gemini") {
    const pro = filtered.find((m) => m.family === "gemini-pro" || m.id.includes("pro") || m.id.includes("argon"));
    const flash = filtered.find(
      (m) => m.family === "gemini-flash" && !m.id.includes("lite") && !m.id.includes("preview"),
    );
    const lite =
      filtered.find(
        (m) =>
          (m.family === "gemini-flash-lite" || m.id.includes("flash-lite")) &&
          !m.id.includes("latest") &&
          !m.id.includes("preview"),
      ) || filtered.find((m) => m.family === "gemini-flash-lite" || m.id.includes("lite"));

    const picks = [pro?.id, flash?.id, lite?.id].filter((id): id is string => Boolean(id));
    return picks.length ? picks : DEFAULT_MODELS.gemini;
  }

  if (provider === "anthropic") {
    const opus = filtered.find((m) => m.family === "claude-opus");
    const sonnet = filtered.find((m) => m.family === "claude-sonnet");
    const haiku = filtered.find((m) => m.family === "claude-haiku");
    const picks = [opus?.id, sonnet?.id, haiku?.id].filter((id): id is string => Boolean(id));
    return picks.length ? picks : DEFAULT_MODELS.anthropic;
  }

  if (provider === "openai") {
    const sol = filtered.find(
      (m) => m.id.includes("sol") || m.id.includes("terra") || m.id.includes("omni") || m.id === "gpt-5",
    );
    const luna = filtered.find((m) => m.id.includes("luna") || m.id.includes("mini"));
    const astra = filtered.find((m) => m.id.includes("astra") || m.id.startsWith("o1") || m.id.startsWith("o3"));
    const picks = [sol?.id, luna?.id, astra?.id].filter((id): id is string => Boolean(id));
    return picks.length ? picks : DEFAULT_MODELS.openai;
  }

  if (provider === "xai") {
    const groks = filtered.filter((m) => m.id.startsWith("grok-")).slice(0, 3).map((m) => m.id);
    return groks.length ? groks : DEFAULT_MODELS.xai;
  }

  return DEFAULT_MODELS[provider] || [];
}

export function loadCachedModels(): Record<string, string[]> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CACHE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        return { ...DEFAULT_MODELS, ...parsed };
      }
    }
  } catch {
    /* fallback to DEFAULT_MODELS */
  }
  return DEFAULT_MODELS;
}

export async function syncModelsDev(): Promise<Record<string, string[]> | null> {
  try {
    const res = await fetch("https://models.dev/api.json", {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { models?: Record<string, ModelDevEntry> }>;
    const providerMap: Record<string, string> = {
      gemini: "google",
      openai: "openai",
      anthropic: "anthropic",
      xai: "xai",
    };

    const out: Record<string, string[]> = {};
    for (const [provider, upstreamKey] of Object.entries(providerMap)) {
      const modelsObj = data[upstreamKey]?.models || {};
      const list = Object.values(modelsObj);
      const chosen = selectProviderModels(provider, list);
      if (chosen.length) out[provider] = chosen;
    }

    if (typeof localStorage !== "undefined" && Object.keys(out).length > 0) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(out));
      } catch {
        /* storage may be restricted */
      }
    }
    return out;
  } catch {
    return null;
  }
}
