import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { forgetDomain, forgetRecent, searchPages, totals, type IndexTotals, type SearchHit } from "../lib/db";
import { HOUR_MS } from "../lib/retention";
import { assembleSummary } from "../lib/ai/prompt";
import { streamText } from "../lib/ai/providers";
import { formatBytes, formatDuration, formatRelative } from "../lib/format";
import { isDomainAllowed } from "../lib/policy";
import { activeModel, type Settings } from "../lib/settings";
import { loadSettings, saveSettings } from "../lib/settings-store";
import { currentApiKey } from "../lib/secrets";
import { domainOf } from "../lib/url";
import { Mark } from "../ui/mark";
import { openAtPassage } from "../ui/open";
import { SnippetText } from "../ui/snippet";
import "../ui/theme.css";

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [stats, setStats] = useState<IndexTotals>({ pages: 0, words: 0, chars: 0 });
  const [usage, setUsage] = useState("");
  const [summary, setSummary] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [tabUrl, setTabUrl] = useState("");

  useEffect(() => {
    void loadSettings().then(async (loaded) => {
      setSettings(loaded);
      const found = await searchPages("", {}, 4, 0, loaded);
      setHits(found.hits);
    });
    void totals().then(setStats);
    void navigator.storage?.estimate?.().then((estimate) => {
      if (estimate.usage) setUsage(formatBytes(estimate.usage));
    });
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.url) setTabUrl(tab.url);
    });
  }, []);

  useEffect(() => {
    if (!settings) return;
    const handle = window.setTimeout(() => {
      void searchPages(query, {}, 4, 0, settings).then((result) => setHits(result.hits));
    }, 120);
    return () => window.clearTimeout(handle);
  }, [query, settings]);

  async function togglePause(): Promise<void> {
    if (!settings) return;
    const next = await saveSettings({ ...settings, paused: !settings.paused });
    setSettings(next);
  }

  async function forgetHour(): Promise<void> {
    const removed = await forgetRecent(Date.now(), HOUR_MS);
    setError(removed ? `Removed ${removed} page${removed === 1 ? "" : "s"} from the last hour.` : "Nothing from the last hour was saved.");
    if (settings) setHits((await searchPages(query, {}, 4, 0, settings)).hits);
    setStats(await totals());
  }

  async function forgetSite(): Promise<void> {
    const domain = domainOf(tabUrl);
    if (!domain) return;
    const removed = await forgetDomain(domain);
    setError(`Forgot ${removed} page${removed === 1 ? "" : "s"} on ${domain}.`);
    if (settings) setHits((await searchPages(query, {}, 4, 0, settings)).hits);
    setStats(await totals());
  }

  async function prepareSummary(): Promise<void> {
    setError("");
    setSummary("");
    if (!settings?.aiEnabled) {
      setError("Turn on Ask in Options to summarize with your own model.");
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;
    if (!isDomainAllowed(tab.url, settings)) {
      setError("This site is excluded. Unforget will not send it.");
      return;
    }
    const response = (await chrome.tabs.sendMessage(tab.id, { type: "extract-now" })) as
      | { ok: true; article: { title: string; text: string } }
      | { ok: false; reason?: string };
    if (!response?.ok) {
      setError(response?.reason === "password" ? "This page has a password field, so it stays out of Unforget." : "This page does not have readable text.");
      return;
    }
    const packet = assembleSummary({ title: response.article.title, url: tab.url, text: response.article.text }, settings);
    if (!packet) {
      setError("This site is excluded.");
      return;
    }
    setPreview(packet.preview);
    const key = await currentApiKey();
    if (!key && settings.provider !== "compatible") {
      setError("Add an API key in Options first.");
      return;
    }
    if (settings.confirmEachSend || !settings.aiAcknowledged) return;
    await runSummary(packet.messages, key ?? "");
  }

  async function runSummary(messages: { role: "system" | "user" | "assistant"; content: string }[], key: string): Promise<void> {
    if (!settings) return;
    let text = "";
    await streamText(
      { provider: settings.provider, model: activeModel(settings), apiKey: key, baseUrl: settings.baseUrl, messages },
      (delta) => {
        text += delta;
        setSummary(text);
      },
    );
    if (!settings.aiAcknowledged) setSettings(await saveSettings({ ...settings, aiAcknowledged: true }));
  }

  return (
    <div class="shell">
      <section class="hero">
        <div class="popup-head">
          <div class="brand"><Mark size={26} /> Unforget</div>
          <button class="btn" type="button" onClick={() => void togglePause()}>{settings?.paused ? "Resume" : "Pause"}</button>
        </div>
        <p class="lede">Search every page you've read. The index never leaves this browser unless you turn on Ask.</p>
        <form class="search-row" onSubmit={(event) => event.preventDefault()}>
          <input
            name="q"
            type="search"
            value={query}
            placeholder="Search what a page said"
            aria-label="Quick search"
            onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
          />
        </form>
        <p class="small muted">{stats.pages.toLocaleString()} pages · {stats.words.toLocaleString()} words{usage ? ` · ${usage}` : ""}</p>
      </section>
      {settings?.paused ? <div class="banner">Paused. New pages are not being saved.</div> : null}
      <div class="hit-list">
        {hits.map((hit) => (
          <article class="result" key={hit.url}>
            <h2>
              <button class="text-btn" type="button" onClick={() => void openAtPassage(hit.url, hit.quote)}>{hit.title}</button>
            </h2>
            <p class="meta">{hit.domain} · {formatRelative(hit.lastSeen)} · {formatDuration(hit.dwellMs)}</p>
            <p class="snippet"><SnippetText text={hit.snippet} ranges={hit.ranges} /></p>
          </article>
        ))}
      </div>
      {preview ? <pre class="passage small">{preview.slice(0, 700)}</pre> : null}
      {summary ? <p class="panel small">{summary}</p> : null}
      {error ? <p class="error">{error}</p> : null}
      <div class="actions stack">
        <button class="btn primary" type="button" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("search.html") })}>Open search</button>
        <button class="btn" type="button" onClick={() => void openSide()}>Ask</button>
        <button class="btn ghost" type="button" onClick={() => void prepareSummary()}>Summarize this page</button>
      </div>
      <div class="actions">
        <button class="btn danger" type="button" onClick={() => void forgetHour()}>Forget last hour</button>
        {tabUrl.startsWith("http") ? <button class="btn danger" type="button" onClick={() => void forgetSite()}>Forget this site</button> : null}
      </div>
    </div>
  );
}

async function openSide(): Promise<void> {
  try {
    const win = await chrome.windows.getCurrent();
    if (win.id !== undefined) {
      await chrome.sidePanel.open({ windowId: win.id });
      return;
    }
  } catch {
    // Fall through to the full search page.
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL("search.html#ask") });
}

render(<App />, document.getElementById("app") as HTMLElement);
