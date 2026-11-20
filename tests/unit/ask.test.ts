import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../../src/lib/settings";
import { assembleAsk, buildAskMessages } from "../../src/lib/ai/prompt";
import { buildHttpRequest, extractDelta, SseDecoder } from "../../src/lib/ai/providers";
import type { Passage } from "../../src/lib/ai/prompt";

const secret = "UNIQUE_BANK_TOKEN_should-not-leak";

function passage(url: string, text: string): Passage {
  const domain = new URL(url).hostname;
  return { n: 1, url, title: "Title", domain, seenAt: Date.parse("2026-11-01"), text, quote: text.slice(0, 40) };
}

describe("prompt assembly", () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, blocklist: ["secret.example"] };

  it("omits blocked and sensitive pages from the prompt", () => {
    const packet = assembleAsk(
      "what did I read about batteries?",
      [
        passage("https://secret.example/vault", secret),
        passage("https://mail.google.com/mail/u/0", "inbox private note"),
        passage("https://news.example/batteries", "A ceramic electrolyte inside solid-state batteries."),
      ],
      settings,
    );
    expect(packet.preview).not.toContain(secret);
    expect(packet.preview).not.toContain("inbox private note");
    expect(packet.preview).toContain("ceramic electrolyte");
    expect(packet.passages).toHaveLength(1);
    expect(packet.passages[0]?.n).toBe(1);
    expect(packet.messages[0]?.content).toContain("[1]");
  });

  it("keeps follow-up history and refuses to invent citations in the instructions", () => {
    const messages = buildAskMessages("and the conclusion?", [passage("https://news.example/a", "The conclusion was cautious.")], [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer [1]" },
    ]);
    expect(messages.at(-1)?.content).toBe("and the conclusion?");
    expect(messages[0]?.content).toContain("Never invent a citation");
    expect(messages.some((message) => message.content === "first question")).toBe(true);
  });
});

describe("provider adapters", () => {
  const messages = [
    { role: "system" as const, content: "Use only the passages." },
    { role: "user" as const, content: "What did it say about creatine?" },
  ];

  it("builds Anthropic, OpenAI, Gemini, OpenRouter, and local requests", () => {
    const anthropic = buildHttpRequest({ provider: "anthropic", model: "claude-test", apiKey: "sk-ant-test", messages }, false);
    expect(anthropic.url).toBe("https://api.anthropic.com/v1/messages");
    expect(anthropic.url).not.toContain("sk-ant-test");
    expect(anthropic.headers["x-api-key"]).toBe("sk-ant-test");
    expect(JSON.parse(anthropic.body).system).toContain("passages");

    const openai = buildHttpRequest({ provider: "openai", model: "gpt-test", apiKey: "sk-openai", messages }, true);
    expect(openai.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(openai.headers.authorization).toBe("Bearer sk-openai");
    expect(JSON.parse(openai.body).stream).toBe(true);

    const gemini = buildHttpRequest({ provider: "gemini", model: "gemini-test", apiKey: "gem-key", messages }, false);
    expect(gemini.url).toContain("generativelanguage.googleapis.com");
    expect(gemini.url).toContain("key=gem-key");
    expect(gemini.headers.authorization).toBeUndefined();

    const router = buildHttpRequest({ provider: "openrouter", model: "openai/gpt-test", apiKey: "or-key", messages }, false);
    expect(router.url).toBe("https://openrouter.ai/api/v1/chat/completions");

    const local = buildHttpRequest(
      { provider: "compatible", model: "llama3.2", apiKey: "", baseUrl: "http://127.0.0.1:11434/v1", messages },
      false,
    );
    expect(local.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(local.headers.authorization).toBeUndefined();
  });

  it("parses streamed deltas without mixing providers", () => {
    const decoder = new SseDecoder();
    const first = decoder.push('data: {"choices":[{"delta":{"content":"Hel"}}]}\n');
    expect(first).toEqual([]);
    const second = decoder.push("\ndata: [DONE]\n\n");
    expect(second).toHaveLength(2);
    expect(extractDelta("openai", second[0] ?? "")).toBe("Hel");
    expect(extractDelta("openai", second[1] ?? "")).toBe("");
    expect(extractDelta("anthropic", JSON.stringify({ delta: { type: "text_delta", text: "lo" } }))).toBe("lo");
    expect(extractDelta("gemini", JSON.stringify({ candidates: [{ content: { parts: [{ text: "there" }] } }] }))).toBe("there");
  });
});
