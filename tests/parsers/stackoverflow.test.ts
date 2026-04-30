import { describe, it, expect, beforeEach } from 'vitest';
import {
  canHandleStackOverflow,
  parseStackOverflow,
} from '@/content/parsers/stackoverflow';

describe('Stack Overflow parser', () => {
  describe('canHandleStackOverflow', () => {
    it('accepts stackoverflow.com', () => {
      Object.defineProperty(window, 'location', {
        value: new URL('https://stackoverflow.com/questions/12345/foo'),
        writable: true,
      });
      expect(canHandleStackOverflow()).toBe(true);
    });

    it('accepts stackexchange subdomains', () => {
      Object.defineProperty(window, 'location', {
        value: new URL('https://serverfault.stackexchange.com/questions/1'),
        writable: true,
      });
      expect(canHandleStackOverflow()).toBe(true);
    });

    it('rejects unrelated domains', () => {
      Object.defineProperty(window, 'location', {
        value: new URL('https://example.com/'),
        writable: true,
      });
      expect(canHandleStackOverflow()).toBe(false);
    });
  });

  describe('parseStackOverflow', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        value: new URL('https://stackoverflow.com/questions/12345/q'),
        writable: true,
      });
      document.title = 'How do I X?';
      document.body.innerHTML = `
        <h1 itemprop="name">How do I X?</h1>
        <div id="question">
          <div class="s-prose"><p>I'm trying to do X but it fails.</p></div>
        </div>
        <a class="post-tag">javascript</a>
        <a class="post-tag">node.js</a>
        <div class="answer accepted-answer">
          <span class="js-vote-count">42</span>
          <div class="s-prose"><p>Use <code>foo()</code>.</p></div>
        </div>
        <div class="answer">
          <span class="js-vote-count">5</span>
          <div class="s-prose"><p>Alternative: bar().</p></div>
        </div>
      `;
    });

    it('captures question, answers, and tags', () => {
      const ctx = parseStackOverflow();
      expect(ctx.parser).toBe('stackoverflow');
      expect(ctx.body).toContain('# How do I X?');
      expect(ctx.body).toContain('## Question');
      expect(ctx.body).toContain('I\'m trying to do X');
      expect(ctx.body).toContain('## Answers');
      expect(ctx.body).toContain('Answer 1 (accepted)');
      expect(ctx.body).toContain('score 42');
      expect(ctx.body).toContain('Answer 2');
      expect(ctx.tags).toEqual(['javascript', 'node.js']);
    });
  });
});
