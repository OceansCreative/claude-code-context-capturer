#!/usr/bin/env node
/**
 * Claude Code Context Capturer — MCP server.
 *
 * Exposes web pages and claude.ai conversations captured by the browser
 * extension to Claude Code, on demand, over stdio. Unlike appending to
 * CLAUDE.md (which Anthropic explicitly warns bloats context and degrades
 * instruction-following), captures stay out of the always-loaded context and
 * are pulled in only when the agent asks for them.
 *
 * Design note: this server reads a plain directory of Markdown files written
 * by the extension via the File System Access API. It deliberately uses NO
 * native-messaging host — the single most common failure mode of similar
 * tools — so installation is just `npx` + one line in the MCP config.
 *
 * Tools:
 *   - list_contexts    : list captured contexts (metadata only)
 *   - get_context      : fetch one capture's full Markdown by slug
 *   - search_contexts  : ranked substring search across captures
 *   - delete_context   : remove a capture by slug
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ContextStore, resolveContextsDir, toSummary } from './store.js';
import { searchContexts } from './search.js';

const VERSION = '0.1.0';

const contextsDir = resolveContextsDir();
const store = new ContextStore(contextsDir);

const server = new McpServer({
  name: 'claude-code-context-capturer',
  version: VERSION,
});

// ---------------------------------------------------------------------------
// list_contexts
// ---------------------------------------------------------------------------

server.registerTool(
  'list_contexts',
  {
    description:
      'List web pages and claude.ai conversations captured into this project ' +
      'by the Claude Code Context Capturer browser extension. Returns metadata ' +
      'only (slug, title, url, source, captured_at, tags) — call get_context ' +
      'with a slug to read the full content. Use this to discover what research ' +
      'or planning context is available before answering.',
    inputSchema: {
      parser: z
        .string()
        .optional()
        .describe(
          'Optional filter by capture source, e.g. "claude-ai", "github", "generic".'
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .optional()
        .describe('Maximum number of entries to return (default 50).'),
    },
  },
  async ({ parser, limit }) => {
    const all = await store.readAll();
    let filtered = all;
    if (parser) {
      const p = parser.toLowerCase();
      filtered = all.filter((e) => (e.parser ?? '').toLowerCase() === p);
    }
    const summaries = filtered.slice(0, limit ?? 50).map(toSummary);

    if (summaries.length === 0) {
      return textResult(emptyMessage(parser));
    }

    const header = `${summaries.length} captured context(s) in ${contextsDir}:\n`;
    const lines = summaries.map(formatSummaryLine);
    return textResult(header + '\n' + lines.join('\n'));
  }
);

// ---------------------------------------------------------------------------
// get_context
// ---------------------------------------------------------------------------

server.registerTool(
  'get_context',
  {
    description:
      'Fetch the full Markdown of one captured context by its slug (from ' +
      'list_contexts or search_contexts). Returns the complete captured page ' +
      'or claude.ai conversation, including frontmatter metadata. Matching is ' +
      'fuzzy: an exact filename, a slug, or a unique substring all work.',
    inputSchema: {
      slug: z
        .string()
        .describe('The context slug, filename, or a unique substring of it.'),
    },
  },
  async ({ slug }) => {
    const entry = await store.readBySlug(slug);
    if (!entry) {
      return textResult(
        `No captured context matches "${slug}". Run list_contexts to see available slugs.`,
        true
      );
    }
    return textResult(entry.raw);
  }
);

// ---------------------------------------------------------------------------
// search_contexts
// ---------------------------------------------------------------------------

server.registerTool(
  'search_contexts',
  {
    description:
      'Search captured contexts by keyword(s), ranked by relevance. Matches ' +
      'titles, URLs, tags, and body text, and returns short snippets around ' +
      'each match plus the slug to fetch with get_context. Prefer this over ' +
      'reading every context when you are looking for something specific.',
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe('One or more space-separated keywords to search for.'),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe('Maximum number of hits to return (default 10).'),
    },
  },
  async ({ query, limit }) => {
    const all = await store.readAll();
    const hits = searchContexts(all, query, limit ?? 10);
    if (hits.length === 0) {
      return textResult(`No captured contexts match "${query}".`);
    }
    const blocks = hits.map((h) => {
      const meta = [
        `### ${h.title}`,
        `- slug: \`${h.slug}\``,
        h.url ? `- url: ${h.url}` : undefined,
        h.parser ? `- source: ${h.parser}` : undefined,
        h.capturedAt ? `- captured_at: ${h.capturedAt}` : undefined,
        h.snippets.length > 0 ? `- match: ${h.snippets.join(' ')}` : undefined,
      ]
        .filter(Boolean)
        .join('\n');
      return meta;
    });
    return textResult(
      `${hits.length} match(es) for "${query}":\n\n` + blocks.join('\n\n')
    );
  }
);

// ---------------------------------------------------------------------------
// delete_context
// ---------------------------------------------------------------------------

server.registerTool(
  'delete_context',
  {
    description:
      'Delete a captured context by slug once it is no longer needed (e.g. ' +
      'after its content has been incorporated into the code or notes). This ' +
      'removes the Markdown file from the captures directory.',
    inputSchema: {
      slug: z.string().describe('The context slug to delete.'),
    },
  },
  async ({ slug }) => {
    const deleted = await store.deleteBySlug(slug);
    if (!deleted) {
      return textResult(
        `No captured context matches "${slug}"; nothing deleted.`,
        true
      );
    }
    return textResult(`Deleted captured context "${slug}".`);
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    isError,
  };
}

function formatSummaryLine(s: ReturnType<typeof toSummary>): string {
  const parts = [`- \`${s.slug}\` — ${s.title}`];
  const meta: string[] = [];
  if (s.parser) meta.push(s.parser);
  if (s.capturedAt) meta.push(s.capturedAt);
  if (s.tags.length > 0) meta.push(`tags: ${s.tags.join(', ')}`);
  if (meta.length > 0) parts.push(`  (${meta.join(' · ')})`);
  if (s.url) parts.push(`\n  ${s.url}`);
  return parts.join('');
}

function emptyMessage(parser?: string): string {
  const where = `Captures directory: ${contextsDir}`;
  if (parser) {
    return `No captured contexts with source "${parser}".\n${where}`;
  }
  return (
    `No captured contexts found yet.\n${where}\n\n` +
    'Capture pages or claude.ai conversations with the Claude Code Context ' +
    'Capturer browser extension (set its output to this directory), then they ' +
    'will appear here.'
  );
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the JSON-RPC channel — log only to stderr.
  console.error(
    `[ccc-mcp] v${VERSION} ready. Watching captures in: ${contextsDir}`
  );
}

main().catch((error) => {
  console.error('[ccc-mcp] fatal:', error);
  process.exit(1);
});
