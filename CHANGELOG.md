# Changelog

All notable changes are listed here. Full release notes — including build context, the underlying bug or design decision, and diff links — live on the corresponding [GitHub Release](https://github.com/OceansCreative/claude-code-context-capturer/releases).

The project follows [Semantic Versioning](https://semver.org/).

---

## v1.1.0 — Reddit + Hacker News parsers

- **New:** Reddit site-specific parser. Captures a Reddit post + its comment tree via Reddit's JSON endpoint (`.json?raw_json=1`) — no scraping of the unstable shreddit DOM. Selftext and comment bodies pass through as native Markdown, nested replies render as blockquotes, deleted/removed comments are skipped (surviving children promoted), `more` stubs are tolerated with a truncation note. 100-comment cap, 15s fetch timeout, friendly 429 (rate-limit) and 403 (private/quarantined) errors. Stable `dedupeKey: reddit:<postId>` so re-capturing updates in place.
- **New:** Hacker News site-specific parser. Captures an HN item page — story (title / external link or Ask HN text / points / author) plus the full comment tree. Nesting is reconstructed from the `td.ind[indent]` attribute (with legacy spacer-width fallback) and rendered as nested blockquotes (depth capped at 10). `[dead]`/`[flagged]` comments skipped via triple detection, 100-comment cap with truncation note. Stable `dedupeKey: hn:<itemId>`.
- Site-specific parsers now cover **GitHub / Stack Overflow / Zenn / Qiita / MDN / YouTube / Reddit / Hacker News / claude.ai** — the major developer-research sources.
- Chore: vitest now excludes `.claude/` worktree checkouts (fixes test-count double-counting).
- Permissions unchanged — the existing `<all_urls>` host permission covers the same-origin fetches. 166/166 unit tests pass (+37 vs v1.0.0).
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v1.1.0) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v1.0.0...v1.1.0)

## v1.0.0 — 1.0

- **1.0 milestone.** Preceded by a multi-agent pre-v1.0 code audit that surfaced no blockers. No new user-facing features over v0.9.0 — this release hardens the multi-agent fan-out reliability and the YouTube parser, and closes audit nice-to-haves.
- **Fix:** Multi-agent fan-out partial-failure signal is now surfaced to the user. When one target file in a fan-out route succeeds and another lapses (e.g. an expired permission), the outcome is no longer silently swallowed as a green checkmark — the partial failure is reported. Added unit coverage for the fan-out outcome classification and for the pre-v0.9.0 handle-shape migration.
- **Polish:** YouTube transcript fetch now enforces a 15s timeout so a hung request can't stall a capture. Added YouTube integration tests (chapter handling + auto-English caption selection). `profiles.ts` is now the single source of `PROFILES`, and the `measure-tokens` comment was corrected.
- Permissions unchanged. 129/129 unit tests pass.
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v1.0.0) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.9.0...v1.0.0)

## v0.9.0 — Multi-agent fan-out (Cursor / Windsurf / Aider / Claude Code)

- **New:** A single context-file route can now write to **multiple** target files at once. People juggling Claude Code + Cursor (or Windsurf, or Aider) in the same project no longer need duplicate routes — link your `CLAUDE.md`, then click "+ Link another file" to add `.cursorrules` / `.windsurfrules` / etc. One capture lands in all targets.
- Schema: `ClaudeMdRoute.handle: FileSystemFileHandle` → `handles: FileSystemFileHandle[]`. Pre-v0.9.0 records are migrated lazily on first read (wrap the single handle into a 1-element array) — no user action required.
- `OffscreenAppendResult` reports per-file success; if some handles succeed and others lapse (e.g. one file's permission expired), the capture is still committed to the working files and `partialFailures` flags the bad ones.
- Options page: the section is now "Context file routes" (was "CLAUDE.md routes"). Each route shows every linked file with its own permission badge and an `unlink` button; the description calls out target paths for Claude Code, Cursor, and Windsurf so users know what to point at.
- Real-Chrome e2e: 5/5 pass — one route with two OPFS handles (CLAUDE.md + .cursorrules) writes the same Markdown to both files with proper entry headings + frontmatter.
- Permissions unchanged. 117/117 unit tests pass.
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.9.0) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.8.0...v0.9.0)

## v0.8.0 — YouTube transcript parser

- **New:** YouTube site-specific parser. Captures the **transcript** (manual or auto-generated, English preferred), plus title / channel / duration / description, into Markdown. When the video has chapters they become `### [mm:ss] <Title>` sub-headings and segments are slotted under the right chapter; otherwise transcript lines are listed linearly with `[mm:ss]` timestamps.
- Handles `youtube.com/watch?v=`, `youtube.com/shorts/`, `youtube.com/embed/`, and `youtu.be/` URLs.
- Re-capturing the same video updates the stored entry rather than accumulating snapshots (stable `dedupeKey: youtube:<videoId>`). Tags include `youtube`, `channel:<name>`, `captions:auto|manual`, `lang:<code>`.
- Defensive: failure modes (no captions / player data not loaded / 429 from YouTube) surface descriptive errors instead of producing empty captures.
- Permissions unchanged. 22 new unit tests covering URL extraction, caption-track preference, player-response parsing (including the deeply-nested chapters path), Markdown render, and three error paths.
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.8.0) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.7.0...v0.8.0)

## v0.7.0 — MCP server tool-set profiles + token-cost measurement

- **New:** `CCC_MCP_TOOLS` env var on the MCP server. Pick a profile (`minimal`, `lean`, `search`, `discover`, `full`) or pass an explicit comma-separated tool list. Trims the per-turn token cost the MCP host pays just to know each tool exists.
- **New:** `npm run measure-tokens` script in `mcp-server/` produces a per-tool and per-profile breakdown of how many chars / approximate tokens each tool definition costs the LLM. Results documented in the mcp-server README so users can make informed profile choices.
- The `lean` profile saves ~666 tokens/turn vs full (~52%); `minimal` saves ~1,050 tokens/turn (~82%) when the agent already knows the slug to fetch.
- **No changes to the browser extension itself** — extension stays at v0.6.0 on the Chrome Web Store. The mcp-server npm package bumps to v0.2.0; the git tag v0.7.0 marks the milestone.
- 12 new unit tests for profile parsing (51 total in mcp-server).
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.7.0) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.6.0...v0.7.0)

## v0.6.0 — Preview before write

- **New:** Preview window between Capture and the actual write. Trim captured Markdown (drop nav menus, footers, sidebar leftovers) before it lands in clipboard / buffer / CLAUDE.md / MCP store. Default-on; toggleable in Options and via a "skip next time" checkbox on the preview itself.
- Implementation: SW stages payload + rendered Markdown + options + tabId into `chrome.storage.session`; opens `src/preview/index.html?id=...` as a popup-type window via `chrome.windows.create`. Confirm re-enters the existing `deliver()` pipeline with the user's edited content; Cancel discards.
- Permissions unchanged from v0.5.x.
- 4 new unit tests for the staging helper (95 total).
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.6.0) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.5.1...v0.6.0)

## v0.5.1 — contextMenus duplicate-id fix

- **Fix:** `chrome.contextMenus.removeAll()` before re-creating on every `onInstalled`. The red "エラー" badge that appeared on every extension reload (with `Unchecked runtime.lastError: Cannot create item with duplicate id ccc-capture-page`) is gone. The bug was benign — the first registration's menu items were already there and right-click capture worked normally — but it polluted the extensions page and obscured real errors.
- [Release notes](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v0.5.1) · [Diff](https://github.com/OceansCreative/claude-code-context-capturer/compare/v0.5.0...v0.5.1)

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
