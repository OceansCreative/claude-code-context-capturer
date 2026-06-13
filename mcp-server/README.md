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
| `list_contexts` | List captures (metadata only). Filter by `parser`, `tags` (AND/OR via `tagMatch`), `since`/`until` date range; `limit`. |
| `search_contexts` | Ranked keyword search across title, URL, tags, and body, with snippets. Accepts the same `parser`/`tags`/`since`/`until` filters to scope the search first. |
| `stats_contexts` | Aggregate overview: total count + size, breakdown by source, top tags, captured-at date range. |
| `get_context` | Fetch one capture by `slug` (fuzzy matching). `format:"code"` returns just the raw code (fences + frontmatter stripped) — ideal for single artifacts. |
| `delete_context` | Remove a capture by `slug` once it's been incorporated. |

### Trim the tool set to save tokens *(v0.2.0+)*

MCP hosts load every connected server's full tool definitions (name +
description + JSON-schema) into the LLM's context on **every turn**, whether
the tools are called or not. Set `CCC_MCP_TOOLS` to expose only the subset
you actually use:

| Profile | Tools | Per-turn cost (est. tokens) | Savings vs full |
|---------|-------|------------------------------:|----------------:|
| `minimal` | `get_context` | 232 | 82% |
| `lean` | `get_context` + `list_contexts` | 616 | 52% |
| `search` | `get_context` + `search_contexts` | 644 | 50% |
| `discover` | `get_context` + `list_contexts` + `search_contexts` | 1,027 | 20% |
| `full` *(default)* | all 5 | 1,282 | — |

You can also pass an explicit comma-separated list, e.g.
`CCC_MCP_TOOLS=get_context,stats_contexts`. Unknown tool names are logged to
stderr and dropped.

```jsonc
// In your Claude Code mcp config:
{
  "mcpServers": {
    "ccc": {
      "command": "ccc-mcp",
      "env": {
        "CCC_CONTEXTS_DIR": "/Users/you/code/your-project/.captures",
        "CCC_MCP_TOOLS": "lean"
      }
    }
  }
}
```

Per-tool costs (run `npm run measure-tokens` to regenerate):

| Tool | Chars | Est. tokens |
|------|------:|------------:|
| `get_context` | 812 | 232 |
| `stats_contexts` | 440 | 126 |
| `delete_context` | 452 | 130 |
| `list_contexts` | 1,343 | 384 |
| `search_contexts` | 1,439 | 412 |

(Approximation: `tokens ≈ chars/3.5`. Actual `cl100k_base` tokens land within ±10%.)

### Artifacts as individual files

When you capture a claude.ai conversation in **mcp-store** mode, each code or
document **artifact** Claude wrote is also saved as its own file (`parser:
claude-ai-artifact`, tagged `artifact` + `lang:<x>`). So you can:

```
list_contexts({ tags: ["artifact"], parser: "claude-ai-artifact" })
get_context({ slug: "...--auth-middleware", format: "code" })   // → raw code, ready to write to a file
```

That's the "one code = one file" path: ask Claude Code to pull a specific
artifact and it gets exactly that file's contents, with no conversation or
Markdown wrapping.

### Filtering

`list_contexts` and `search_contexts` share these optional filters:

- `parser` — exact source, e.g. `"claude-ai"`, `"github"`, `"generic"`.
- `tags` — case-insensitive substring match. `["lang:ts"]` matches the
  `lang:ts` tag; `["lang:"]` matches any language tag. Multiple tags are ANDed
  by default; pass `tagMatch: "any"` to OR them.
- `since` / `until` — ISO date (`"2026-05-01"`) or datetime. A bare `until` date
  covers the whole day. An unparseable bound is ignored with a warning rather
  than failing the call.

Example: *"search my claude.ai TypeScript artifacts from this month for the auth
helper"* →
`search_contexts({ query: "auth helper", parser: "claude-ai", tags: ["lang:ts"], since: "2026-06-01" })`.

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

## Troubleshooting

**"I captured something but Claude Code can't see it."** This almost always
means the server and the extension disagree on *which directory* to use. The
server logs the exact absolute path it resolved on startup (to stderr):

```
[ccc-mcp] Watching 3 capture(s) in: /Users/you/project/.ccc-contexts
```

If you instead see `does not exist`, `is a file, not a directory`, or a count of
`0` when you expect captures, compare that absolute path against the directory
you linked in the extension's options page — they must resolve to the **same
folder**. The most common cause is a relative path (`./.ccc-contexts`) resolving
against an unexpected working directory; use an absolute path in the MCP config
if in doubt. The `list_contexts` tool surfaces the same diagnostic to the agent.

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
