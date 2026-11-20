import { readFileSync, statSync } from "node:fs";
import { MemoryIndex } from "../../shared/bm25";

export interface StoredPage {
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

export class HistoryStore {
  private mtime = -1;
  private pages: StoredPage[] = [];
  private index = new MemoryIndex();
  private missing = false;

  constructor(private readonly filePath: string) {}

  reload(): void {
    let mtime = -1;
    try {
      mtime = statSync(this.filePath).mtimeMs;
    } catch {
      this.missing = true;
      this.pages = [];
      this.index = new MemoryIndex();
      this.mtime = -1;
      return;
    }
    if (mtime === this.mtime) return;
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as { pages?: unknown[] } | unknown[];
    const rows = Array.isArray(parsed) ? parsed : parsed.pages ?? [];
    this.pages = rows.map((row) => normalize(row)).filter((row): row is StoredPage => row !== null);
    this.index = new MemoryIndex();
    for (const page of this.pages) this.index.add(page.url, `${page.title}\n${page.text}`);
    this.mtime = mtime;
    this.missing = false;
  }

  get path(): string {
    return this.filePath;
  }

  get isMissing(): boolean {
    this.reload();
    return this.missing;
  }

  search(query: string, since?: number, domain?: string, limit = 8): StoredPage[] {
    this.reload();
    const filtered = this.pages.filter((page) => {
      if (since && page.lastSeen < since) return false;
      if (domain && page.domain !== domain && !page.domain.endsWith(`.${domain}`)) return false;
      return true;
    });
    if (!query.trim()) return filtered.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit);
    const allowed = new Set(filtered.map((page) => page.url));
    const byUrl = new Map(filtered.map((page) => [page.url, page]));
    const hits: StoredPage[] = [];
    for (const row of this.index.search(query, 80)) {
      if (!allowed.has(row.id)) continue;
      const page = byUrl.get(row.id);
      if (!page) continue;
      hits.push(page);
      if (hits.length >= limit) break;
    }
    return hits;
  }

  getPage(url: string): StoredPage | null {
    this.reload();
    return this.pages.find((page) => page.url === url) ?? null;
  }

  recent(limit = 10, since?: number): StoredPage[] {
    this.reload();
    return this.pages
      .filter((page) => (since ? page.lastSeen >= since : true))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, limit);
  }
}

function normalize(row: unknown): StoredPage | null {
  if (!row || typeof row !== "object") return null;
  const page = row as Partial<StoredPage>;
  if (typeof page.url !== "string" || typeof page.text !== "string") return null;
  let domain = typeof page.domain === "string" ? page.domain : "";
  if (!domain) {
    try {
      domain = new URL(page.url).hostname.replace(/^www\./, "");
    } catch {
      domain = "";
    }
  }
  return {
    url: page.url,
    title: typeof page.title === "string" ? page.title : page.url,
    domain,
    text: page.text,
    excerpt: typeof page.excerpt === "string" ? page.excerpt : page.text.slice(0, 280),
    dwellMs: typeof page.dwellMs === "number" ? page.dwellMs : 0,
    firstSeen: typeof page.firstSeen === "number" ? page.firstSeen : 0,
    lastSeen: typeof page.lastSeen === "number" ? page.lastSeen : 0,
    visits: typeof page.visits === "number" ? page.visits : 1,
  };
}
