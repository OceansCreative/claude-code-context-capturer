# Privacy Policy

Last updated: April 30, 2026

## Overview

Claude Code Context Capturer ("the extension") is a browser extension that converts the web page you are currently viewing into Markdown text and copies it to your clipboard. This document describes what data the extension handles and how.

## Data we DO NOT collect

The extension does not collect, transmit, sell, or share any of the following:

- Personal information (name, email, etc.)
- Browsing history
- Page content of pages you visit
- IP address
- Usage analytics or telemetry
- Cookies or tracking identifiers

The extension does not communicate with any external server. All processing happens locally in your browser.

## Data we DO process locally

The extension processes the following on your device only:

| Data | Purpose | Storage location |
|---|---|---|
| The HTML of the page you actively choose to capture | Convert it to Markdown for you | Memory only — discarded after the operation |
| Your selected text (if you use "Capture selection") | Convert it to Markdown for you | Memory only — discarded after the operation |
| The Markdown output | Place it on your system clipboard | System clipboard (managed by your OS) |
| Buffered captures (if you opt into "Append to buffer" mode) | Let you export multiple captures together later | `chrome.storage.local` on your device |
| Your settings (frontmatter on/off, locale, etc.) | Persist your preferences | `chrome.storage.sync` on your device, optionally synced via your Chrome account |

None of this data leaves your device through the extension.

## Permissions explained

The extension requests the following Chrome permissions:

- **`activeTab`** — to read the page content only when you actively trigger a capture
- **`clipboardWrite`** — to copy the Markdown output to your clipboard
- **`storage`** — to save your settings and the optional capture buffer locally
- **`scripting`** — to inject the clipboard write call into the active tab
- **`contextMenus`** — to show "Capture page" / "Capture selection" right-click menu items
- **`<all_urls>` host permission** — so that you can capture from any site you visit

## Third-party services

The extension uses two open-source libraries embedded in its code:

- [Mozilla Readability](https://github.com/mozilla/readability) for article content extraction
- [Turndown](https://github.com/mixmark-io/turndown) for HTML-to-Markdown conversion

Both run entirely in your browser. They do not transmit data anywhere.

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
