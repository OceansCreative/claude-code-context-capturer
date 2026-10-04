import { describe, it, expect, beforeEach } from 'vitest';
import {
  canHandleHatenaBlog,
  parseHatenaBlog,
  canHandleHatenaBookmark,
  parseHatenaBookmark,
  extractBookmarkedUrl,
} from '@/content/parsers/hatena';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Hatena Blog
// ---------------------------------------------------------------------------

interface BlogFixture {
  url: string;
  title: string;
  bodyHtml: string;
  categories?: string[];
  datetime?: string;
  siteName?: string;
  author?: string;
  /** Emit the <article class="entry"> wrapper + .entry-content (default true). */
  withBody?: boolean;
}

function mountBlog(p: BlogFixture): void {
  setLocation(p.url);
  document.title = `${p.title} - ${p.siteName ?? 'My Hatena Blog'}`;

  const head: string[] = [`<meta property="og:title" content="${p.title}" />`];
  if (p.siteName) head.push(`<meta property="og:site_name" content="${p.siteName}" />`);
  document.head.innerHTML = head.join('\n');

  const categories = (p.categories ?? [])
    .map(
      (c) =>
        `<a href="/archive/category/${encodeURIComponent(c)}" class="entry-category-link">${c}</a>`
    )
    .join('\n');
  const dateBlock = p.datetime
    ? `<div class="entry-date"><a class="entry-date-link"><time datetime="${p.datetime}" class="updated">date</time></a></div>`
    : '';
  const authorBlock = p.author
    ? `<div class="entry-footer"><span class="author vcard"><a href="/">${p.author}</a></span></div>`
    : '';

  const body =
    p.withBody === false
      ? `<article class="entry"><h1 class="entry-title"><a class="entry-title-link" href="${p.url}">${p.title}</a></h1></article>`
      : `
        <article class="entry">
          <header>
            <h1 class="entry-title"><a class="entry-title-link" href="${p.url}">${p.title}</a></h1>
            ${dateBlock}
            <div class="entry-categories">${categories}</div>
          </header>
          <div class="entry-content">${p.bodyHtml}</div>
          ${authorBlock}
        </article>`;

  document.body.innerHTML = body;
}

const SAMPLE_BLOG: BlogFixture = {
  url: 'https://example.hatenablog.com/entry/2024/01/15/120000',
  title: 'Claude Code を使い倒す',
  bodyHtml:
    '<h2>導入</h2><p>これは本文です。<a href="https://example.com/ref">参考リンク</a>も貼れます。</p><pre><code class="language-ts">const x = 1;</code></pre>',
  categories: ['AI', 'Claude Code'],
  datetime: '2024-01-15T12:00:00+09:00',
  siteName: 'My Hatena Blog',
  author: 'alice',
};

describe('Hatena Blog parser', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  describe('canHandleHatenaBlog', () => {
    it('accepts /entry/ article pages across the Hatena blog hosts', () => {
      for (const host of [
        'example.hatenablog.com',
        'example.hatenablog.jp',
        'example.hateblo.jp',
        'example.hatenadiary.com',
        'example.hatenadiary.jp',
      ]) {
        setLocation(`https://${host}/entry/2024/01/15/120000`);
        expect(canHandleHatenaBlog(), host).toBe(true);
      }
      // Custom-slug permalinks also live under /entry/.
      setLocation('https://example.hatenablog.com/entry/my-custom-slug');
      expect(canHandleHatenaBlog()).toBe(true);
    });

    it('rejects the blog index, archive, and about pages', () => {
      setLocation('https://example.hatenablog.com/');
      expect(canHandleHatenaBlog()).toBe(false);
      setLocation('https://example.hatenablog.com/archive');
      expect(canHandleHatenaBlog()).toBe(false);
      setLocation('https://example.hatenablog.com/archive/category/AI');
      expect(canHandleHatenaBlog()).toBe(false);
      setLocation('https://example.hatenablog.com/about');
      expect(canHandleHatenaBlog()).toBe(false);
    });

    it('rejects the bare Hatena host and unrelated hosts', () => {
      // Corporate root (no subdomain) is not a user blog.
      setLocation('https://hatenablog.com/entry/whatever');
      expect(canHandleHatenaBlog()).toBe(false);
      setLocation('https://example.com/entry/2024/01/15/120000');
      expect(canHandleHatenaBlog()).toBe(false);
      // A lookalike suffix on another host must not match.
      setLocation('https://evil-hatenablog.com.attacker.test/entry/x');
      expect(canHandleHatenaBlog()).toBe(false);
    });
  });

  describe('parseHatenaBlog', () => {
    it('captures title, body Markdown, categories, date, and byline', () => {
      mountBlog(SAMPLE_BLOG);
      const ctx = parseHatenaBlog();

      expect(ctx.parser).toBe('hatenablog');
      expect(ctx.fromSelection).toBe(false);
      expect(ctx.title).toBe('Claude Code を使い倒す');
      expect(ctx.body).toContain('# Claude Code を使い倒す');
      expect(ctx.body).toContain('## 導入');
      expect(ctx.body).toContain('これは本文です。');
      expect(ctx.body).toContain('[参考リンク](https://example.com/ref)');
      // Language-aware fenced code block survives.
      expect(ctx.body).toContain('```ts\nconst x = 1;\n```');

      expect(ctx.tags).toEqual(['hatenablog', 'AI', 'Claude Code']);
      expect(ctx.author).toBe('alice');
      expect(ctx.publishedAt).toBe('2024-01-15T03:00:00.000Z'); // +09:00 → UTC
      expect(ctx.dedupeKey).toBe(
        'hatenablog:example.hatenablog.com/entry/2024/01/15/120000'
      );
      expect(ctx.url).toBe('https://example.hatenablog.com/entry/2024/01/15/120000');
    });

    it('falls back to the blog name when no explicit author is present', () => {
      mountBlog({ ...SAMPLE_BLOG, author: undefined });
      const ctx = parseHatenaBlog();
      expect(ctx.author).toBe('My Hatena Blog');
      expect(ctx.body).toContain('*My Hatena Blog*');
    });

    it('throws a friendly error when the article body is missing', () => {
      mountBlog({ ...SAMPLE_BLOG, withBody: false });
      expect(() => parseHatenaBlog()).toThrow(/couldn't find the article body/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Hatena Bookmark
// ---------------------------------------------------------------------------

interface BookmarkComment {
  user: string;
  html: string;
  tags?: string[];
  datetime?: string;
  dateText?: string;
  stars?: number;
}

interface BookmarkFixture {
  url: string;
  title?: string;
  targetLink?: string;
  userCount?: number;
  comments: BookmarkComment[];
  /** Append a commentless bookmark that must be skipped (default true). */
  withCommentlessBookmark?: boolean;
}

function commentItemHtml(c: BookmarkComment): string {
  const tags = (c.tags ?? [])
    .map((t) => `<li class="entry-comment-tag"><a href="/t/${t}">${t}</a></li>`)
    .join('');
  const time = c.datetime
    ? `<time datetime="${c.datetime}">${c.dateText ?? c.datetime}</time>`
    : c.dateText
      ? `<time>${c.dateText}</time>`
      : '';
  const stars = '<span class="hatena-star-star"></span>'.repeat(c.stars ?? 0);
  return `
    <li class="entry-comment">
      <div class="entry-comment-contents">
        <a class="entry-comment-username" href="/${c.user}/">${c.user}</a>
        <span class="entry-comment-text">${c.html}</span>
        <ul class="entry-comment-tags">${tags}</ul>
      </div>
      <div class="entry-comment-footer">
        ${time}
        <span class="entry-comment-stars">${stars}</span>
      </div>
    </li>`;
}

function mountBookmark(p: BookmarkFixture): void {
  setLocation(p.url);
  document.title = `[B! tech] ${p.title ?? 'Bookmarked article'} - はてなブックマーク`;
  document.head.innerHTML = '';

  const header = `
    <div class="entry-info">
      <h1 class="entry-info-title">
        <a class="js-entry-link" href="${p.targetLink ?? 'https://example.com/article'}">${
          p.title ?? 'Bookmarked article'
        }</a>
      </h1>
      ${
        p.userCount !== undefined
          ? `<span class="entry-info-users"><span class="count">${p.userCount}</span> users</span>`
          : ''
      }
    </div>`;

  const items = p.comments.map(commentItemHtml).join('\n');
  const commentless =
    p.withCommentlessBookmark === false
      ? ''
      : `<li class="entry-comment">
           <div class="entry-comment-contents">
             <a class="entry-comment-username" href="/silent/">silent</a>
             <span class="entry-comment-text"></span>
           </div>
         </li>`;

  document.body.innerHTML = `
    ${header}
    <ul class="entry-comments">
      ${items}
      ${commentless}
    </ul>`;
}

const SAMPLE_BOOKMARK: BookmarkFixture = {
  url: 'https://b.hatena.ne.jp/entry/s/example.com/article',
  title: 'すごい記事',
  targetLink: 'https://example.com/article',
  userCount: 42,
  comments: [
    {
      user: 'alice',
      html: 'とても参考になった。<a href="https://example.org/ref">これ</a>も関連。',
      tags: ['あとで読む', 'AI'],
      datetime: '2024-01-15T12:34:00Z',
      stars: 3,
    },
    {
      user: 'bob',
      html: '別の視点から見ると違う。',
      dateText: '2024/01/16',
    },
  ],
};

describe('Hatena Bookmark parser', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  describe('extractBookmarkedUrl', () => {
    it('decodes the https (/entry/s/…) path form, preserving path and query', () => {
      expect(
        extractBookmarkedUrl('https://b.hatena.ne.jp/entry/s/example.com/a/b?x=1')
      ).toBe('https://example.com/a/b?x=1');
    });

    it('decodes the http (/entry/…) path form', () => {
      expect(extractBookmarkedUrl('https://b.hatena.ne.jp/entry/example.com/foo')).toBe(
        'http://example.com/foo'
      );
    });

    it('decodes the /entry?url= query form', () => {
      expect(
        extractBookmarkedUrl(
          'https://b.hatena.ne.jp/entry?url=' +
            encodeURIComponent('https://example.com/x?y=1')
        )
      ).toBe('https://example.com/x?y=1');
    });

    it('returns undefined for a numeric eid path (no host encoded)', () => {
      expect(
        extractBookmarkedUrl('https://b.hatena.ne.jp/entry/4712345678901234567')
      ).toBeUndefined();
    });

    it('returns undefined for other hosts and malformed URLs', () => {
      expect(
        extractBookmarkedUrl('https://example.com/entry/s/example.com/a')
      ).toBeUndefined();
      expect(extractBookmarkedUrl('not a url')).toBeUndefined();
    });
  });

  describe('canHandleHatenaBookmark', () => {
    it('accepts entry pages (path and query forms)', () => {
      setLocation('https://b.hatena.ne.jp/entry/s/example.com/article');
      expect(canHandleHatenaBookmark()).toBe(true);
      setLocation('https://b.hatena.ne.jp/entry/example.com/article');
      expect(canHandleHatenaBookmark()).toBe(true);
      setLocation('https://b.hatena.ne.jp/entry?url=https%3A%2F%2Fexample.com');
      expect(canHandleHatenaBookmark()).toBe(true);
    });

    it('rejects the hotentry, entrylist, user, and home listing pages', () => {
      setLocation('https://b.hatena.ne.jp/');
      expect(canHandleHatenaBookmark()).toBe(false);
      setLocation('https://b.hatena.ne.jp/hotentry/it');
      expect(canHandleHatenaBookmark()).toBe(false);
      // /entrylist starts with "/entry" but is NOT an entry page.
      setLocation('https://b.hatena.ne.jp/entrylist');
      expect(canHandleHatenaBookmark()).toBe(false);
      setLocation('https://b.hatena.ne.jp/someuser/');
      expect(canHandleHatenaBookmark()).toBe(false);
      // /entry with no url param is not an entry page either.
      setLocation('https://b.hatena.ne.jp/entry');
      expect(canHandleHatenaBookmark()).toBe(false);
    });

    it('rejects other hosts', () => {
      setLocation('https://example.com/entry/s/example.com/article');
      expect(canHandleHatenaBookmark()).toBe(false);
    });
  });

  describe('parseHatenaBookmark', () => {
    it('captures the bookmarked title, URL, user count, and comments', () => {
      mountBookmark(SAMPLE_BOOKMARK);
      const ctx = parseHatenaBookmark();

      expect(ctx.parser).toBe('hatenabookmark');
      expect(ctx.fromSelection).toBe(false);
      expect(ctx.title).toBe('すごい記事');
      expect(ctx.body).toContain('# すごい記事');
      expect(ctx.body).toContain('**Bookmarked:** https://example.com/article');
      expect(ctx.body).toContain('*42 users*');

      // Only the two commented bookmarks count — the commentless one is skipped.
      expect(ctx.body).toContain('## Comments (2)');
      expect(ctx.body).not.toContain('silent');

      // alice's comment: header with date + stars, body (link converted), tags.
      expect(ctx.body).toContain('**alice** · 2024-01-15 · ★3');
      expect(ctx.body).toContain('[これ](https://example.org/ref)');
      expect(ctx.body).toContain('*[あとで読む, AI]*');

      // bob's comment: non-ISO date text passes through, no stars.
      expect(ctx.body).toContain('**bob** · 2024/01/16');
      expect(ctx.body).toContain('別の視点から見ると違う。');

      expect(ctx.tags).toEqual(['hatenabookmark', 'host:example.com']);
      expect(ctx.dedupeKey).toBe('hatenabookmark:https://example.com/article');
      expect(ctx.url).toBe('https://b.hatena.ne.jp/entry/s/example.com/article');
    });

    it('renders a placeholder when an entry has no comments', () => {
      mountBookmark({ ...SAMPLE_BOOKMARK, comments: [], withCommentlessBookmark: false });
      const ctx = parseHatenaBookmark();
      expect(ctx.body).toContain('## Comments');
      expect(ctx.body).toContain('*(no comments on this entry yet)*');
      // Still a valid capture because the target URL resolved from the path.
      expect(ctx.body).toContain('**Bookmarked:** https://example.com/article');
    });

    it('caps rendered comments at 100 and notes the truncation', () => {
      const comments: BookmarkComment[] = [];
      for (let i = 1; i <= 105; i++) {
        comments.push({ user: `user${i}`, html: `comment ${i}` });
      }
      mountBookmark({ ...SAMPLE_BOOKMARK, comments, withCommentlessBookmark: false });
      const ctx = parseHatenaBookmark();
      expect(ctx.body).toContain('## Comments (105)');
      expect(ctx.body).toContain('comment 100');
      expect(ctx.body).not.toContain('comment 101');
      expect(ctx.body).toContain(
        '*…truncated: showing the first 100 of 105 comments on this page.*'
      );
    });

    it('throws a friendly error when the entry content is absent', () => {
      // Numeric-eid entry (URL unresolvable) with no comments in the DOM.
      setLocation('https://b.hatena.ne.jp/entry/4712345678901234567');
      document.title = 'はてなブックマーク';
      document.body.innerHTML = '<div class="page">nothing useful here</div>';
      expect(() => parseHatenaBookmark()).toThrow(/couldn't find the bookmarked entry/i);
    });
  });
});
