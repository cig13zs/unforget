#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { decodeFrames, encodeFrame } from "./protocol.mjs";

const dir = join(homedir(), ".unforget");
const file = join(dir, "index.json");
mkdirSync(dir, { recursive: true, mode: 0o700 });

/** @type {Map<string, object>} */
const pages = new Map();
if (existsSync(file)) {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    for (const page of saved.pages ?? []) {
      if (page && typeof page.url === "string") pages.set(page.url, page);
    }
  } catch (error) {
    process.stderr.write(`unforget bridge could not read the index: ${error}\n`);
  }
}

let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const body = JSON.stringify(
      { unforget: 1, exportedAt: new Date().toISOString(), pages: [...pages.values()] },
      null,
      2,
    );
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, file);
  }, 200);
}

function reply(message) {
  process.stdout.write(encodeFrame(message));
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  try {
    const decoded = decodeFrames(buffer);
    buffer = decoded.rest;
    for (const message of decoded.messages) apply(message);
  } catch (error) {
    process.stderr.write(`unforget bridge: ${error}\n`);
  }
});

process.stdin.on("end", () => {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const body = JSON.stringify(
    { unforget: 1, exportedAt: new Date().toISOString(), pages: [...pages.values()] },
    null,
    2,
  );
  writeFileSync(file, body, { mode: 0o600 });
});

function apply(message) {
  if (message?.type === "upsert-many" && Array.isArray(message.pages)) {
    for (const page of message.pages) {
      if (page && typeof page.url === "string") pages.set(page.url, page);
    }
    scheduleFlush();
    reply({ type: "ok", count: pages.size });
    return;
  }
  if (message?.type === "delete" && Array.isArray(message.urls)) {
    for (const url of message.urls) pages.delete(url);
    scheduleFlush();
    reply({ type: "ok", count: pages.size });
    return;
  }
  if (message?.type === "ping") {
    reply({ type: "pong" });
    return;
  }
  reply({ type: "error", error: "Unknown message" });
}
