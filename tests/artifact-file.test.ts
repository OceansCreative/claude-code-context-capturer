import { describe, expect, it } from 'vitest';
import { buildArtifactFiles, slugFileNamesToRemove } from '@/shared/artifact-file';
import type { CapturedContext } from '@/shared/types';

function ctx(p: Partial<CapturedContext>): CapturedContext {
  return {
    url: p.url ?? 'https://claude.ai/chat/abc-123',
    title: p.title ?? 'Auth work',
    body: p.body ?? 'body',
    capturedAt: p.capturedAt ?? '2026-05-31T14:30:00.000Z',
    parser: p.parser ?? 'claude-ai',
    fromSelection: false,
    artifacts: p.artifacts,
  };
}

describe('buildArtifactFiles', () => {
  it('returns nothing when there are no artifacts', () => {
    expect(buildArtifactFiles(ctx({}))).toEqual([]);
    expect(buildArtifactFiles(ctx({ artifacts: [] }))).toEqual([]);
  });

  it('writes one file per artifact with frontmatter + single code block', () => {
    const files = buildArtifactFiles(
      ctx({
        artifacts: [
          { id: '1', title: 'Auth middleware', language: 'ts', content: 'export const a = 1;' },
          { id: '2', title: 'Schema', language: 'sql', content: 'CREATE TABLE t (id int);' },
        ],
      })
    );
    expect(files).toHaveLength(2);

    const f0 = files[0];
    expect(f0.fileName).toMatch(/--auth-middleware\.md$/);
    expect(f0.content).toContain('parser: claude-ai-artifact');
    expect(f0.content).toContain('artifact_of:');
    expect(f0.content).toContain('language: ts');
    expect(f0.content).toContain('tags: ["artifact", "lang:ts"]');
    expect(f0.content).toContain('```ts');
    expect(f0.content).toContain('export const a = 1;');
    // title from the artifact, not the conversation
    expect(f0.content).toContain('title: Auth middleware');
  });

  it('shares the parent slug across artifact filenames', () => {
    const files = buildArtifactFiles(
      ctx({
        title: 'Project X',
        artifacts: [
          { title: 'One', language: 'ts', content: 'a' },
          { title: 'Two', language: 'ts', content: 'b' },
        ],
      })
    );
    const prefix0 = files[0].fileName.split('--')[0];
    const prefix1 = files[1].fileName.split('--')[0];
    expect(prefix0).toBe(prefix1);
    expect(prefix0).toContain('project-x');
  });

  it('disambiguates artifacts with the same title', () => {
    const files = buildArtifactFiles(
      ctx({
        artifacts: [
          { id: 'a', title: 'Same', language: 'ts', content: 'one' },
          { id: 'b', title: 'Same', language: 'ts', content: 'two' },
        ],
      })
    );
    expect(files[0].fileName).not.toBe(files[1].fileName);
  });

  it('falls back to artifact-N when there is no title', () => {
    const files = buildArtifactFiles(
      ctx({ artifacts: [{ language: 'py', content: 'print(1)' }] })
    );
    expect(files[0].fileName).toMatch(/--artifact-1\.md$/);
  });
});

describe('slugFileNamesToRemove (silo prevention, prefix-based)', () => {
  const dirNames = [
    'ccc-1a2b3c-old-title.md', // main file (prior capture, old title)
    'ccc-1a2b3c-old-title--middleware.md', // derived artifact
    'ccc-1a2b3c-old-title--schema.md', // derived artifact
    'ccc-1a2b3cX-other.md', // NOT ours: prefix boundary differs
    'ccc-9z9z9z-other.md', // different conversation
    'ccc-1a2b3c-old-title--note.txt', // not markdown
    'README.md',
  ];

  it('selects all files for the prefix, even though the title differs', () => {
    // We re-capture with a NEW title but the SAME conversation → same prefix.
    expect(slugFileNamesToRemove(dirNames, 'ccc-1a2b3c').sort()).toEqual(
      [
        'ccc-1a2b3c-old-title.md',
        'ccc-1a2b3c-old-title--middleware.md',
        'ccc-1a2b3c-old-title--schema.md',
      ].sort()
    );
  });

  it('respects the prefix boundary (does not match ccc-1a2b3cX)', () => {
    const removed = slugFileNamesToRemove(dirNames, 'ccc-1a2b3c');
    expect(removed).not.toContain('ccc-1a2b3cX-other.md');
  });

  it('does not touch other conversations or non-markdown files', () => {
    const removed = slugFileNamesToRemove(dirNames, 'ccc-1a2b3c');
    expect(removed).not.toContain('ccc-9z9z9z-other.md');
    expect(removed).not.toContain('ccc-1a2b3c-old-title--note.txt');
    expect(removed).not.toContain('README.md');
  });

  it('returns empty for a non-matching or empty prefix', () => {
    expect(slugFileNamesToRemove(dirNames, 'ccc-nomatch')).toEqual([]);
    expect(slugFileNamesToRemove(dirNames, '')).toEqual([]);
  });
});
