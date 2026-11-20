import { Readability } from "@mozilla/readability";

export interface ExtractedArticle {
  title: string;
  text: string;
  excerpt: string;
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "NAV", "FOOTER", "SVG", "FORM", "HEADER"]);
const MAX_TEXT = 200_000;

export function extractFromDocument(doc: Document): ExtractedArticle | null {
  let title = doc.title?.trim() ?? "";
  let text = "";
  let excerpt = "";

  try {
    const clone = doc.cloneNode(true);
    if (clone.nodeType === 9) {
      const parsed = new Readability(clone as Document).parse();
      if (parsed) {
        title = parsed.title?.trim() || title;
        text = collapse(parsed.textContent || "");
        excerpt = collapse(parsed.excerpt || "");
      }
    }
  } catch {
    text = "";
  }

  if (text.length < 200) {
    const fallback = fallbackText(doc);
    if (fallback.length > text.length) text = fallback;
  }

  text = text.slice(0, MAX_TEXT).trim();
  if (!text) return null;
  if (!excerpt) excerpt = makeExcerpt(text);
  return { title: title || "Untitled page", text, excerpt };
}

export function makeExcerpt(text: string, max = 280): string {
  const clean = collapse(text);
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const space = slice.lastIndexOf(" ");
  return `${(space > 80 ? slice.slice(0, space) : slice).trim()}…`;
}

function fallbackText(doc: Document): string {
  const root = doc.body;
  if (!root) return "";
  const chunks: string[] = [];
  walk(root, chunks);
  return collapse(chunks.join(" "));
}

function walk(node: Node, chunks: string[]): void {
  if (node.nodeType === 3) {
    const value = node.textContent ?? "";
    if (value.trim()) chunks.push(value);
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  if (SKIP_TAGS.has(el.tagName)) return;
  if (el.getAttribute("aria-hidden") === "true") return;
  for (const child of el.childNodes) walk(child, chunks);
}

function collapse(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}
