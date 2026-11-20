# Privacy

Unforget is a local memory of pages you read. The developer does not operate an account system, a sync server, or analytics. This document is the privacy policy for the extension.

## What stays on the device

When capture is on, and only after you have had the page in the foreground for the dwell time you set (15 seconds by default), Unforget stores:

- the page URL, with the fragment and common tracking parameters removed
- the title and the readable article text
- when you read it, how long you stayed, and how many visits
- a local search index (word postings and a small numeric vector)

That data lives in IndexedDB inside the extension. Settings live in `chrome.storage.local`. If you save an API key, it lives there too, never in `chrome.storage.sync`. You can encrypt the key with a passphrase. The passphrase is not written to disk. While Chrome is open, the unlocked key is held in `chrome.storage.session`.

Unforget does not run in incognito windows (`incognito: not_allowed`).

## What is never indexed

Capture is refused, and the article text is not even read out of the page, when any of these are true:

- the extension is paused
- the URL is not `http` or `https` (`chrome://`, `file://`, the extension itself)
- the top document contains a password field
- the host is on the built-in banking, health-portal, or webmail list, unless you put that host on your allowlist
- the host matches your blocklist
- you turned on allowlist-only mode and the host is not listed
- the readable text is shorter than the minimum you set, unless you explicitly choose **Save this page**

A site you later block is hidden from search and from Ask. Use **Forget this site** to delete copies already stored. **Forget last hour** deletes pages whose last reading time is inside the past hour. Retention, if you set a number of days, deletes older pages on a schedule.

## Network

With Ask off and the desktop bridge off, Unforget does not request host permissions and does not make network calls. Fonts and the readability extractor are bundled. The similarity vector is computed locally. There is no model download.

If you turn Ask on:

1. Unforget searches the local index and builds a short list of passages.
2. It shows those passages, the character count, and the provider before the request.
3. The first send, and any later send while **Confirm every question** is on, waits for you to click **Send these passages**.
4. The request goes from this browser straight to the provider you picked. Unforget's author does not receive the text or the key.
5. Host permission is requested at that moment, only for that provider's origin. A custom Ollama, LM Studio, or other OpenAI-compatible base URL is requested as that exact origin.

Blocked and sensitive pages are removed from the prompt even if an older copy is still in the database.

Gemini's HTTP API places the key in the query string. The other providers send it in a header. In every case the key is sent only to the host you approved, over the URL you configured.

Per-page summary and the optional weekly AI recap use the same preview rule. The weekly digest you see in the extension is computed locally and does not contact a model unless you ask it to.

## Desktop bridge

If you allow the desktop bridge, the extension asks for the `nativeMessaging` permission and talks to a local host you installed. That host writes `~/.unforget/index.json` with file mode `0600`. The file contains the same page text as the export. `unforget-mcp` reads the file. It does not open a port, does not delete pages, and does not upload them. Remove the native-messaging manifest and turn the bridge off to revoke it. Delete `~/.unforget` to remove the export file.

## Export

JSON and Markdown exports are files you download yourself. They do not include the API key. Importing a file rewrites the local index. Treat the export like a copy of your reading history.

## Data the developer collects

None. There is no telemetry. Publishing this extension does not give the author your pages, your key, or your queries.

## Store data-use answers

See [STORE_LISTING.md](STORE_LISTING.md) for the Chrome Web Store disclosure answers that match this policy.
