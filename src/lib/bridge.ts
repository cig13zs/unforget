import type { ExchangePage } from "./exchange";

/** Native messaging payloads must stay under Chrome's 1MB frame limit. */
export function batchPages(pages: readonly ExchangePage[], maxBytes = 700_000): ExchangePage[][] {
  const batches: ExchangePage[][] = [];
  let current: ExchangePage[] = [];
  let size = 2;
  for (const page of pages) {
    const bytes = JSON.stringify(page).length;
    if (current.length && size + bytes > maxBytes) {
      batches.push(current);
      current = [];
      size = 2;
    }
    current.push(page);
    size += bytes + 1;
  }
  if (current.length) batches.push(current);
  return batches;
}

export interface HostUpsert {
  type: "upsert-many";
  pages: ExchangePage[];
}

export interface HostDelete {
  type: "delete";
  urls: string[];
}

export function upsertMessage(pages: readonly ExchangePage[]): HostUpsert {
  return { type: "upsert-many", pages: [...pages] };
}

export function deleteMessage(urls: readonly string[]): HostDelete {
  return { type: "delete", urls: [...urls] };
}
