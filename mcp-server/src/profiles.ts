/**
 * Tool-set profiles.
 *
 * Why this exists: MCP loads every connected server's full tool definitions
 * (name + description + JSON-schema for inputs) into the LLM's context on
 * every turn. A 5-tool server can easily cost 1,500–3,000 tokens per turn
 * just for its definitions, regardless of whether any tool is actually called.
 *
 * Most projects don't need all five capture-store tools at the same time.
 * `CCC_MCP_TOOLS` lets the user pick a smaller subset and recover the
 * savings. Profiles are convenience shortcuts; an explicit comma-separated
 * list (e.g. `get_context,search_contexts`) is also valid.
 *
 * The exhaustive token cost per tool is measured by `scripts/measure-tokens.ts`
 * and documented in the README so users can make informed choices.
 */

export type ToolName =
  | 'list_contexts'
  | 'get_context'
  | 'search_contexts'
  | 'stats_contexts'
  | 'delete_context';

export const ALL_TOOLS: readonly ToolName[] = [
  'list_contexts',
  'get_context',
  'search_contexts',
  'stats_contexts',
  'delete_context',
] as const;

export const PROFILES: Record<string, readonly ToolName[]> = {
  /** Just fetch by slug — for when the agent already knows what to read (e.g. from CLAUDE.md). */
  minimal: ['get_context'],
  /** List + get. Browse-then-fetch. Smallest useful profile for general use. */
  lean: ['get_context', 'list_contexts'],
  /** Search + get. For larger stores where listing isn't useful. */
  search: ['get_context', 'search_contexts'],
  /** All discovery + fetch, but no destructive ops. */
  discover: ['get_context', 'list_contexts', 'search_contexts'],
  /** Everything. */
  full: ALL_TOOLS,
  /** Alias for the default behavior. */
  default: ALL_TOOLS,
};

/**
 * Parse the user's selection — typically from `process.env.CCC_MCP_TOOLS`.
 *
 * Accepted forms (case-insensitive, whitespace tolerated):
 *   - `undefined` / `""` → ALL_TOOLS (the default; preserves backward compat)
 *   - a known profile name: `minimal` | `lean` | `search` | `discover` | `full` | `default`
 *   - a comma-separated list of tool names: `get_context,list_contexts`
 *
 * Unknown names in a list are reported in `warnings` (so the user notices
 * typos) but don't halt startup — silently dropping unknown tools is
 * surprising, but failing to start would be worse for an MCP server the
 * user is already trying to use.
 */
export function parseEnabledTools(raw: string | undefined): {
  tools: readonly ToolName[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const trimmed = (raw ?? '').trim().toLowerCase();

  if (trimmed === '') {
    return { tools: ALL_TOOLS, warnings };
  }

  // Profile name takes precedence over treating it as a single tool.
  if (Object.prototype.hasOwnProperty.call(PROFILES, trimmed)) {
    return { tools: PROFILES[trimmed], warnings };
  }

  const requested = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const out: ToolName[] = [];
  for (const name of requested) {
    if ((ALL_TOOLS as readonly string[]).includes(name)) {
      if (!out.includes(name as ToolName)) {
        out.push(name as ToolName);
      }
    } else {
      warnings.push(
        `CCC_MCP_TOOLS: unknown tool "${name}" (valid: ${ALL_TOOLS.join(', ')}). Ignored.`
      );
    }
  }

  if (out.length === 0) {
    warnings.push(
      'CCC_MCP_TOOLS resolved to no tools — falling back to the full set.'
    );
    return { tools: ALL_TOOLS, warnings };
  }

  return { tools: out, warnings };
}

/** Convenience: just the tool list, dropping the warnings (for callers that don't care). */
export function enabledTools(raw: string | undefined): readonly ToolName[] {
  return parseEnabledTools(raw).tools;
}
