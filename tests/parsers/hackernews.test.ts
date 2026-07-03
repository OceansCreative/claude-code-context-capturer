import { describe, it, expect, beforeEach } from 'vitest';
import {
  canHandleHackerNews,
  parseHackerNews,
  extractItemId,
} from '@/content/parsers/hackernews';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
  });
}

/** Story header table mirroring HN's real (table-based) markup. */
function fatitemHtml(opts: {
  titleHref: string;
  title: string;
  points?: string;
  topText?: string;
}): string {
  return `
    <table class="fatitem">
      <tr class="athing submission" id="99001122">
        <td class="title"><span class="rank"></span></td>
        <td class="votelinks"><a href="vote?id=99001122"><div class="votearrow"></div></a></td>
        <td class="title">
          <span class="titleline">
            <a href="${opts.titleHref}">${opts.title}</a>
          </span>
        </td>
      </tr>
      <tr>
        <td colspan="2"></td>
        <td class="subtext">
          <span class="subline">
            <span class="score" id="score_99001122">${opts.points ?? '123 points'}</span>
            by <a href="user?id=alice" class="hnuser">alice</a>
            <span class="age" title="2026-07-02T10:00:00 1782986400"><a href="item?id=99001122">5 hours ago</a></span>
            | <a href="item?id=99001122">89&nbsp;comments</a>
          </span>
        </td>
      </tr>
      ${opts.topText ? `<tr><td colspan="2"></td><td><div class="toptext">${opts.topText}</div></td></tr>` : ''}
    </table>
  `;
}

/** One flat comment row the way HN serves them (nesting via td.ind). */
function commentRow(opts: {
  id: string;
  indent: number;
  author: string;
  html: string;
  commtextClass?: string;
  comheadExtra?: string;
  rowClass?: string;
}): string {
  return `
    <tr class="athing comtr ${opts.rowClass ?? ''}" id="${opts.id}">
      <td>
        <table>
          <tr>
            <td class="ind" indent="${opts.indent}"><img src="s.gif" height="1" width="${opts.indent * 40}"></td>
            <td class="votelinks"><a href="vote?id=${opts.id}"><div class="votearrow"></div></a></td>
            <td class="default">
              <div style="margin-top:2px; margin-bottom:-10px;">
                <span class="comhead">
                  <a href="user?id=${opts.author}" class="hnuser">${opts.author}</a>
                  <span class="age" title="2026-07-02T11:00:00 1751454000"><a href="item?id=${opts.id}">4 hours ago</a></span>
                  ${opts.comheadExtra ?? ''}
                </span>
              </div>
              <br>
              <div class="comment">
                <div class="commtext ${opts.commtextClass ?? 'c00'}">${opts.html}</div>
                <div class="reply"><p><font size="1"><u><a href="reply?id=${opts.id}">reply</a></u></font></p></div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function commentTree(rows: string[]): string {
  return `<table class="comment-tree">${rows.join('\n')}</table>`;
}

describe('Hacker News parser', () => {
  describe('canHandleHackerNews', () => {
    it('accepts item pages', () => {
      setLocation('https://news.ycombinator.com/item?id=99001122');
      expect(canHandleHackerNews()).toBe(true);
    });

    it('rejects the front page and other HN paths', () => {
      setLocation('https://news.ycombinator.com/news');
      expect(canHandleHackerNews()).toBe(false);
      setLocation('https://news.ycombinator.com/');
      expect(canHandleHackerNews()).toBe(false);
    });

    it('rejects /item without a numeric id', () => {
      setLocation('https://news.ycombinator.com/item');
      expect(canHandleHackerNews()).toBe(false);
      setLocation('https://news.ycombinator.com/item?id=abc');
      expect(canHandleHackerNews()).toBe(false);
    });

    it('rejects other hosts', () => {
      setLocation('https://example.com/item?id=99001122');
      expect(canHandleHackerNews()).toBe(false);
    });
  });

  describe('extractItemId', () => {
    it('extracts numeric ids and rejects malformed URLs', () => {
      expect(extractItemId('https://news.ycombinator.com/item?id=42')).toBe('42');
      expect(extractItemId('not a url')).toBeUndefined();
      expect(extractItemId('https://news.ycombinator.com/item')).toBeUndefined();
    });
  });

  describe('parseHackerNews — link post', () => {
    beforeEach(() => {
      setLocation('https://news.ycombinator.com/item?id=99001122');
      document.title = 'A neat article | Hacker News';
      document.body.innerHTML =
        fatitemHtml({
          titleHref: 'https://example.com/neat-article',
          title: 'A neat article',
        }) +
        commentTree([
          commentRow({
            id: 'c1',
            indent: 0,
            author: 'bob',
            html: 'Great write-up. See <a href="https://example.org/ref">the ref</a>.',
          }),
        ]);
    });

    it('captures title, external link, points, author, and metadata', () => {
      const ctx = parseHackerNews();
      expect(ctx.parser).toBe('hackernews');
      expect(ctx.title).toBe('A neat article');
      expect(ctx.body).toContain('# A neat article');
      expect(ctx.body).toContain('**Link:** https://example.com/neat-article');
      expect(ctx.body).toContain('123 points · by alice · 5 hours ago');
      expect(ctx.author).toBe('alice');
      expect(ctx.tags).toEqual(['hn', 'points:123']);
      expect(ctx.dedupeKey).toBe('hn:99001122');
      expect(ctx.publishedAt).toBe('2026-07-02T10:00:00.000Z');
      expect(ctx.fromSelection).toBe(false);
    });

    it('converts comment HTML (links) to Markdown and strips the reply link', () => {
      const ctx = parseHackerNews();
      expect(ctx.body).toContain('## Comments (1)');
      expect(ctx.body).toContain('**bob** · 4 hours ago');
      expect(ctx.body).toContain('[the ref](https://example.org/ref)');
      expect(ctx.body).not.toContain('reply?id=');
    });
  });

  describe('parseHackerNews — Ask HN text post', () => {
    beforeEach(() => {
      setLocation('https://news.ycombinator.com/item?id=99001122');
      document.title = 'Ask HN: How do you test parsers? | Hacker News';
      document.body.innerHTML = fatitemHtml({
        titleHref: 'item?id=99001122',
        title: 'Ask HN: How do you test parsers?',
        topText:
          'I keep breaking mine.<p>Any <i>battle-tested</i> tips?</p><p><pre><code>expect(true)</code></pre></p>',
      });
    });

    it('captures the story text and omits the external link line', () => {
      const ctx = parseHackerNews();
      expect(ctx.title).toBe('Ask HN: How do you test parsers?');
      expect(ctx.body).not.toContain('**Link:**');
      expect(ctx.body).toContain('I keep breaking mine.');
      expect(ctx.body).toContain('_battle-tested_');
      expect(ctx.body).toContain('```\nexpect(true)\n```');
      expect(ctx.body).not.toContain('## Comments');
      expect(ctx.dedupeKey).toBe('hn:99001122');
    });
  });

  describe('parseHackerNews — nested comments', () => {
    beforeEach(() => {
      setLocation('https://news.ycombinator.com/item?id=99001122');
      document.body.innerHTML =
        fatitemHtml({ titleHref: 'https://example.com/a', title: 'A' }) +
        commentTree([
          commentRow({ id: 'c1', indent: 0, author: 'bob', html: 'Top-level take.' }),
          commentRow({ id: 'c2', indent: 1, author: 'carol', html: 'Reply to bob.' }),
          commentRow({ id: 'c3', indent: 2, author: 'dave', html: 'Reply to carol.' }),
          commentRow({ id: 'c4', indent: 0, author: 'erin', html: 'Another thread.' }),
        ]);
    });

    it('renders nesting as blockquote depth from the indent attribute', () => {
      const ctx = parseHackerNews();
      expect(ctx.body).toContain('## Comments (4)');
      expect(ctx.body).toContain('**bob** · 4 hours ago');
      expect(ctx.body).toContain('\nTop-level take.');
      expect(ctx.body).toContain('> **carol** · 4 hours ago');
      expect(ctx.body).toContain('> Reply to bob.');
      expect(ctx.body).toContain('> > **dave** · 4 hours ago');
      expect(ctx.body).toContain('> > Reply to carol.');
      expect(ctx.body).toContain('**erin** · 4 hours ago');
    });

    it('falls back to spacer-image width when the indent attribute is absent', () => {
      // Strip the indent attribute, keep width="80" (= depth 2).
      document.body.innerHTML = document.body.innerHTML.replace(/ indent="\d+"/g, '');
      const ctx = parseHackerNews();
      expect(ctx.body).toContain('> > **dave**');
    });
  });

  describe('parseHackerNews — dead / flagged / collapsed comments', () => {
    beforeEach(() => {
      setLocation('https://news.ycombinator.com/item?id=99001122');
      document.body.innerHTML =
        fatitemHtml({ titleHref: 'https://example.com/a', title: 'A' }) +
        commentTree([
          commentRow({ id: 'c1', indent: 0, author: 'bob', html: 'Visible comment.' }),
          commentRow({
            id: 'c2',
            indent: 0,
            author: 'troll',
            html: 'Dead comment body.',
            commtextClass: 'cdd',
            comheadExtra: '<span> [dead]</span>',
          }),
          commentRow({
            id: 'c3',
            indent: 0,
            author: 'spammer',
            html: 'Flagged body.',
            comheadExtra: '<span> [flagged]</span>',
          }),
          commentRow({
            id: 'c4',
            indent: 1,
            author: 'hidden',
            html: 'Hidden child of collapsed parent.',
            rowClass: 'noshow',
          }),
        ]);
    });

    it('skips [dead], [flagged], and collapsed-away comments', () => {
      const ctx = parseHackerNews();
      expect(ctx.body).toContain('## Comments (1)');
      expect(ctx.body).toContain('Visible comment.');
      expect(ctx.body).not.toContain('Dead comment body.');
      expect(ctx.body).not.toContain('Flagged body.');
      expect(ctx.body).not.toContain('Hidden child');
    });
  });

  describe('parseHackerNews — comment cap', () => {
    beforeEach(() => {
      setLocation('https://news.ycombinator.com/item?id=99001122');
      const rows: string[] = [];
      for (let i = 1; i <= 105; i++) {
        rows.push(
          commentRow({ id: `c${i}`, indent: 0, author: `user${i}`, html: `Comment number ${i}.` })
        );
      }
      document.body.innerHTML =
        fatitemHtml({ titleHref: 'https://example.com/a', title: 'A' }) + commentTree(rows);
    });

    it('caps rendered comments at 100 and notes the truncation', () => {
      const ctx = parseHackerNews();
      expect(ctx.body).toContain('## Comments (105)');
      expect(ctx.body).toContain('Comment number 100.');
      expect(ctx.body).not.toContain('Comment number 101.');
      expect(ctx.body).toContain(
        '*…truncated: showing the first 100 of 105 comments on this page.*'
      );
    });
  });

  describe('parseHackerNews — missing key element fallback', () => {
    it('falls back to document title/body when the fatitem table is absent', () => {
      setLocation('https://news.ycombinator.com/item?id=424242');
      document.title = 'Some HN page';
      document.body.innerHTML = '<p>Unexpected markup.</p>';
      const ctx = parseHackerNews();
      expect(ctx.parser).toBe('hackernews');
      expect(ctx.title).toBe('Some HN page');
      expect(ctx.body).toContain('Unexpected markup.');
      expect(ctx.dedupeKey).toBe('hn:424242');
    });
  });
});
