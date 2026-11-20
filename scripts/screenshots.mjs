import { chromium } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dist = resolve("dist");
const out = resolve("docs");
mkdirSync(out, { recursive: true });

const now = Date.now();
const day = 86400000;
const pages = [
  {
    url: "https://lab.example/solid-state",
    title: "Solid-state batteries and ceramic electrolytes",
    domain: "lab.example",
    text: "Researchers studying solid-state batteries have turned to a ceramic electrolyte that stays stable beside lithium metal anodes. The ceramic electrolyte conducts ions without a flammable liquid. A dense ceramic electrolyte can block dendrites while still moving lithium ions, which is the practical promise of solid-state batteries.",
    excerpt: "A ceramic electrolyte conducts ions without a flammable liquid.",
    dwellMs: 240000,
    firstSeen: now - 3 * day,
    lastSeen: now - 3 * day,
    visits: 2,
  },
  {
    url: "https://journal.example/creatine-sleep",
    title: "Creatine and sleep, in a small study",
    domain: "journal.example",
    text: "The article said creatine taken in the morning did not change sleep in the small study. Participants reported the same sleep onset. The authors still want a longer trial before anyone changes a routine.",
    excerpt: "Creatine taken in the morning did not change sleep in the small study.",
    dwellMs: 180000,
    firstSeen: now - 2 * day,
    lastSeen: now - 2 * day,
    visits: 1,
  },
  {
    url: "https://games.example/gta-notes",
    title: "Notes on GTA 6",
    domain: "games.example",
    text: "The trailer notes said GTA 6 is set in Leonida and follows a pair of protagonists. Most of the writeup is about the map, not a release date.",
    excerpt: "GTA 6 is set in Leonida and follows a pair of protagonists.",
    dwellMs: 90000,
    firstSeen: now - 6 * day,
    lastSeen: now - 6 * day,
    visits: 1,
  },
  {
    url: "https://grid.example/sodium",
    title: "Sodium batteries for the grid",
    domain: "grid.example",
    text: "Sodium batteries are being tested for grid storage because the materials are abundant. They are a different bet from solid-state lithium cells.",
    excerpt: "Sodium batteries are being tested for grid storage.",
    dwellMs: 150000,
    firstSeen: now - day,
    lastSeen: now - day,
    visits: 1,
  },
];

const exportFile = join(tmpdir(), "unforget-screenshot.json");
writeFileSync(exportFile, JSON.stringify({ unforget: 1, exportedAt: new Date(now).toISOString(), pages }));

const userData = mkdtempSync(join(tmpdir(), "unforget-shot-"));
const context = await chromium.launchPersistentContext(userData, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--headless=new"],
});

let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent("serviceworker");
const id = new URL(worker.url()).host;
const page = await context.newPage();
await page.goto(`chrome-extension://${id}/options.html`);
await page.setInputFiles("input[type=file]", exportFile);
await page.getByText(/Imported/).waitFor();

await page.evaluate(async () => {
  const bag = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: {
      ...bag.settings,
      aiEnabled: true,
      confirmEachSend: true,
      provider: "anthropic",
      aiAcknowledged: false,
      paused: false,
    },
  });
});

await page.goto(`chrome-extension://${id}/search.html?q=${encodeURIComponent("ceramic electrolyte")}`);
await page.getByRole("heading", { name: /Solid-state batteries/ }).waitFor();
await page.screenshot({ path: join(out, "search.png") });

await page.locator("#ask textarea").fill("What did that article say about the ceramic electrolyte?");
await page.getByRole("button", { name: "Find passages" }).click();
await page.getByRole("button", { name: "Send these passages" }).scrollIntoViewIfNeeded();
await page.screenshot({ path: join(out, "ask.png") });

await page.goto(`chrome-extension://${id}/options.html`);
await page.screenshot({ path: join(out, "options.png") });
await context.close();

const promo = await chromium.launch({ headless: true });
const promoPage = await promo.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
await promoPage.goto(pathToFileURL(resolve("docs/promo.html")).href);
await promoPage.screenshot({ path: join(out, "promo-440x280.png") });
await promo.close();
console.log("wrote screenshots");
