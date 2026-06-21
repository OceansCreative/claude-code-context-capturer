import { describe, expect, it } from 'vitest';
import { classifyAppendResult } from '@/shared/append-result';

describe('classifyAppendResult (fan-out outcome)', () => {
  it('all handles succeeded → ok with no partialFailures field', () => {
    const result = classifyAppendResult(['CLAUDE.md', '.cursorrules'], []);
    expect(result).toEqual({ ok: true, fileNames: ['CLAUDE.md', '.cursorrules'] });
    // Absent, not just empty — the SW checks `partialFailures?.length`.
    expect('partialFailures' in result).toBe(false);
  });

  it('some succeeded, some lapsed → ok BUT carries partialFailures', () => {
    const result = classifyAppendResult(
      ['CLAUDE.md'],
      [{ fileName: '.cursorrules', reason: 'permission lapsed (re-link …)' }]
    );
    expect(result).toEqual({
      ok: true,
      fileNames: ['CLAUDE.md'],
      partialFailures: [{ fileName: '.cursorrules', reason: 'permission lapsed (re-link …)' }],
    });
  });

  it('all failed with a permission lapse → permission-denied, lapse named first', () => {
    const result = classifyAppendResult(
      [],
      [
        { fileName: 'a.md', reason: 'disk full' },
        { fileName: '.cursorrules', reason: 'permission lapsed (re-link …)' },
      ]
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('permission-denied');
    // The lapsed file is the actionable one and must be the one surfaced,
    // even though it wasn't first in the failure list.
    expect(result.message).toContain('.cursorrules');
  });

  it('all failed with only write errors → write-failed listing each', () => {
    const result = classifyAppendResult(
      [],
      [
        { fileName: 'a.md', reason: 'disk full' },
        { fileName: 'b.md', reason: 'quota exceeded' },
      ]
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('write-failed');
    expect(result.message).toContain('a.md: disk full');
    expect(result.message).toContain('b.md: quota exceeded');
  });
});
