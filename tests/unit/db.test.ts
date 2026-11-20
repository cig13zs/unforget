import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { capturePage } from "../../src/lib/capture";
import { forgetExpired, forgetRecent, resetIndex, searchPages, totals, upsertPage } from "../../src/lib/db";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";
import { retrieveForQuestion } from "../../src/lib/ai/retrieve";

afterEach(async () => {
  await resetIndex();
});

describe("indexed pages", () => {
  it("stores a readable page and finds it by a phrase, including a prefix", async () => {
    const decision = await capturePage(
      {
        url: "https://lab.example/batteries?utm_source=newsletter",
        title: "Solid-state batteries",
        text: "A ceramic electrolyte lets solid-state batteries run without a flammable liquid. The ceramic electrolyte is the whole story. ".repeat(6),
        dwellMs: 20000,
        visitToken: "visit-1",
        hasPassword: false,
      },
      DEFAULT_SETTINGS,
    );
    expect(decision.ok).toBe(true);
    const found = await searchPages("ceramic electrolyte", {}, 5, 0, DEFAULT_SETTINGS);
    expect(found.hits[0]?.title).toBe("Solid-state batteries");
    expect(found.hits[0]?.snippet.toLowerCase()).toContain("ceramic");
    expect(found.hits[0]?.url).toBe("https://lab.example/batteries");
    const stats = await totals();
    expect(stats.pages).toBe(1);
  });

  it("does not store banking pages or password pages", async () => {
    const bank = await capturePage(
      {
        url: "https://chase.com/account",
        title: "Account",
        text: "Balance UNIQUE_BALANCE_FIGURE and a long enough statement to pass the length check. ".repeat(8),
        dwellMs: 20000,
        visitToken: "v",
        hasPassword: false,
      },
      DEFAULT_SETTINGS,
    );
    expect(bank.ok).toBe(false);
    const password = await capturePage(
      {
        url: "https://news.example/login",
        title: "Login",
        text: "xylophone-ledger-should-not-index ".repeat(30),
        dwellMs: 20000,
        visitToken: "v2",
        hasPassword: true,
      },
      DEFAULT_SETTINGS,
    );
    expect(password.ok).toBe(false);
    const found = await searchPages("xylophone ledger UNIQUE_BALANCE", {}, 5, 0, DEFAULT_SETTINGS);
    expect(found.hits).toHaveLength(0);
  });

  it("forgets the last hour and expired pages", async () => {
    const now = Date.now();
    await upsertPage({
      url: "https://old.example/a",
      title: "Old",
      text: "ancient ceramic note that should expire from the index when retention runs",
      dwellMs: 1000,
      mode: "import",
      firstSeen: now - 40 * 86400000,
      lastSeen: now - 40 * 86400000,
    });
    await upsertPage({
      url: "https://new.example/b",
      title: "New",
      text: "fresh note about sodium batteries written today",
      dwellMs: 1000,
      mode: "import",
      firstSeen: now - 1000,
      lastSeen: now - 1000,
    });
    expect(await forgetRecent(now, 60 * 60 * 1000)).toBe(1);
    expect((await searchPages("sodium", {}, 5)).hits).toHaveLength(0);
    expect(await forgetExpired(30, now)).toBe(1);
    expect((await totals()).pages).toBe(0);
  });

  it("answers from local passages and still hides a blocked site", async () => {
    await upsertPage({
      url: "https://news.example/creatine",
      title: "Creatine and sleep",
      text: "The article said creatine taken in the morning did not change sleep in the small study.",
      dwellMs: 60000,
      mode: "import",
      lastSeen: Date.now() - 2 * 86400000,
    });
    await upsertPage({
      url: "https://secret.example/vault",
      title: "Vault",
      text: "DO_NOT_SEND_THIS_SECRET about creatine",
      dwellMs: 60000,
      mode: "import",
      lastSeen: Date.now() - 86400000,
    });
    const settings = { ...DEFAULT_SETTINGS, blocklist: ["secret.example"] };
    const retrieval = await retrieveForQuestion("what did the article last week say about creatine and sleep?", settings);
    expect(retrieval.packet.preview).toContain("did not change sleep");
    expect(retrieval.packet.preview).not.toContain("DO_NOT_SEND_THIS_SECRET");
  });
});
