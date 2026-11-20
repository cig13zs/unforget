import { upsertPage, type PageInput } from "./db";
import { decideIndex, type IndexDecision } from "./policy";
import type { Settings } from "./settings";

export interface CaptureRequest {
  url: string;
  title: string;
  text: string;
  excerpt?: string;
  dwellMs: number;
  visitToken: string;
  hasPassword: boolean;
  force?: boolean;
}

export async function capturePage(request: CaptureRequest, settings: Settings): Promise<IndexDecision> {
  const decision = decideIndex({
    url: request.url,
    textLength: request.text.trim().length,
    hasPassword: request.hasPassword,
    paused: settings.paused,
    settings,
    force: request.force,
  });
  if (!decision.ok) return decision;
  const page: PageInput = {
    url: request.url,
    title: request.title,
    text: request.text,
    excerpt: request.excerpt,
    dwellMs: request.dwellMs,
    visitToken: request.visitToken,
    mode: "capture",
  };
  await upsertPage(page);
  return { ok: true };
}
