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
 *   - list_contexts    : list captured contexts (metadata only), filterable
 *   - get_context      : fetch one capture's full Markdown by slug
 *   - search_contexts  : ranked substring search across captures, filterable
 *   - stats_contexts   : aggregate stats (counts by source/tag, date range)
 *   - delete_context   : remove a capture by slug
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  ContextStore,
  resolveContextsDir,
  toSummary,
  describeStatus,
  extractCode,
  isSafeSlugComponent,
} from './store.js';
import { searchContexts } from './search.js';
import { filterEntries, type FilterCriteria } from './filter.js';
import { computeStats, formatBytes } from './stats.js';
import { parseEnabledTools, type ToolName } from './profiles.js';

const VERSION = '0.2.0';

const contextsDir = resolveContextsDir();
const store = new ContextStore(contextsDir);

const server = new McpServer({
  name: 'claude-code-context-capturer',
  version: VERSION,
});

// Per-turn token cost reminder: the MCP host loads every registered tool's
// description + JSON-schema into the LLM's context on every message, whether
// or not the tool is called. Honoring CCC_MCP_TOOLS lets users prune the set
// down to what they actually use.
const { tools: ENABLED_TOOLS, warnings: TOOL_WARNINGS } = parseEnabledTools(
  process.env.CCC_MCP_TOOLS
);
for (const w of TOOL_WARNINGS) {
  // stderr so it doesn't pollute the JSON-RPC channel on stdout.
  console.error(`[ccc-mcp] ${w}`);
}

/**
 * Whether the user has enabled this tool. Each tool registration below is
 * wrapped in `if (isToolEnabled(...))` rather than going through a wrapper —
 * a wrapper would have to choose between losing the SDK's input-schema →
 * handler-args type inference (broad `any`) or chasing the SDK's overloaded
 * registerTool signature (Parameters<…> collapses to the last overload).
 * Inline guards keep every call site fully typed.
 */
function isToolEnabled(name: ToolName): boolean {
  return ENABLED_TOOLS.includes(name);
}

// Reusable filter fields shared by list_contexts and search_contexts.
const FILTER_FIELDS = {
  parser: z
    .string()
    .optional()
    .describe('Filter by capture source, e.g. "claude-ai", "github", "generic".'),
  tags: z
    .array(z.string())
    .optional()
    .describe(
      'Filter by tags (case-insensitive, substring). e.g. ["lang:ts"] or ' +
        '["artifacts-only"]. By default an entry must match ALL given tags.'
    ),
  tagMatch: z
    .enum(['all', 'any'])
    .optional()
    .describe('Whether entries must match ALL tags (default) or ANY of them.'),
  since: z
    .string()
    .optional()
    .describe('Only captures on/after this ISO date or datetime, e.g. "2026-05-01".'),
  until: z
    .string()
    .optional()
    .describe('Only captures on/before this ISO date or datetime (date = whole day).'),
};

function criteriaFrom(args: {
  parser?: string;
  tags?: string[];
  tagMatch?: 'all' | 'any';
  since?: string;
  until?: string;
}): FilterCriteria {
  return {
    parser: args.parser,
    tags: args.tags,
    tagMatch: args.tagMatch,
    since: args.since,
    until: args.until,
  };
}

// ---------------------------------------------------------------------------
// list_contexts
// ---------------------------------------------------------------------------

if (isToolEnabled('list_contexts')) server.registerTool(
  'list_contexts',
  {
    description:
      'List web pages and claude.ai conversations captured into this project ' +
      'by the Claude Code Context Capturer browser extension. Returns metadata ' +
      'only (slug, title, url, source, captured_at, tags) — call get_context ' +
      'with a slug to read the full content. Filter by source, tags, and date ' +
      'range. Use this to discover what research or planning context is ' +
      'available before answering.',
    inputSchema: {
      ...FILTER_FIELDS,
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .optional()
        .describe('Maximum number of entries to return (default 50).'),
    },
  },
  async ({ parser, tags, tagMatch, since, until, limit }) => {
    const all = await store.readAll();
    const { entries, warnings } = filterEntries(
      all,
      criteriaFrom({ parser, tags, tagMatch, since, until })
    );
    const summaries = entries.slice(0, limit ?? 50).map(toSummary);

    if (summaries.length === 0) {
      return textResult(prependWarnings(warnings, await emptyMessage(parser)));
    }

    const header = `${summaries.length} captured context(s) in ${contextsDir}:\n`;
    const lines = summaries.map(formatSummaryLine);
    return textResult(prependWarnings(warnings, header + '\n' + lines.join('\n')));
  }
);

// ---------------------------------------------------------------------------
// get_context
// ---------------------------------------------------------------------------

if (isToolEnabled('get_context')) server.registerTool(
  'get_context',
  {
    description:
      'Fetch one captured context by its slug (from list_contexts or ' +
      'search_contexts). Matching is fuzzy: an exact filename, a slug, or a ' +
      'unique substring all work. With format:"code" (useful for artifacts — ' +
      'single code/document files), returns just the raw code with frontmatter ' +
      'and code fences stripped, ready to write to a file.',
    inputSchema: {
      slug: z
        .string()
        .describe('The context slug, filename, or a unique substring of it.'),
      format: z
        .enum(['markdown', 'code'])
        .optional()
        .describe(
          'markdown (default): full file with frontmatter. code: raw code only, ' +
            'fences and frontmatter stripped — best for single artifacts.'
        ),
    },
  },
  async ({ slug, format }) => {
    const entry = await store.readBySlug(slug);
    if (!entry) {
      return textResult(
        `No captured context matches "${slug}". Run list_contexts to see available slugs.`,
        true
      );
    }
    if (format === 'code') {
      return textResult(extractCode(entry));
    }
    return textResult(entry.raw);
  }
);

// ---------------------------------------------------------------------------
// search_contexts
// ---------------------------------------------------------------------------

if (isToolEnabled('search_contexts')) server.registerTool(
  'search_contexts',
  {
    description:
      'Search captured contexts by keyword(s), ranked by relevance. Matches ' +
      'titles, URLs, tags, and body text, and returns short snippets around ' +
      'each match plus the slug to fetch with get_context. Optionally restrict ' +
      'the search to a source, tags, or date range first. Prefer this over ' +
      'reading every context when you are looking for something specific.',
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe('One or more space-separated keywords to search for.'),
      ...FILTER_FIELDS,
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe('Maximum number of hits to return (default 10).'),
    },
  },
  async ({ query, parser, tags, tagMatch, since, until, limit }) => {
    const all = await store.readAll();
    const { entries, warnings } = filterEntries(
      all,
      criteriaFrom({ parser, tags, tagMatch, since, until })
    );
    const hits = searchContexts(entries, query, limit ?? 10);
    if (hits.length === 0) {
      return textResult(
        prependWarnings(warnings, `No captured contexts match "${query}".`)
      );
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
      prependWarnings(
        warnings,
        `${hits.length} match(es) for "${query}":\n\n` + blocks.join('\n\n')
      )
    );
  }
);

// ---------------------------------------------------------------------------
// stats_contexts
// ---------------------------------------------------------------------------

if (isToolEnabled('stats_contexts')) server.registerTool(
  'stats_contexts',
  {
    description:
      'Summarize the capture store: total count and size, a breakdown by ' +
      'source (claude-ai / github / generic / …), the most common tags, and ' +
      'the captured-at date range. Use this for an at-a-glance picture of what ' +
      'research/planning context exists without listing every entry.',
    inputSchema: {},
  },
  async () => {
    const all = await store.readAll();
    if (all.length === 0) {
      return textResult(await emptyMessage());
    }
    const stats = computeStats(all);
    const lines: string[] = [];
    lines.push(`**${stats.total}** captured context(s), ${formatBytes(stats.totalBytes)} total.`);
    if (stats.earliest && stats.latest) {
      lines.push(`Date range: ${stats.earliest} → ${stats.latest}`);
    }
    lines.push('');
    lines.push('By source:');
    for (const { source, count } of stats.bySource) {
      lines.push(`- ${source}: ${count}`);
    }
    if (stats.topTags.length > 0) {
      lines.push('');
      lines.push('Top tags:');
      for (const { tag, count } of stats.topTags) {
        lines.push(`- ${tag}: ${count}`);
      }
    }
    return textResult(lines.join('\n'));
  }
);

// ---------------------------------------------------------------------------
// delete_context
// ---------------------------------------------------------------------------

if (isToolEnabled('delete_context')) server.registerTool(
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
    // Defense in depth at the destructive boundary: reject path-like slugs
    // outright (store.deleteBySlug also contains the path, but a clear refusal
    // here is safer and more legible than a silent "nothing deleted").
    if (!isSafeSlugComponent(slug)) {
      return textResult(
        `Refusing to delete: "${slug}" is not a valid context slug ` +
          `(no paths or "..").`,
        true
      );
    }
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

/** Prefix any non-fatal filter warnings (e.g. a bad date bound) to the output. */
function prependWarnings(warnings: string[], text: string): string {
  if (warnings.length === 0) return text;
  return warnings.map((w) => `⚠️ ${w}`).join('\n') + '\n\n' + text;
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

async function emptyMessage(parser?: string): Promise<string> {
  const status = await store.status();
  const where = describeStatus(contextsDir, status);

  // A misconfigured directory (missing / file / unreadable) is the real
  // problem far more often than "no captures yet" — surface it directly so
  // the agent can relay the fix instead of saying "nothing found".
  if (status.kind !== 'ok') {
    return `No captured contexts available.\n${where}`;
  }

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
  // Emit a clear startup diagnostic so the #1 silent failure mode ("I
  // captured something but Claude Code can't see it") is immediately
  // visible: it almost always means this resolved path differs from where
  // the extension writes.
  const status = await store.status();
  console.error(`[ccc-mcp] v${VERSION} ready.`);
  console.error(`[ccc-mcp] ${describeStatus(contextsDir, status)}`);
  if (status.kind !== 'ok') {
    console.error(
      `[ccc-mcp] hint: this is the absolute path the server resolved from ` +
        `its arguments and working directory. If captures don't appear, the ` +
        `extension is likely writing to a different folder.`
    );
  }
}

main().catch((error) => {
  console.error('[ccc-mcp] fatal:', error);
  process.exit(1);
});
