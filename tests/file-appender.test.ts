import { describe, expect, it } from 'vitest';
import { buildAppendBlock, buildEntryHeading } from '@/shared/file-appender';
import type { CapturedContext } from '@/shared/types';

const sampleCtx: CapturedContext = {
  url: 'https://example.com/post',
  title: 'Sample post',
  body: '# Body',
  capturedAt: '2026-04-30T13:35:00.000Z',
  parser: 'generic',
  fromSelection: false,
};

describe('buildEntryHeading', () => {
  it('formats local date/time and uses the page title', () => {
    const heading = buildEntryHeading(sampleCtx, new Date(2026, 3, 30, 22, 35));
    expect(heading).toBe('## 2026-04-30 22:35 — Sample post');
  });

  it('falls back to the URL when title is empty', () => {
    const heading = buildEntryHeading(
      { ...sampleCtx, title: '   ' },
      new Date(2026, 3, 30, 9, 5)
    );
    expect(heading).toBe('## 2026-04-30 09:05 — https://example.com/post');
  });

  it('zero-pads single-digit components', () => {
    const heading = buildEntryHeading(sampleCtx, new Date(2026, 0, 1, 0, 1));
    expect(heading).toContain('2026-01-01 00:01');
  });
});

describe('buildAppendBlock', () => {
  it('starts with a blank-line separator and ends with a newline', () => {
    const block = buildAppendBlock('## heading', 'body content');
    expect(block.startsWith('\n\n## heading')).toBe(true);
    expect(block.endsWith('\n')).toBe(true);
  });

  it('strips trailing whitespace from the body before appending', () => {
    const block = buildAppendBlock('## h', 'body\n\n\n');
    expect(block).toBe('\n\n## h\n\nbody\n');
  });

  it('places exactly one blank line between heading and body', () => {
    const block = buildAppendBlock('## h', 'body');
    expect(block).toContain('## h\n\nbody');
  });
});
