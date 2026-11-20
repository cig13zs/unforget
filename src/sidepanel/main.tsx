import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Settings } from "../lib/settings";
import { loadSettings, saveSettings } from "../lib/settings-store";
import { currentApiKey } from "../lib/secrets";
import { AskPanel } from "../ui/ask";
import { Mark } from "../ui/mark";
import "../ui/theme.css";

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void currentApiKey().then(setApiKey);
  }, []);

  if (!settings) return <p class="page">Loading…</p>;

  return (
    <div class="page">
      <a class="brand" href="search.html"><Mark size={24} /> Unforget</a>
      <AskPanel
        settings={settings}
        apiKey={apiKey}
        compact
        onSettings={(next) => {
          setSettings(next);
          void saveSettings(next);
        }}
      />
      <p class="footer-note"><a href="search.html">Open full search</a></p>
    </div>
  );
}

render(<App />, document.getElementById("app") as HTMLElement);
