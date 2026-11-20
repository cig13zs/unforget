import { termFrequencies, uniqueTerms } from "./tokenize";

export interface RankPosting {
  id: string;
  tf: number;
  docLen: number;
  positions: number[];
}

export interface QueryList {
  term: string;
  df: number;
  postings: RankPosting[];
}

export interface RankedDoc {
  id: string;
  score: number;
  positions: number[];
}

const K1 = 1.2;
const B = 0.75;

/** BM25 with a strictly positive IDF so rare terms outrank boilerplate. */
export function rankBm25(lists: QueryList[], totalDocs: number, avgLen: number): RankedDoc[] {
  const scores = new Map<string, { score: number; positions: number[] }>();
  const safeAvg = avgLen > 0 ? avgLen : 1;
  const n = Math.max(totalDocs, 1);

  for (const list of lists) {
    if (!list.postings.length) continue;
    const df = Math.max(list.df, list.postings.length);
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    for (const posting of list.postings) {
      const norm = 1 - B + B * (posting.docLen / safeAvg);
      const tfScore = (posting.tf * (K1 + 1)) / (posting.tf + K1 * norm);
      const row = scores.get(posting.id) ?? { score: 0, positions: [] };
      row.score += idf * tfScore;
      for (const offset of posting.positions) row.positions.push(offset);
      scores.set(posting.id, row);
    }
  }

  return [...scores.entries()]
    .map(([id, row]) => ({ id, score: row.score, positions: row.positions }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

export interface MemoryDoc {
  id: string;
  text: string;
}

/**
 * In-memory index used by tests and by the MCP server.
 * The extension persists the same posting shape in IndexedDB.
 */
export class MemoryIndex {
  private docs = new Map<string, { len: number; tf: Map<string, number>; positions: Map<string, number[]> }>();
  private df = new Map<string, number>();
  private lexicon: string[] = [];

  add(id: string, text: string): void {
    this.remove(id);
    const { tf, positions, length } = termFrequencies(text);
    this.docs.set(id, { len: length, tf, positions });
    for (const term of tf.keys()) {
      const next = (this.df.get(term) ?? 0) + 1;
      if (next === 1) insertLexicon(this.lexicon, term);
      this.df.set(term, next);
    }
  }

  remove(id: string): void {
    const existing = this.docs.get(id);
    if (!existing) return;
    for (const term of existing.tf.keys()) {
      const next = (this.df.get(term) ?? 1) - 1;
      if (next <= 0) {
        this.df.delete(term);
        const at = binarySearch(this.lexicon, term);
        if (at >= 0) this.lexicon.splice(at, 1);
      } else {
        this.df.set(term, next);
      }
    }
    this.docs.delete(id);
  }

  search(query: string, limit = 10): RankedDoc[] {
    const terms = uniqueTerms(query);
    if (!terms.length || !this.docs.size) return [];
    const lists: QueryList[] = [];
    for (const term of terms) {
      const expanded = expand(term, this.lexicon, this.df);
      const merged = new Map<string, RankPosting>();
      let df = 0;
      for (const candidate of expanded) {
        df += this.df.get(candidate) ?? 0;
        for (const [id, doc] of this.docs) {
          const tf = doc.tf.get(candidate);
          if (!tf) continue;
          const prev = merged.get(id);
          if (prev) {
            prev.tf += tf;
            prev.positions.push(...(doc.positions.get(candidate) ?? []));
          } else {
            merged.set(id, {
              id,
              tf,
              docLen: doc.len,
              positions: [...(doc.positions.get(candidate) ?? [])],
            });
          }
        }
      }
      lists.push({ term, df, postings: [...merged.values()] });
    }
    let totalLen = 0;
    for (const doc of this.docs.values()) totalLen += doc.len;
    const avg = totalLen / this.docs.size;
    return rankBm25(lists, this.docs.size, avg).slice(0, limit);
  }

  get size(): number {
    return this.docs.size;
  }
}

function insertLexicon(lexicon: string[], term: string): void {
  const at = binarySearch(lexicon, term);
  if (at < 0) lexicon.splice(~at, 0, term);
}

function binarySearch(sorted: string[], term: string): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = sorted[mid];
    if (value === term) return mid;
    if (value < term) lo = mid + 1;
    else hi = mid - 1;
  }
  return ~lo;
}

export function expandTerm(term: string, lexicon: readonly string[], df: ReadonlyMap<string, number>): string[] {
  return expand(term, lexicon, df);
}

function expand(term: string, lexicon: readonly string[], df: ReadonlyMap<string, number>): string[] {
  const exact = df.has(term) ? [term] : [];
  if (term.length < 4) return exact;
  const start = lowerBound(lexicon, term);
  const endKey = `${term}\uffff`;
  const prefixed: { term: string; df: number }[] = [];
  for (let i = start; i < lexicon.length; i++) {
    const candidate = lexicon[i];
    if (candidate > endKey || !candidate.startsWith(term)) break;
    if (candidate === term) continue;
    if (candidate.length > term.length + 8) continue;
    prefixed.push({ term: candidate, df: df.get(candidate) ?? 0 });
    if (prefixed.length > 24) break;
  }
  prefixed.sort((a, b) => b.df - a.df || a.term.length - b.term.length);
  return [...exact, ...prefixed.slice(0, 5).map((item) => item.term)];
}

function lowerBound(sorted: readonly string[], term: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < term) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
