import { describe, expect, it } from "vitest";
import { batchPages } from "../../src/lib/bridge";
import { decryptString, encryptString } from "../../src/lib/crypto";
import { parseExchange, toMarkdown } from "../../src/lib/exchange";
import { buildDigest } from "../../src/lib/digest";
import { decodeFrames, encodeFrame } from "../../bridge/protocol.mjs";
import { handleRpc } from "../../mcp/src/server";
import { HistoryStore } from "../../mcp/src/store";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("export, crypto, and the desktop bridge", () => {
  it("round-trips an encrypted key and rejects the wrong passphrase", async () => {
    const blob = await encryptString("sk-test-key", "correct horse");
    expect(blob.ct).not.toContain("sk-test-key");
    expect(await decryptString(blob, "correct horse")).toBe("sk-test-key");
    await expect(decryptString(blob, "nope")).rejects.toThrow();
  });

  it("exports markdown and parses json without requiring extra fields", () => {
    const pages = parseExchange(JSON.stringify({ unforget: 1, pages: [{ url: "https://example.com/a", title: "A", text: "hello world" }] }));
    expect(pages).toHaveLength(1);
    expect(toMarkdown(pages)).toContain("hello world");
    expect(toMarkdown(pages)).toContain("https://example.com/a");
  });

  it("batches pages under the native messaging limit", () => {
    const pages = Array.from({ length: 5 }, (_, index) => ({
      url: `https://example.com/${index}`,
      title: "T",
      domain: "example.com",
      text: "x".repeat(100),
      excerpt: "x",
      dwellMs: 1,
      firstSeen: 1,
      lastSeen: 1,
      visits: 1,
    }));
    const batches = batchPages(pages, 250);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toHaveLength(5);
  });

  it("frames native messages", () => {
    const frame = encodeFrame({ type: "ping" });
    const decoded = decodeFrames(Buffer.concat([frame.subarray(0, 3), frame.subarray(3)]));
    expect(decoded.messages).toEqual([{ type: "ping" }]);
  });

  it("serves read-only MCP search over an export file", () => {
    const dir = mkdtempSync(join(tmpdir(), "unforget-mcp-"));
    const file = join(dir, "index.json");
    writeFileSync(
      file,
      JSON.stringify({
        unforget: 1,
        pages: [
          {
            url: "https://games.example/gta",
            title: "Notes on GTA 6",
            domain: "games.example",
            text: "The trailer notes said GTA 6 is set in Leonida and focuses on a pair of protagonists.",
            excerpt: "Leonida",
            lastSeen: Date.parse("2026-11-18T00:00:00Z"),
            firstSeen: Date.parse("2026-11-18T00:00:00Z"),
            dwellMs: 40000,
            visits: 1,
          },
        ],
      }),
    );
    const store = new HistoryStore(file);
    const response = handleRpc(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_history", arguments: { query: "Leonida" } } },
      store,
    );
    const text = JSON.stringify(response);
    expect(text).toContain("GTA 6");
    expect(text).not.toContain("delete");
    const listed = handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, store);
    const names = JSON.stringify(listed);
    expect(names).toContain("search_history");
    expect(names).toContain("get_page");
    expect(names).not.toContain("forget_page");
    expect(names).not.toContain("delete_page");
  });

  it("builds a weekly digest from titles", () => {
    const now = Date.parse("2026-11-20T00:00:00Z");
    const digest = buildDigest(
      [
        {
          url: "https://example.com/a",
          title: "Sodium batteries",
          domain: "example.com",
          excerpt: "Sodium batteries as a grid storage option",
          dwellMs: 120000,
          lastSeen: now - 86400000,
        },
      ],
      now,
    );
    expect(digest.pageCount).toBe(1);
    expect(digest.topTerms.some((term) => term.term === "sodium")).toBe(true);
  });
});
