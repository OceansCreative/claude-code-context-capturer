import { describe, expect, it } from 'vitest';
import { matchesPattern, resolveRoute } from '@/shared/route-matcher';
import type { ClaudeMdRoute } from '@/shared/types';

function route(p: Partial<ClaudeMdRoute>): ClaudeMdRoute {
  return {
    id: p.id ?? 'r',
    label: p.label ?? 'Test',
    pattern: p.pattern ?? '',
    isDefault: p.isDefault ?? false,
    createdAt: p.createdAt ?? '2026-01-01T00:00:00Z',
    handle: {} as FileSystemFileHandle,
  };
}

describe('matchesPattern', () => {
  it('matches a literal substring anywhere in the URL', () => {
    expect(matchesPattern('https://github.com/anthropic/cli', 'github.com/anthropic')).toBe(true);
  });

  it('expands * into any-char sequence', () => {
    expect(matchesPattern('https://github.com/anthropic/cli', 'github.com/*/cli')).toBe(true);
    expect(matchesPattern('https://example.com', 'github.com/*/cli')).toBe(false);
  });

  it('escapes regex metacharacters in the literal portion', () => {
    expect(matchesPattern('https://a.b.com', 'a.b.com')).toBe(true);
    // The dot is now literal — should not match a `c` between a and b.
    expect(matchesPattern('https://acb.com', 'a.b.com')).toBe(false);
  });

  it('returns false for an empty pattern (so default routes never match by pattern)', () => {
    expect(matchesPattern('https://anything.example', '')).toBe(false);
  });

  it('matches multi-* patterns', () => {
    expect(matchesPattern('https://docs.zenn.dev/articles/foo', '*.zenn.dev/*')).toBe(true);
  });
});

describe('resolveRoute', () => {
  const r1 = route({ id: 'r1', pattern: 'github.com/anthropic/*' });
  const r2 = route({ id: 'r2', pattern: 'zenn.dev/*' });
  const def = route({ id: 'rd', pattern: '', isDefault: true });

  it('returns the first route whose pattern matches', () => {
    expect(resolveRoute('https://github.com/anthropic/x', [r1, r2, def])?.id).toBe('r1');
    expect(resolveRoute('https://zenn.dev/foo/articles/bar', [r1, r2, def])?.id).toBe('r2');
  });

  it('falls back to the default route when no pattern matches', () => {
    expect(resolveRoute('https://example.com/something', [r1, r2, def])?.id).toBe('rd');
  });

  it('returns undefined if no routes match and no default is set', () => {
    expect(resolveRoute('https://example.com', [r1, r2])).toBeUndefined();
  });

  it('a default route is never considered before non-defaults even when listed first', () => {
    // Default is first in the array; its empty pattern would not match anyway,
    // and we should still hit r1 for the github URL.
    expect(resolveRoute('https://github.com/anthropic/x', [def, r1])?.id).toBe('r1');
  });

  it('returns undefined for an empty route list', () => {
    expect(resolveRoute('https://anywhere', [])).toBeUndefined();
  });
});
