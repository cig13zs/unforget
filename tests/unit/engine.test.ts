import { describe, expect, it } from "vitest";
import { MemoryIndex } from "../../shared/bm25";
import { blendScores, cosine, hashEmbed } from "../../shared/embed";
import { buildSnippet, highlightRanges } from "../../shared/snippet";
import { askTerms, stem, tokenize } from "../../shared/tokenize";

describe("tokenize", () => {
  it("stems plurals and drops function words", () => {
    expect(stem("batteries")).toBe("battery");
    expect(stem("electrolytes")).toBe("electrolyte");
    expect(stem("news")).toBe("news");
    expect(tokenize("The batteries and the news")).toEqual(["battery", "news"]);
  });

  it("drops question filler only for ask terms", () => {
    const terms = askTerms("what did that article say about solid-state batteries");
    expect(terms).toContain("solid");
    expect(terms).toContain("battery");
    expect(terms).not.toContain("article");
    expect(terms).not.toContain("about");
  });
});

describe("bm25", () => {
  const index = new MemoryIndex();
  index.add("a", "Solid-state batteries use a ceramic electrolyte and lithium metal anodes.");
  index.add("b", "Chocolate cake recipe with butter and sugar.");
  index.add("c", "Ceramic mugs for coffee on a kitchen shelf.");

  it("ranks the document that actually discusses the query first", () => {
    const hits = index.search("ceramic electrolytes");
    expect(hits[0]?.id).toBe("a");
    expect(hits.map((hit) => hit.id)).not.toContain("b");
  });

  it("matches a prefix of a stemmed word", () => {
    const hits = index.search("electrol");
    expect(hits.map((hit) => hit.id)).toContain("a");
  });

  it("searches a few thousand pages quickly", () => {
    const big = new MemoryIndex();
    for (let i = 0; i < 2000; i++) {
      big.add(`doc-${i}`, `note ${i} about commuting routes and city parks and timetable changes`);
    }
    big.add("needle", "solid state battery ceramic electrolyte laboratory note");
    const started = performance.now();
    const hits = big.search("ceramic electrolyte");
    const elapsed = performance.now() - started;
    expect(hits[0]?.id).toBe("needle");
    expect(elapsed).toBeLessThan(250);
  });
});

describe("snippets and embeddings", () => {
  it("highlights the matching word inside a window", () => {
    const text = "Intro. Researchers describe a ceramic electrolyte that stays stable. Outro.";
    const at = text.indexOf("ceramic");
    const snippet = buildSnippet(text, [at], ["ceramic"], 40);
    expect(snippet.text.toLowerCase()).toContain("ceramic electrolyte");
    expect(snippet.ranges.length).toBeGreaterThan(0);
    expect(highlightRanges("ceramic electrolyte", ["ceramic"])[0]).toEqual([0, 7]);
  });

  it("blends lexical and hashed similarity", () => {
    const left = hashEmbed(["ceramic", "electrolyte", "battery"]);
    const right = hashEmbed(["ceramic", "electrolyte", "battery"]);
    const other = hashEmbed(["chocolate", "cake", "butter"]);
    expect(cosine(left, right)).toBeCloseTo(1, 5);
    expect(cosine(left, other)).toBeLessThan(cosine(left, right));
    const blended = blendScores([2, 2], [1, 0], 0.5);
    expect(blended[0]).toBeGreaterThan(blended[1]);
  });
});
