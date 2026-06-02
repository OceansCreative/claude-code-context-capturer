# Changelog

All notable changes are listed here. Full release notes — including build context, the underlying bug or design decision, and diff links — live on the corresponding [GitHub Release](https://github.com/OceansCreative/claude-code-context-capturer/releases).

The project follows [Semantic Versioning](https://semver.org/).

---

## v0.5.0 — claude.ai artifacts + MCP server

- **New:** claude.ai artifact extraction (capture just the code / documents Claude wrote, drop the chat) and range selection (last N messages of a long planning conversation). Toggleable from the popup whenever you're on a `claude.ai/chat/*` URL.
- **New:** MCP server for on-demand context. Captures land as individual Markdown files in a directory you pick; a bundled Model Context Protocol server exposes `get_context` / `list_contexts` / `search_contexts` / `stats_contexts` to Claude Code, with tag and date filtering. Keeps `CLAUDE.md` small.
- **New:** In-place re-capture for claude.ai. Re-capturing the same conversation overwrites the existing file (`dedupeKey` derived from the conversation UUID) instead of accumulating duplicate snapshots. Artifacts-only mode gets its own dedupe namespace so it doesn't clobber a full capture of the same chat.
- **New:** Artifacts-as-files mode (`get_context format: "code"`). Each artifact becomes its own file with the right extension inferred from the language.
- **Fix:** Security pass — path traversal, hash collisions, CRLF handling, `extractCode` semantics, and artifact ordering all hardened.
- **Fix:** Unconfigured MCP captures directory now surfaces a clear error instead of failing silently.
- Tests: 58 → 91.
- Permissions: unchanged from v0.4.3.
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.5.0) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.4.3...v0.5.0)

## v0.4.3 — Clipboard race fix (retry on Receiving-end-not-exist)

- **Fix:** Retries `chrome.runtime.sendMessage` to the offscreen document on `Receiving end does not exist`, covering the cold-start race the v0.4.2 ping/pong handshake didn't fully close. Production Chrome was sensitive to this; Chrome for Testing wasn't, so the e2e harness had missed it.
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.4.3) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.4.2...v0.4.3)

## v0.4.2 — Offscreen ping/pong

- **Fix:** Service worker now pings the offscreen document until its `onMessage` listener is registered before sending real work. Closes the race where `chrome.offscreen.createDocument` resolves on the document's `load` event but the ESM imports haven't finished wiring up.
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.4.2) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.4.1...v0.4.2)

## v0.4.1 — Clipboard writes actually land

- **Fix:** Clipboard mode silently failed when invoked from the popup (the popup steals focus from the tab, so `navigator.clipboard.writeText()` rejects with `Document is not focused`, and `chrome.scripting.executeScript` was swallowing the rejection). Clipboard writes now route through the offscreen document with the legacy `textarea + execCommand("copy")` path, which doesn't depend on tab focus. Errors are propagated instead of being silently absorbed.
- This bug shipped from v0.1.0 through v0.4.0; keyboard-shortcut and context-menu captures were unaffected because they didn't open the popup.
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.4.1) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.4.0...v0.4.1)

## v0.4.0 — claude.ai conversation capture

- **New:** Capture claude.ai conversations directly to the linked `CLAUDE.md` (or clipboard / buffer). The parser hits claude.ai's internal API from inside the claude.ai tab using the user's existing session and walks the conversation tree from `current_leaf_message_uuid` back to root.
- Preserves thinking blocks, `tool_use` entries, and branch structure that DOM scraping would miss.
- Defensive: unknown content block types render as fenced JSON instead of crashing.
- The dispatcher became async so claude.ai (or any future fetch-based parser) can run without breaking the existing synchronous DOM parsers.
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.4.0) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.3.0...v0.4.0)

## v0.3.0 — Multi-route CLAUDE.md

- **New:** Link multiple `CLAUDE.md` files and route captures by URL glob pattern. Mark exactly one route as the default to catch unmatched URLs.
- IndexedDB schema bumped to v2 with a `routes` object store. The v0.2.0 single-handle schema is migrated lazily into a default route on first read.
- Options page rewritten as a routes table with add / edit / remove.
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.3.0) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.2.0...v0.3.0)

## v0.2.0 — Direct CLAUDE.md write

- **New:** Pick a `CLAUDE.md` file once via the File System Access API; subsequent captures append directly to it.
- MV3 service workers can't use the File System Access API, so an offscreen document hosts the write. `FileSystemFileHandle` is persisted across browser restarts via IndexedDB (chrome.storage would lose it to JSON serialization).
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.2.0) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.1.0...v0.2.0)

## v0.1.0 — Initial public release

- Initial release. One-click capture, site-specific parsers for GitHub / Stack Overflow / Zenn / Qiita / MDN, generic fallback via Mozilla Readability, selection mode, in-extension buffer, YAML frontmatter, English / Japanese UI, keyboard shortcuts.
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.1.0)
