/** FNV-1a. Stable across sessions so stored vectors stay comparable. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export const EMBED_DIMS = 128;

/**
 * On-device feature hashing. No model download, no network, and cheap enough
 * to run while a page is indexed. It is a compressed bag-of-words, so it
 * reranks lexical neighbors; it is not a neural semantic model.
 */
export function hashEmbed(tokens: readonly string[], dims = EMBED_DIMS): number[] {
  const vector = new Float64Array(dims);
  for (const token of tokens) {
    const hash = fnv1a(token);
    const index = hash % dims;
    const sign = (hash & 0x10) === 0 ? 1 : -1;
    vector[index] += sign;
  }
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(dims);
  for (let i = 0; i < dims; i++) out[i] = vector[i] / norm;
  return out;
}

export function cosine(left: readonly number[], right: readonly number[]): number {
  const n = Math.min(left.length, right.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += left[i] * right[i];
  return sum;
}

export function blendScores(bm25: readonly number[], cosines: readonly number[], bm25Weight = 0.78): number[] {
  let max = 0;
  for (const score of bm25) if (score > max) max = score;
  if (max <= 0) max = 1;
  return bm25.map((score, index) => {
    const lexical = score / max;
    const semantic = Math.max(0, cosines[index] ?? 0);
    return bm25Weight * lexical + (1 - bm25Weight) * semantic;
  });
}
