import { describe, expect, it } from 'vitest';
import { buildContextSlug, shortHash, dedupePrefix } from '@/shared/slug';
import type { CapturedContext } from '@/shared/types';

function ctx(p: Partial<CapturedContext>): CapturedContext {
  return {
    url: p.url ?? 'https://example.com/page',
    title: p.title ?? 'Example Title',
    body: p.body ?? 'body',
    capturedAt: p.capturedAt ?? '2026-05-31T14:30:00.000Z',
    parser: p.parser ?? 'generic',
    fromSelection: p.fromSelection ?? false,
    author: p.author,
    publishedAt: p.publishedAt,
    tags: p.tags,
    dedupeKey: p.dedupeKey,
  };
}

describe('buildContextSlug', () => {
  it('starts with the capture date', () => {
    expect(buildContextSlug(ctx({}))).toMatch(/^2026-05-31-/);
  });

  it('slugifies the title', () => {
    const slug = buildContextSlug(ctx({ title: 'Auth Refactor: OAuth Plan!' }));
    expect(slug).toContain('auth-refactor-oauth-plan');
  });

  it('falls back to the host when title is empty', () => {
    const slug = buildContextSlug(ctx({ title: '', url: 'https://www.react.dev/hooks' }));
    // host dots are slugified to dashes, www. is stripped
    expect(slug).toContain('react-dev');
  });

  it('is filesystem-safe (no slashes, spaces, or quotes)', () => {
    const slug = buildContextSlug(
      ctx({ title: 'a/b c"d\\e', url: 'https://x.com/a b' })
    );
    expect(slug).not.toMatch(/[/\\\s"]/);
  });

  it('produces different slugs for different URLs with the same title/date', () => {
    const a = buildContextSlug(ctx({ url: 'https://x.com/1' }));
    const b = buildContextSlug(ctx({ url: 'https://x.com/2' }));
    expect(a).not.toBe(b);
  });

  it('is deterministic for the same input', () => {
    expect(buildContextSlug(ctx({}))).toBe(buildContextSlug(ctx({})));
  });

  it('truncates very long titles', () => {
    const slug = buildContextSlug(ctx({ title: 'word '.repeat(100) }));
    // date(10) + dash + base(<=60) + dash + hash(6)
    expect(slug.length).toBeLessThanOrEqual(10 + 1 + 60 + 1 + 6);
  });

  describe('with dedupeKey (stable slug)', () => {
    it('leads with the stable ccc-<hash> prefix, not the date', () => {
      const slug = buildContextSlug(ctx({ dedupeKey: 'conv-uuid-1' }));
      expect(slug).not.toMatch(/^\d{4}-\d{2}-\d{2}-/);
      expect(slug.startsWith(dedupePrefix('conv-uuid-1'))).toBe(true);
      expect(slug).toContain('example-title');
    });

    it('is identical for the same dedupeKey regardless of capturedAt', () => {
      const a = buildContextSlug(
        ctx({ dedupeKey: 'conv-uuid-1', capturedAt: '2026-05-31T10:00:00.000Z' })
      );
      const b = buildContextSlug(
        ctx({ dedupeKey: 'conv-uuid-1', capturedAt: '2026-06-15T22:00:00.000Z' })
      );
      expect(a).toBe(b);
    });

    it('keeps the same prefix when only the title changes (title is cosmetic)', () => {
      const a = buildContextSlug(ctx({ dedupeKey: 'conv-1', title: 'Old title' }));
      const b = buildContextSlug(ctx({ dedupeKey: 'conv-1', title: 'Renamed by Claude' }));
      expect(a).not.toBe(b); // full slug differs (title changed)...
      const prefix = dedupePrefix('conv-1');
      expect(a.startsWith(prefix)).toBe(true); // ...but the stable prefix matches
      expect(b.startsWith(prefix)).toBe(true);
    });

    it('differs for different dedupeKeys', () => {
      const a = buildContextSlug(ctx({ dedupeKey: 'conv-A' }));
      const b = buildContextSlug(ctx({ dedupeKey: 'conv-B' }));
      expect(a).not.toBe(b);
    });

    it('separates artifacts-only from full capture of the same conversation', () => {
      const full = buildContextSlug(ctx({ dedupeKey: 'conv-1' }));
      const arts = buildContextSlug(ctx({ dedupeKey: 'conv-1:artifacts' }));
      expect(full).not.toBe(arts);
      expect(dedupePrefix('conv-1')).not.toBe(dedupePrefix('conv-1:artifacts'));
    });
  });
});

describe('dedupePrefix', () => {
  it('is stable for a given key and shaped ccc-<hash>', () => {
    expect(dedupePrefix('abc')).toBe(dedupePrefix('abc'));
    expect(dedupePrefix('abc')).toMatch(/^ccc-[0-9a-z]{6}$/);
  });
});

describe('shortHash', () => {
  it('returns a 6-char base36 string', () => {
    expect(shortHash('hello')).toMatch(/^[0-9a-z]{6}$/);
  });
  it('differs for different inputs', () => {
    expect(shortHash('a')).not.toBe(shortHash('b'));
  });
});
