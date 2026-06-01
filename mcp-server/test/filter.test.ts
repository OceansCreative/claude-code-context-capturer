import { describe, expect, it } from 'vitest';
import { filterEntries } from '../src/filter.js';
import { computeStats, formatBytes } from '../src/stats.js';
import type { ContextEntry } from '../src/store.js';

function entry(p: Partial<ContextEntry>): ContextEntry {
  return {
    slug: p.slug ?? 's',
    filePath: p.filePath ?? '/x/s.md',
    title: p.title ?? 'Title',
    url: p.url,
    parser: p.parser,
    capturedAt: p.capturedAt,
    author: p.author,
    tags: p.tags ?? [],
    body: p.body ?? '',
    raw: p.raw ?? '',
    bytes: p.bytes ?? 0,
  };
}

const SAMPLE: ContextEntry[] = [
  entry({
    slug: 'a',
    parser: 'claude-ai',
    tags: ['model:claude-opus-4', 'artifacts-only', 'lang:ts'],
    capturedAt: '2026-05-01T10:00:00.000Z',
    bytes: 1000,
  }),
  entry({
    slug: 'b',
    parser: 'github',
    tags: ['bug'],
    capturedAt: '2026-05-15T10:00:00.000Z',
    bytes: 2000,
  }),
  entry({
    slug: 'c',
    parser: 'claude-ai',
    tags: ['lang:python'],
    capturedAt: '2026-05-30T10:00:00.000Z',
    bytes: 3000,
  }),
  entry({ slug: 'd', parser: 'generic', tags: [], capturedAt: undefined, bytes: 500 }),
];

describe('filterEntries — parser', () => {
  it('filters by exact source, case-insensitive', () => {
    const { entries } = filterEntries(SAMPLE, { parser: 'Claude-AI' });
    expect(entries.map((e) => e.slug)).toEqual(['a', 'c']);
  });
});

describe('filterEntries — tags', () => {
  it('matches a tag by substring', () => {
    const { entries } = filterEntries(SAMPLE, { tags: ['lang:ts'] });
    expect(entries.map((e) => e.slug)).toEqual(['a']);
  });

  it('ANDs multiple tags by default', () => {
    const { entries } = filterEntries(SAMPLE, {
      tags: ['artifacts-only', 'lang:ts'],
    });
    expect(entries.map((e) => e.slug)).toEqual(['a']);
  });

  it('returns nothing when AND is unsatisfiable', () => {
    const { entries } = filterEntries(SAMPLE, { tags: ['lang:ts', 'bug'] });
    expect(entries).toHaveLength(0);
  });

  it('ORs tags with tagMatch:any', () => {
    const { entries } = filterEntries(SAMPLE, {
      tags: ['lang:ts', 'bug'],
      tagMatch: 'any',
    });
    expect(entries.map((e) => e.slug)).toEqual(['a', 'b']);
  });

  it('substring matches the tag prefix, e.g. "lang:"', () => {
    const { entries } = filterEntries(SAMPLE, { tags: ['lang:'] });
    expect(entries.map((e) => e.slug)).toEqual(['a', 'c']);
  });
});

describe('filterEntries — date range', () => {
  it('filters since (inclusive)', () => {
    const { entries } = filterEntries(SAMPLE, { since: '2026-05-15' });
    expect(entries.map((e) => e.slug)).toEqual(['b', 'c']);
  });

  it('filters until as end-of-day for a bare date', () => {
    const { entries } = filterEntries(SAMPLE, { until: '2026-05-15' });
    // b is on 2026-05-15T10:00 — must be included by the end-of-day rule.
    expect(entries.map((e) => e.slug)).toEqual(['a', 'b']);
  });

  it('combines since and until into a window', () => {
    const { entries } = filterEntries(SAMPLE, {
      since: '2026-05-10',
      until: '2026-05-20',
    });
    expect(entries.map((e) => e.slug)).toEqual(['b']);
  });

  it('excludes entries without a date when a date filter is set', () => {
    const { entries } = filterEntries(SAMPLE, { since: '2026-01-01' });
    expect(entries.map((e) => e.slug)).not.toContain('d');
  });

  it('warns and ignores an invalid date bound', () => {
    const { entries, warnings } = filterEntries(SAMPLE, { since: 'not-a-date' });
    expect(warnings.join(' ')).toMatch(/not a valid ISO date/);
    expect(entries).toHaveLength(SAMPLE.length); // bound ignored
  });
});

describe('computeStats', () => {
  it('aggregates totals, sources, tags, and range', () => {
    const stats = computeStats(SAMPLE);
    expect(stats.total).toBe(4);
    expect(stats.totalBytes).toBe(6500);
    expect(stats.bySource[0]).toEqual({ source: 'claude-ai', count: 2 });
    expect(stats.bySource.map((s) => s.source)).toContain('generic');
    // lang:ts and others each appear once; claude-ai entries dominate tag set.
    expect(stats.topTags.find((t) => t.tag === 'lang:ts')?.count).toBe(1);
    expect(stats.earliest).toBe('2026-05-01T10:00:00.000Z');
    expect(stats.latest).toBe('2026-05-30T10:00:00.000Z');
  });

  it('labels missing parser as unknown', () => {
    const stats = computeStats([entry({ slug: 'x', parser: undefined })]);
    expect(stats.bySource[0]).toEqual({ source: 'unknown', count: 1 });
  });
});

describe('formatBytes', () => {
  it('formats B / KB / MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
