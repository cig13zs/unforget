export interface TimedPage {
  id: string;
  lastSeen: number;
}

export function selectExpired(pages: readonly TimedPage[], retentionDays: number, now: number): string[] {
  if (retentionDays <= 0) return [];
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return pages.filter((page) => page.lastSeen < cutoff).map((page) => page.id);
}

export function selectSince(pages: readonly TimedPage[], now: number, windowMs: number): string[] {
  const cutoff = now - windowMs;
  return pages.filter((page) => page.lastSeen >= cutoff).map((page) => page.id);
}

export const HOUR_MS = 60 * 60 * 1000;
