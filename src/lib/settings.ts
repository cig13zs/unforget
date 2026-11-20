export type ProviderId = "anthropic" | "openai" | "gemini" | "openrouter" | "compatible";

export interface Settings {
  dwellSeconds: number;
  retentionDays: number;
  paused: boolean;
  blocklist: string[];
  allowlist: string[];
  allowlistOnly: boolean;
  skipSensitive: boolean;
  minChars: number;
  confirmEachSend: boolean;
  aiEnabled: boolean;
  aiAcknowledged: boolean;
  provider: ProviderId;
  model: string;
  baseUrl: string;
  bridgeEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  dwellSeconds: 15,
  retentionDays: 0,
  paused: false,
  blocklist: [],
  allowlist: [],
  allowlistOnly: false,
  skipSensitive: true,
  minChars: 400,
  confirmEachSend: false,
  aiEnabled: false,
  aiAcknowledged: false,
  provider: "anthropic",
  model: "",
  baseUrl: "http://127.0.0.1:11434/v1",
  bridgeEnabled: false,
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT)",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  compatible: "Ollama, LM Studio, or other OpenAI-compatible server",
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  openrouter: "openai/gpt-4o-mini",
  compatible: "llama3.2",
};

export function providerOrigins(provider: ProviderId, baseUrl: string): string[] {
  switch (provider) {
    case "anthropic":
      return ["https://api.anthropic.com/*"];
    case "openai":
      return ["https://api.openai.com/*"];
    case "gemini":
      return ["https://generativelanguage.googleapis.com/*"];
    case "openrouter":
      return ["https://openrouter.ai/*"];
    case "compatible": {
      try {
        const url = new URL(baseUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") return [];
        return [`${url.origin}/*`];
      } catch {
        return [];
      }
    }
  }
}

export function normalizeSettings(raw: unknown): Settings {
  const input = raw && typeof raw === "object" ? (raw as Partial<Settings>) : {};
  const provider = isProvider(input.provider) ? input.provider : DEFAULT_SETTINGS.provider;
  return {
    dwellSeconds: clamp(num(input.dwellSeconds, DEFAULT_SETTINGS.dwellSeconds), 3, 180),
    retentionDays: clamp(num(input.retentionDays, DEFAULT_SETTINGS.retentionDays), 0, 3650),
    paused: Boolean(input.paused),
    blocklist: cleanList(input.blocklist),
    allowlist: cleanList(input.allowlist),
    allowlistOnly: Boolean(input.allowlistOnly),
    skipSensitive: input.skipSensitive === undefined ? true : Boolean(input.skipSensitive),
    minChars: clamp(num(input.minChars, DEFAULT_SETTINGS.minChars), 80, 8000),
    confirmEachSend: Boolean(input.confirmEachSend),
    aiEnabled: Boolean(input.aiEnabled),
    aiAcknowledged: Boolean(input.aiAcknowledged),
    provider,
    model: typeof input.model === "string" ? input.model.trim() : "",
    baseUrl: typeof input.baseUrl === "string" && input.baseUrl.trim() ? input.baseUrl.trim() : DEFAULT_SETTINGS.baseUrl,
    bridgeEnabled: Boolean(input.bridgeEnabled),
  };
}

export function activeModel(settings: Settings): string {
  return settings.model || DEFAULT_MODELS[settings.provider];
}

function isProvider(value: unknown): value is ProviderId {
  return value === "anthropic" || value === "openai" || value === "gemini" || value === "openrouter" || value === "compatible";
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
