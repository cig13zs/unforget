export interface Snippet {
  text: string;
  ranges: [number, number][];
  quote: string;
}

export function buildSnippet(text: string, positions: number[], terms: string[], radius = 110): Snippet {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { text: "", ranges: [], quote: "" };

  const offsets = uniqueSorted(positions.filter((offset) => offset >= 0 && offset < text.length));
  let sliceStart = 0;
  let sliceEnd = Math.min(text.length, radius * 2);
  if (offsets.length) {
    let best = offsets[0];
    let bestScore = -1;
    const width = radius * 2;
    for (const offset of offsets) {
      const start = Math.max(0, offset - radius);
      const end = start + width;
      let score = 0;
      for (const other of offsets) {
        if (other >= start && other < end) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = start;
      }
    }
    sliceStart = best;
    sliceEnd = Math.min(text.length, best + width);
  }

  if (sliceStart > 0) {
    const space = text.lastIndexOf(" ", sliceStart + 24);
    if (space >= sliceStart - 40 && space !== -1) sliceStart = space + 1;
  }
  if (sliceEnd < text.length) {
    const space = text.lastIndexOf(" ", sliceEnd);
    if (space > sliceStart + 40) sliceEnd = space;
  }

  const raw = text.slice(sliceStart, sliceEnd).replace(/\s+/g, " ").trim();
  const prefix = sliceStart > 0 ? "…" : "";
  const suffix = sliceEnd < text.length ? "…" : "";
  const body = `${prefix}${raw}${suffix}`;
  const quote = raw.split(" ").slice(0, 14).join(" ");
  return { text: body, ranges: highlightRanges(body, terms), quote };
}

export function highlightRanges(snippet: string, terms: string[]): [number, number][] {
  const ranges: [number, number][] = [];
  const lower = snippet.toLowerCase();
  const seen = new Set<string>();
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (needle.length < 2 || seen.has(needle)) continue;
    seen.add(needle);
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      const before = at === 0 || !isWord(snippet.charCodeAt(at - 1));
      const afterAt = at + needle.length;
      const after = afterAt >= snippet.length || !isWord(snippet.charCodeAt(afterAt));
      if (before && after) ranges.push([at, afterAt]);
      else if (before) ranges.push([at, afterAt]);
      from = at + needle.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && range[0] <= prev[1]) prev[1] = Math.max(prev[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

export function fragmentPhrase(quote: string): string {
  const words = quote
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 1)
    .slice(0, 12);
  return words.join(" ");
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function isWord(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
