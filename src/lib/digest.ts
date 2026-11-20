import { mondayOf } from "./dates";
import { tokenize } from "../../shared/tokenize";

export interface DigestPage {
  url: string;
  title: string;
  domain: string;
  excerpt: string;
  dwellMs: number;
  lastSeen: number;
}

export interface WeeklyDigest {
  weekId: string;
  from: number;
  to: number;
  pageCount: number;
  totalDwellMs: number;
  domains: { domain: string; count: number; dwellMs: number }[];
  pages: DigestPage[];
  topTerms: { term: string; count: number }[];
}

export function buildDigest(pages: readonly DigestPage[], now: number): WeeklyDigest {
  const from = now - 7 * 24 * 60 * 60 * 1000;
  const recent = pages.filter((page) => page.lastSeen >= from && page.lastSeen <= now);
  const byDomain = new Map<string, { domain: string; count: number; dwellMs: number }>();
  const terms = new Map<string, number>();
  let totalDwellMs = 0;
  for (const page of recent) {
    totalDwellMs += page.dwellMs;
    const row = byDomain.get(page.domain) ?? { domain: page.domain, count: 0, dwellMs: 0 };
    row.count += 1;
    row.dwellMs += page.dwellMs;
    byDomain.set(page.domain, row);
    for (const term of tokenize(`${page.title} ${page.excerpt}`)) {
      terms.set(term, (terms.get(term) ?? 0) + 1);
    }
  }
  const ordered = [...recent].sort((a, b) => b.lastSeen - a.lastSeen);
  return {
    weekId: new Date(mondayOf(now)).toISOString().slice(0, 10),
    from,
    to: now,
    pageCount: recent.length,
    totalDwellMs,
    domains: [...byDomain.values()].sort((a, b) => b.dwellMs - a.dwellMs).slice(0, 8),
    pages: ordered.slice(0, 40),
    topTerms: [...terms.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([term, count]) => ({ term, count })),
  };
}
