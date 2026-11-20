import { openDB, type IDBPDatabase, type IDBPTransaction } from "idb";
import { blendScores, cosine, fnv1a, hashEmbed } from "../../shared/embed";
import { rankBm25, type QueryList, type RankPosting } from "../../shared/bm25";
import { buildSnippet } from "../../shared/snippet";
import { termFrequencies, uniqueTerms } from "../../shared/tokenize";
import type { ExchangePage } from "./exchange";
import { makeExcerpt } from "./extract";
import { isDomainAllowed } from "./policy";
import { selectExpired, selectSince } from "./retention";
import type { Settings } from "./settings";
import { domainMatches } from "./sensitive";
import { domainOf, normalizeUrl } from "./url";

const DB_NAME = "unforget";
const DB_VERSION = 1;

export interface PageMeta {
  id: string;
  url: string;
  title: string;
  domain: string;
  excerpt: string;
  wordCount: number;
  tokenLen: number;
  dwellMs: number;
  firstSeen: number;
  lastSeen: number;
  visits: number;
  visitToken: string;
  appliedDwell: number;
  textHash: string;
}

interface PageBody {
  id: string;
  text: string;
}

interface Posting {
  key: string;
  term: string;
  pageId: string;
  tf: number;
  docLen: number;
  positions: number[];
}

interface Lexeme {
  term: string;
  df: number;
}

interface IndexStats {
  id: "global";
  docCount: number;
  totalLen: number;
  totalWords: number;
  totalChars: number;
}

interface VectorRow {
  id: string;
  vector: number[];
}

interface UnforgetSchema {
  meta: { key: string; value: PageMeta; indexes: { byDomain: string; byLastSeen: number } };
  body: { key: string; value: PageBody };
  postings: { key: string; value: Posting; indexes: { byTerm: string; byPage: string } };
  lexicon: { key: string; value: Lexeme };
  stats: { key: string; value: IndexStats };
  vectors: { key: string; value: VectorRow };
}

export interface PageInput {
  url: string;
  title: string;
  text: string;
  excerpt?: string;
  dwellMs?: number;
  visitToken?: string;
  firstSeen?: number;
  lastSeen?: number;
  visits?: number;
  mode?: "capture" | "import";
}

export interface SearchFilter {
  since?: number;
  until?: number;
  domain?: string;
  minDwellMs?: number;
}

export interface SearchHit {
  url: string;
  title: string;
  domain: string;
  excerpt: string;
  wordCount: number;
  dwellMs: number;
  firstSeen: number;
  lastSeen: number;
  visits: number;
  score: number;
  snippet: string;
  ranges: [number, number][];
  quote: string;
  passage: string;
}

export interface SearchResult {
  hits: SearchHit[];
  hasMore: boolean;
}

export interface IndexTotals {
  pages: number;
  words: number;
  chars: number;
}

type UnforgetDB = IDBPDatabase<UnforgetSchema>;

let dbPromise: Promise<UnforgetDB> | null = null;
let writeTail: Promise<unknown> = Promise.resolve();

function withLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks) return locks.request("unforget-index", work) as Promise<T>;
  const run = writeTail.then(work, work);
  writeTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function open(): Promise<UnforgetDB> {
  if (!dbPromise) {
    dbPromise = openDB<UnforgetSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const meta = db.createObjectStore("meta", { keyPath: "id" });
        meta.createIndex("byDomain", "domain");
        meta.createIndex("byLastSeen", "lastSeen");
        db.createObjectStore("body", { keyPath: "id" });
        const postings = db.createObjectStore("postings", { keyPath: "key" });
        postings.createIndex("byTerm", "term");
        postings.createIndex("byPage", "pageId");
        db.createObjectStore("lexicon", { keyPath: "term" });
        db.createObjectStore("stats", { keyPath: "id" });
        db.createObjectStore("vectors", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export async function resetIndex(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

export function upsertPage(input: PageInput): Promise<void> {
  return withLock(async () => {
    const db = await open();
    await writePage(db, input);
  });
}

export function importPages(pages: readonly ExchangePage[]): Promise<number> {
  return withLock(async () => {
    const db = await open();
    for (const page of pages) {
      await writePage(db, {
        url: page.url,
        title: page.title,
        text: page.text,
        excerpt: page.excerpt,
        dwellMs: page.dwellMs,
        firstSeen: page.firstSeen,
        lastSeen: page.lastSeen,
        visits: page.visits,
        mode: "import",
      });
    }
    return pages.length;
  });
}

export function recordDwell(url: string, dwellMs: number, visitToken: string): Promise<void> {
  return withLock(async () => {
    const db = await open();
    const id = safeId(url);
    if (!id) return;
    const meta = await db.get("meta", id);
    if (!meta || meta.visitToken !== visitToken) return;
    const delta = Math.max(0, Math.round(dwellMs) - meta.appliedDwell);
    meta.dwellMs += delta;
    meta.appliedDwell = Math.round(dwellMs);
    meta.lastSeen = Date.now();
    await db.put("meta", meta);
  });
}

export async function searchPages(
  query: string,
  filter: SearchFilter = {},
  limit = 20,
  offset = 0,
  settings?: Settings,
): Promise<SearchResult> {
  const db = await open();
  const terms = uniqueTerms(query);
  if (!terms.length) return browse(db, filter, limit, offset, settings);

  const stats = (await db.get("stats", "global")) ?? emptyStats();
  const allowed = await allowedIds(db, filter);
  const lists: QueryList[] = [];
  for (const term of terms) {
    const expanded = await expand(db, term);
    if (!expanded.length) continue;
    const merged = new Map<string, RankPosting>();
    let df = 0;
    for (const candidate of expanded) {
      const lex = await db.get("lexicon", candidate);
      df += lex?.df ?? 0;
      const postings = await db.getAllFromIndex("postings", "byTerm", candidate);
      for (const posting of postings) {
        if (allowed && !allowed.has(posting.pageId)) continue;
        const prev = merged.get(posting.pageId);
        if (prev) {
          prev.tf += posting.tf;
          prev.positions.push(...posting.positions);
        } else {
          merged.set(posting.pageId, {
            id: posting.pageId,
            tf: posting.tf,
            docLen: posting.docLen,
            positions: [...posting.positions],
          });
        }
      }
    }
    if (!merged.size) continue;
    const tooCommon = stats.docCount >= 40 && df > stats.docCount * 0.5 && terms.length > 1;
    if (tooCommon) continue;
    lists.push({ term, df, postings: [...merged.values()] });
  }

  const avg = stats.docCount ? stats.totalLen / stats.docCount : 0;
  let ranked = rankBm25(lists, Math.max(stats.docCount, 1), avg);
  if (settings) ranked = ranked.filter((row) => isDomainAllowed(row.id, settings));
  ranked = ranked.slice(0, 200);

  const metas = await Promise.all(ranked.map((row) => db.get("meta", row.id)));
  const kept: { meta: PageMeta; score: number; positions: number[] }[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const meta = metas[i];
    const row = ranked[i];
    if (!meta || !row || !passes(meta, filter)) continue;
    kept.push({ meta, score: row.score, positions: row.positions });
  }

  if (kept.length) {
    const vectors = await Promise.all(kept.map((row) => db.get("vectors", row.meta.id)));
    const queryVector = hashEmbed(terms);
    const blended = blendScores(
      kept.map((row) => row.score),
      vectors.map((vector) => (vector ? cosine(queryVector, vector.vector) : 0)),
      0.8,
    );
    kept.forEach((row, index) => {
      row.score = blended[index] ?? row.score;
    });
    kept.sort((a, b) => b.score - a.score);
  }

  const page = kept.slice(offset, offset + limit);
  const hits = await Promise.all(page.map((row) => hitFromRank(db, row.meta, row.score, row.positions, terms)));
  return { hits, hasMore: offset + limit < kept.length };
}

export async function getPage(url: string): Promise<(PageMeta & { text: string }) | null> {
  const db = await open();
  const id = safeId(url);
  if (!id) return null;
  const meta = await db.get("meta", id);
  if (!meta) return null;
  const body = await db.get("body", id);
  return { ...meta, text: body?.text ?? "" };
}

export function deleteUrls(urls: readonly string[]): Promise<number> {
  const ids = urls.map((url) => safeId(url)).filter((id): id is string => Boolean(id));
  return deleteIds(ids);
}

export function deleteIds(ids: readonly string[]): Promise<number> {
  return withLock(async () => {
    const db = await open();
    return removeIds(db, ids);
  });
}

export function forgetDomain(domain: string): Promise<number> {
  return withLock(async () => {
    const db = await open();
    const metas = await db.getAll("meta");
    const ids = metas.filter((meta) => domainMatches(meta.domain, domain)).map((meta) => meta.id);
    return removeIds(db, ids);
  });
}

export function forgetRecent(now: number, windowMs: number): Promise<number> {
  return withLock(async () => {
    const db = await open();
    const metas = await db.getAll("meta");
    return removeIds(db, selectSince(metas, now, windowMs));
  });
}

export function forgetExpired(retentionDays: number, now: number): Promise<number> {
  return withLock(async () => {
    const db = await open();
    const metas = await db.getAll("meta");
    return removeIds(db, selectExpired(metas, retentionDays, now));
  });
}

export async function listMeta(): Promise<PageMeta[]> {
  const db = await open();
  return db.getAll("meta");
}

export async function totals(): Promise<IndexTotals> {
  const db = await open();
  const stats = (await db.get("stats", "global")) ?? emptyStats();
  return { pages: stats.docCount, words: stats.totalWords, chars: stats.totalChars };
}

export async function exportPages(): Promise<ExchangePage[]> {
  const db = await open();
  const metas = await db.getAll("meta");
  const pages: ExchangePage[] = [];
  for (const meta of metas) {
    const body = await db.get("body", meta.id);
    pages.push({
      url: meta.url,
      title: meta.title,
      domain: meta.domain,
      text: body?.text ?? "",
      excerpt: meta.excerpt,
      dwellMs: meta.dwellMs,
      firstSeen: meta.firstSeen,
      lastSeen: meta.lastSeen,
      visits: meta.visits,
    });
  }
  return pages;
}

export async function relatedTo(url: string, limit = 5, settings?: Settings): Promise<SearchHit[]> {
  const page = await getPage(url);
  if (!page) return [];
  const db = await open();
  const vector = await db.get("vectors", page.id);
  if (!vector) return [];
  const seed = uniqueTerms(page.title).slice(0, 6).join(" ");
  const found = await searchPages(seed || page.title, {}, 40, 0, settings);
  const scored: { hit: SearchHit; score: number }[] = [];
  for (const hit of found.hits) {
    if (hit.url === page.url) continue;
    const other = await db.get("vectors", safeId(hit.url) ?? hit.url);
    if (!other) continue;
    scored.push({ hit, score: cosine(vector.vector, other.vector) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((row) => row.hit);
}

async function writePage(db: UnforgetDB, input: PageInput): Promise<void> {
  const id = safeId(input.url);
  if (!id) return;
  const now = Date.now();
  const title = input.title.trim() || domainOf(id) || id;
  const article = input.text.replace(/\u00a0/g, " ").trim();
  const textHash = `${fnv1a(article).toString(16)}:${article.length}`;
  const existing = await db.get("meta", id);
  const mode = input.mode ?? "capture";
  const incomingDwell = Math.max(0, Math.round(input.dwellMs ?? 0));

  if (existing && mode === "capture" && existing.visitToken && existing.visitToken === (input.visitToken ?? "") && existing.textHash === textHash) {
    const delta = Math.max(0, incomingDwell - existing.appliedDwell);
    existing.dwellMs += delta;
    existing.appliedDwell = incomingDwell;
    existing.lastSeen = now;
    await db.put("meta", existing);
    return;
  }

  const articleFreq = termFrequencies(article);
  const titleFreq = termFrequencies(title);
  const tf = new Map(articleFreq.tf);
  const positions = new Map(articleFreq.positions);
  for (const [term, count] of titleFreq.tf) {
    tf.set(term, (tf.get(term) ?? 0) + count * 3);
    if (!positions.has(term)) positions.set(term, [0]);
  }
  const tokenLen = articleFreq.length + titleFreq.length;
  const words = article ? article.split(/\s+/).filter(Boolean).length : 0;
  const firstSeen = mode === "import" ? input.firstSeen ?? existing?.firstSeen ?? now : existing?.firstSeen ?? now;
  const lastSeen = mode === "import" ? input.lastSeen ?? now : now;
  const visits = mode === "import" ? input.visits ?? 1 : existing ? (existing.visitToken === input.visitToken ? existing.visits : existing.visits + 1) : 1;
  let dwellMs = incomingDwell;
  if (mode === "capture" && existing) {
    if (existing.visitToken && existing.visitToken === input.visitToken) {
      dwellMs = existing.dwellMs + Math.max(0, incomingDwell - existing.appliedDwell);
    } else {
      dwellMs = existing.dwellMs + incomingDwell;
    }
  }
  if (mode === "import") dwellMs = incomingDwell;

  const meta: PageMeta = {
    id,
    url: id,
    title,
    domain: domainOf(id),
    excerpt: input.excerpt?.trim() || makeExcerpt(article),
    wordCount: words,
    tokenLen,
    dwellMs,
    firstSeen,
    lastSeen,
    visits,
    visitToken: input.visitToken ?? "",
    appliedDwell: mode === "import" ? incomingDwell : incomingDwell,
    textHash,
  };

  const tx = db.transaction(["meta", "body", "postings", "lexicon", "stats", "vectors"], "readwrite");
  const stats = (await tx.objectStore("stats").get("global")) ?? emptyStats();
  const oldBody = existing ? await tx.objectStore("body").get(existing.id) : undefined;
  if (existing) {
    await subtractPostings(tx, existing.id);
    stats.docCount = Math.max(0, stats.docCount - 1);
    stats.totalLen = Math.max(0, stats.totalLen - existing.tokenLen);
    stats.totalWords = Math.max(0, stats.totalWords - existing.wordCount);
    stats.totalChars = Math.max(0, stats.totalChars - (oldBody?.text.length ?? 0));
  }

  for (const [term, count] of tf) {
    const posting: Posting = {
      key: postingKey(term, id),
      term,
      pageId: id,
      tf: count,
      docLen: Math.max(tokenLen, 1),
      positions: positions.get(term) ?? [],
    };
    await tx.objectStore("postings").put(posting);
    const lex = (await tx.objectStore("lexicon").get(term)) ?? { term, df: 0 };
    lex.df += 1;
    await tx.objectStore("lexicon").put(lex);
  }

  stats.docCount += 1;
  stats.totalLen += tokenLen;
  stats.totalWords += words;
  stats.totalChars += article.length;
  await tx.objectStore("meta").put(meta);
  await tx.objectStore("body").put({ id, text: article });
  await tx.objectStore("vectors").put({ id, vector: hashEmbed([...articleFreq.tf.keys(), ...titleFreq.tf.keys()]) });
  await tx.objectStore("stats").put(stats);
  await tx.done;
}

type WriteTx = IDBPTransaction<UnforgetSchema, string[], "readwrite">;

async function subtractPostings(tx: WriteTx, pageId: string): Promise<void> {
  const index = tx.objectStore("postings").index("byPage");
  let cursor = await index.openCursor(pageId);
  while (cursor) {
    const posting = cursor.value;
    const lex = await tx.objectStore("lexicon").get(posting.term);
    if (lex) {
      lex.df -= 1;
      if (lex.df <= 0) await tx.objectStore("lexicon").delete(posting.term);
      else await tx.objectStore("lexicon").put(lex);
    }
    await cursor.delete!();
    cursor = await cursor.continue!();
  }
}

async function removeIds(db: UnforgetDB, ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0;
  const tx = db.transaction(["meta", "body", "postings", "lexicon", "stats", "vectors"], "readwrite");
  const stats = (await tx.objectStore("stats").get("global")) ?? emptyStats();
  let removed = 0;
  for (const id of ids) {
    const meta = await tx.objectStore("meta").get(id);
    if (!meta) continue;
    const body = await tx.objectStore("body").get(id);
    await subtractPostings(tx, id);
    await tx.objectStore("meta").delete(id);
    await tx.objectStore("body").delete(id);
    await tx.objectStore("vectors").delete(id);
    stats.docCount = Math.max(0, stats.docCount - 1);
    stats.totalLen = Math.max(0, stats.totalLen - meta.tokenLen);
    stats.totalWords = Math.max(0, stats.totalWords - meta.wordCount);
    stats.totalChars = Math.max(0, stats.totalChars - (body?.text.length ?? 0));
    removed += 1;
  }
  await tx.objectStore("stats").put(stats);
  await tx.done;
  return removed;
}

async function browse(
  db: UnforgetDB,
  filter: SearchFilter,
  limit: number,
  offset: number,
  settings?: Settings,
): Promise<SearchResult> {
  const range = timeRange(filter);
  const index = db.transaction("meta").store.index("byLastSeen");
  let cursor = await index.openCursor(range ?? undefined, "prev");
  const hits: SearchHit[] = [];
  let skipped = 0;
  let extra = false;
  while (cursor) {
    const meta = cursor.value;
    if (passes(meta, filter) && (!settings || isDomainAllowed(meta.url, settings))) {
      if (skipped < offset) skipped += 1;
      else if (hits.length < limit) hits.push(hitFromMeta(meta));
      else {
        extra = true;
        break;
      }
    }
    cursor = await cursor.continue();
  }
  return { hits, hasMore: extra };
}

async function allowedIds(db: UnforgetDB, filter: SearchFilter): Promise<Set<string> | null> {
  if (!filter.since && !filter.until && !filter.domain) return null;
  let ids: Set<string> | null = null;
  if (filter.since || filter.until) {
    const rows = await db.getAllFromIndex("meta", "byLastSeen", timeRange(filter));
    ids = new Set(rows.map((row) => row.id));
  }
  if (filter.domain) {
    const rows = await db.getAll("meta");
    const matched = rows.filter((row) => domainMatches(row.domain, filter.domain ?? "")).map((row) => row.id);
    const domainIds = new Set(matched);
    ids = ids ? new Set([...ids].filter((id) => domainIds.has(id))) : domainIds;
  }
  return ids;
}

async function expand(db: UnforgetDB, term: string): Promise<string[]> {
  const exact = await db.get("lexicon", term);
  if (term.length < 4) return exact ? [term] : [];
  const found: Lexeme[] = [];
  const range = IDBKeyRange.bound(term, `${term}\uffff`);
  let cursor = await db.transaction("lexicon").store.openCursor(range);
  while (cursor) {
    if (cursor.value.term !== term && cursor.value.term.length <= term.length + 8) found.push(cursor.value);
    if (found.length >= 24) break;
    cursor = await cursor.continue();
  }
  found.sort((a, b) => b.df - a.df || a.term.length - b.term.length);
  const prefixes = found.slice(0, 5).map((row) => row.term);
  return exact ? [term, ...prefixes] : prefixes;
}

async function hitFromRank(db: UnforgetDB, meta: PageMeta, score: number, positions: number[], terms: string[]): Promise<SearchHit> {
  const body = await db.get("body", meta.id);
  const text = body?.text ?? "";
  const snippet = buildSnippet(text, positions, terms, 110);
  const passage = buildSnippet(text, positions, terms, 420);
  return {
    ...hitFromMeta(meta),
    score,
    snippet: snippet.text || meta.excerpt,
    ranges: snippet.ranges,
    quote: snippet.quote || meta.excerpt,
    passage: passage.text || snippet.text || meta.excerpt,
  };
}

function hitFromMeta(meta: PageMeta): SearchHit {
  return {
    url: meta.url,
    title: meta.title,
    domain: meta.domain,
    excerpt: meta.excerpt,
    wordCount: meta.wordCount,
    dwellMs: meta.dwellMs,
    firstSeen: meta.firstSeen,
    lastSeen: meta.lastSeen,
    visits: meta.visits,
    score: 0,
    snippet: meta.excerpt,
    ranges: [],
    quote: meta.excerpt,
    passage: meta.excerpt,
  };
}

function passes(meta: PageMeta, filter: SearchFilter): boolean {
  if (filter.since && meta.lastSeen < filter.since) return false;
  if (filter.until && meta.lastSeen > filter.until) return false;
  if (filter.minDwellMs && meta.dwellMs < filter.minDwellMs) return false;
  if (filter.domain && !domainMatches(meta.domain, filter.domain)) return false;
  return true;
}

function timeRange(filter: SearchFilter): IDBKeyRange | null {
  if (!filter.since && !filter.until) return null;
  return IDBKeyRange.bound(filter.since ?? 0, filter.until ?? Number.MAX_SAFE_INTEGER);
}

function postingKey(term: string, pageId: string): string {
  return `${term}\u0000${pageId}`;
}

function safeId(url: string): string | null {
  try {
    return normalizeUrl(url);
  } catch {
    return null;
  }
}

function emptyStats(): IndexStats {
  return { id: "global", docCount: 0, totalLen: 0, totalWords: 0, totalChars: 0 };
}
