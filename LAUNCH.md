# Launch playbook

Copy-paste-ready material for shipping the latest version (currently **v1.2.1**) publicly. Order the actions top-to-bottom; each section is independent.

> **Status note:** v0.3.0 was approved and is live on the Chrome Web Store. Every update since (v0.4.x through v1.2.1) keeps the permissions list unchanged, so no fresh permission justifications are required — reviews should be fast.
> **Store state (2026-07-05):** v1.1.0 is live; **v1.2.1 (A2 logo + X/Twitter parser + Power Pack footer) is in review** — v1.2.0 was never store-submitted. Until approval, store installs lack the X parser and show the old icon; the GitHub release zip is always current.

> **Launch strategy (decided 2026-07-05): international first.**
> 1. **Phase INTL** — awesome-claude-code list PRs → Show HN → r/ClaudeAI → X (English). Goal: raw feedback from the largest Claude Code audience.
> 2. **Brush-up** — triage the feedback, ship fixes / most-requested parser as v1.3.
> 3. **Phase JP (deferred)** — Zenn build-log article + Japanese X post, launched with the improved v1.3. Do NOT start the Zenn article before international feedback lands.

---

## 1. Chrome Web Store submission (or update)

The production zip is built locally — it is no longer committed to the repo. To rebuild:

```bash
npm install && npm run build
cd dist && zip -rq ../claude-code-context-capturer-v1.2.1.zip . && cd ..
```

The latest released zip is also attached to the [v1.2.1 release on GitHub](https://github.com/OceansCreative/claude-code-context-capturer/releases/tag/v1.2.1) for direct download.

### Pre-flight checklist

- [ ] One-time: register a Chrome Web Store developer account at https://chrome.google.com/webstore/devconsole/ ($5)
- [ ] Set up the extension's PRIVACY policy URL: https://github.com/OceansCreative/claude-code-context-capturer/blob/main/PRIVACY.md
- [ ] Have the screenshots ready in `docs/screenshots/` (five PNGs, all 1280×800 or composable)

### Filling the form

Reach for `STORE_LISTING.md` — every field has its copy-paste source there:

- **Short description** → STORE_LISTING.md "Store listing — short description"
- **Detailed description (English)** → STORE_LISTING.md "Store listing — detailed description (English)"
- **Detailed description (Japanese)** → STORE_LISTING.md "Store listing — detailed description (Japanese)" — paste this in the "Add language" → Japanese field
- **Category** → Productivity
- **Permissions justifications** → STORE_LISTING.md "Permissions justification" table
- **Single purpose** → STORE_LISTING.md "Single purpose statement"
- **Privacy practices** → STORE_LISTING.md "Privacy practices declaration"

### Screenshots to upload

Use these from `docs/screenshots/`:

1. `01-options-routes-1280x800.png` — routes table + buffer (the killer feature shot)
2. `04-claude-md-rendered.png` — what an entry looks like inside CLAUDE.md (story shot)
3. `03-hero.png` — hero composite (popup + value prop)
4. `02-popup.png` — popup standalone (skip if you already used 03)

Aim for 3–5 screenshots; quality > quantity.

### Review timeline

Expect 1–14 days. Email notifications go to the developer account address.

---

## 1.5 awesome-claude-code list PRs (do these BEFORE the HN post — durable discovery, zero risk)

Submit the extension to the curated lists. Unlike the one-shot posts below, listings keep converting for months, and an accepted PR is mild social proof by launch day.

Targets (status as of 2026-07-05):

1. [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) — the canonical list. **Submissions temporarily CLOSED** (issue creation is collaborator-only while their redesign settles; PRs are never accepted — web-UI issue form only, must be filed by a human). **Retry after Show HN**: check whether https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml is open again, and submit with the field contents below. Post-HN is the better timing anyway — their CONTRIBUTING explicitly favors projects that already have users/traction.
2. [jqueryscript/awesome-claude-code](https://github.com/jqueryscript/awesome-claude-code) — submitted as [PR #475](https://github.com/jqueryscript/awesome-claude-code/pull/475), but **expect no merge**: as of 2026-07-05 the repo has 360 open PRs, 0 ever merged, 53 closed unmerged — the maintainer curates the README directly and ignores external PRs. Leave the PR open (zero cost, tiny discovery surface) but don't invest further here.

**Takeaway:** both awesome lists are effectively closed to submissions right now. The durable-listing channel is deprioritized; Show HN carries the launch. Revisit the hesreallyhim form after HN traction.

Field contents for the hesreallyhim issue form (when it reopens):

- **Display Name:** `Claude Code Context Capturer`
- **Category:** `Memory & Context Persistence`
- **Link:** `https://github.com/OceansCreative/claude-code-context-capturer`
- **Author Name:** `Kazushi Ikeda (OceansCreative)` / **Author Link:** `https://github.com/OceansCreative`
- **Description:** Chrome extension that captures web pages, claude.ai conversations, and YouTube/Reddit/Hacker News/X threads as Markdown and appends them to a project's CLAUDE.md via the File System Access API, with URL-pattern routing across projects and fan-out to .cursorrules/.windsurfrules. A bundled MCP server can instead store captures as individual files and serve them to Claude Code on demand, keeping CLAUDE.md small. Fully local, MIT licensed.

Suggested one-line entry (adapt to each list's format):

```
[Claude Code Context Capturer](https://github.com/OceansCreative/claude-code-context-capturer) - Chrome extension that captures web pages, claude.ai conversations, and YouTube/Reddit/HN/X threads as Markdown and appends them to CLAUDE.md (URL-pattern routing, multi-agent fan-out to .cursorrules/.windsurfrules) or serves them on demand via a bundled MCP server.
```

Follow each repo's CONTRIBUTING.md if present; some lists require alphabetical ordering or a specific category.

---

## 2. Hacker News — Show HN post

Title (under 80 chars — first option recommended; the HN-parser hook earns goodwill):

```
Show HN: Pipe web pages, HN threads, and claude.ai chats into your CLAUDE.md
```

Alternate (safer, feature-neutral):

```
Show HN: Chrome extension piping web pages and claude.ai chats into CLAUDE.md
```

Body (paste into the URL field as a self post; leave the URL field blank):

```
Hi HN. I built a Chrome extension that turns the web page you're reading — including your claude.ai conversations and YouTube transcripts — into clean Markdown and either appends it directly to your project's context files (CLAUDE.md, and .cursorrules / .windsurfrules if you run several agents) OR exposes it to Claude Code on demand via a bundled MCP server. And yes — it parses HN item pages, so it can capture this very thread.

Why bother — the existing workflow leaks context badly. You spend an hour brainstorming with claude.ai, then switch to your terminal where Claude Code is running, and the agent knows none of what you just discussed. claude.ai share links 403 from outside the browser session. URLs to articles don't reliably work (many models can't fetch). Copy-pasting brings ads, sidebars, footers. Manual CLAUDE.md edits don't survive a busy day. And once your CLAUDE.md grows past ~30k tokens, Anthropic's own guidance is that Claude starts ignoring your instructions.

Two delivery modes, depending on how you want to spend context budget:

1. Direct context-file append (since v0.2.0). Pick a file with the File System Access API once. Subsequent captures append directly. URL-pattern routing — github.com/anthropic/* goes to one file, zenn.dev/* to another, claude.ai/chat/* to whichever project you're working on. Good when you want everything front-loaded. Since v0.9.0 a route can fan out to multiple targets: one capture appends to CLAUDE.md (Claude Code) + .cursorrules (Cursor) + .windsurfrules (Windsurf) simultaneously, and a partial failure (one file's permission expired) is reported instead of silently swallowed as a green checkmark.

2. MCP-on-demand (v0.5.0+). Captures land as individual Markdown files in a directory. A bundled MCP server exposes get_context / list_contexts / search_contexts / stats_contexts to Claude Code. The agent pulls what it needs when it needs it; CLAUDE.md stays small. Tag and date filters let big libraries stay searchable. Re-capturing the same claude.ai conversation overwrites the existing file (stable dedupeKey from the conversation UUID), so you don't accumulate snapshot silos. Tool definitions themselves cost tokens every turn, so a CCC_MCP_TOOLS env var trims the exposed tool set — measured with a bundled script, the lean profile saves ~52% of the per-turn tool-definition cost, minimal ~82%.

Before anything is written, an optional preview window (v0.6.0+) lets you trim cruft — nav menus, sidebar leftovers — and confirm or cancel.

For long claude.ai planning chats, an artifacts-only mode extracts just the code/documents Claude wrote — drops the conversation entirely. Or limit to the last N messages. Both toggles surface as checkboxes on the popup whenever you're on a claude.ai chat.

There's also a YouTube parser (v0.8.0+): it captures the transcript (manual or auto-generated captions) plus title / channel / duration, and when the video has chapters they become [mm:ss]-timestamped sub-headings — so conference talks and tutorials can land in your context files too.

v1.1.0 added Reddit and Hacker News thread parsers. Reddit goes through the JSON endpoint (.json?raw_json=1) rather than scraping the shreddit DOM — selftext and comments are already Markdown there, nesting renders as blockquotes, deleted comments are skipped with their surviving children promoted. HN reconstructs the comment tree from the indent encoding in its table layout, skips [dead]/[flagged], and caps megathreads at 100 comments with an explicit truncation note. v1.2.0 added X/Twitter threads: DOM-only via data-testid anchors (no internal API calls, no account-flag risk), focal tweet + self-thread + replies, quote tweets as blockquotes, promoted content skipped.

Some build notes that might be useful to others:
- MV3 service workers can't use the File System Access API or write to the clipboard while the popup steals focus. The fix is offscreen documents — chrome.offscreen.createDocument spins up a hidden page that handles both. The clipboard path uses the legacy textarea + execCommand("copy") trick because navigator.clipboard.writeText still requires document focus even from offscreen contexts.
- FileSystemFileHandle is structured-cloneable but not JSON-serializable, so chrome.storage loses the file binding. IndexedDB preserves it across browser restarts.
- claude.ai is a React SPA — its DOM drops thinking blocks, tool_use entries, and merges branches. The parser hits claude.ai's internal API (/api/organizations/{org}/chat_conversations/{uuid}?tree=True) from inside the claude.ai tab, where the user's session cookie is automatically attached. Walks the tree from current_leaf back to root.
- For real-Chrome verification under puppeteer, OPFS (navigator.storage.getDirectory()) gives you a FileSystemFileHandle without the OS picker — same interface, queryPermission auto-granted. Lets you e2e-test the entire write path in CI.

Honest positioning: the broader "Web → Markdown" category is crowded — LLMFeeder and Save are mature options. The specific niche of "directly write to your AI agent's context file with URL-based routing, including claude.ai conversations, with an MCP-pull alternative" appears empty, which is what I targeted.

1.0 shipped after a multi-agent pre-1.0 code audit (no blockers; the release hardened fan-out partial-failure surfacing and added a 15s timeout on transcript fetches). 1.1 followed with the Reddit + HN parsers, 1.2 with X/Twitter. 100% local, MIT licensed, 184 unit tests, real-Chrome e2e for every release.

Repo: https://github.com/OceansCreative/claude-code-context-capturer
Chrome Web Store: https://chromewebstore.google.com/detail/claude-code-context-captu/bnhoinbchkcamklfcpnjplljjodiikfo (heads-up: the store build can lag a few days behind while an update is in review — the GitHub release zip is always the newest version)

Happy to answer questions about the offscreen-doc + IndexedDB pattern, the claude.ai internal API, or about positioning in the AI clipper space.
```

### Posting tips

- Post Tue/Wed/Thu **9:00 AM PT** for the largest active US/EU window — that is **1:00 AM JST the following day** (PDT). Plan to stay up 1:00–3:00 AM JST for the reply window, or accept the smaller 10:00 PM JST (= 6:00 AM PT) slot
- Don't ask for upvotes; HN penalizes solicited boosting
- Reply to early comments within 30 minutes — first hour determines visibility
- If it lands at #1–10 on Show HN, expect 100–1000 stars in 24–48h

---

## 3. Reddit — r/ClaudeAI cross-post

Title:

```
I built a Chrome extension that writes web pages directly to your project's CLAUDE.md (open source)
```

Body:

```
**The problem.** I brainstorm with claude.ai for an hour, switch to my terminal where Claude Code is running, and the agent knows none of what we just discussed. Share links 403 from outside the browser session. Existing Web→Markdown clippers (LLMFeeder, Save, etc.) output to clipboard or their own vault — none of them target your project's CLAUDE.md directly, and none parse claude.ai conversations correctly (DOM scraping a React SPA loses thinking blocks and branches).

**What this does.** Pick a CLAUDE.md once with the File System Access API; every subsequent capture appends to it automatically. Each entry gets a `## YYYY-MM-DD HH:MM — <title>` heading, YAML frontmatter (URL, title, captured_at, parser, tags), and the cleaned body.

**Multi-route by URL pattern** — `github.com/anthropic/*` → one file, `zenn.dev/*` → another, `claude.ai/chat/*` → whichever project you're brainstorming for, unmatched URLs to a default route. Per-project AI context files self-maintain.

**Multi-agent fan-out (v0.9.0+)** — a single route can write to multiple context files at once: `CLAUDE.md` (Claude Code) + `.cursorrules` (Cursor) + `.windsurfrules` (Windsurf), etc. One capture, all agents updated; partial failures (one file's permission expired) are surfaced instead of silently swallowed.

**Or: MCP-on-demand (v0.5.0+).** Captures land as individual files in a directory you pick. A bundled MCP server exposes `get_context` / `list_contexts` / `search_contexts` / `stats_contexts` to Claude Code, with tag and date filters. The agent pulls what it needs, when it needs it — your CLAUDE.md stays small. Re-capturing the same claude.ai conversation overwrites in place.

**Artifacts-only mode (v0.5.0+)** for claude.ai: extract just the code/documents Claude wrote, drop the chat. Or limit to last N messages. Both toggleable from the popup.

**Preview before write (v0.6.0+)** — review the captured Markdown in a window, trim cruft, then confirm. Toggleable.

**Site-specific parsers** for GitHub (Issues / PRs / Discussions), Stack Overflow, Zenn, Qiita, MDN, **YouTube transcripts with chapters (v0.8.0+)**, **Reddit and Hacker News threads (v1.1.0+)** — yes, it can capture this thread — **X/Twitter threads (v1.2.0+)**, and **claude.ai conversations** (via the internal API, preserving thinking / tool_use / branches). Generic Readability fallback for everything else. 100% local — no telemetry, no API key, no external server.

**MIT licensed.** Repo: https://github.com/OceansCreative/claude-code-context-capturer

Happy to take feedback on missing parsers, UX, or the routing model. Just shipped v1.2.1 — Reddit + Hacker News thread parsers in 1.1, X/Twitter threads in 1.2, on top of the audited 1.0. 184 tests. Tell me which parser you want next. (Note: the Web Store build may lag a few days behind the GitHub release while updates are in review.)
```

### Subreddits to consider (in order of fit)

1. **r/ClaudeAI** — primary fit, most engaged
2. **r/AICoding** — secondary, smaller but on-topic
3. **r/ChromeExtensions** — only if traction is slow elsewhere
4. **r/SideProject** — neutral, but lower conversion

Don't blast all four day-one. Start with r/ClaudeAI; if it lands well, cross-post to r/AICoding 24h later (mods often dislike same-day cross-posting).

---

## 4. X / Twitter — launch tweet

Single tweet (280-char budget — currently fits):

```
Chrome extension: capture web pages, claude.ai chats, YouTube transcripts + Reddit/HN/X threads as Markdown. Fan out to CLAUDE.md + .cursorrules + .windsurfrules, or pull on demand via MCP. 100% local, MIT, v1.2, 184 tests.

github.com/OceansCreative/claude-code-context-capturer
```

### Follow-up thread (post 30 minutes later if first tweet gets traction)

```
2/ The hardest piece was claude.ai. It's a React SPA — DOM scraping loses thinking blocks, tool_use entries, and merged branches.

Fix: hit claude.ai's internal API (/api/organizations/{org}/chat_conversations/{uuid}?tree=True) from inside the claude.ai tab. Session cookie auto-attaches. Walk the tree from current_leaf back to root.

3/ MV3 service workers can't use the File System Access API or write to clipboard while a popup steals focus.

Both fixes go through chrome.offscreen — a hidden page hosting the writes. Clipboard uses textarea + execCommand("copy") because navigator.clipboard.writeText still needs document focus even from offscreen.

4/ FileSystemFileHandle is structured-cloneable but NOT JSON-serializable.

chrome.storage round-trips lose the OS file binding. IndexedDB preserves it across browser restarts.

5/ For real-Chrome puppeteer e2e tests, navigator.storage.getDirectory() (OPFS) gives you a FileSystemFileHandle without the OS picker. Same interface, queryPermission auto-granted. The entire write path is CI-testable.
```

### Accounts to tag (if appropriate)

- **@AnthropicAI** — only if the extension materially improves their product surface; otherwise skip (looks like begging)
- **@simonw** — sometimes RTs interesting Claude tooling
- AI-coding influencers in your follow graph who'd actually use this

---

## 5. Day-of-launch checklist

Morning of launch:

- [ ] Final `npm run build` and `npm test` (sanity)
- [ ] Verify the GitHub repo's README screenshots all render correctly
- [ ] Pin the latest release (v1.0.0 or whichever is newest) in the repo's "Releases" sidebar
- [ ] Open a draft of the HN post, paste content, leave URL field blank
- [ ] Open a draft of the Reddit post in r/ClaudeAI
- [ ] Have the X tweet drafted in the app
- [ ] Be at the keyboard for 2 hours after posting (HN prioritizes engaged authors)

Order:

1. **HN** first — biggest payoff, sets the social-proof anchor
2. **r/ClaudeAI** ~30 min later (different audience, no cross-pollination penalty)
3. **X** ~1 hour after HN, with HN URL in a follow-up reply if it's trending

Don't spam. One post per platform on day one. Cross-post r/AICoding the next day if r/ClaudeAI worked.

---

## 6. After launch

Whatever happens:

- [ ] Reply to every substantive comment within 24h
- [ ] File issues for any bug reports immediately
- [ ] Update README with HN/Reddit links once they exist (social proof)
- [ ] Tag any contributors in CHANGELOG
- [ ] If traction is real (>500 stars or >50 installs day 1), open a discussion with users on what to ship next (X/Twitter thread parser, more parsers, etc.)

If traction is light: ship the next version anyway. The extension is useful regardless of HN ranking, and the next launch (the next feature drop) gets a second shot at attention.
