import { describe, it, expect, beforeEach } from 'vitest';
import { parseSelection } from '@/content/parsers/selection';

describe('parseSelection', () => {
  beforeEach(() => {
    document.body.innerHTML = '<p id="p1">Hello <strong>world</strong>!</p>';
    Object.defineProperty(window, 'location', {
      value: new URL('https://example.com/article'),
      writable: true,
    });
    document.title = 'Example Article';
  });

  it('returns null when no text is selected', () => {
    const result = parseSelection();
    expect(result).toBeNull();
  });

  it('extracts the selected text as Markdown', () => {
    const range = document.createRange();
    const p = document.getElementById('p1');
    if (!p) throw new Error('test setup failed');
    range.selectNodeContents(p);

    const sel = window.getSelection();
    if (!sel) throw new Error('no selection');
    sel.removeAllRanges();
    sel.addRange(range);

    const result = parseSelection();
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.fromSelection).toBe(true);
    expect(result.parser).toBe('selection');
    expect(result.url).toBe('https://example.com/article');
    expect(result.title).toBe('Example Article');
    expect(result.body).toContain('Hello **world**');
  });

  it('returns null for whitespace-only selections', () => {
    document.body.innerHTML = '<span id="empty">   </span>';
    const range = document.createRange();
    const span = document.getElementById('empty');
    if (!span) throw new Error('test setup failed');
    range.selectNodeContents(span);

    const sel = window.getSelection();
    if (!sel) throw new Error('no selection');
    sel.removeAllRanges();
    sel.addRange(range);

    const result = parseSelection();
    expect(result).toBeNull();
  });
});
