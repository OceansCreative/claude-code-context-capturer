# Draft comment for anthropics/claude-code#13843

> "Share conversation context from Claude.ai to Claude Code"
> https://github.com/anthropics/claude-code/issues/13843

---

For anyone who wants this **today** without waiting on a first-party fix, I built an open-source pair of tools that bridges it — and deliberately avoids the native-messaging-host setup that trips up most attempts at this.

**How it works:**
1. A Chrome extension captures your claude.ai conversation — preserving thinking blocks, `tool_use` steps, and branch structure (it reads claude.ai's conversation API rather than scraping the rendered DOM, so artifacts and code survive).
2. It saves each conversation as a Markdown file in a directory you pick (via the File System Access API — **no native messaging host**, which is where similar tools usually break).
3. A small MCP server exposes those files to Claude Code on demand: `list_contexts`, `search_contexts`, `get_context`.

**Why on-demand instead of dumping into `CLAUDE.md`:** Anthropic's own [memory guidance](https://code.claude.com/docs/en/memory) is to keep `CLAUDE.md` small — bloated context files make Claude ignore instructions. So the agent pulls in a captured conversation only when it needs it, instead of permanently inflating context. (No silos either — it's a single directory you can inspect, search, or delete from.)

Setup is `npx` + one line:

```bash
claude mcp add ccc-contexts -- npx -y claude-code-context-capturer-mcp ./.ccc-contexts
```

Repo: https://github.com/OceansCreative/claude-code-context-capturer
It also captures general web pages (GitHub issues, docs, Stack Overflow, etc.) the same way, if that's useful for research → code workflows.

Feedback very welcome — especially on whether on-demand MCP access fits how you actually move from planning in claude.ai to building in Claude Code.

---

## Posting notes (for me, not part of the comment)

- **Don't post until** the MCP server is actually published to npm (the `npx` line must work for a stranger) OR reword to point at the manual install. Posting a broken install command is exactly what sank the competitor.
- Tone: helpful, not spammy. Lead with "here's a thing that works today," not "check out my project."
- The thread has a vocal "no export/import, I want live read access / single source of truth" camp (powerobject, +10). The "single directory you can inspect/search/delete, agent reads on demand" framing is aimed at them — keep it.
- Consider also replying to geovaniprodata, who hit "native messaging host not found" with the competitor — explicitly note this design has no native host.
