import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { listMeta, relatedTo, searchPages, totals, type IndexTotals, type SearchHit } from "../lib/db";
import { buildDigest, type WeeklyDigest } from "../lib/digest";
import { formatDay, formatDuration, formatRelative, dayKey } from "../lib/format";
import type { Settings } from "../lib/settings";
import { loadSettings, saveSettings } from "../lib/settings-store";
import { currentApiKey } from "../lib/secrets";
import { AskPanel } from "../ui/ask";
import { Mark } from "../ui/mark";
import { openAtPassage } from "../ui/open";
import { SnippetText } from "../ui/snippet";
import "../ui/theme.css";

type View = "results" | "timeline" | "week";

const DWELL = [
  { label: "Any read time", value: 0 },
  { label: "At least 30 seconds", value: 30_000 },
  { label: "At least 2 minutes", value: 120_000 },
  { label: "At least 5 minutes", value: 300_000 },
];

function App() {
  const params = new URLSearchParams(location.search);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [domain, setDomain] = useState(params.get("domain") ?? "");
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [minDwell, setMinDwell] = useState(Number(params.get("min") ?? 0));
  const [view, setView] = useState<View>(location.hash === "#week" ? "week" : "results");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [stats, setStats] = useState<IndexTotals>({ pages: 0, words: 0, chars: 0 });
  const [digest, setDigest] = useState<WeeklyDigest | null>(null);
  const [related, setRelated] = useState<Record<string, SearchHit[]>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    void loadSettings().then(setSettings);
    void currentApiKey().then(setApiKey);
    void totals().then(setStats);
  }, []);

  useEffect(() => {
    if (!settings) return;
    const handle = window.setTimeout(() => {
      void run(0);
    }, 120);
    return () => window.clearTimeout(handle);
  }, [query, domain, from, to, minDwell, settings]);

  useEffect(() => {
    if (view !== "week") return;
    void listMeta().then((metas) => {
      setDigest(
        buildDigest(
          metas.map((meta) => ({
            url: meta.url,
            title: meta.title,
            domain: meta.domain,
            excerpt: meta.excerpt,
            dwellMs: meta.dwellMs,
            lastSeen: meta.lastSeen,
          })),
          Date.now(),
        ),
      );
    });
  }, [view]);

  const groups = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      const key = dayKey(hit.lastSeen);
      const list = map.get(key) ?? [];
      list.push(hit);
      map.set(key, list);
    }
    return [...map.entries()].map(([key, items]) => ({ key, label: formatDay(items[0]?.lastSeen ?? Date.now()), items }));
  }, [hits]);

  async function run(nextOffset: number): Promise<void> {
    if (!settings) return;
    setError("");
    const since = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
    const until = to ? new Date(`${to}T23:59:59`).getTime() : undefined;
    try {
      const result = await searchPages(
        query,
        { domain: domain.trim() || undefined, since, until, minDwellMs: minDwell || undefined },
        20,
        nextOffset,
        settings,
      );
      setHits((current) => (nextOffset === 0 ? result.hits : [...current, ...result.hits]));
      setHasMore(result.hasMore);
      setOffset(nextOffset);
      const url = new URL(location.href);
      if (query) url.searchParams.set("q", query);
      else url.searchParams.delete("q");
      history.replaceState({}, "", url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed.");
    }
  }

  async function showRelated(url: string): Promise<void> {
    if (!settings) return;
    const pages = await relatedTo(url, 4, settings);
    setRelated((current) => ({ ...current, [url]: pages }));
  }

  function updateSettings(next: Settings): void {
    setSettings(next);
    void saveSettings(next);
  }

  if (!settings) return <p class="page">Opening your local index…</p>;

  return (
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="search.html">
          <Mark />
          Unforget
        </a>
        <nav class="nav">
          <a href="#ask">Ask</a>
          <a href="options.html">Options</a>
        </nav>
      </header>
      {settings.paused ? <div class="banner">Paused. Unforget is not saving new pages. Search still works.</div> : null}
      <section class="hero">
        <p class="eyebrow">100% on this device</p>
        <h1>Search every page you've read</h1>
        <p class="lede">Find that article by what it said, not its title. Unforget keeps a private full-text memory of pages you actually stayed on.</p>
        <form
          class="search-row"
          onSubmit={(event) => {
            event.preventDefault();
            void run(0);
          }}
        >
          <input
            name="q"
            type="search"
            value={query}
            placeholder="Try ceramic electrolyte, or the phrase you remember"
            aria-label="Search pages you've read"
            onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
          />
          <button class="btn primary" type="submit">Search</button>
        </form>
        <div class="filters">
          <label>
            From
            <input type="date" value={from} onInput={(event) => setFrom((event.currentTarget as HTMLInputElement).value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onInput={(event) => setTo((event.currentTarget as HTMLInputElement).value)} />
          </label>
          <label>
            Domain
            <input value={domain} placeholder="any site" onInput={(event) => setDomain((event.currentTarget as HTMLInputElement).value)} />
          </label>
          <label>
            Read time
            <select value={minDwell} onChange={(event) => setMinDwell(Number((event.currentTarget as HTMLSelectElement).value))}>
              {DWELL.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div class="view-switch">
          <button class={view === "results" ? "chip active" : "chip"} type="button" onClick={() => setView("results")}>Results</button>
          <button class={view === "timeline" ? "chip active" : "chip"} type="button" onClick={() => setView("timeline")}>Timeline</button>
          <button class={view === "week" ? "chip active" : "chip"} type="button" onClick={() => setView("week")}>This week</button>
          <span class="small muted">{stats.pages.toLocaleString()} pages · {stats.words.toLocaleString()} words</span>
        </div>
      </section>
      <div class="layout">
        <main class="results" aria-live="polite">
          {error ? <p class="error">{error}</p> : null}
          {view === "week" && digest ? <Week digest={digest} /> : null}
          {view !== "week" && hits.length === 0 ? (
            <article class="result">
              <h2>Nothing saved for that yet</h2>
              <p class="muted">Stay on a normal article for a few seconds and it will show up here. Incognito, banking, email, health portals, and pages with password fields are skipped.</p>
            </article>
          ) : null}
          {view === "results" ? hits.map((hit) => (
            <Result key={hit.url} hit={hit} related={related[hit.url]} onRelated={() => void showRelated(hit.url)} />
          )) : null}
          {view === "timeline" ? groups.map((group) => (
            <section key={group.key}>
              <h2 class="timeline-day">{group.label}</h2>
              {group.items.map((hit) => (
                <Result key={hit.url} hit={hit} related={related[hit.url]} onRelated={() => void showRelated(hit.url)} />
              ))}
            </section>
          )) : null}
          {view !== "week" && hasMore ? (
            <button class="btn" type="button" onClick={() => void run(offset + 20)}>More pages</button>
          ) : null}
          <p class="footer-note">Address bar: type uf, then your query. Shortcut: Ctrl+Shift+U, or Command+Shift+U on a Mac.</p>
        </main>
        <AskPanel
          settings={settings}
          apiKey={apiKey}
          onSettings={updateSettings}
          initialQuestion={params.get("ask") ?? ""}
        />
      </div>
    </div>
  );
}

function Result({ hit, related, onRelated }: { hit: SearchHit; related?: SearchHit[]; onRelated: () => void }) {
  return (
    <article class="result" data-url={hit.url}>
      <h2>
        <button type="button" onClick={() => void openAtPassage(hit.url, hit.quote)}>{hit.title}</button>
      </h2>
      <p class="meta">{hit.domain} · {formatRelative(hit.lastSeen)} · {formatDuration(hit.dwellMs)} read</p>
      <p class="snippet">
        <SnippetText text={hit.snippet} ranges={hit.ranges} />
      </p>
      <div class="actions">
        <button class="btn" type="button" onClick={() => void openAtPassage(hit.url, hit.quote)}>Open at passage</button>
        <button class="btn ghost" type="button" onClick={onRelated}>Related pages you've read</button>
      </div>
      {related ? (
        related.length ? (
          <ul class="small">
            {related.map((item) => (
              <li key={item.url}>
                <button class="text-btn" type="button" onClick={() => void openAtPassage(item.url, item.quote)}>{item.title}</button>
                <span class="muted"> · {item.domain}</span>
              </li>
            ))}
          </ul>
        ) : <p class="small muted">No close neighbors in your index yet.</p>
      ) : null}
    </article>
  );
}

function Week({ digest }: { digest: WeeklyDigest }) {
  return (
    <section class="digest">
      <p class="eyebrow">Weekly digest</p>
      <h2>What you read this week</h2>
      <div class="week-grid">
        <div class="statline"><b>{digest.pageCount}</b><div class="small muted">pages</div></div>
        <div class="statline"><b>{formatDuration(digest.totalDwellMs)}</b><div class="small muted">reading time</div></div>
        <div class="statline"><b>{digest.domains.length}</b><div class="small muted">sites</div></div>
      </div>
      <p class="small">{digest.topTerms.map((term) => term.term).join(" · ") || "Terms show up as you read."}</p>
      <ul>
        {digest.pages.slice(0, 12).map((page) => (
          <li key={page.url}>
            <button class="text-btn" type="button" onClick={() => void openAtPassage(page.url, page.excerpt)}>{page.title}</button>
            <span class="muted"> · {page.domain}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

render(<App />, document.getElementById("app") as HTMLElement);
