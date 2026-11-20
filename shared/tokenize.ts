export interface TokenHit {
  term: string;
  offset: number;
}

const STOP = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "while",
  "of", "at", "by", "for", "with", "about", "against", "between", "into",
  "through", "during", "before", "after", "above", "below", "to", "from",
  "up", "down", "in", "out", "on", "off", "over", "under", "again", "further",
  "once", "here", "there", "all", "any", "both", "each", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so",
  "than", "too", "very", "can", "will", "just", "should", "now", "what",
  "which", "who", "whom", "this", "that", "these", "those", "am", "is", "are",
  "was", "were", "be", "been", "being", "have", "has", "had", "having", "do",
  "does", "did", "doing", "i", "me", "my", "we", "our", "you", "your", "he",
  "she", "it", "they", "them", "their", "his", "her", "its", "as", "until",
  "how", "why", "where", "your", "ours", "yours", "theirs", "also", "than",
]);

/** Extra words that show up in questions but are poor search terms. */
const ASK_EXTRA = new Set([
  "article", "articles", "page", "pages", "read", "reading", "say", "said",
  "says", "summarize", "summary", "please", "tell", "anything", "something",
  "thing", "things", "week", "month", "year", "yesterday", "today", "ago",
]);

/**
 * Conservative suffix stem so "batteries" and "battery" meet,
 * without dragging short words like "news" into a different token.
 */
export function stem(word: string): string {
  if (word.length <= 4) return word;
  if (word === "news" || word === "series" || word === "species") return word;
  if (word.endsWith("ies") && word.length > 5) return `${word.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/.test(word) && word.length > 6) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) {
    return word.slice(0, -1);
  }
  return word;
}

export function tokenizeDetailed(text: string): TokenHit[] {
  const out: TokenHit[] = [];
  const re = /[a-z0-9]+/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const raw = match[0].toLowerCase();
    if (raw.length < 2 || STOP.has(raw)) continue;
    const term = stem(raw);
    if (term.length < 2 || STOP.has(term)) continue;
    out.push({ term, offset: match.index });
  }
  return out;
}

export function tokenize(text: string): string[] {
  return tokenizeDetailed(text).map((hit) => hit.term);
}

export function uniqueTerms(text: string): string[] {
  return [...new Set(tokenize(text))];
}

export function askTerms(text: string): string[] {
  return [...new Set(tokenize(text).filter((term) => !ASK_EXTRA.has(term)))];
}

export function termFrequencies(text: string): {
  tf: Map<string, number>;
  positions: Map<string, number[]>;
  length: number;
} {
  const tf = new Map<string, number>();
  const positions = new Map<string, number[]>();
  const hits = tokenizeDetailed(text);
  for (const hit of hits) {
    tf.set(hit.term, (tf.get(hit.term) ?? 0) + 1);
    const list = positions.get(hit.term);
    if (list) {
      if (list.length < 12) list.push(hit.offset);
    } else {
      positions.set(hit.term, [hit.offset]);
    }
  }
  return { tf, positions, length: hits.length };
}
