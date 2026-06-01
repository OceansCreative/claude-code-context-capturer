# Claude Code Context Capturer — MCP server

Expose the web pages and **claude.ai conversations** you capture with the
[Claude Code Context Capturer](https://github.com/OceansCreative/claude-code-context-capturer)
browser extension to **Claude Code — on demand**, over MCP.

## Why on-demand instead of CLAUDE.md?

Anthropic's own guidance is to keep `CLAUDE.md` small (target < 200 lines) —
[bloated context files make Claude ignore your instructions](https://code.claude.com/docs/en/memory).
Dumping every captured article and chat into `CLAUDE.md` works against that.

This MCP server takes the opposite approach: your captures live as individual
Markdown files in a directory, and Claude Code pulls in **only the ones it needs,
only when it needs them** — via `list_contexts`, `search_contexts`, and
`get_context`. Nothing is loaded into context until the agent asks. No silos,
no bloat.

## How it fits together

```
 ┌─────────────┐   capture (FSA write)    ┌──────────────────┐   read    ┌─────────────┐
 │  browser    │ ───────────────────────▶ │  contexts dir/   │ ◀──────── │ this MCP    │
 │  extension  │   <slug>.md per capture   │  *.md files      │           │ server      │
 └─────────────┘                           └──────────────────┘           └──────┬──────┘
                                                                                  │ stdio (MCP)
                                                                           ┌──────▼──────┐
                                                                           │ Claude Code │
                                                                           └─────────────┘
```

**No native-messaging host.** The extension writes plain files via the File
System Access API; this server just reads that directory. That's the single
biggest reliability difference from similar bridges — there's nothing fragile to
register.

## Install

Requires Node.js ≥ 18. No global install needed — `npx` fetches it on demand.

```bash
# From inside your project, register the server pointed at your captures dir:
claude mcp add ccc-contexts \
  -- npx -y claude-code-context-capturer-mcp ./.ccc-contexts
```

Or add it to your MCP config manually:

```json
{
  "mcpServers": {
    "ccc-contexts": {
      "command": "npx",
      "args": ["-y", "claude-code-context-capturer-mcp", "./.ccc-contexts"]
    }
  }
}
```

The captures directory is resolved in this order:

1. the first CLI argument (`./.ccc-contexts` above)
2. the `CCC_CONTEXTS_DIR` environment variable
3. `<cwd>/.ccc-contexts`

`~` is expanded to your home directory.

## Connect the extension

1. Open the extension's options page.
2. Under **MCP contexts directory**, click **Link directory** and pick the same
   directory you pointed the server at (e.g. `.ccc-contexts` in your project).
3. Set **Default action** to **“Save to MCP contexts directory.”**

Now every page or claude.ai conversation you capture lands as a `.md` file the
server can serve to Claude Code.

## Tools

| Tool | Description |
|------|-------------|
| `list_contexts` | List captures (metadata only). Optional `parser` filter, `limit`. |
| `search_contexts` | Ranked keyword search across title, URL, tags, and body, with snippets. |
| `get_context` | Fetch one capture's full Markdown by `slug` (fuzzy matching). |
| `delete_context` | Remove a capture by `slug` once it's been incorporated. |

### Example

In Claude Code:

> *“Search my captured contexts for the OAuth migration plan and use it.”*

Claude calls `search_contexts({ query: "oauth migration" })`, finds the
`claude-ai` conversation you captured, then `get_context` to read the full plan —
without you pasting anything.

## File format

The server reads the Markdown + YAML frontmatter the extension emits:

```markdown
---
url: https://claude.ai/chat/abc-123
title: "Auth refactor plan"
captured_at: 2026-05-31T14:00:00.000Z
parser: claude-ai
tags: ["model:claude-opus-4"]
---

# Auth refactor plan
...
```

Files without frontmatter are still served (the whole file becomes the body, and
the title falls back to the first heading or the filename).

## Develop

```bash
npm install
npm run build      # tsc -> dist/, makes bin executable
npm test           # vitest
npm start          # run against ./.ccc-contexts (or $CCC_CONTEXTS_DIR)
```

Logs go to **stderr** — stdout is the JSON-RPC channel and must stay clean.

## License

MIT
