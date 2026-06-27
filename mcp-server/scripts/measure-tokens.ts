/**
 * Measure the per-turn token cost the MCP host pays just to know each tool
 * exists. The host serializes the tool's name, description, and input JSON
 * schema into the LLM's context on every message, whether or not the tool
 * is called. With 5 tools and rich descriptions, that adds up.
 *
 * No native tokenizer dependency: we use a conservative chars→tokens
 * heuristic that's good enough for relative comparison and pessimistic
 * enough for budget planning.
 *
 *   tokens ≈ ceil(chars / 3.5)
 *
 * 3.5 is between the standard "4 chars per token" for English prose and the
 * "3 chars per token" for JSON-like content. For these specific tool
 * definitions (description prose + JSON schema), this lands within ~10% of
 * what cl100k_base actually produces.
 *
 * Run: `npm run measure-tokens` (after `npm run build`).
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ALL_TOOLS, PROFILES, type ToolName } from '../src/profiles.js';

// We can't import the actual `server.registerTool` calls without starting the
// server (and side-effecting on the contexts dir). Instead we mirror the
// tool definitions here. KEEP IN SYNC with src/index.ts BY HAND: the
// `Record<ToolName, …>` typing guarantees the tool *set* stays aligned with
// profiles.ts, but the description/schema text is a manual copy with nothing
// enforcing it matches the live definitions.

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

const TOOL_DEFINITIONS: Record<ToolName, { description: string; inputSchema: Record<string, z.ZodTypeAny> }> = {
  list_contexts: {
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
  get_context: {
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
  search_contexts: {
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
  stats_contexts: {
    description:
      'Summarize the capture store: total count and size, a breakdown by ' +
      'source (claude-ai / github / generic / …), the most common tags, and ' +
      'the captured-at date range. Use this for an at-a-glance picture of what ' +
      'research/planning context exists without listing every entry.',
    inputSchema: {},
  },
  delete_context: {
    description:
      'Delete a captured context by slug once it is no longer needed (e.g. ' +
      'after its content has been incorporated into the code or notes). This ' +
      'removes the Markdown file from the captures directory.',
    inputSchema: {
      slug: z.string().describe('The context slug to delete.'),
    },
  },
};

function tokensOf(chars: number): number {
  return Math.ceil(chars / 3.5);
}

function serializedForToolList(name: string, def: { description: string; inputSchema: Record<string, z.ZodTypeAny> }) {
  // Mirrors the shape an MCP host sends to the LLM in the tools array.
  const schema = zodToJsonSchema(z.object(def.inputSchema), { target: 'jsonSchema7' });
  return JSON.stringify({ name, description: def.description, input_schema: schema });
}

interface Row {
  name: string;
  chars: number;
  tokens: number;
}

function measure(): { perTool: Row[]; perProfile: Array<{ name: string; chars: number; tokens: number; tools: readonly ToolName[] }> } {
  const perTool: Row[] = [];
  for (const name of ALL_TOOLS) {
    const serialized = serializedForToolList(name, TOOL_DEFINITIONS[name]);
    perTool.push({ name, chars: serialized.length, tokens: tokensOf(serialized.length) });
  }

  const perProfile = Object.entries(PROFILES)
    // `default` is an alias of `full` — skip it so the table has no duplicate row.
    .filter(([name]) => name !== 'default')
    .map(([name, tools]) => {
    const chars = tools
      .map((t) => serializedForToolList(t, TOOL_DEFINITIONS[t]).length)
      .reduce((a, b) => a + b, 0);
    return { name, chars, tokens: tokensOf(chars), tools };
  });

  return { perTool, perProfile };
}

function table(rows: Row[]): string {
  const w0 = Math.max(...rows.map((r) => r.name.length), 4);
  const w1 = Math.max(...rows.map((r) => String(r.chars).length), 5);
  const w2 = Math.max(...rows.map((r) => String(r.tokens).length), 6);
  const lines = [
    `| ${'tool'.padEnd(w0)} | ${'chars'.padStart(w1)} | ${'tokens'.padStart(w2)} |`,
    `| ${'-'.repeat(w0)} | ${'-'.repeat(w1)} | ${'-'.repeat(w2)} |`,
    ...rows.map(
      (r) => `| ${r.name.padEnd(w0)} | ${String(r.chars).padStart(w1)} | ${String(r.tokens).padStart(w2)} |`
    ),
  ];
  return lines.join('\n');
}

function main(): void {
  const { perTool, perProfile } = measure();

  console.log('Per-tool serialized cost (what an MCP host sends to the LLM on every turn):\n');
  console.log(table(perTool));

  console.log('\nPer-profile total (sum of tools in that profile):\n');
  const profileRows: Row[] = perProfile.map((p) => ({
    name: `${p.name} (${p.tools.length} tools)`,
    chars: p.chars,
    tokens: p.tokens,
  }));
  console.log(table(profileRows));

  const fullTokens = perProfile.find((p) => p.name === 'full')!.tokens;
  const leanTokens = perProfile.find((p) => p.name === 'lean')!.tokens;
  const minimalTokens = perProfile.find((p) => p.name === 'minimal')!.tokens;
  const savedLean = fullTokens - leanTokens;
  const savedMinimal = fullTokens - minimalTokens;

  console.log(
    `\nlean profile saves ~${savedLean} tokens/turn vs full (${Math.round((savedLean / fullTokens) * 100)}%).`
  );
  console.log(
    `minimal profile saves ~${savedMinimal} tokens/turn vs full (${Math.round((savedMinimal / fullTokens) * 100)}%).`
  );
  console.log(
    '\nApproximation: tokens ≈ chars/3.5. Actual cl100k_base tokens land within ±10%.'
  );
}

main();
