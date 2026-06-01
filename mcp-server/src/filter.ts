/**
 * Shared filtering over captured contexts: by source (parser), tags, and a
 * captured-at date range. Used by both list_contexts and search_contexts so
 * the two tools behave consistently.
 */

import type { ContextEntry } from './store.js';

export interface FilterCriteria {
  /** Exact source/parser, case-insensitive (e.g. "claude-ai"). */
  parser?: string;
  /**
   * Tags the entry must carry. Matching is case-insensitive and substring-based
   * so `lang:ts` matches and `ts` also matches `lang:ts`. By default an entry
   * must match ALL given tags (AND); pass tagMatch:'any' for OR.
   */
  tags?: string[];
  /** 'all' (AND, default) or 'any' (OR) over the `tags` list. */
  tagMatch?: 'all' | 'any';
  /** Inclusive lower bound on captured_at (ISO date or datetime). */
  since?: string;
  /** Inclusive upper bound on captured_at (ISO date or datetime). */
  until?: string;
}

export interface FilterResult {
  entries: ContextEntry[];
  /** Non-fatal notes, e.g. an unparseable date bound that was ignored. */
  warnings: string[];
}

export function filterEntries(
  entries: ContextEntry[],
  criteria: FilterCriteria
): FilterResult {
  const warnings: string[] = [];

  const sinceMs = parseBound(criteria.since, 'since', warnings, false);
  const untilMs = parseBound(criteria.until, 'until', warnings, true);

  const wantTags = (criteria.tags ?? [])
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  const tagMatch = criteria.tagMatch ?? 'all';
  const wantParser = criteria.parser?.trim().toLowerCase();

  const filtered = entries.filter((e) => {
    if (wantParser && (e.parser ?? '').toLowerCase() !== wantParser) return false;

    if (wantTags.length > 0) {
      const have = e.tags.map((t) => t.toLowerCase());
      const matches = (want: string) => have.some((h) => h.includes(want));
      const ok = tagMatch === 'any' ? wantTags.some(matches) : wantTags.every(matches);
      if (!ok) return false;
    }

    if (sinceMs !== undefined || untilMs !== undefined) {
      const t = e.capturedAt ? Date.parse(e.capturedAt) : NaN;
      if (Number.isNaN(t)) return false; // can't satisfy a date filter without a date
      if (sinceMs !== undefined && t < sinceMs) return false;
      if (untilMs !== undefined && t > untilMs) return false;
    }

    return true;
  });

  return { entries: filtered, warnings };
}

/**
 * Parse a date bound. A bare date ("2026-05-01") is treated as the start of
 * that day; for an `until` bound it's pushed to the end of the day so the bound
 * is inclusive of the whole calendar day.
 */
function parseBound(
  raw: string | undefined,
  label: string,
  warnings: string[],
  endOfDay: boolean
): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    warnings.push(`Ignored ${label}: "${raw}" is not a valid ISO date.`);
    return undefined;
  }
  // Date-only string (no time component) → optionally extend to end of day.
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  if (isDateOnly && endOfDay) {
    return ms + 24 * 60 * 60 * 1000 - 1;
  }
  return ms;
}
