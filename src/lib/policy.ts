import { normalizeSettings, type Settings } from "./settings";
import { domainMatches, sensitiveCategory } from "./sensitive";
import { domainOf } from "./url";

export type SkipReason =
  | "paused"
  | "scheme"
  | "sensitive"
  | "blocklist"
  | "allowlist"
  | "password"
  | "short";

export interface IndexDecision {
  ok: boolean;
  reason?: SkipReason;
}

export function isDomainAllowed(url: string, settings: Settings): boolean {
  let hostname = "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    hostname = parsed.hostname;
  } catch {
    return false;
  }
  const allowed = settings.allowlist.some((pattern) => domainMatches(hostname, pattern));
  if (settings.allowlistOnly && !allowed) return false;
  if (!allowed && settings.blocklist.some((pattern) => domainMatches(hostname, pattern))) return false;
  if (!allowed && settings.skipSensitive && sensitiveCategory(hostname)) return false;
  return true;
}

export function decideIndex(input: {
  url: string;
  textLength: number;
  hasPassword: boolean;
  paused: boolean;
  settings: Settings;
  force?: boolean;
}): IndexDecision {
  const settings = normalizeSettings(input.settings);
  if (input.paused || settings.paused) return { ok: false, reason: "paused" };
  if (!isHttp(input.url)) return { ok: false, reason: "scheme" };
  if (input.hasPassword) return { ok: false, reason: "password" };
  if (!isDomainAllowed(input.url, settings)) {
    const host = domainOf(input.url);
    if (settings.allowlistOnly && !settings.allowlist.some((pattern) => domainMatches(host, pattern))) {
      return { ok: false, reason: "allowlist" };
    }
    if (settings.blocklist.some((pattern) => domainMatches(host, pattern))) {
      return { ok: false, reason: "blocklist" };
    }
    return { ok: false, reason: "sensitive" };
  }
  if (!input.force && input.textLength < settings.minChars) return { ok: false, reason: "short" };
  return { ok: true };
}

function isHttp(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
