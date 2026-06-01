import { describe, expect, it } from 'vitest';
import { buildContextSlug, shortHash } from '@/shared/slug';
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
});

describe('shortHash', () => {
  it('returns a 6-char base36 string', () => {
    expect(shortHash('hello')).toMatch(/^[0-9a-z]{6}$/);
  });
  it('differs for different inputs', () => {
    expect(shortHash('a')).not.toBe(shortHash('b'));
  });
});
