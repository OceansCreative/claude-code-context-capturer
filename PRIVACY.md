# Privacy Policy

Last updated: June 3, 2026

## Overview

Claude Code Context Capturer ("the extension") is a browser extension that converts the web page you are currently viewing into Markdown text and either copies it to your clipboard or appends it to a file you have explicitly linked. This document describes what data the extension handles and how.

## Data we DO NOT collect

The extension does not collect, transmit, sell, or share any of the following:

- Personal information (name, email, etc.)
- Browsing history
- Page content of pages you visit
- IP address
- Usage analytics or telemetry
- Cookies or tracking identifiers

The extension itself does not communicate with any external server. The only outbound network traffic happens **inside the page you are capturing**, and only when you explicitly trigger a capture — see "claude.ai conversation capture" below.

## Data we DO process locally

The extension processes the following on your device only:

| Data | Purpose | Storage location |
|---|---|---|
| The HTML of the page you actively choose to capture | Convert it to Markdown for you | Memory only — discarded after the operation |
| Your selected text (if you use "Capture selection") | Convert it to Markdown for you | Memory only — discarded after the operation |
| The Markdown output | Place it on your system clipboard | System clipboard (managed by your OS) |
| Buffered captures (if you opt into "Append to buffer" mode) | Let you export multiple captures together later | `chrome.storage.local` on your device |
| Linked CLAUDE.md file handles (if you opt into "Append to linked CLAUDE.md file" mode, v0.2.0+) | Persist the FileSystemFileHandle the user picked so subsequent captures can append to the same file | `IndexedDB` on your device |
| URL routing rules (v0.3.0+) | Route different sites to different `CLAUDE.md` files | `IndexedDB` on your device |
| MCP captures directory handle and stored capture files (if you opt into the MCP store mode, v0.5.0+) | Persist captures as individual Markdown files that the bundled MCP server can hand to Claude Code on demand; dedupe keys let re-captures overwrite the right file | `FileSystemDirectoryHandle` in `IndexedDB`; capture files in the directory you picked, on your disk |
| Your settings (frontmatter on/off, locale, default mode, etc.) | Persist your preferences | `chrome.storage.sync` on your device, optionally synced via your Chrome account |

None of this data leaves your device through the extension.

## claude.ai conversation capture (v0.4.0+)

When you capture a conversation on `claude.ai/chat/<id>`:

- The extension calls **claude.ai's own internal REST API** (`/api/organizations` and `/api/organizations/{org}/chat_conversations/{id}?tree=True`) **from within the claude.ai tab itself**, using your already-authenticated session
- These requests are **same-origin** — they go to claude.ai, not to any server operated by the extension author or a third party
- The conversation data the API returns is processed in your browser to build the Markdown output, then handled exactly like any other capture (clipboard / buffer / linked file)
- The extension never transmits your conversation to anywhere other than the destinations you have configured (clipboard, in-extension buffer on your device, or your own linked `CLAUDE.md` file on your disk)

You can verify this by inspecting the source: `src/content/parsers/claude-ai.ts` in this repository.

## MCP server (v0.5.0+)

If you enable the MCP store mode, the extension also runs a small Model Context Protocol server that lets Claude Code (or any MCP-aware agent) pull captures on demand instead of you having to paste them. Privacy specifics:

- The MCP server reads from the captures directory **you picked**. It cannot read any other file on your disk.
- The directory path is validated against `..` traversal and other path injection patterns before any file operation.
- The server's tools (`get_context`, `list_contexts`, `search_contexts`, `stats_contexts`) operate on files already on your machine — nothing is fetched from any external source.
- Captures are stored as standalone Markdown files with stable filenames derived from a content hash plus, when applicable, a stable identity (`dedupeKey`, e.g. a claude.ai conversation UUID). Re-capturing the same subject updates the existing file instead of accumulating duplicates.
- The MCP server only responds to clients you've configured on your own machine.

## File System Access (v0.2.0+)

If you choose the "Append to linked CLAUDE.md file" mode, the extension uses the [File System Access API](https://wicg.github.io/file-system-access/) to read and append to a file you explicitly pick. Specifically:

- You pick the file once via the OS file dialog (a user gesture)
- Chrome stores the resulting `FileSystemFileHandle` in the extension's IndexedDB so subsequent captures can re-use it
- The extension only reads and writes the file you picked — it cannot access any other file on your disk
- Read/write permission is granted by you per file and may need to be re-granted after browser restart (Chrome's choice; the extension cannot bypass this)

If you remove the linked file via the options page or uninstall the extension, the handle is forgotten.

## Permissions explained

The extension requests the following Chrome permissions:

- **`activeTab`** — to read the page content only when you actively trigger a capture
- **`clipboardWrite`** — to copy the Markdown output to your clipboard
- **`storage`** — to save your settings and the optional capture buffer locally
- **`scripting`** — to inject capture-related code into the active tab when you trigger a capture
- **`contextMenus`** — to show "Capture page" / "Capture selection" right-click menu items
- **`offscreen`** — to host a hidden document where File System Access writes and clipboard writes can run (MV3 service workers cannot access these APIs directly; v0.2.0+)
- **`<all_urls>` host permission** — so that you can capture from any site you visit. The extension does not run automatically on any page; capture only happens when you explicitly trigger it

## Third-party services

The extension uses two open-source libraries embedded in its code:

- [Mozilla Readability](https://github.com/mozilla/readability) for article content extraction
- [Turndown](https://github.com/mixmark-io/turndown) for HTML-to-Markdown conversion

Both run entirely in your browser. They do not transmit data anywhere.

The extension also calls claude.ai's own internal API when you capture from claude.ai (see "claude.ai conversation capture" above). This communication is between your browser and claude.ai only, using your existing session — no third party is involved.

## Children's privacy

The extension is not directed at children under 13 and does not knowingly process any personal information from them.

## Changes to this policy

If this policy changes, the new version will be published to the extension's GitHub repository and the "Last updated" date above will be revised. For significant changes, a notice will be added to the extension's release notes.

## Contact

Questions about this policy can be sent to:

- GitHub Issues: https://github.com/OceansCreative/claude-code-context-capturer/issues
- OceansBase contact form: https://oceans-base.com/contact

---

Maintainer: Kazushi Ikeda / OceansBase
