import type { CapturedContext } from '@/shared/types';
import {
  ArticleLd,
  bodyToMarkdown,
  findArticleLd,
  ldAuthorName,
  ldKeywords,
  ldText,
  metaContent,
  normalizeDate,
  renderArticle,
  withPlatformTag,
} from './blog-common';

/**
 * Hashnode article parser.
 *
 * SCOPE: only the hashnode.dev and hashnode.com hosts (including subdomains
 * such as `<name>.hashnode.dev` and `townhall.hashnode.com`). Hashnode also
 * serves blogs on arbitrary CUSTOM DOMAINS, which are indistinguishable from
 * any other site — those fall through to the generic Readability parser by
 * design (we can't auto-detect them, and guessing would be wrong).
 *
 * DATA SOURCE: the server-rendered article DOM (Hashnode is a Next.js SSR app,
 * so the post HTML is present on first paint). Metadata is anchored on the
 * schema.org `Article` JSON-LD block Hashnode emits (headline / author /
 * datePublished / keywords) with DOM fallbacks; the body is the `.prose`
 * typography container.
 *
 * ============================================================================
 * ANCHORS THIS PARSER DEPENDS ON (check these first when Hashnode breaks it)
 * ============================================================================
 *   .prose                                the article body (richest wins);
 *                                         <article> is the fallback container
 *   script[type=application/ld+json]      Article: headline / author /
 *                                         datePublished / keywords
 *   a[href^="/tag/"]                     tag links (slug lives in the href)
 *   pre > code.language-*                 code blocks (highlighter sets the lang)
 *   time[datetime]                        published-date fallback
 *   link[rel=canonical]                   canonical article URL
 * ============================================================================
 */

function isHashnodeHost(hostname: string): boolean {
  // Only blog SUBDOMAINS host posts (<name>.hashnode.dev, townhall.hashnode.com).
  // The bare apex hashnode.com / hashnode.dev is the product/marketing/feed site —
  // claiming it would mis-capture pages like hashnode.com/pricing as "articles",
  // so the apex is deliberately left to the generic Readability fallback.
  return hostname.endsWith('.hashnode.dev') || hostname.endsWith('.hashnode.com');
}

/**
 * Single path segments that are NOT post slugs — blog listing, feed, and app
 * routes. A real post lives at `/<slug>` whose segment is none of these.
 */
const HASHNODE_RESERVED = new Set([
  'tags',
  'tag',
  'series',
  'about',
  'members',
  'newsletter',
  'badges',
  'sponsor',
  'sponsors',
  'search',
  'n',
  'archive',
  'recommendations',
  'drafts',
  'dashboard',
  'settings',
  'onboard',
  'enterprise',
  'ama',
  'feed',
  'explore',
  'hackathons',
  'following',
  'rss',
  'sitemap',
]);

/**
 * A Hashnode post lives at `/<slug>` (a single path segment) on a blog host.
 * The blog home (`/`), tag (`/tags/<t>`) and series (`/series/<s>`) listings
 * (two segments), profile pages (`/@user`), feed routes (`/n/<network>`) and
 * feeds like `/rss.xml` all return undefined and fall through to generic.
 */
export function extractHashnodeSlug(pathname: string): string | undefined {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length !== 1) return undefined;
  const slug = segs[0];
  if (slug.startsWith('@')) return undefined;
  if (HASHNODE_RESERVED.has(slug.toLowerCase())) return undefined;
  if (/\.(xml|txt|json)$/i.test(slug)) return undefined;
  return slug;
}

export function canHandleHashnode(): boolean {
  return (
    isHashnodeHost(window.location.hostname) &&
    extractHashnodeSlug(window.location.pathname) !== undefined
  );
}

export function parseHashnode(): CapturedContext {
  const capturedAt = new Date().toISOString();
  const slug = extractHashnodeSlug(window.location.pathname);
  if (!slug) {
    // canHandleHashnode gates this, but guard anyway so a direct call fails
    // loudly rather than producing a corrupt capture.
    throw new Error(
      'This does not look like a Hashnode post page. Open a post and retry (blog home, tag, and series pages are not articles).'
    );
  }

  const bodyEl = findBody();
  if (!bodyEl) {
    throw new Error(
      'Could not find the Hashnode article body. This may be a blog home, tag, or series page, or the post may still be loading — open the post and retry.'
    );
  }
  const bodyMarkdown = bodyToMarkdown(bodyEl);
  if (!bodyMarkdown.trim()) {
    throw new Error(
      'The Hashnode article body came back empty. Reload the post and retry.'
    );
  }

  const ld = findArticleLd(document);
  const title =
    ldText(ld?.headline) ||
    document.querySelector('h1')?.textContent?.trim() ||
    metaContent(document, 'og:title') ||
    cleanDocTitle();
  const author = ldAuthorName(ld) || metaContent(document, 'author');
  const publishedAt =
    normalizeDate(ld?.datePublished) ||
    normalizeDate(
      document.querySelector('time[datetime]')?.getAttribute('datetime')
    );

  const tags = withPlatformTag('hashnode', extractTags(ld));

  const canonical =
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ||
    window.location.href;

  return {
    url: canonical,
    title,
    body: renderArticle({
      title,
      author,
      publishedAt,
      platform: 'Hashnode',
      bodyMarkdown,
    }),
    author,
    publishedAt,
    tags,
    capturedAt,
    parser: 'hashnode',
    fromSelection: false,
    // Keyed on the canonical article URL (host-qualified — the same slug can
    // exist on different Hashnode blogs) so re-capturing updates in place.
    dedupeKey: canonicalKey(canonical),
  };
}

/**
 * Hashnode's body is the `.prose` typography container. A page can carry more
 * than one `.prose` (e.g. an author-bio block), so pick the richest by text
 * length; fall back to `<article>`.
 */
function findBody(): Element | undefined {
  const proses = Array.from(document.querySelectorAll('.prose'));
  if (proses.length > 0) {
    return proses.reduce((best, el) =>
      (el.textContent?.length ?? 0) > (best.textContent?.length ?? 0) ? el : best
    );
  }
  return document.querySelector('article') ?? undefined;
}

/** Tag slugs from the `/tag/<tag>` links, falling back to JSON-LD keywords. */
function extractTags(ld: ArticleLd | undefined): string[] {
  const fromLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href^="/tag/"]')
  )
    .map((a) =>
      a.getAttribute('href')?.replace(/^\/tag\//, '').replace(/\/$/, '')
    )
    .filter((t): t is string => Boolean(t));
  if (fromLinks.length > 0) return Array.from(new Set(fromLinks));
  return ldKeywords(ld);
}

/** `hashnode:<host>/<slug>` from the canonical URL. */
function canonicalKey(url: string): string {
  try {
    const u = new URL(url);
    return `hashnode:${u.hostname}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return `hashnode:${window.location.hostname}${window.location.pathname.replace(/\/$/, '')}`;
  }
}

function cleanDocTitle(): string {
  return (document.title || 'Hashnode article').trim() || 'Hashnode article';
}
