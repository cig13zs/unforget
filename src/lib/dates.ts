export interface TimeRange {
  since?: number;
  until?: number;
}

export interface ParsedQuestion {
  query: string;
  range: TimeRange;
  domain?: string;
}

const RELATIVE: { pattern: RegExp; days: number }[] = [
  { pattern: /\byesterday\b/gi, days: 1 },
  { pattern: /\btoday\b/gi, days: 1 },
  { pattern: /\b(?:this|last|past)\s+week\b/gi, days: 7 },
  { pattern: /\b(?:this|last|past)\s+month\b/gi, days: 31 },
  { pattern: /\b(?:this|last|past)\s+year\b/gi, days: 365 },
];

export function parseQuestion(question: string, now: number): ParsedQuestion {
  let text = question;
  let since: number | undefined;
  const day = 24 * 60 * 60 * 1000;

  for (const rule of RELATIVE) {
    if (rule.pattern.test(text)) {
      since = now - rule.days * day;
      text = text.replace(rule.pattern, " ");
    }
    rule.pattern.lastIndex = 0;
  }

  const counted = text.match(/\b(?:in the )?(?:last|past)\s+(\d+)\s+days?\b/i);
  if (counted) {
    since = now - Number(counted[1]) * day;
    text = text.replace(counted[0], " ");
  }

  let domain: string | undefined;
  const host = text.match(/\b(?:on|from|at)\s+((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i);
  if (host) {
    domain = host[1].toLowerCase().replace(/^www\./, "");
    text = text.replace(host[0], " ");
  }

  return {
    query: text.replace(/\s+/g, " ").trim(),
    range: since === undefined ? {} : { since },
    domain,
  };
}

export function mondayOf(now: number): number {
  const date = new Date(now);
  const day = date.getDay();
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((day + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

export function weekId(now: number): string {
  return new Date(mondayOf(now)).toISOString().slice(0, 10);
}
