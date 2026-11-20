import { useState } from "preact/hooks";
import type { Settings } from "../lib/settings";
import { providerBlurb } from "../lib/ai/prompt";
import type { Passage } from "../lib/ai/prompt";
import { retrieveForQuestion } from "../lib/ai/retrieve";
import { streamText } from "../lib/ai/providers";
import { activeModel } from "../lib/settings";
import { openAtPassage } from "./open";
import { saveSettings } from "../lib/settings-store";

interface Turn {
  role: "user" | "assistant";
  content: string;
  passages?: Passage[];
}

export function AskPanel({
  settings,
  apiKey,
  onSettings,
  compact = false,
  initialQuestion = "",
}: {
  settings: Settings;
  apiKey: string | null;
  onSettings: (settings: Settings) => void;
  compact?: boolean;
  initialQuestion?: string;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<{ question: string; passages: Passage[]; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function prepare(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError("");
    setBusy(true);
    try {
      const history = turns.map(({ role, content }) => ({ role, content }));
      const retrieval = await retrieveForQuestion(trimmed, settings, Date.now(), history);
      if (!retrieval.packet.passages.length) {
        setTurns((current) => [
          ...current,
          { role: "user", content: trimmed },
          {
            role: "assistant",
            content: "Nothing in your reading history matched that. Nothing was sent to a model.",
          },
        ]);
        setQuestion("");
        setPending(null);
        return;
      }
      const next = {
        question: trimmed,
        passages: retrieval.packet.passages,
        preview: retrieval.packet.preview,
      };
      setPending(next);
      setQuestion("");
      const mustConfirm = settings.confirmEachSend || !settings.aiAcknowledged;
      if (!mustConfirm) await send(next, history);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not search your history.");
    } finally {
      setBusy(false);
    }
  }

  async function send(
    packet: { question: string; passages: Passage[]; preview: string },
    history = turns.map(({ role, content }) => ({ role, content })),
  ): Promise<void> {
    if (!settings.aiEnabled) {
      setError("Ask is off. Turn it on in Options when you want a model to see these passages.");
      return;
    }
    if (!apiKey && settings.provider !== "compatible") {
      setError("Add your API key in Options. It stays in chrome.storage.local on this device.");
      return;
    }
    setBusy(true);
    setError("");
    if (!settings.aiAcknowledged) onSettings(await saveSettings({ ...settings, aiAcknowledged: true }));
    setTurns((current) => [
      ...current,
      { role: "user", content: packet.question },
      { role: "assistant", content: "", passages: packet.passages },
    ]);
    setPending(null);
    try {
      const retrieval = await retrieveForQuestion(packet.question, settings, Date.now(), history);
      let answer = "";
      await streamText(
        {
          provider: settings.provider,
          model: activeModel(settings),
          apiKey: apiKey ?? "",
          baseUrl: settings.baseUrl,
          messages: retrieval.packet.messages,
        },
        (delta) => {
          answer += delta;
          const snapshot = answer;
          setTurns((current) => {
            const copy = [...current];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: snapshot };
            return copy;
          });
        },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The model request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class={compact ? "panel" : "ask"} id="ask">
      <p class="eyebrow">Ask your history</p>
      <h2>Ask AI about anything you've read</h2>
      <p class="small muted">
        Unforget searches this device first. Only the passages in the preview are sent, and only if you have turned Ask on.
        {settings.aiEnabled ? ` ${providerBlurb(settings)}.` : " Ask is off."}
      </p>
      <div class="thread" aria-live="polite">
        {turns.map((turn, index) => (
          <div class={`bubble ${turn.role}`} key={index}>
            {turn.role === "assistant" ? (
              <>
                <Answer text={turn.content} passages={turn.passages ?? []} />
                {turn.passages?.length ? (
                  <p class="small muted">Sent {turn.passages.length} passage{turn.passages.length === 1 ? "" : "s"} from your history.</p>
                ) : null}
              </>
            ) : (
              turn.content
            )}
          </div>
        ))}
      </div>
      {pending ? (
        <div class="passage">
          <strong>What will be sent · {pending.preview.length.toLocaleString()} characters</strong>
          <p class="small muted">These passages leave the device only after you send them. The rest of your history stays here.</p>
          {pending.passages.map((passage) => (
            <p key={passage.n} class="small">
              <b>[{passage.n}]</b> {passage.title} · {passage.domain}
              <br />
              {passage.text.slice(0, 280)}
            </p>
          ))}
          <div class="actions">
            <button class="btn primary" type="button" disabled={busy} onClick={() => void send(pending)}>
              Send these passages
            </button>
            <button class="btn ghost" type="button" onClick={() => setPending(null)}>
              Don't send
            </button>
          </div>
        </div>
      ) : null}
      <form
        class="ask-box"
        onSubmit={(event) => {
          event.preventDefault();
          void prepare(question);
        }}
      >
        <textarea
          rows={compact ? 3 : 4}
          placeholder="What did that article last week say about solid-state batteries?"
          value={question}
          aria-label="Ask your history"
          onInput={(event) => setQuestion((event.currentTarget as HTMLTextAreaElement).value)}
        />
        <div class="actions">
          <button class="btn primary" type="submit" disabled={busy || !question.trim()}>
            {busy ? "Searching…" : "Find passages"}
          </button>
          <label class="check">
            <input
              type="checkbox"
              checked={settings.confirmEachSend}
              onChange={(event) => onSettings({ ...settings, confirmEachSend: (event.currentTarget as HTMLInputElement).checked })}
            />
            Confirm every question
          </label>
        </div>
      </form>
      {error ? <p class="error">{error}</p> : null}
    </section>
  );
}

function Answer({ text, passages }: { text: string; passages: Passage[] }) {
  if (!text) return <span class="muted">Waiting for the model…</span>;
  const parts = text.split(/(\[\d+\])/g);
  return (
    <span>
      {parts.map((part, index) => {
        const match = /^\[(\d+)\]$/.exec(part);
        if (!match) return <span key={index}>{part}</span>;
        const passage = passages.find((item) => item.n === Number(match[1]));
        if (!passage) return <span key={index}>{part}</span>;
        return (
          <button key={index} type="button" class="cite" onClick={() => void openAtPassage(passage.url, passage.quote)}>
            {match[1]}
          </button>
        );
      })}
    </span>
  );
}
