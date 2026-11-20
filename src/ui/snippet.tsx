import type { JSX } from "preact";

export function SnippetText({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (!ranges.length) return <span>{text}</span>;
  const nodes: (string | JSX.Element)[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], index) => {
    const safeStart = Math.max(cursor, Math.min(start, text.length));
    const safeEnd = Math.max(safeStart, Math.min(end, text.length));
    if (safeStart > cursor) nodes.push(text.slice(cursor, safeStart));
    if (safeEnd > safeStart) nodes.push(<mark key={index}>{text.slice(safeStart, safeEnd)}</mark>);
    cursor = safeEnd;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <span>{nodes}</span>;
}
