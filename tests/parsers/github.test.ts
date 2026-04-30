import { describe, it, expect, beforeEach } from 'vitest';
import { canHandleGitHub, parseGitHub } from '@/content/parsers/github';

describe('GitHub parser', () => {
  describe('canHandleGitHub', () => {
    it('rejects non-github hosts', () => {
      Object.defineProperty(window, 'location', {
        value: new URL('https://example.com/foo/bar'),
        writable: true,
      });
      expect(canHandleGitHub()).toBe(false);
    });

    it('accepts issue URLs', () => {
      Object.defineProperty(window, 'location', {
        value: new URL('https://github.com/owner/repo/issues/42'),
        writable: true,
      });
      expect(canHandleGitHub()).toBe(true);
    });

    it('accepts pull request URLs', () => {
      Object.defineProperty(window, 'location', {
        value: new URL('https://github.com/owner/repo/pull/7'),
        writable: true,
      });
      expect(canHandleGitHub()).toBe(true);
    });

    it('accepts repo root URLs', () => {
      Object.defineProperty(window, 'location', {
        value: new URL('https://github.com/owner/repo'),
        writable: true,
      });
      expect(canHandleGitHub()).toBe(true);
    });

    it('rejects deep paths that are not issues / PRs / discussions', () => {
      Object.defineProperty(window, 'location', {
        value: new URL('https://github.com/owner/repo/blob/main/README.md'),
        writable: true,
      });
      expect(canHandleGitHub()).toBe(false);
    });
  });

  describe('parseGitHub - issue', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        value: new URL('https://github.com/owner/repo/issues/42'),
        writable: true,
      });
      document.title = 'Bug: something is broken';
      document.body.innerHTML = `
        <h1><bdi class="js-issue-title">Bug: something is broken</bdi></h1>
        <div class="timeline-comment">
          <div class="timeline-comment-header">
            <a class="author">alice</a>
          </div>
          <div class="js-comment-body">
            <p>The thing crashes when I do <code>foo()</code>.</p>
          </div>
        </div>
        <div class="timeline-comment">
          <div class="timeline-comment-header">
            <a class="author">bob</a>
          </div>
          <div class="js-comment-body">
            <p>I see the same.</p>
          </div>
        </div>
        <div class="js-issue-labels">
          <span class="IssueLabel">bug</span>
          <span class="IssueLabel">priority:high</span>
        </div>
      `;
    });

    it('captures title, body, comments, and labels', () => {
      const ctx = parseGitHub();
      expect(ctx.parser).toBe('github');
      expect(ctx.title).toContain('Bug: something is broken');
      expect(ctx.body).toContain('# Bug: something is broken');
      expect(ctx.body).toContain('The thing crashes');
      expect(ctx.body).toContain('## Comments');
      expect(ctx.body).toContain('I see the same');
      expect(ctx.tags).toEqual(['bug', 'priority:high']);
      expect(ctx.author).toBe('alice');
    });
  });
});
