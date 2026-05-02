# Launch playbook

Copy-paste-ready material for shipping v0.3.0 publicly. Order the actions top-to-bottom; each section is independent.

---

## 1. Chrome Web Store submission

The production zip is committed at `claude-code-context-capturer-v0.3.0.zip` (87 KB).

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

## 2. Hacker News — Show HN post

Title (under 80 chars):

```
Show HN: Chrome extension that writes web pages directly to your CLAUDE.md
```

Body (paste into the URL field as a self post; leave the URL field blank):

```
Hi HN. I built a Chrome extension that converts the web page you're reading into clean Markdown and appends it directly to your project's CLAUDE.md (the context file Claude Code and similar AI agents read on every session).

Why bother — the existing workflow leaks context badly. You spend an hour reading 5 articles to understand a tricky bug, switch to your terminal to fix it, and the agent knows none of what you just learned. URLs in chat don't reliably work (many models can't fetch). Copy-pasting brings ads, sidebars, footers. Manual CLAUDE.md edits don't survive a busy day.

This closes the loop. You link a CLAUDE.md once via the File System Access API; subsequent captures append directly. v0.3.0 adds URL-pattern routing — github.com/anthropic/* goes to one file, zenn.dev/* to another, with a default route catching the rest. So I can keep separate AI context files per project without thinking about it.

Some build notes that might be useful to others:
- MV3 service workers can't use the File System Access API (no DOM). The fix is offscreen documents — chrome.offscreen.createDocument spins up a hidden page that handles the FSA write, then closes when idle.
- FileSystemFileHandle is structured-cloneable but not JSON-serializable, so chrome.storage loses the file binding. IndexedDB preserves it across browser restarts.
- For real-Chrome verification under puppeteer, OPFS (navigator.storage.getDirectory()) gives you a FileSystemFileHandle without the OS picker — same interface, queryPermission auto-granted. Lets you e2e-test the entire write path in CI.

Honest positioning: the broader "Web → Markdown" category is crowded — LLMFeeder and Save are mature options. The specific niche of "directly write to your AI agent's context file with URL-based routing" appears empty, which is what I targeted.

100% local, MIT licensed, 45 unit tests, real-Chrome e2e verification.

Repo: https://github.com/OceansCreative/claude-code-context-capturer
Chrome Web Store: [in review — paste URL once approved]

Happy to answer questions about the offscreen-doc + IndexedDB pattern, or about positioning in the AI clipper space.
```

### Posting tips

- Post Tue/Wed/Thu **9:00 AM PT** for the largest active US/EU window
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
**The problem.** I research with Claude Code, read 5 articles for an hour, switch to my terminal, and the agent knows none of what I just learned. Existing Web→Markdown clippers (LLMFeeder, Save, etc.) all output to clipboard or their own vault — none of them target your project's CLAUDE.md directly.

**What this does.** Pick a CLAUDE.md once with the File System Access API; every subsequent capture appends to it automatically. Each entry gets a `## YYYY-MM-DD HH:MM — <title>` heading, YAML frontmatter (URL, title, captured_at, parser, tags), and the cleaned body.

**v0.3.0 lets you link multiple CLAUDE.md files** and route by URL pattern — `github.com/anthropic/*` → one file, `zenn.dev/*` → another, unmatched URLs to a default route. So per-project AI context files self-maintain.

**Site-specific parsers** for GitHub (Issues / PRs / Discussions), Stack Overflow, Zenn, Qiita, MDN. Generic Readability fallback for everything else. 100% local — no telemetry, no API key, no external server.

**MIT licensed.** Repo: https://github.com/OceansCreative/claude-code-context-capturer

Happy to take feedback on missing parsers, UX, or the routing model. v0.4 candidates I'm considering: capture preview/edit before write (kill cruft), YouTube transcript parser, X/Twitter thread parser.
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
Built a Chrome extension that writes web pages directly to your project's CLAUDE.md.

URL-pattern routing — github.com/anthropic/* to one file, zenn.dev/* to another. So per-project AI context files maintain themselves.

100% local, MIT, 45 tests.

github.com/OceansCreative/claude-code-context-capturer
```

### Follow-up thread (post 30 minutes later if first tweet gets traction)

```
2/ MV3 service workers can't use the File System Access API (no DOM context).

The fix is offscreen documents — chrome.offscreen.createDocument spins up a hidden page just to host the FSA write call. Closes when idle.

3/ FileSystemFileHandle is structured-cloneable but NOT JSON-serializable.

chrome.storage round-trips lose the OS file binding. IndexedDB preserves it across browser restarts. Took me an hour to figure out why captures stopped writing after a Chrome restart.

4/ For real-Chrome puppeteer e2e tests:

navigator.storage.getDirectory() (OPFS) gives you a FileSystemFileHandle without the OS picker. Same interface, queryPermission auto-granted. The entire write path is now CI-testable.
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
- [ ] Pin the v0.3.0 release in the repo's "Releases" sidebar
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
- [ ] If traction is real (>500 stars or >50 installs day 1), open a discussion with users on what to ship in v0.4 (capture preview/edit, more parsers, etc.)

If traction is light: ship v0.4 anyway. The extension is useful regardless of HN ranking, and the next launch (v0.4 with preview/edit) gets a second shot at attention.
