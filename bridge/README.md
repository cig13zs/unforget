# Unforget desktop bridge

Optional. Chrome starts this native-messaging host when Unforget has the bridge turned on. The host's only job is to keep `~/.unforget/index.json` in sync with pages the extension has indexed, so [`unforget-mcp`](../mcp/README.md) can read them.

It does not listen on a port. It does not upload anything. Messages from the extension are either "here are pages" or "delete these URLs from the file".

## Install

From the repository root, after `npm run build` so the extension id is the one you loaded:

```bash
node bridge/install.mjs
```

That marks `bridge/host.mjs` executable and writes `com.unforget.bridge.json` into the Chrome and Chromium native-messaging directories for Linux and macOS. On Windows it prints the `REG ADD` command.

Then, in the extension's Options, click **Allow the desktop bridge** and accept the permission prompt. Restart Chrome if the host does not connect the first time.

The allowed extension id is `bikdfibehenngminabomcdhmhmjdiaaj`. An unpacked build that does not include the public key in `src/extension-key.json` will have a different id and Chrome will refuse the connection. Load the `dist/` folder produced by `npm run build`.

## File

`~/.unforget/index.json` is the same shape as an in-app JSON export:

```json
{
  "unforget": 1,
  "exportedAt": "2026-11-20T00:00:00.000Z",
  "pages": [{ "url": "https://example.com/a", "title": "A", "text": "...", "domain": "example.com" }]
}
```

The host writes it atomically (temp file, then rename) and sets mode `0600`.

You can ignore the bridge and instead export JSON from Options, then set `UNFORGET_INDEX` to that file. The MCP server works either way. The bridge is the live copy.

## Revoke

1. Turn the desktop bridge off in Unforget options.
2. Delete the `com.unforget.bridge.json` file the installer wrote (under `NativeMessagingHosts` for your browser).
3. Delete `~/.unforget` if you want the export gone too.

The extension cannot start the host again until you grant `nativeMessaging` once more.
