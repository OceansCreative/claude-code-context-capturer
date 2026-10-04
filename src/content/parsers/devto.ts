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
 * Dev.to (dev.to) article parser.
 *
 * DATA SOURCE: the server-rendered article page DOM, not the public JSON API
 * (`dev.to/api/articles/<id>`). The page is already clean, server-rendered HTML
 * in the content script, so parsing it in place avoids an extra network
 * round-trip (plus the API's rate limits / CORS) and keeps the tests hermetic
 * DOM fixtures. Metadata is anchored on the schema.org `Article` JSON-LD block
 * Dev.to emits (stable across redesigns) with DOM fallbacks.
 *
 * ============================================================================
 * ANCHORS THIS PARSER DEPENDS ON (check these first when Dev.to breaks it)
 * ============================================================================
 *   #article-body                         the rendered article body (required)
 *   script[type=application/ld+json]      Article: headline / author /
 *                                         datePublished / keywords
 *   a.crayons-tag[href^="/t/"]            tag links (slug lives in the href)
 *   pre.highlight > code                  code blocks (Rouge lexer name is the
 *                                         second class on the <pre>)
 *   time[datetime]                        published-date fallback
 *   link[rel=canonical]                   canonical article URL
 * ============================================================================
 */

const DEVTO_HOST = 'dev.to';

/**
 * First path segments that are NOT usernames — feed, tag, and app routes. A
 * real article is `/<user>/<slug>` whose first segment is none of these.
 */
const DEVTO_RESERVED = new Set([
  't',
  'tags',
  'search',
  'dashboard',
  'settings',
  'notifications',
  'readinglist',
  'enter',
  'leave',
  'new',
  'signout',
  'pod',
  'videos',
  'latest',
  'top',
  'about',
  'contact',
  'privacy',
  'terms',
  'code-of-conduct',
  'faq',
  'api',
  'admin',
  'page',
  'feed',
  'followers',
  'following',
  'onboarding',
  'welcome',
  'shop',
  'security',
  'sponsors',
]);

/** A Dev.to article reference parsed from the page path. */
export interface DevtoRef {
  user: string;
  slug: string;
}

/**
 * A Dev.to article path is exactly `/<user>/<slug>` with a non-reserved first
 * segment. The home feed (`/`), tag listings (`/t/<tag>`), user profiles
 * (`/<user>`), series (`/<user>/series/<n>` — three segments) and app routes
 * all return undefined and fall through to the generic parser.
 */
export function extractDevtoRef(pathname: string): DevtoRef | undefined {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length !== 2) return undefined;
  const [user, slug] = segs;
  if (DEVTO_RESERVED.has(user.toLowerCase())) return undefined;
  return { user, slug };
}

export function canHandleDevto(): boolean {
  return (
    window.location.hostname === DEVTO_HOST &&
    extractDevtoRef(window.location.pathname) !== undefined
  );
}

export function parseDevto(): CapturedContext {
  const capturedAt = new Date().toISOString();
  const ref = extractDevtoRef(window.location.pathname);
  if (!ref) {
    // canHandleDevto gates this, but guard anyway so a direct call fails loudly
    // rather than producing a corrupt capture.
    throw new Error(
      'This does not look like a Dev.to article page. Open an article (dev.to/<user>/<slug>) and retry.'
    );
  }

  const bodyEl = document.getElementById('article-body');
  if (!bodyEl) {
    throw new Error(
      'Could not find the Dev.to article body. This looks like a feed, tag, or profile page — open an actual article and retry.'
    );
  }
  const bodyMarkdown = bodyToMarkdown(bodyEl);
  if (!bodyMarkdown.trim()) {
    throw new Error(
      'The Dev.to article body came back empty. Reload the article and retry.'
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

  const tags = withPlatformTag('devto', extractTags(ld));

  const canonical =
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ||
    `https://${DEVTO_HOST}/${ref.user}/${ref.slug}`;

  return {
    url: canonical,
    title,
    body: renderArticle({
      title,
      author,
      publishedAt,
      platform: 'Dev.to',
      bodyMarkdown,
    }),
    author,
    publishedAt,
    tags,
    capturedAt,
    parser: 'devto',
    fromSelection: false,
    // Keyed on the canonical article slug so re-capturing the same post updates
    // the store entry in place instead of piling up snapshots.
    dedupeKey: `devto:${ref.user}/${ref.slug}`,
  };
}

/** Tag slugs from the `/t/<tag>` links, falling back to JSON-LD keywords. */
function extractTags(ld: ArticleLd | undefined): string[] {
  const fromLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a.crayons-tag[href^="/t/"]')
  )
    .map((a) => a.getAttribute('href')?.replace(/^\/t\//, '').replace(/\/$/, ''))
    .filter((t): t is string => Boolean(t));
  if (fromLinks.length > 0) return Array.from(new Set(fromLinks));
  return ldKeywords(ld);
}

function cleanDocTitle(): string {
  return (
    (document.title || 'Dev.to article')
      .replace(/\s*[-|]\s*DEV Community\s*$/i, '')
      .trim() || 'Dev.to article'
  );
}
