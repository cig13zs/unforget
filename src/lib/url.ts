const TRACKING = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "igshid",
]);

export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING.has(key.toLowerCase())) continue;
    kept.push([key, value]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function domainOf(input: string): string {
  try {
    return new URL(input).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function withTextFragment(pageUrl: string, phrase: string): string {
  const url = new URL(pageUrl);
  if (!phrase.trim()) return url.toString();
  url.hash = `:~:text=${encodeURIComponent(phrase)}`;
  return url.toString();
}

export function highlightStorageKey(pageUrl: string): string {
  return `hl:${normalizeUrl(pageUrl)}`;
}
