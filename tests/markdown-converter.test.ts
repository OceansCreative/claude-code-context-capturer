import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from '@/shared/markdown-converter';

describe('htmlToMarkdown', () => {
  it('converts basic paragraphs to Markdown', () => {
    const html = '<p>Hello <strong>world</strong>.</p>';
    const md = htmlToMarkdown(html);
    expect(md.trim()).toBe('Hello **world**.');
  });

  it('converts headings', () => {
    const html = '<h1>Title</h1><h2>Sub</h2>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('# Title');
    expect(md).toContain('## Sub');
  });

  it('preserves language hints in code blocks', () => {
    const html = '<pre><code class="language-typescript">const x = 1;</code></pre>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('```typescript');
    expect(md).toContain('const x = 1;');
  });

  it('falls back to plain code block when no language hint', () => {
    const html = '<pre><code>plain code</code></pre>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('```');
    expect(md).toContain('plain code');
  });

  it('strips script and style tags', () => {
    // Use harmless content; happy-dom would try to evaluate real script bodies.
    const html =
      '<p>Visible</p><script>var SHOULD_BE_GONE=1;</script><style>.x{color:red}</style>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('Visible');
    expect(md).not.toContain('SHOULD_BE_GONE');
    expect(md).not.toContain('color:red');
  });

  it('renders inline links', () => {
    const html = '<p>See <a href="https://example.com">example</a>.</p>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('[example](https://example.com)');
  });

  it('handles unordered lists', () => {
    const html = '<ul><li>one</li><li>two</li></ul>';
    const md = htmlToMarkdown(html);
    // Turndown uses bullet + 3 spaces by default; just check that bullets are present.
    expect(md).toMatch(/^-\s+one/m);
    expect(md).toMatch(/^-\s+two/m);
  });

  it('collapses excessive blank lines', () => {
    const html = '<p>A</p><p></p><p></p><p>B</p>';
    const md = htmlToMarkdown(html);
    // Should not contain three or more consecutive newlines.
    expect(md).not.toMatch(/\n{3,}/);
  });

  it('preserves blank lines inside fenced code blocks', () => {
    // PEP8 puts two blank lines between top-level defs; collapseWhitespace
    // must NOT squash blank lines inside ``` fences (code fidelity).
    const code = 'def a():\n    pass\n\n\ndef b():\n    pass';
    const html = `<pre><code class="language-python">${code}</code></pre>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain('def a():\n    pass\n\n\ndef b():');
  });

  it('still collapses blank lines in prose outside code fences', () => {
    const html =
      '<p>Intro</p><pre><code>x\n\n\ny</code></pre><p>A</p><p></p><p></p><p>B</p>';
    const md = htmlToMarkdown(html);
    // Code keeps its blank lines...
    expect(md).toContain('x\n\n\ny');
    // ...but the prose after the fence is still collapsed.
    const afterFence = md.slice(md.lastIndexOf('```') + 3);
    expect(afterFence).not.toMatch(/\n{3,}/);
  });

  it('removes aria-hidden spans', () => {
    const html = '<p>Visible<span aria-hidden="true">hidden</span></p>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('Visible');
    expect(md).not.toContain('hidden');
  });
});
