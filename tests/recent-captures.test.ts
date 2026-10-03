import { describe, expect, it } from 'vitest';
import type { BufferEntry } from '@/shared/buffer-storage';
import {
  selectRecentCaptures,
  captureSourceLabel,
  formatRelativeTime,
  formatCaptureRow,
  outputModeIncludesBuffer,
} from '@/shared/recent-captures';

function entry(p: Partial<BufferEntry>): BufferEntry {
  return {
    id: p.id ?? 'id-1',
    capturedAt: p.capturedAt ?? '2026-10-03T12:00:00.000Z',
    url: p.url ?? 'https://example.com/page',
    title: p.title ?? 'Example page',
    markdown: p.markdown ?? '# Example',
  };
}

// A fixed clock so relative-time assertions are deterministic.
const NOW = new Date('2026-10-03T12:00:00.000Z').getTime();

describe('selectRecentCaptures', () => {
  const entries = [1, 2, 3, 4, 5, 6, 7].map((n) => entry({ id: `id-${n}` }));

  it('returns the first N (buffer is newest-first)', () => {
    const picked = selectRecentCaptures(entries, 5);
    expect(picked.map((e) => e.id)).toEqual(['id-1', 'id-2', 'id-3', 'id-4', 'id-5']);
  });

  it('returns everything when the limit exceeds the length', () => {
    expect(selectRecentCaptures(entries.slice(0, 3), 5)).toHaveLength(3);
  });

  it('returns an empty list for a zero / negative / non-finite limit', () => {
    expect(selectRecentCaptures(entries, 0)).toEqual([]);
    expect(selectRecentCaptures(entries, -3)).toEqual([]);
    expect(selectRecentCaptures(entries, Number.NaN)).toEqual([]);
    expect(selectRecentCaptures(entries, Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it('floors a fractional limit', () => {
    expect(selectRecentCaptures(entries, 2.9)).toHaveLength(2);
  });

  it('never mutates the input array', () => {
    const input = entries.slice();
    selectRecentCaptures(input, 3);
    expect(input).toHaveLength(entries.length);
  });
});

describe('captureSourceLabel', () => {
  it('returns the host without a leading www.', () => {
    expect(captureSourceLabel('https://www.example.com/a/b')).toBe('example.com');
    expect(captureSourceLabel('https://claude.ai/chat/abc')).toBe('claude.ai');
    expect(captureSourceLabel('https://news.ycombinator.com/item?id=1')).toBe(
      'news.ycombinator.com'
    );
  });

  it('returns an empty string for an unparseable URL', () => {
    expect(captureSourceLabel('not a url')).toBe('');
    expect(captureSourceLabel('')).toBe('');
  });
});

describe('formatRelativeTime', () => {
  it('reads "now" at zero offset (English)', () => {
    expect(formatRelativeTime('2026-10-03T12:00:00.000Z', NOW, 'en')).toBe('now');
  });

  it('formats seconds, minutes, hours and days in the past (English)', () => {
    const ago = (ms: number) => new Date(NOW - ms).toISOString();
    expect(formatRelativeTime(ago(45_000), NOW, 'en')).toBe('45 seconds ago');
    expect(formatRelativeTime(ago(5 * 60_000), NOW, 'en')).toBe('5 minutes ago');
    expect(formatRelativeTime(ago(3 * 3_600_000), NOW, 'en')).toBe('3 hours ago');
    expect(formatRelativeTime(ago(4 * 86_400_000), NOW, 'en')).toBe('4 days ago');
  });

  it('localizes into Japanese', () => {
    const fiveMinAgo = new Date(NOW - 5 * 60_000).toISOString();
    const ja = formatRelativeTime(fiveMinAgo, NOW, 'ja');
    expect(ja).toContain('5');
    expect(ja).toContain('分');
  });

  it('returns an empty string for an unparseable timestamp', () => {
    expect(formatRelativeTime('not-a-date', NOW, 'en')).toBe('');
  });
});

describe('formatCaptureRow', () => {
  it('composes id, url, trimmed title, source and relative time', () => {
    const row = formatCaptureRow(
      entry({
        id: 'id-9',
        url: 'https://www.example.com/x',
        title: '  Spaced title  ',
        capturedAt: new Date(NOW - 5 * 60_000).toISOString(),
      }),
      NOW,
      'en'
    );
    expect(row).toEqual({
      id: 'id-9',
      url: 'https://www.example.com/x',
      title: 'Spaced title',
      source: 'example.com',
      relativeTime: '5 minutes ago',
    });
  });
});

describe('outputModeIncludesBuffer', () => {
  it('is true only for buffer-writing modes', () => {
    expect(outputModeIncludesBuffer('append-buffer')).toBe(true);
    expect(outputModeIncludesBuffer('both')).toBe(true);
    expect(outputModeIncludesBuffer('clipboard')).toBe(false);
    expect(outputModeIncludesBuffer('claude-md')).toBe(false);
    expect(outputModeIncludesBuffer('mcp-store')).toBe(false);
  });
});
