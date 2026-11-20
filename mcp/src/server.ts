import type { HistoryStore, StoredPage } from "./store";

export interface RpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const TOOLS = [
  {
    name: "search_history",
    description: "Search the local Unforget reading history by full text. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words or a phrase from the page." },
        since: { type: "string", description: "ISO date. Only pages read on or after this moment." },
        domain: { type: "string", description: "Limit to a site, such as example.com." },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_page",
    description: "Fetch one saved page by its exact URL. Read-only.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "list_recent",
    description: "List recently read pages. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        since: { type: "string" },
      },
    },
  },
];

export function handleRpc(message: RpcRequest, store: HistoryStore): RpcResponse | null {
  const method = message.method ?? "";
  if (message.id === undefined || message.id === null) {
    if (method.startsWith("notifications/")) return null;
  }
  if (method === "initialize") {
    const requested = typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "2024-11-05";
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: { name: "unforget", version: "1.0.0" },
      },
    };
  }
  if (method === "ping") return { jsonrpc: "2.0", id: message.id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } };
  if (method === "tools/call") return callTool(message, store);
  return { jsonrpc: "2.0", id: message.id ?? null, error: { code: -32601, message: `Unknown method ${method}` } };
}

function callTool(message: RpcRequest, store: HistoryStore): RpcResponse {
  if (store.isMissing) {
    return text(message.id, `No Unforget index at ${store.path}. Export JSON from the extension or enable the desktop bridge.`, true);
  }
  const name = String(message.params?.name ?? "");
  const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
  if (name === "search_history") {
    const query = String(args.query ?? "");
    const hits = store.search(query, iso(args.since), stringArg(args.domain), numberArg(args.limit, 8));
    return text(message.id, JSON.stringify(hits.map(publicPage), null, 2));
  }
  if (name === "get_page") {
    const page = store.getPage(String(args.url ?? ""));
    if (!page) return text(message.id, "Page not found in the local index.", true);
    return text(message.id, JSON.stringify(publicPage(page), null, 2));
  }
  if (name === "list_recent") {
    const hits = store.recent(numberArg(args.limit, 10), iso(args.since));
    return text(message.id, JSON.stringify(hits.map(publicPage), null, 2));
  }
  return { jsonrpc: "2.0", id: message.id ?? null, error: { code: -32602, message: `Unknown tool ${name}` } };
}

function publicPage(page: StoredPage): StoredPage {
  return page;
}

function text(id: RpcRequest["id"], body: string, isError = false): RpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: body }], isError },
  };
}

function iso(value: unknown): number | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberArg(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(50, Math.floor(number));
}
