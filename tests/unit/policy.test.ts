import { describe, expect, it } from "vitest";
import { decideIndex, isDomainAllowed } from "../../src/lib/policy";
import { DEFAULT_SETTINGS, type Settings } from "../../src/lib/settings";
import { selectExpired, selectSince } from "../../src/lib/retention";
import { normalizeUrl } from "../../src/lib/url";
import { parseQuestion } from "../../src/lib/dates";

const settings: Settings = { ...DEFAULT_SETTINGS, blocklist: ["blocked.example"], allowlist: ["mail.google.com"] };

function decide(url: string, extra: Partial<Parameters<typeof decideIndex>[0]> = {}) {
  return decideIndex({
    url,
    textLength: 1000,
    hasPassword: false,
    paused: false,
    settings,
    ...extra,
  });
}

describe("capture policy", () => {
  it("skips sensitive, blocked, password, paused, and non-http pages", () => {
    expect(decide("https://chase.com/account").reason).toBe("sensitive");
    expect(decide("https://mail.yahoo.com/inbox").reason).toBe("sensitive");
    expect(decide("https://healthy.mychart.com/app").reason).toBe("sensitive");
    expect(decide("https://news.blocked.example/story").reason).toBe("blocklist");
    expect(decide("https://example.com/login", { hasPassword: true }).reason).toBe("password");
    expect(decide("https://example.com/a", { paused: true }).reason).toBe("paused");
    expect(decide("chrome://settings").reason).toBe("scheme");
    expect(decide("https://example.com/short", { textLength: 20 }).reason).toBe("short");
  });

  it("lets an allowlist entry override the built-in sensitive list", () => {
    expect(decide("https://mail.google.com/mail/u/0/").ok).toBe(true);
    expect(isDomainAllowed("https://www.example.com/story", settings)).toBe(true);
  });

  it("force capture still refuses password pages but allows short notes", () => {
    expect(decide("https://example.com/note", { textLength: 20, force: true }).ok).toBe(true);
    expect(decide("https://example.com/login", { hasPassword: true, force: true }).ok).toBe(false);
  });
});

describe("retention and urls", () => {
  const now = Date.parse("2026-11-20T00:00:00Z");
  it("selects old pages and the last hour", () => {
    const pages = [
      { id: "old", lastSeen: now - 10 * 86400000 },
      { id: "new", lastSeen: now - 1000 },
      { id: "hour", lastSeen: now - 30 * 60 * 1000 },
    ];
    expect(selectExpired(pages, 7, now)).toEqual(["old"]);
    expect(selectExpired(pages, 0, now)).toEqual([]);
    expect(selectSince(pages, now, 3600000)).toEqual(["new", "hour"]);
  });

  it("strips tracking params and hashes", () => {
    expect(normalizeUrl("https://www.Example.com/a/?utm_source=x&b=2&id=1#top")).toBe("https://example.com/a?b=2&id=1");
  });
});

describe("question parsing", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  it("pulls last week and a domain out of a question", () => {
    const parsed = parseQuestion("what did that article last week say about solid-state batteries on example.com", now);
    expect(parsed.range.since).toBe(now - 7 * 86400000);
    expect(parsed.domain).toBe("example.com");
    expect(parsed.query.toLowerCase()).toContain("solid-state batteries");
    expect(parsed.query.toLowerCase()).not.toContain("last week");
  });
});
