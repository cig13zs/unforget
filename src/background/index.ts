import { batchPages, deleteMessage, upsertMessage } from "../lib/bridge";
import { capturePage } from "../lib/capture";
import { buildDigest } from "../lib/digest";
import {
  deleteUrls,
  exportPages,
  getPage,
  forgetDomain,
  forgetExpired,
  forgetRecent,
  listMeta,
  recordDwell,
  searchPages,
} from "../lib/db";
import type { ExchangePage } from "../lib/exchange";
import { HOUR_MS } from "../lib/retention";
import { applyBadge, loadSettings } from "../lib/settings-store";

interface CapturePage {
  url: string;
  title: string;
  text: string;
  excerpt?: string;
  dwellMs: number;
  visitToken: string;
  hasPassword: boolean;
}

interface RuntimeMessage {
  type?: string;
  force?: boolean;
  page?: CapturePage;
  url?: string;
  dwellMs?: number;
  visitToken?: string;
  domain?: string;
}

let nativePort: chrome.runtime.Port | null = null;

chrome.runtime.onInstalled.addListener(() => {
  void setup(true);
});

chrome.runtime.onStartup.addListener(() => {
  void setup(false);
});

void setup(false);

async function setup(install: boolean): Promise<void> {
  const settings = await loadSettings();
  await applyBadge(settings.paused);
  await chrome.alarms.create("retention", { periodInMinutes: 12 * 60 });
  await chrome.alarms.create("weekly-digest", { periodInMinutes: 60 * 24 });
  if (install) createMenus();
  chrome.omnibox.setDefaultSuggestion({
    description: "Search pages you have read for <match>%s</match>",
  });
}

function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "save-page",
      title: "Save this page to Unforget",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "forget-page",
      title: "Forget this page",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "search-selection",
      title: 'Search Unforget for "%s"',
      contexts: ["selection"],
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void onMenu(info, tab);
});

async function onMenu(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  if (info.menuItemId === "save-page" && tab?.id) {
    await chrome.tabs.sendMessage(tab.id, { type: "capture-now" });
    return;
  }
  if (info.menuItemId === "forget-page" && tab?.url) {
    await deleteUrls([tab.url]);
    await pushDelete([tab.url]);
    return;
  }
  if (info.menuItemId === "search-selection" && info.selectionText) {
    const url = chrome.runtime.getURL(`search.html?q=${encodeURIComponent(info.selectionText)}`);
    await chrome.tabs.create({ url });
  }
}

chrome.commands.onCommand.addListener((command) => {
  const hash = command === "open-ask" ? "#ask" : "";
  void chrome.tabs.create({ url: chrome.runtime.getURL(`search.html${hash}`) });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "retention") void runRetention();
  if (alarm.name === "weekly-digest") void storeDigest();
});

async function runRetention(): Promise<void> {
  const settings = await loadSettings();
  if (settings.retentionDays > 0) await forgetExpired(settings.retentionDays, Date.now());
}

async function storeDigest(): Promise<void> {
  const metas = await listMeta();
  const digest = buildDigest(
    metas.map((meta) => ({
      url: meta.url,
      title: meta.title,
      domain: meta.domain,
      excerpt: meta.excerpt,
      dwellMs: meta.dwellMs,
      lastSeen: meta.lastSeen,
    })),
    Date.now(),
  );
  await chrome.storage.local.set({ weeklyDigest: digest });
}

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  void suggestFor(text, suggest);
});

async function suggestFor(text: string, suggest: (suggestions: chrome.omnibox.SuggestResult[]) => void): Promise<void> {
  const settings = await loadSettings();
  const { hits } = await searchPages(text, {}, 5, 0, settings);
  suggest(
    hits.map((hit) => ({
      content: hit.url,
      description: `${xml(hit.title)} <dim>— ${xml(hit.domain)}</dim>`,
    })),
  );
}

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  const target = /^https?:\/\//.test(text)
    ? text
    : chrome.runtime.getURL(`search.html?q=${encodeURIComponent(text)}`);
  void openTarget(target, disposition);
});

async function openTarget(url: string, disposition: string): Promise<void> {
  if (disposition === "currentTab") {
    await chrome.tabs.update({ url });
    return;
  }
  await chrome.tabs.create({ url });
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  void _sender;
  void handle(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "Unforget could not finish that.";
      sendResponse({ ok: false, error: text });
    });
  return true;
});

async function handle(message: RuntimeMessage): Promise<unknown> {
  if (message.type === "capture" && message.page) {
    const settings = await loadSettings();
    const decision = await capturePage({ ...message.page, force: message.force }, settings);
    if (decision.ok) await pushCaptured(message.page.url);
    return decision;
  }
  if (message.type === "dwell" && message.url && message.visitToken) {
    await recordDwell(message.url, message.dwellMs ?? 0, message.visitToken);
    return { ok: true };
  }
  if (message.type === "forget-url" && message.url) {
    const removed = await deleteUrls([message.url]);
    await pushDelete([message.url]);
    return { ok: true, removed };
  }
  if (message.type === "forget-domain" && message.domain) {
    const removed = await forgetDomain(message.domain);
    return { ok: true, removed };
  }
  if (message.type === "forget-recent") {
    const removed = await forgetRecent(Date.now(), HOUR_MS);
    return { ok: true, removed };
  }
  if (message.type === "bridge-sync") {
    await fullSync();
    return { ok: true };
  }
  return { ok: false, error: "Unknown message" };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings?.newValue) return;
  const paused = Boolean((changes.settings.newValue as { paused?: boolean }).paused);
  void applyBadge(paused);
});

async function pushCaptured(url: string): Promise<void> {
  const settings = await loadSettings();
  if (!settings.bridgeEnabled) return;
  const page = await getPage(url);
  if (!page) return;
  await postPages([
    {
      url: page.url,
      title: page.title,
      domain: page.domain,
      text: page.text,
      excerpt: page.excerpt,
      dwellMs: page.dwellMs,
      firstSeen: page.firstSeen,
      lastSeen: page.lastSeen,
      visits: page.visits,
    },
  ]);
}

async function pushDelete(urls: string[]): Promise<void> {
  const settings = await loadSettings();
  if (!settings.bridgeEnabled || !nativePort) return;
  nativePort.postMessage(deleteMessage(urls));
}

async function fullSync(): Promise<void> {
  const pages = await exportPages();
  await postPages(pages);
}

async function postPages(pages: ExchangePage[]): Promise<void> {
  const port = await ensurePort();
  if (!port) return;
  for (const batch of batchPages(pages)) port.postMessage(upsertMessage(batch));
}

async function ensurePort(): Promise<chrome.runtime.Port | null> {
  const granted = await chrome.permissions.contains({ permissions: ["nativeMessaging"] });
  if (!granted) return null;
  if (nativePort) return nativePort;
  try {
    nativePort = chrome.runtime.connectNative("com.unforget.bridge");
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
    });
    return nativePort;
  } catch {
    nativePort = null;
    return null;
  }
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
