/**
 * Aggregate statistics over captured contexts — for the stats_contexts tool,
 * which lets the agent (and the user) get an at-a-glance picture of what's in
 * the capture store without listing every entry.
 */

import type { ContextEntry } from './store.js';

export interface ContextStats {
  total: number;
  totalBytes: number;
  /** Count per source/parser, descending. */
  bySource: Array<{ source: string; count: number }>;
  /** Count per tag, descending, top N only. */
  topTags: Array<{ tag: string; count: number }>;
  /** Earliest captured_at (ISO), if any have dates. */
  earliest?: string;
  /** Latest captured_at (ISO), if any have dates. */
  latest?: string;
}

export function computeStats(entries: ContextEntry[], topTagsN = 15): ContextStats {
  let totalBytes = 0;
  const sourceCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  let earliestMs = Infinity;
  let latestMs = -Infinity;
  let earliest: string | undefined;
  let latest: string | undefined;

  for (const e of entries) {
    totalBytes += e.bytes;

    const source = e.parser || 'unknown';
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);

    for (const tag of e.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    if (e.capturedAt) {
      const t = Date.parse(e.capturedAt);
      if (!Number.isNaN(t)) {
        if (t < earliestMs) {
          earliestMs = t;
          earliest = e.capturedAt;
        }
        if (t > latestMs) {
          latestMs = t;
          latest = e.capturedAt;
        }
      }
    }
  }

  return {
    total: entries.length,
    totalBytes,
    bySource: sortedCounts(sourceCounts).map(([source, count]) => ({ source, count })),
    topTags: sortedCounts(tagCounts)
      .slice(0, topTagsN)
      .map(([tag, count]) => ({ tag, count })),
    earliest,
    latest,
  };
}

/** Sort a count map by count desc, then key asc for stable output. */
function sortedCounts(m: Map<string, number>): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Human-readable byte size, e.g. "12.3 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
