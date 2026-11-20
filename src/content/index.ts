import { extractFromDocument } from "../lib/extract";
import { decideIndex } from "../lib/policy";
import { normalizeSettings, type Settings } from "../lib/settings";
import { fragmentPhrase } from "../../shared/snippet";
import { highlightStorageKey } from "../lib/url";

const visitToken = Math.random().toString(36).slice(2);
let dwellMs = 0;
let lastTick = performance.now();
let running = document.visibilityState === "visible" && document.hasFocus();
let saved = false;
let currentUrl = location.href;

function accumulate(): void {
  const now = performance.now();
  if (running) dwellMs += now - lastTick;
  lastTick = now;
}

async function readSettings(): Promise<Settings> {
  const bag = await chrome.storage.local.get("settings");
  return normalizeSettings(bag.settings);
}

function hasPasswordField(): boolean {
  return Boolean(document.querySelector('input[type="password"]'));
}

async function tick(): Promise<void> {
  accumulate();
  if (location.href !== currentUrl) onNavigate();
  if (saved || document.contentType !== "text/html") return;
  const settings = await readSettings();
  if (settings.paused || dwellMs < settings.dwellSeconds * 1000) return;
  await tryCapture(false);
}

async function tryCapture(force: boolean): Promise<void> {
  try {
    const settings = await readSettings();
    const password = hasPasswordField();
    const preview = decideIndex({
      url: location.href,
      textLength: Math.max(settings.minChars, 1),
      hasPassword: password,
      paused: settings.paused,
      settings,
      force,
    });
    if (!preview.ok && preview.reason !== "short") return;
    const article = extractFromDocument(document);
    if (!article) return;
    const decision = (await chrome.runtime.sendMessage({
      type: "capture",
      force,
      page: {
        url: location.href,
        title: article.title,
        text: article.text,
        excerpt: article.excerpt,
        dwellMs: Math.round(dwellMs),
        visitToken,
        hasPassword: password,
      },
    })) as { ok?: boolean } | undefined;
    if (decision?.ok) {
      saved = true;
      console.info("unforget: indexed");
    }
  } catch {
    // The extension was reloaded or the page blocked messaging.
  }
}

function onNavigate(): void {
  const previous = currentUrl;
  const previousDwell = dwellMs;
  const wasSaved = saved;
  currentUrl = location.href;
  dwellMs = 0;
  saved = false;
  lastTick = performance.now();
  if (!wasSaved) return;
  void chrome.runtime.sendMessage({
    type: "dwell",
    url: previous,
    dwellMs: Math.round(previousDwell),
    visitToken,
  });
}

function watchHistory(): void {
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  history.pushState = (...args) => {
    push(...args);
    onNavigate();
  };
  history.replaceState = (...args) => {
    replace(...args);
    onNavigate();
  };
  window.addEventListener("popstate", onNavigate);
  window.addEventListener("hashchange", () => {
    if (location.href.split("#")[0] !== currentUrl.split("#")[0]) onNavigate();
  });
}

function watchFocus(): void {
  const update = (): void => {
    accumulate();
    running = document.visibilityState === "visible" && document.hasFocus();
  };
  document.addEventListener("visibilitychange", update);
  window.addEventListener("focus", update);
  window.addEventListener("blur", update);
  window.addEventListener("pagehide", () => {
    accumulate();
    if (!saved) return;
    void chrome.runtime.sendMessage({
      type: "dwell",
      url: currentUrl,
      dwellMs: Math.round(dwellMs),
      visitToken,
    });
  });
}

function highlightQuote(quote: string): void {
  const needle = quote.trim().toLowerCase();
  if (needle.length < 8 || !document.body) return;
  const styleId = "unforget-hit-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = ".unforget-hit{background:#ffe08a;color:inherit;border-radius:2px;padding:0 .15em;}";
    document.documentElement.appendChild(style);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const slice = needle.slice(0, 48);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? "";
    const at = text.toLowerCase().indexOf(slice);
    if (at >= 0 && node.parentElement && node.parentElement.closest("script,style") === null) {
      try {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, Math.min(text.length, at + slice.length));
        const mark = document.createElement("mark");
        mark.className = "unforget-hit";
        range.surroundContents(mark);
        mark.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        (node.parentElement ?? document.body).scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    node = walker.nextNode();
  }
}

async function highlightPending(): Promise<void> {
  try {
    const key = highlightStorageKey(location.href);
    const bag = await chrome.storage.session.get(key);
    const pending = bag[key] as { quote?: string } | undefined;
    if (!pending?.quote) return;
    await chrome.storage.session.remove(key);
    highlightQuote(fragmentPhrase(pending.quote));
  } catch {
    // Session storage can be unavailable on unusual pages.
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string }, sender, sendResponse) => {
  void sender;
  if (message?.type === "capture-now") {
    void tryCapture(true).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "extract-now") {
    if (hasPasswordField()) {
      sendResponse({ ok: false, reason: "password" });
      return true;
    }
    const article = extractFromDocument(document);
    sendResponse(article ? { ok: true, article } : { ok: false, reason: "empty" });
    return true;
  }
  return false;
});

watchHistory();
watchFocus();
window.setInterval(() => {
  void tick();
}, 1000);
void highlightPending();
