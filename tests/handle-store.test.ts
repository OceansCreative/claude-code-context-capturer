import { describe, expect, it } from 'vitest';
import { normalizeRouteHandles } from '@/shared/handle-store';
import type { ClaudeMdRoute } from '@/shared/types';

// FileSystemFileHandle is opaque in tests — a named stub is enough since
// normalizeRouteHandles only moves the reference around, never calls it.
function fakeHandle(name: string): FileSystemFileHandle {
  return { name } as unknown as FileSystemFileHandle;
}

const base = {
  id: 'r1',
  label: 'work',
  pattern: 'github.com/*',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('normalizeRouteHandles (pre-v0.9.0 → v0.9.0 migration)', () => {
  it('wraps a legacy single `handle` into `handles: [handle]` and flags changed', () => {
    const handle = fakeHandle('CLAUDE.md');
    const legacy = { ...base, handle } as unknown as ClaudeMdRoute;

    const { route, changed } = normalizeRouteHandles(legacy);

    expect(changed).toBe(true);
    expect(route.handles).toEqual([handle]);
    expect('handle' in route).toBe(false);
  });

  it('leaves an already-migrated route untouched (not changed)', () => {
    const handles = [fakeHandle('CLAUDE.md'), fakeHandle('.cursorrules')];
    const migrated: ClaudeMdRoute = { ...base, handles };

    const { route, changed } = normalizeRouteHandles(migrated);

    expect(changed).toBe(false);
    expect(route).toBe(migrated); // same reference — no needless rewrite
    expect(route.handles).toBe(handles);
  });

  it('strips a stray legacy `handle` left on an already-migrated route', () => {
    const handles = [fakeHandle('CLAUDE.md')];
    const stray = {
      ...base,
      handles,
      handle: fakeHandle('CLAUDE.md'),
    } as unknown as ClaudeMdRoute;

    const { route, changed } = normalizeRouteHandles(stray);

    expect(changed).toBe(true);
    expect('handle' in route).toBe(false);
    expect(route.handles).toBe(handles);
  });

  it('defends against a route with neither field → empty handles, not changed', () => {
    const broken = { ...base } as unknown as ClaudeMdRoute;

    const { route, changed } = normalizeRouteHandles(broken);

    expect(changed).toBe(false);
    expect(route.handles).toEqual([]);
  });

  it('does not mutate the input route object', () => {
    const handle = fakeHandle('CLAUDE.md');
    const legacy = { ...base, handle } as unknown as ClaudeMdRoute & {
      handle?: FileSystemFileHandle;
    };

    normalizeRouteHandles(legacy);

    // Original still carries its legacy field — migration returned a copy.
    expect(legacy.handle).toBe(handle);
  });
});
