#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { handleRpc, type RpcRequest } from "./server";
import { HistoryStore } from "./store";

const indexPath = process.env.UNFORGET_INDEX || flagValue("--index") || join(homedir(), ".unforget", "index.json");
const store = new HistoryStore(indexPath);

const lines = createInterface({ input: process.stdin, terminal: false });
lines.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message: RpcRequest;
  try {
    message = JSON.parse(trimmed) as RpcRequest;
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
    return;
  }
  try {
    const response = handleRpc(message, store);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Tool failed";
    process.stderr.write(`unforget-mcp: ${detail}\n`);
    if (message.id !== undefined) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: detail } })}\n`);
    }
  }
});

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
