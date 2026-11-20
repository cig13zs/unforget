import { searchPages, type SearchHit } from "../db";
import { parseQuestion, type ParsedQuestion } from "../dates";
import type { Settings } from "../settings";
import { askTerms } from "../../../shared/tokenize";
import { assembleAsk, type AskPacket, type Passage } from "./prompt";

export interface Retrieval {
  parsed: ParsedQuestion;
  hits: SearchHit[];
  packet: AskPacket;
}

export async function retrieveForQuestion(
  question: string,
  settings: Settings,
  now = Date.now(),
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<Retrieval> {
  const parsed = parseQuestion(question, now);
  const terms = askTerms(parsed.query);
  const result = await searchPages(
    terms.join(" "),
    { since: parsed.range.since, until: parsed.range.until, domain: parsed.domain },
    8,
    0,
    settings,
  );
  const candidates: Passage[] = result.hits.map((hit, index) => ({
    n: index + 1,
    url: hit.url,
    title: hit.title,
    domain: hit.domain,
    seenAt: hit.lastSeen,
    text: hit.passage || hit.snippet,
    quote: hit.quote,
  }));
  return {
    parsed,
    hits: result.hits,
    packet: assembleAsk(question, candidates, settings, history),
  };
}
