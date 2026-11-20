import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { exportPages, forgetDomain, forgetExpired, forgetRecent, importPages, totals, type IndexTotals } from "../lib/db";
import { parseExchange, toMarkdown, type ExchangeFile } from "../lib/exchange";
import { formatBytes } from "../lib/format";
import { HOUR_MS } from "../lib/retention";
import {
  activeModel,
  DEFAULT_MODELS,
  PROVIDER_LABELS,
  providerOrigins,
  type ProviderId,
  type Settings,
} from "../lib/settings";
import { loadSettings, saveSettings } from "../lib/settings-store";
import { clearApiKey, keyStatus, saveEncryptedKey, savePlainKey, unlockKey } from "../lib/secrets";
import { Mark } from "../ui/mark";
import "../ui/theme.css";

const PROVIDERS: ProviderId[] = ["anthropic", "openai", "gemini", "openrouter", "compatible"];

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<IndexTotals>({ pages: 0, words: 0, chars: 0 });
  const [usage, setUsage] = useState("Measuring…");
  const [blockText, setBlockText] = useState("");
  const [allowText, setAllowText] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [encrypt, setEncrypt] = useState(false);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof keyStatus>>>("missing");
  const [domain, setDomain] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    const loaded = await loadSettings();
    setSettings(loaded);
    setBlockText(loaded.blocklist.join("\n"));
    setAllowText(loaded.allowlist.join("\n"));
    setStats(await totals());
    setStatus(await keyStatus());
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.usage) {
      const quota = estimate.quota ? ` of ${formatBytes(estimate.quota)}` : "";
      setUsage(`${formatBytes(estimate.usage)}${quota}`);
    } else setUsage("Unavailable");
  }

  function update(patch: Partial<Settings>): void {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveSettings(next);
  }

  async function saveLists(): Promise<void> {
    if (!settings) return;
    const next = await saveSettings({
      ...settings,
      blocklist: blockText.split(/\n+/),
      allowlist: allowText.split(/\n+/),
    });
    setSettings(next);
    setMessage("Blocklist and allowlist saved. Hidden sites stay out of search and Ask. Use Forget this site to delete pages already indexed.");
  }

  async function storeKey(): Promise<void> {
    if (!apiKey.trim()) return;
    if (encrypt) {
      if (passphrase.length < 8) {
        setMessage("Use a passphrase of at least 8 characters. It is not saved.");
        return;
      }
      await saveEncryptedKey(apiKey.trim(), passphrase);
    } else {
      await savePlainKey(apiKey.trim());
    }
    setApiKey("");
    setPassphrase("");
    setStatus(await keyStatus());
    setMessage(encrypt ? "Key encrypted in local storage. It stays unlocked until you close Chrome." : "Key saved unencrypted in chrome.storage.local. It is never synced.");
  }

  async function onProvider(provider: ProviderId): Promise<void> {
    const origins = providerOrigins(provider, settings?.baseUrl ?? "");
    if (origins.length) {
      const granted = await chrome.permissions.request({ origins });
      if (!granted) {
        setMessage("Host permission was not granted, so Ask cannot reach that provider.");
        return;
      }
    }
    update({ provider, aiEnabled: true });
    setMessage(`Ask will use ${PROVIDER_LABELS[provider]}. Only passages you preview are sent there.`);
  }

  async function enableBridge(): Promise<void> {
    const granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
    if (!granted) {
      setMessage("Native messaging was not granted. The desktop bridge stays off.");
      return;
    }
    update({ bridgeEnabled: true });
    await chrome.runtime.sendMessage({ type: "bridge-sync" });
    setMessage("Bridge enabled. Install the local host so desktop agents can read the export.");
  }

  async function download(kind: "json" | "md"): Promise<void> {
    const pages = await exportPages();
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "json") {
      const file: ExchangeFile = { unforget: 1, exportedAt: new Date().toISOString(), pages };
      saveFile(`unforget-${stamp}.json`, JSON.stringify(file, null, 2), "application/json");
    } else {
      saveFile(`unforget-${stamp}.md`, toMarkdown(pages), "text/markdown");
    }
  }

  async function onImport(file: File): Promise<void> {
    setBusy(true);
    try {
      const pages = parseExchange(await file.text());
      const count = await importPages(pages);
      setMessage(`Imported ${count} pages and rebuilt the local index.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <p class="page">Loading options…</p>;

  return (
    <div class="page">
      <a class="brand" href="search.html"><Mark /> Unforget</a>
      <p class="lede">Search every page you've read. These controls stay on this device.</p>

      <section class="section" id="capture">
        <h2>When a page is saved</h2>
        <p class="muted">Unforget waits until you have actually stayed on the page, then keeps the readable text.</p>
        <label class="field">
          Dwell time: {settings.dwellSeconds} seconds
          <input type="range" min={3} max={120} value={settings.dwellSeconds} onInput={(event) => update({ dwellSeconds: Number((event.currentTarget as HTMLInputElement).value) })} />
        </label>
        <label class="field">
          Minimum characters
          <input type="number" min={80} max={8000} value={settings.minChars} onInput={(event) => update({ minChars: Number((event.currentTarget as HTMLInputElement).value) })} />
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.paused} onChange={(event) => update({ paused: (event.currentTarget as HTMLInputElement).checked })} />
          Pause capture
        </label>
      </section>

      <section class="section" id="boundaries">
        <h2>Sites that stay out</h2>
        <p class="muted">Incognito windows are never indexed. Banking, health-portal, and webmail domains are skipped, and so is any page with a password field.</p>
        <label class="check">
          <input type="checkbox" checked={settings.skipSensitive} onChange={(event) => update({ skipSensitive: (event.currentTarget as HTMLInputElement).checked })} />
          Skip built-in banking, health, and email domains
        </label>
        <div class="grid-2">
          <label class="field">
            Blocklist, one domain per line
            <textarea value={blockText} onInput={(event) => setBlockText((event.currentTarget as HTMLTextAreaElement).value)} />
          </label>
          <label class="field">
            Allowlist, one domain per line
            <textarea value={allowText} onInput={(event) => setAllowText((event.currentTarget as HTMLTextAreaElement).value)} />
          </label>
        </div>
        <label class="check">
          <input type="checkbox" checked={settings.allowlistOnly} onChange={(event) => update({ allowlistOnly: (event.currentTarget as HTMLInputElement).checked })} />
          Only save allowlisted domains
        </label>
        <div class="actions">
          <button class="btn" type="button" onClick={() => void saveLists()}>Save lists</button>
        </div>
      </section>

      <section class="section" id="memory">
        <h2>Memory and storage</h2>
        <p>{stats.pages.toLocaleString()} pages · {stats.words.toLocaleString()} words · about {formatBytes(stats.chars)} of text · browser storage {usage}</p>
        <label class="field">
          Delete pages older than this many days (0 keeps them)
          <input type="number" min={0} max={3650} value={settings.retentionDays} onInput={(event) => update({ retentionDays: Number((event.currentTarget as HTMLInputElement).value) })} />
        </label>
        <div class="actions">
          <button class="btn" type="button" onClick={() => void forgetExpired(settings.retentionDays, Date.now()).then((count) => setMessage(`Removed ${count} expired pages.`))}>Apply retention now</button>
          <button class="btn danger" type="button" onClick={() => void forgetRecent(Date.now(), HOUR_MS).then((count) => setMessage(`Forgot ${count} pages from the last hour.`))}>Forget last hour</button>
        </div>
        <div class="actions">
          <input value={domain} placeholder="example.com" aria-label="Domain to forget" onInput={(event) => setDomain((event.currentTarget as HTMLInputElement).value)} />
          <button class="btn danger" type="button" onClick={() => void forgetDomain(domain).then((count) => setMessage(`Removed ${count} pages for ${domain}.`))}>Forget this site</button>
        </div>
        <div class="actions">
          <button class="btn" type="button" onClick={() => void download("json")}>Export JSON</button>
          <button class="btn" type="button" onClick={() => void download("md")}>Export Markdown</button>
          <label class="btn">
            Import JSON
            <input type="file" accept="application/json,.json" hidden onChange={(event) => {
              const file = (event.currentTarget as HTMLInputElement).files?.[0];
              if (file) void onImport(file);
            }} />
          </label>
        </div>
      </section>

      <section class="section" id="ask">
        <h2>Ask your history</h2>
        <p class="muted">Off by default. Your key stays in chrome.storage.local and is never synced. Requests go from this browser straight to the provider you pick. Unforget does not run a server.</p>
        <label class="check">
          <input type="checkbox" checked={settings.aiEnabled} onChange={(event) => update({ aiEnabled: (event.currentTarget as HTMLInputElement).checked })} />
          Enable Ask
        </label>
        <label class="check">
          <input type="checkbox" checked={settings.confirmEachSend} onChange={(event) => update({ confirmEachSend: (event.currentTarget as HTMLInputElement).checked })} />
          Confirm before each question
        </label>
        <div class="actions">
          {PROVIDERS.map((provider) => (
            <button class={settings.provider === provider ? "chip active" : "chip"} type="button" key={provider} onClick={() => void onProvider(provider)}>
              {PROVIDER_LABELS[provider]}
            </button>
          ))}
        </div>
        <label class="field">
          Model ({DEFAULT_MODELS[settings.provider]} if empty)
          <input value={settings.model} placeholder={activeModel(settings)} onInput={(event) => update({ model: (event.currentTarget as HTMLInputElement).value })} />
        </label>
        {settings.provider === "compatible" ? (
          <label class="field">
            OpenAI-compatible base URL
            <input value={settings.baseUrl} onInput={(event) => update({ baseUrl: (event.currentTarget as HTMLInputElement).value })} />
          </label>
        ) : null}
        <p class="small">Key status: {status}. Gemini's API puts the key in the query string; the others use a header. Either way it goes only to that provider over HTTPS.</p>
        <label class="field">
          API key
          <input type="password" value={apiKey} autocomplete="off" onInput={(event) => setApiKey((event.currentTarget as HTMLInputElement).value)} />
        </label>
        <label class="check">
          <input type="checkbox" checked={encrypt} onChange={(event) => setEncrypt((event.currentTarget as HTMLInputElement).checked)} />
          Encrypt the key with a passphrase
        </label>
        {encrypt ? (
          <label class="field">
            Passphrase
            <input type="password" value={passphrase} onInput={(event) => setPassphrase((event.currentTarget as HTMLInputElement).value)} />
          </label>
        ) : null}
        <div class="actions">
          <button class="btn primary" type="button" onClick={() => void storeKey()}>Save key</button>
          <button class="btn" type="button" onClick={() => void unlockKey(passphrase).then((ok) => setMessage(ok ? "Unlocked for this browser session." : "Could not unlock."))}>Unlock</button>
          <button class="btn danger" type="button" onClick={() => void clearApiKey().then(() => setStatus("missing"))}>Remove key</button>
        </div>
      </section>

      <section class="section" id="agents">
        <h2>Desktop agents</h2>
        <p class="muted">Optional. A local native-messaging host writes ~/.unforget/index.json. The unforget-mcp server reads that file and exposes search_history and get_page. It cannot delete anything.</p>
        <button class="btn" type="button" disabled={settings.bridgeEnabled} onClick={() => void enableBridge()}>
          {settings.bridgeEnabled ? "Desktop bridge is on" : "Allow the desktop bridge"}
        </button>
        {settings.bridgeEnabled ? <button class="btn ghost" type="button" onClick={() => update({ bridgeEnabled: false })}>Turn bridge off</button> : null}
        <pre class="small">{`node bridge/install.mjs\nnpx unforget-mcp`}</pre>
      </section>
      {message ? <p class="notice">{message}</p> : null}
      {busy ? <p class="muted">Importing…</p> : null}
    </div>
  );
}

function saveFile(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

render(<App />, document.getElementById("app") as HTMLElement);
