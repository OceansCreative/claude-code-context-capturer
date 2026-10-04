import { describe, it, expect, beforeEach } from 'vitest';
import {
  canHandleDevto,
  parseDevto,
  extractDevtoRef,
} from '@/content/parsers/devto';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Fixture builder — mirrors a dev.to article page: a schema.org Article JSON-LD
// block + canonical link in <head>, the <h1> title, #article-body, Rouge code
// blocks, crayons tag links, and a <time> in <body>.
// ---------------------------------------------------------------------------

interface DevtoFixture {
  url: string;
  title: string;
  author?: string;
  datePublished?: string;
  /** Tag slugs, rendered as /t/<slug> crayons-tag links. */
  tags?: string[];
  /** Inner HTML of #article-body. */
  bodyHtml: string;
  /** Emit the Article JSON-LD block (default true). */
  withLd?: boolean;
  /** Omit #article-body entirely (missing-body path). */
  withBody?: boolean;
  ogTitle?: string;
  docTitle?: string;
}

const DEFAULT_BODY = `
  <h2>Intro</h2>
  <p>Hello <strong>world</strong>. See <a href="https://example.com">example</a>.</p>
  <div class="highlight js-code-highlight"><pre class="highlight python"><code>print("hi")</code></pre></div>
  <div class="highlight js-code-highlight"><pre class="highlight plaintext"><code>just text</code></pre></div>
  <p><img src="https://img.dev.to/x.png" alt="diagram"></p>
`;

function mountDevto(p: DevtoFixture): void {
  setLocation(p.url);
  document.title = p.docTitle ?? `${p.title} - DEV Community`;

  const head: string[] = [`<link rel="canonical" href="${p.url}" />`];
  if (p.ogTitle) head.push(`<meta property="og:title" content="${p.ogTitle}" />`);
  if (p.withLd !== false) {
    const ld = {
      '@context': 'http://schema.org',
      '@type': 'Article',
      headline: p.title,
      author: p.author
        ? { '@type': 'Person', name: p.author, url: 'https://dev.to/x' }
        : undefined,
      datePublished: p.datePublished,
      url: p.url,
    };
    head.push(
      `<script type="application/ld+json">${JSON.stringify(ld)}</script>`
    );
  }
  document.head.innerHTML = head.join('\n');

  const tagLinks = (p.tags ?? [])
    .map((t) => `<a class="crayons-tag" href="/t/${t}">#${t}</a>`)
    .join('\n');
  const timeEl = p.datePublished
    ? `<time datetime="${p.datePublished}">date</time>`
    : '';
  const articleBody =
    p.withBody === false
      ? ''
      : `<div id="article-body" class="crayons-article__body" data-article-id="42">${p.bodyHtml}</div>`;

  document.body.innerHTML = `
    <h1>${p.title}</h1>
    <div class="crayons-article__header__meta">${timeEl}</div>
    ${articleBody}
    <div class="spec__tags">${tagLinks}</div>`;
}

const POST: DevtoFixture = {
  url: 'https://dev.to/georgekobaidze/cyberpunk-console-h4c',
  title: 'I Turned My GitHub Profile Into a Cyberpunk Console',
  author: 'Giorgi Kobaidze',
  datePublished: '2026-10-01T18:02:38Z',
  tags: ['python', 'showdev', 'github'],
  bodyHtml: DEFAULT_BODY,
};

describe('Dev.to parser', () => {
  describe('extractDevtoRef', () => {
    it('parses /<user>/<slug> article paths', () => {
      expect(extractDevtoRef('/ben/the-dev-story-6ph')).toEqual({
        user: 'ben',
        slug: 'the-dev-story-6ph',
      });
    });

    it('returns undefined for non-article paths', () => {
      expect(extractDevtoRef('/')).toBeUndefined(); // home feed
      expect(extractDevtoRef('/t/python')).toBeUndefined(); // tag listing
      expect(extractDevtoRef('/ben')).toBeUndefined(); // user profile
      expect(extractDevtoRef('/ben/series/my-series')).toBeUndefined(); // series (3 segs)
      expect(extractDevtoRef('/dashboard')).toBeUndefined();
      expect(extractDevtoRef('/settings/profile')).toBeUndefined();
    });
  });

  describe('canHandleDevto', () => {
    it('accepts a dev.to article URL', () => {
      setLocation('https://dev.to/ben/the-dev-story-6ph');
      expect(canHandleDevto()).toBe(true);
    });

    it('rejects the home feed, tag listings, and profiles', () => {
      setLocation('https://dev.to/');
      expect(canHandleDevto()).toBe(false);
      setLocation('https://dev.to/t/python');
      expect(canHandleDevto()).toBe(false);
      setLocation('https://dev.to/ben');
      expect(canHandleDevto()).toBe(false);
    });

    it('rejects non-dev.to hosts even with an article-like path', () => {
      setLocation('https://example.com/ben/the-dev-story-6ph');
      expect(canHandleDevto()).toBe(false);
      setLocation('https://notdev.to/ben/the-dev-story-6ph');
      expect(canHandleDevto()).toBe(false);
    });
  });

  describe('parseDevto', () => {
    beforeEach(() => {
      document.head.innerHTML = '';
      document.body.innerHTML = '';
    });

    it('captures an article with metadata, body, tags, and dedupeKey', () => {
      mountDevto(POST);
      const ctx = parseDevto();

      expect(ctx.parser).toBe('devto');
      expect(ctx.fromSelection).toBe(false);
      expect(ctx.title).toBe('I Turned My GitHub Profile Into a Cyberpunk Console');
      expect(ctx.author).toBe('Giorgi Kobaidze');
      expect(ctx.publishedAt).toBe('2026-10-01T18:02:38.000Z');
      expect(ctx.url).toBe('https://dev.to/georgekobaidze/cyberpunk-console-h4c');
      expect(ctx.dedupeKey).toBe('devto:georgekobaidze/cyberpunk-console-h4c');

      // Title heading + author/date/platform byline + body content.
      expect(ctx.body).toContain(
        '# I Turned My GitHub Profile Into a Cyberpunk Console'
      );
      expect(ctx.body).toContain('_Giorgi Kobaidze · 2026-10-01 · Dev.to_');
      expect(ctx.body).toContain('## Intro');
      expect(ctx.body).toContain('Hello **world**');
      expect(ctx.body).toContain('[example](https://example.com)');
      expect(ctx.body).toContain('![diagram](https://img.dev.to/x.png)');
    });

    it('preserves code-block languages (Rouge class on the <pre>)', () => {
      mountDevto(POST);
      const ctx = parseDevto();

      // Rouge puts the lexer name as the 2nd class on <pre>; we lift it onto
      // the <code> so the fence is tagged.
      expect(ctx.body).toContain('```python');
      expect(ctx.body).toContain('print("hi")');
      // `plaintext` collapses to a bare fence, not ```plaintext.
      expect(ctx.body).toContain('just text');
      expect(ctx.body).not.toContain('```plaintext');
    });

    it('extracts tag slugs (prefixed with the platform, # stripped)', () => {
      mountDevto(POST);
      const ctx = parseDevto();
      expect(ctx.tags).toEqual(['devto', 'python', 'showdev', 'github']);
    });

    it('falls back to <h1> / og:title and <time> when no JSON-LD', () => {
      mountDevto({
        ...POST,
        author: undefined,
        withLd: false,
        ogTitle: 'OG Title',
      });
      const ctx = parseDevto();
      // h1 is first in the fallback chain.
      expect(ctx.title).toBe('I Turned My GitHub Profile Into a Cyberpunk Console');
      // date recovered from <time datetime>.
      expect(ctx.publishedAt).toBe('2026-10-01T18:02:38.000Z');
      // tags still come from the /t/ links.
      expect(ctx.tags).toEqual(['devto', 'python', 'showdev', 'github']);
    });

    it('throws a friendly error when the article body is missing', () => {
      mountDevto({ ...POST, withBody: false });
      expect(() => parseDevto()).toThrow(/could not find the dev\.to article body/i);
    });
  });
});
