import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { extractFromDocument } from "../../src/lib/extract";

describe("extraction", () => {
  it("keeps the article and drops the navigation", () => {
    const html = `<!doctype html><html><head><title>Ceramic notes</title></head><body>
      <nav>Subscribe to the newsletter and buy now</nav>
      <article>
        <h1>Ceramic notes</h1>
        <p>The ceramic electrolyte conducts ions without a flammable liquid. This paragraph is the part a reader came for, and it is long enough to stand on its own as the main text of the page.</p>
        <p>Further down, the same ceramic electrolyte is sintered into a thin sheet for solid-state batteries.</p>
      </article>
    </body></html>`;
    const dom = new JSDOM(html, { url: "https://lab.example/ceramic" });
    const article = extractFromDocument(dom.window.document);
    expect(article?.text).toContain("ceramic electrolyte conducts ions");
    expect(article?.text).not.toContain("Subscribe to the newsletter");
    expect(article?.title).toContain("Ceramic");
  });
});
