import { describe, it, expect } from 'vitest';
import {
  buildFrontmatter,
  buildSourceFooter,
} from '@/shared/frontmatter-builder';
import type { CapturedContext } from '@/shared/types';

const baseCtx: CapturedContext = {
  url: 'https://example.com/post',
  title: 'Hello',
  body: 'irrelevant',
  capturedAt: '2026-04-30T12:00:00.000Z',
  parser: 'generic',
  fromSelection: false,
};

describe('buildFrontmatter', () => {
  it('emits required fields', () => {
    const fm = buildFrontmatter(baseCtx);
    expect(fm).toContain('---');
    // URL contains a colon, so it gets quoted in YAML.
    expect(fm).toContain('url: "https://example.com/post"');
    expect(fm).toContain('title: Hello');
    expect(fm).toContain('captured_at: 2026-04-30T12:00:00.000Z');
    expect(fm).toContain('parser: generic');
  });

  it('escapes special YAML characters in values', () => {
    const fm = buildFrontmatter({
      ...baseCtx,
      title: 'A: B # C "quoted"',
    });
    // With special chars, value must be wrapped in double quotes and the
    // inner quotes escaped.
    expect(fm).toContain('title: "A: B # C \\"quoted\\""');
  });

  it('includes optional fields when present', () => {
    const fm = buildFrontmatter({
      ...baseCtx,
      author: 'Alice',
      publishedAt: '2026-04-01T00:00:00.000Z',
      tags: ['ai', 'claude'],
    });
    expect(fm).toContain('author: Alice');
    expect(fm).toContain('published_at: 2026-04-01T00:00:00.000Z');
    expect(fm).toContain('tags: ["ai", "claude"]');
  });

  it('marks selection captures distinctly', () => {
    const fm = buildFrontmatter({ ...baseCtx, fromSelection: true });
    expect(fm).toContain('source_type: selection');
  });
});

describe('buildSourceFooter', () => {
  it('produces an English footer', () => {
    const footer = buildSourceFooter(baseCtx, 'en');
    expect(footer).toContain('Source:');
    expect(footer).toContain('[Hello](https://example.com/post)');
  });

  it('produces a Japanese footer', () => {
    const footer = buildSourceFooter(baseCtx, 'ja');
    expect(footer).toContain('出典:');
    expect(footer).toContain('[Hello](https://example.com/post)');
  });

  it('escapes square brackets in title', () => {
    const footer = buildSourceFooter(
      { ...baseCtx, title: '[draft] hello' },
      'en'
    );
    expect(footer).toContain('\\[draft\\]');
  });
});
