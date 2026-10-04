import { describe, it, expect, beforeEach } from 'vitest';
import {
  canHandleHashnode,
  parseHashnode,
  extractHashnodeSlug,
} from '@/content/parsers/hashnode';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Fixture builder — mirrors a Hashnode post page: a schema.org Article JSON-LD
// block + canonical link in <head>, and an <article> wrapping the <h1>, the
// `.prose` body, /tag/ links, and a <time> in <body>.
// ---------------------------------------------------------------------------

interface HashnodeFixture {
  url: string;
  title: string;
  author?: string;
  datePublished?: string;
  /** schema.org `keywords` (comma-joined) — the JSON-LD tag source. */
  keywords?: string;
  /** Tag slugs, rendered as /tag/<slug> links. */
  tags?: string[];
  /** Inner HTML of the `.prose` body. */
  bodyHtml: string;
  withLd?: boolean;
  withBody?: boolean;
  /** Add a second, shorter `.prose` (author-bio) to test "richest wins". */
  withDecoyProse?: boolean;
}

const DEFAULT_BODY = `
  <div>
    <h2 id="heading-intro">Intro</h2>
    <p>A paragraph with a <a target="_blank" href="https://example.com">link</a>.</p>
    <pre><code class="hljs language-js">const x = 1;</code></pre>
    <ul><li>one</li><li>two</li></ul>
  </div>
`;

function mountHashnode(p: HashnodeFixture): void {
  setLocation(p.url);
  document.title = p.title;

  const head: string[] = [`<link rel="canonical" href="${p.url}" />`];
  if (p.withLd !== false) {
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: p.title,
      author: p.author
        ? { '@type': 'Person', name: p.author, url: 'https://hashnode.com/@x' }
        : undefined,
      datePublished: p.datePublished,
      keywords: p.keywords,
    };
    head.push(
      `<script type="application/ld+json">${JSON.stringify(ld)}</script>`
    );
  }
  document.head.innerHTML = head.join('\n');

  const tagLinks = (p.tags ?? [])
    .map((t) => `<a href="/tag/${t}">#${t}</a>`)
    .join('\n');
  const timeEl = p.datePublished
    ? `<time datetime="${p.datePublished}">date</time>`
    : '';
  const decoy = p.withDecoyProse
    ? `<div class="prose"><p>Written by the author bio.</p></div>`
    : '';
  const prose =
    p.withBody === false
      ? ''
      : `<div class="prose dark:prose-invert prose">${p.bodyHtml}</div>`;

  document.body.innerHTML = `
    <article class="rounded-xl border">
      <h1>${p.title}</h1>
      ${timeEl}
      ${decoy}
      ${prose}
      <div class="tags">${tagLinks}</div>
    </article>`;
}

const POST: HashnodeFixture = {
  url: 'https://anmol-kansal.hashnode.dev/how-to-timeout-a-javascript-promise',
  title: 'How to Timeout a JavaScript Promise',
  author: 'Anmol Kansal',
  datePublished: '2025-06-18T00:40:45.105Z',
  tags: ['javascript', 'promises', 'nodejs'],
  bodyHtml: DEFAULT_BODY,
};

describe('Hashnode parser', () => {
  describe('extractHashnodeSlug', () => {
    it('accepts a single-segment post slug', () => {
      expect(extractHashnodeSlug('/how-to-timeout-a-promise')).toBe(
        'how-to-timeout-a-promise'
      );
    });

    it('returns undefined for blog home / listings / profiles / feeds', () => {
      expect(extractHashnodeSlug('/')).toBeUndefined(); // blog home
      expect(extractHashnodeSlug('/tags/javascript')).toBeUndefined(); // tag listing
      expect(extractHashnodeSlug('/series/my-series')).toBeUndefined(); // series
      expect(extractHashnodeSlug('/@anmol')).toBeUndefined(); // profile
      expect(extractHashnodeSlug('/n/javascript')).toBeUndefined(); // feed
      expect(extractHashnodeSlug('/rss.xml')).toBeUndefined(); // feed file
    });
  });

  describe('canHandleHashnode', () => {
    it('accepts a *.hashnode.dev post', () => {
      setLocation('https://anmol-kansal.hashnode.dev/how-to-timeout-a-promise');
      expect(canHandleHashnode()).toBe(true);
    });

    it('accepts a *.hashnode.com post (e.g. townhall)', () => {
      setLocation('https://townhall.hashnode.com/introducing-auto-blog-ai');
      expect(canHandleHashnode()).toBe(true);
    });

    it('rejects the blog home, tag, and series listing pages', () => {
      setLocation('https://anmol-kansal.hashnode.dev/');
      expect(canHandleHashnode()).toBe(false);
      setLocation('https://anmol-kansal.hashnode.dev/tags/javascript');
      expect(canHandleHashnode()).toBe(false);
      setLocation('https://anmol-kansal.hashnode.dev/series/js');
      expect(canHandleHashnode()).toBe(false);
    });

    it('rejects the apex product/marketing site (hashnode.com / hashnode.dev)', () => {
      // The bare apex is the product site, not a blog host — must fall through
      // to generic so pages like hashnode.com/pricing aren't mis-captured.
      setLocation('https://hashnode.com/pricing');
      expect(canHandleHashnode()).toBe(false);
      setLocation('https://hashnode.com/');
      expect(canHandleHashnode()).toBe(false);
      setLocation('https://hashnode.dev/');
      expect(canHandleHashnode()).toBe(false);
    });

    it('rejects custom-domain Hashnode blogs (undetectable → generic)', () => {
      // A Hashnode blog on a custom domain is indistinguishable from any site;
      // it must NOT be claimed here.
      setLocation('https://blog.mycustomdomain.com/how-to-timeout-a-promise');
      expect(canHandleHashnode()).toBe(false);
      // Lookalike host must not match either.
      setLocation('https://nothashnode.dev/some-post');
      expect(canHandleHashnode()).toBe(false);
    });
  });

  describe('parseHashnode', () => {
    beforeEach(() => {
      document.head.innerHTML = '';
      document.body.innerHTML = '';
    });

    it('captures a post with metadata, body, tags, and dedupeKey', () => {
      mountHashnode(POST);
      const ctx = parseHashnode();

      expect(ctx.parser).toBe('hashnode');
      expect(ctx.fromSelection).toBe(false);
      expect(ctx.title).toBe('How to Timeout a JavaScript Promise');
      expect(ctx.author).toBe('Anmol Kansal');
      expect(ctx.publishedAt).toBe('2025-06-18T00:40:45.105Z');
      expect(ctx.url).toBe(
        'https://anmol-kansal.hashnode.dev/how-to-timeout-a-javascript-promise'
      );
      expect(ctx.dedupeKey).toBe(
        'hashnode:anmol-kansal.hashnode.dev/how-to-timeout-a-javascript-promise'
      );

      expect(ctx.body).toContain('# How to Timeout a JavaScript Promise');
      expect(ctx.body).toContain('_Anmol Kansal · 2025-06-18 · Hashnode_');
      expect(ctx.body).toContain('## Intro');
      expect(ctx.body).toContain('[link](https://example.com)');
    });

    it('preserves code-block languages (language-* class on the <code>)', () => {
      mountHashnode(POST);
      const ctx = parseHashnode();
      expect(ctx.body).toContain('```js');
      expect(ctx.body).toContain('const x = 1;');
    });

    it('extracts tag slugs (prefixed with the platform, # stripped)', () => {
      mountHashnode(POST);
      const ctx = parseHashnode();
      expect(ctx.tags).toEqual(['hashnode', 'javascript', 'promises', 'nodejs']);
    });

    it('falls back to JSON-LD keywords when there are no /tag/ links', () => {
      mountHashnode({
        ...POST,
        tags: [],
        keywords: 'JavaScript, Promises, Node.js',
      });
      const ctx = parseHashnode();
      expect(ctx.tags).toEqual(['hashnode', 'JavaScript', 'Promises', 'Node.js']);
    });

    it('picks the richest .prose when several are present', () => {
      mountHashnode({ ...POST, withDecoyProse: true });
      const ctx = parseHashnode();
      // The real article body, not the shorter author-bio .prose.
      expect(ctx.body).toContain('## Intro');
      expect(ctx.body).not.toContain('Written by the author bio.');
    });

    it('throws a friendly error when the article body is missing', () => {
      // No .prose and no <article> content container.
      setLocation(POST.url);
      document.head.innerHTML = '';
      document.body.innerHTML = '<div>not a post</div>';
      expect(() => parseHashnode()).toThrow(
        /could not find the hashnode article body/i
      );
    });
  });
});
