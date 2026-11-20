export interface ExchangePage {
  url: string;
  title: string;
  domain: string;
  text: string;
  excerpt: string;
  dwellMs: number;
  firstSeen: number;
  lastSeen: number;
  visits: number;
}

export interface ExchangeFile {
  unforget: 1;
  exportedAt: string;
  pages: ExchangePage[];
}

export function toMarkdown(pages: readonly ExchangePage[]): string {
  const parts = ["# Unforget", "", "A local export of pages you read. Each section is one page.", ""];
  const ordered = [...pages].sort((a, b) => b.lastSeen - a.lastSeen);
  for (const page of ordered) {
    const when = new Date(page.lastSeen).toISOString().slice(0, 10);
    const minutes = Math.max(1, Math.round(page.dwellMs / 60000));
    parts.push(`## ${page.title || page.url}`, "", `- ${page.url}`, `- ${page.domain} · ${when} · ${minutes} min`, "", page.text.trim(), "");
  }
  return parts.join("\n");
}

export function parseExchange(raw: string): ExchangePage[] {
  const parsed: unknown = JSON.parse(raw);
  const pages = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { pages?: unknown }).pages)
      ? (parsed as { pages: unknown[] }).pages
      : null;
  if (!pages) throw new Error("This file is not an Unforget export.");
  const out: ExchangePage[] = [];
  for (const item of pages) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<ExchangePage>;
    if (typeof row.url !== "string" || typeof row.text !== "string") continue;
    out.push({
      url: row.url,
      title: typeof row.title === "string" ? row.title : row.url,
      domain: typeof row.domain === "string" ? row.domain : "",
      text: row.text,
      excerpt: typeof row.excerpt === "string" ? row.excerpt : row.text.slice(0, 280),
      dwellMs: typeof row.dwellMs === "number" ? row.dwellMs : 0,
      firstSeen: typeof row.firstSeen === "number" ? row.firstSeen : Date.now(),
      lastSeen: typeof row.lastSeen === "number" ? row.lastSeen : Date.now(),
      visits: typeof row.visits === "number" ? row.visits : 1,
    });
  }
  return out;
}
