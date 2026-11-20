import { chromium, expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dist = resolve("dist");

test("captures a local page and finds it from the search page", async () => {
  const server = await listen();
  const port = (server.address() as { port: number }).port;
  const userData = mkdtempSync(join(tmpdir(), "unforget-e2e-"));
  const context = await chromium.launchPersistentContext(userData, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      "--headless=new",
    ],
  });

  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    const extensionId = new URL(worker.url()).host;

    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/search.html`);
    await setup.evaluate(async () => {
      const bag = await chrome.storage.local.get("settings");
      const settings = bag.settings ?? {};
      await chrome.storage.local.set({
        settings: { ...settings, dwellSeconds: 1, minChars: 80, paused: false, skipSensitive: true },
      });
    });
    await setup.close();

    const article = await context.newPage();
    const indexed = article.waitForEvent("console", {
      predicate: (message) => message.text().includes("unforget: indexed"),
      timeout: 15000,
    });
    await article.goto(`http://127.0.0.1:${port}/batteries`);
    await indexed;

    const login = await context.newPage();
    await login.goto(`http://127.0.0.1:${port}/login`);
    await login.waitForTimeout(2500);

    const search = await context.newPage();
    await search.goto(`chrome-extension://${extensionId}/search.html`);
    await search.locator('input[name="q"]').fill("ceramic electrolyte");
    await expect(search.locator("article.result h2").first()).toContainText("Solid-state", { timeout: 10000 });

    await search.locator('input[name="q"]').fill("xylophone-ledger-should-not-index");
    await expect(search.getByText("Nothing saved for that yet")).toBeVisible();
  } finally {
    await context.close();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

function listen(): Promise<Server> {
  const batteries = readFileSync(join("tests/fixtures/batteries.html"));
  const login = readFileSync(join("tests/fixtures/login.html"));
  const server = createServer((request, response) => {
    const body = request.url?.startsWith("/login") ? login : batteries;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  });
  return new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen(server));
  });
}
