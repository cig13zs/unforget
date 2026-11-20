import type { Settings } from "../settings";
import { activeModel, PROVIDER_LABELS } from "../settings";
import { isDomainAllowed } from "../policy";
import type { WeeklyDigest } from "../digest";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Passage {
  n: number;
  url: string;
  title: string;
  domain: string;
  seenAt: number;
  text: string;
  quote: string;
}

export interface AskPacket {
  passages: Passage[];
  messages: ChatMessage[];
  preview: string;
  charCount: number;
}

const PASSAGE_CHARS = 900;
const MAX_PASSAGES = 6;

export function assembleAsk(
  question: string,
  candidates: Passage[],
  settings: Settings,
  history: ChatMessage[] = [],
): AskPacket {
  const allowed = candidates.filter((passage) => passage.text.trim() && isDomainAllowed(passage.url, settings));
  const passages = allowed.slice(0, MAX_PASSAGES).map((passage, index) => ({
    ...passage,
    n: index + 1,
    text: passage.text.length > PASSAGE_CHARS ? `${passage.text.slice(0, PASSAGE_CHARS)}…` : passage.text,
  }));
  const messages = buildAskMessages(question, passages, history);
  const preview = messages.map((message) => message.content).join("\n\n");
  return { passages, messages, preview, charCount: preview.length };
}

export function buildAskMessages(question: string, passages: Passage[], history: ChatMessage[]): ChatMessage[] {
  const block = passages.length
    ? passages
        .map((passage) => {
          const when = new Date(passage.seenAt).toISOString().slice(0, 10);
          return `[${passage.n}] ${passage.title}\n${passage.domain} · ${when}\n${passage.text}\nURL: ${passage.url}`;
        })
        .join("\n\n")
    : "(no matching passages)";
  const prior = history.filter((message) => message.role !== "system").slice(-8);
  return [
    {
      role: "system",
      content: [
        "You answer questions about pages the user has actually read.",
        "Use only the numbered passages below. If they do not contain the answer, say you cannot find it in their reading history.",
        "Cite passages inline as [1] or [2]. Never invent a citation, URL, or page.",
        "",
        "Passages:",
        block,
      ].join("\n"),
    },
    ...prior,
    { role: "user", content: question },
  ];
}

export function assembleSummary(input: { title: string; url: string; text: string }, settings: Settings): AskPacket | null {
  if (!isDomainAllowed(input.url, settings)) return null;
  const text = input.text.slice(0, 6000);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: "Summarize the page in three short paragraphs. Use only the text provided. Do not add facts from outside it.",
    },
    {
      role: "user",
      content: `Title: ${input.title}\nURL: ${input.url}\n\n${text}`,
    },
  ];
  return {
    passages: [
      {
        n: 1,
        url: input.url,
        title: input.title,
        domain: "",
        seenAt: Date.now(),
        text,
        quote: text.slice(0, 160),
      },
    ],
    messages,
    preview: messages.map((message) => message.content).join("\n\n"),
    charCount: text.length,
  };
}

export function assembleDigest(digest: WeeklyDigest, includeExcerpts: boolean): AskPacket {
  const lines = [
    `Week of ${digest.weekId}`,
    `${digest.pageCount} pages, ${Math.round(digest.totalDwellMs / 60000)} minutes`,
    "",
    ...digest.pages.map((page) => {
      const when = new Date(page.lastSeen).toISOString().slice(0, 10);
      const extra = includeExcerpts ? `\n${page.excerpt}` : "";
      return `- ${when} · ${page.domain} · ${page.title}${extra}`;
    }),
  ];
  const body = lines.join("\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: "Write a short weekly reading recap from the list below. Mention specific titles. Do not invent pages that are not listed.",
    },
    { role: "user", content: body },
  ];
  return {
    passages: [],
    messages,
    preview: messages.map((message) => message.content).join("\n\n"),
    charCount: body.length,
  };
}

export function providerBlurb(settings: Settings): string {
  return `${PROVIDER_LABELS[settings.provider]} · ${activeModel(settings)}`;
}
