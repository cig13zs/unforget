# unforget-mcp

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server for a local Unforget export. Desktop agents can search pages you have read. They cannot add, edit, or delete them, and the server does not open a network port.

```bash
npm run build -w unforget-mcp
```

The binary is `mcp/dist/cli.js` (`unforget-mcp`). It speaks newline-delimited JSON-RPC on stdin/stdout and logs only to stderr.

## Where the index comes from

Either:

1. In Unforget, export JSON and point `UNFORGET_INDEX` at that file, or
2. Enable **Desktop bridge** in the extension and run `node bridge/install.mjs`. The host keeps `~/.unforget/index.json` updated while Chrome is open. See [../bridge/README.md](../bridge/README.md).

If the file is missing, the tools return an error that tells you how to create it. They do not create it themselves.

## Tools

| Tool | Arguments | Behavior |
| --- | --- | --- |
| `search_history` | `query` (required), `since` (ISO date), `domain`, `limit` | BM25 search over the export. |
| `get_page` | `url` | One saved page, including its text. |
| `list_recent` | `limit`, `since` | Newest pages first. |

There is no delete or update tool.

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

```json
{
  "mcpServers": {
    "unforget": {
      "command": "node",
      "args": ["/absolute/path/to/unforget/mcp/dist/cli.js"],
      "env": { "UNFORGET_INDEX": "/home/you/.unforget/index.json" }
    }
  }
}
```

Restart Claude Desktop after saving.

## Claude Code

```bash
claude mcp add unforget -- node /absolute/path/to/unforget/mcp/dist/cli.js
```

Set `UNFORGET_INDEX` in the environment Claude Code launches, or pass `--index /path/to/index.json` by adding it to the args.

## Cursor

Put this in `.cursor/mcp.json` in your project, or in Cursor's user MCP settings:

```json
{
  "mcpServers": {
    "unforget": {
      "command": "node",
      "args": ["/absolute/path/to/unforget/mcp/dist/cli.js", "--index", "/home/you/.unforget/index.json"]
    }
  }
}
```

## Google Antigravity

Antigravity takes a local stdio MCP server. Add a server named `unforget` with the same `node` command, `cli.js` argument, and `UNFORGET_INDEX` (or `--index`) as the Cursor snippet. If the settings UI asks for JSON, the Claude Desktop shape above is the one to paste.

## Security

- Read-only. The process only reads the index file.
- Local. It does not bind a port and does not call a model.
- The index file is your reading history. It is written mode `0600` by the bridge. Do not point the server at a shared directory.
- Revoke it by turning **Desktop bridge** off in Unforget, deleting the native-messaging host manifest (see the bridge README), and removing the MCP config. Delete `~/.unforget/index.json` to remove the copy on disk.
- The extension id allowed to talk to the host is fixed: `bikdfibehenngminabomcdhmhmjdiaaj`.

## Publish

`mcp/package.json` is an npm-ready package named `unforget-mcp`. `npm run build -w unforget-mcp` bundles the CLI and the shared search code into `mcp/dist`. This repository does not publish it for you.
