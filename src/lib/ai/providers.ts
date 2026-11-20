import type { ProviderId } from "../settings";
import type { ChatMessage } from "./prompt";

export interface LlmRequest {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl?: string;
  messages: ChatMessage[];
}

export interface BuiltHttp {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function buildHttpRequest(request: LlmRequest, stream: boolean): BuiltHttp {
  const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const dialog = request.messages.filter((message) => message.role !== "system");

  if (request.provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": request.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 1200,
        system,
        messages: dialog.map((message) => ({ role: message.role, content: message.content })),
        stream,
      }),
    };
  }

  if (request.provider === "gemini") {
    const path = stream ? "streamGenerateContent" : "generateContent";
    const key = encodeURIComponent(request.apiKey);
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:${path}?key=${key}${stream ? "&alt=sse" : ""}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: dialog.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
      }),
    };
  }

  const base = openaiBase(request);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (request.apiKey) headers.authorization = `Bearer ${request.apiKey}`;
  if (request.provider === "openrouter") headers["x-title"] = "Unforget";
  return {
    url: `${base}/chat/completions`,
    headers,
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: 0.2,
      stream,
    }),
  };
}

export class SseDecoder {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split(/\n\n/);
    this.buffer = parts.pop() ?? "";
    const data: string[] = [];
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        data.push(line.slice(5).trim());
      }
    }
    return data;
  }
}

export function extractDelta(provider: ProviderId, payload: string): string {
  if (!payload || payload === "[DONE]") return "";
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return "";
  }
  if (!json || typeof json !== "object") return "";
  const record = json as Record<string, unknown>;

  if (provider === "anthropic") {
    const delta = record.delta;
    if (delta && typeof delta === "object" && "text" in delta && typeof (delta as { text?: unknown }).text === "string") {
      return (delta as { text: string }).text;
    }
    return "";
  }

  if (provider === "gemini") {
    const candidates = record.candidates;
    if (!Array.isArray(candidates)) return "";
    const parts = (((candidates[0] as { content?: { parts?: { text?: string }[] } } | undefined)?.content?.parts) ?? []);
    return parts.map((part) => part.text ?? "").join("");
  }

  const choices = record.choices;
  if (!Array.isArray(choices) || !choices.length) return "";
  const choice = choices[0] as { delta?: { content?: string }; message?: { content?: string } };
  return choice.delta?.content ?? choice.message?.content ?? "";
}

export async function completeText(request: LlmRequest, fetchImpl: typeof fetch = fetch): Promise<string> {
  const http = buildHttpRequest(request, false);
  const response = await fetchImpl(http.url, { method: "POST", headers: http.headers, body: http.body });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`${response.status} from ${request.provider}. ${detail}`);
  }
  const json: unknown = await response.json();
  return readComplete(request.provider, json);
}

export async function streamText(
  request: LlmRequest,
  onDelta: (chunk: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const http = buildHttpRequest(request, true);
  const response = await fetchImpl(http.url, { method: "POST", headers: http.headers, body: http.body });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`${response.status} from ${request.provider}. ${detail}`);
  }
  if (!response.body) {
    const json: unknown = await response.json();
    const text = readComplete(request.provider, json);
    if (text) onDelta(text);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseDecoder();
  let full = "";
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    for (const payload of sse.push(decoder.decode(step.value, { stream: true }))) {
      const delta = extractDelta(request.provider, payload);
      if (!delta) continue;
      full += delta;
      onDelta(delta);
    }
  }
  return full;
}

function openaiBase(request: LlmRequest): string {
  if (request.provider === "openai") return "https://api.openai.com/v1";
  if (request.provider === "openrouter") return "https://openrouter.ai/api/v1";
  const raw = (request.baseUrl || "http://127.0.0.1:11434/v1").replace(/\/$/, "");
  return raw.endsWith("/v1") ? raw : `${raw}/v1`;
}

function readComplete(provider: ProviderId, json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const record = json as Record<string, unknown>;
  if (provider === "anthropic") {
    const content = record.content;
    if (!Array.isArray(content)) return "";
    return content
      .map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text?: string }).text ?? "") : ""))
      .join("");
  }
  if (provider === "gemini") {
    return extractDelta("gemini", JSON.stringify(json));
  }
  const choices = record.choices;
  if (!Array.isArray(choices) || !choices.length) return "";
  const message = (choices[0] as { message?: { content?: string } }).message;
  return message?.content ?? "";
}
