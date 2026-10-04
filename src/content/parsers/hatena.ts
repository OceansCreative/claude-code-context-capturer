import { htmlToMarkdown } from '@/shared/markdown-converter';
import type { CapturedContext } from '@/shared/types';

/**
 * Hatena parser — two capture shapes on two different hosts.
 *
 *   1. Hatena Blog (`*.hatenablog.com`, `*.hatenablog.jp`, `*.hateblo.jp`,
 *      `*.hatenadiary.com`, `*.hatenadiary.jp`) — a blog ARTICLE on an
 *      `/entry/…` permalink. Captured like Zenn / Qiita: title, blog name /
 *      author, published date, categories, and the body as clean Markdown.
 *
 *   2. Hatena Bookmark (`b.hatena.ne.jp/entry/…`) — a social-bookmark ENTRY
 *      page: the bookmarked page's title + URL plus the public user comments.
 *      Captured like a lightweight comment thread (cf. hackernews / reddit) —
 *      this is the more differentiated half.
 *
 * TWO parser names (`hatenablog` + `hatenabookmark`) rather than one `hatena`,
 * because the two outputs are genuinely different shapes on different hosts —
 * mirroring the existing `claude-ai` / `claude-ai-artifact` and `github` /
 * `gist` splits. The frontmatter `parser:` field then records which shape
 * produced a capture, and each carries its own site tag.
 *
 * Both parsers read the server-rendered DOM only — no internal-API calls. The
 * article body and the bookmark comments are present in the initial HTML, so
 * there's nothing to fetch and no account-flag risk.
 *
 * Custom-domain Hatena blogs (users can map their own domain to a Hatena Blog)
 * can't be told apart from any other site by host, so those fall through to
 * generic Readability — by design.
 *
 * ============================================================================
 * ANCHORS THESE PARSERS DEPEND ON (check these first if Hatena breaks them)
 * ============================================================================
 * Hatena Blog (theme-independent classes Hatena injects around every entry):
 *   article.entry / .entry       the single-article wrapper
 *   .entry-title ( > a )         the article title (link)
 *   .entry-content               the article body HTML
 *   .entry-category-link         category / tag links
 *   .entry-date time[datetime]   the published date (ISO with offset)
 *   og:site_name                 the blog name
 *
 * Hatena Bookmark (entry page):
 *   the entry URL path            encodes the bookmarked target URL
 *                                 (/entry/s/<host>/… = https, /entry/<host>/… = http)
 *   .entry-comment                one list item per bookmark-with-comment
 *     .entry-comment-username       the bookmarker
 *     .entry-comment-text           the comment body
 *     .entry-comment-tags a         the comment's tags
 *     time[datetime]                when it was bookmarked
 *     .hatena-star-star             one node per star (best-effort; loads async)
 * ============================================================================
 */

/** Host suffixes Hatena assigns to free-tier blogs (custom domains fall through). */
const HATENA_BLOG_SUFFIXES = [
  '.hatenablog.com',
  '.hatenablog.jp',
  '.hateblo.jp',
  '.hatenadiary.com',
  '.hatenadiary.jp',
];

const HATENA_BOOKMARK_HOST = 'b.hatena.ne.jp';

/** Cap on rendered bookmark comments so a heavily-bookmarked entry stays sane. */
const MAX_COMMENTS = 100;

// ===========================================================================
// Hatena Blog (article)
// ===========================================================================

export function canHandleHatenaBlog(): boolean {
  const host = window.location.hostname;
  const onHatenaBlogHost = HATENA_BLOG_SUFFIXES.some((suffix) => host.endsWith(suffix));
  // Article permalinks live under /entry/… ; the blog index, /archive, /about,
  // and category listings do not → those fall through to generic.
  return onHatenaBlogHost && /^\/entry\//.test(window.location.pathname);
}

export function parseHatenaBlog(): CapturedContext {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();

  const entry =
    document.querySelector('article.entry') ?? document.querySelector('.entry');
  const bodyEl = (entry ?? document).querySelector('.entry-content');

  if (!bodyEl) {
    // Never write an empty/corrupt capture — surface a friendly error instead.
    throw new Error(
      "Couldn't find the article body on this Hatena Blog page (.entry-content is missing). Open the article's permalink (…/entry/…) and retry — the blog index and archive pages aren't article pages."
    );
  }

  const title = extractBlogTitle(entry);
  const bodyMarkdown = htmlToMarkdown(bodyEl.innerHTML);
  const categories = extractBlogCategories(entry);
  const publishedAt = extractBlogDate(entry);
  const { blogName, author } = extractBlogByline();

  const sections: string[] = [`# ${title}`];
  const byline = author ?? blogName;
  if (byline) sections.push(`*${byline}*`);
  sections.push(bodyMarkdown);

  return {
    url,
    title,
    body: sections.join('\n\n'),
    author: author ?? blogName,
    publishedAt,
    tags: ['hatenablog', ...categories],
    capturedAt,
    parser: 'hatenablog',
    fromSelection: false,
    // Re-capturing the same article updates the stored entry rather than
    // accumulating snapshots (same subject-keyed pattern as the other parsers).
    dedupeKey: `hatenablog:${window.location.hostname}${stripTrailingSlash(
      window.location.pathname
    )}`,
  };
}

function extractBlogTitle(entry: Element | null): string {
  const scope: ParentNode = entry ?? document;
  const el =
    scope.querySelector('.entry-title a') ??
    scope.querySelector('.entry-title') ??
    document.querySelector('h1.entry-title');
  const text = collapse(el?.textContent ?? '');
  if (text) return text;
  return metaContent('og:title', 'property') ?? document.title;
}

function extractBlogCategories(entry: Element | null): string[] {
  const scope: ParentNode = entry ?? document;
  return uniqueText(
    scope.querySelectorAll(
      '.entry-category-link, .entry-categories a, a[href*="/archive/category/"]'
    )
  );
}

function extractBlogDate(entry: Element | null): string | undefined {
  const scope: ParentNode = entry ?? document;
  const datetime =
    scope
      .querySelector('.entry-date time[datetime], time.updated[datetime], time[datetime]')
      ?.getAttribute('datetime') ?? metaContent('article:published_time', 'property');
  return normalizeIso(datetime);
}

function extractBlogByline(): { blogName?: string; author?: string } {
  const author =
    collapse(
      document.querySelector(
        '.entry-footer .author.vcard a, .author.vcard .url, .entry-author .author-name'
      )?.textContent ?? ''
    ) || undefined;
  const blogName =
    metaContent('og:site_name', 'property') ??
    (collapse(
      document.querySelector('.blog-title-content, #blog-title .blog-title, #title a')
        ?.textContent ?? ''
    ) ||
      undefined);
  return { blogName, author };
}

// ===========================================================================
// Hatena Bookmark (entry page)
// ===========================================================================

export function canHandleHatenaBookmark(): boolean {
  if (window.location.hostname !== HATENA_BOOKMARK_HOST) return false;
  const { pathname, search } = window.location;
  // Entry pages are /entry/… (path form) or /entry?url=… (query form). The
  // hotentry / entrylist / user / tag listing pages do NOT start with /entry/
  // (note /entrylist is excluded by requiring the trailing slash).
  if (pathname.startsWith('/entry/')) return true;
  if (pathname === '/entry' && new URLSearchParams(search).has('url')) return true;
  return false;
}

export function parseHatenaBookmark(): CapturedContext {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();

  const bookmarkedUrl = extractBookmarkedUrl(url) ?? extractBookmarkedUrlFromDom();
  const { comments, total } = extractBookmarkComments();

  if (!bookmarkedUrl && total === 0) {
    // Couldn't resolve the target URL AND there are no comments — this isn't a
    // usable entry page (or Hatena changed its markup). Fail loudly rather than
    // emitting an empty capture.
    throw new Error(
      "Couldn't find the bookmarked entry on this Hatena Bookmark page. Open a bookmark entry page (b.hatena.ne.jp/entry/…) and retry — the hotentry and listing pages aren't entry pages."
    );
  }

  const title = extractBookmarkTitle(bookmarkedUrl);
  const userCount = extractBookmarkCount();

  const sections: string[] = [`# ${title}`];
  if (bookmarkedUrl) sections.push(`**Bookmarked:** ${bookmarkedUrl}`);
  if (userCount !== undefined) {
    sections.push(`*${userCount} user${userCount === 1 ? '' : 's'}*`);
  }

  if (total > 0) {
    sections.push(`## Comments (${total})`);
    sections.push(comments.join('\n\n'));
    if (comments.length < total) {
      sections.push(
        `*…truncated: showing the first ${comments.length} of ${total} comments on this page.*`
      );
    }
  } else {
    sections.push('## Comments', '*(no comments on this entry yet)*');
  }

  const tags = ['hatenabookmark'];
  const host = bookmarkedUrl ? safeHost(bookmarkedUrl) : undefined;
  if (host) tags.push(`host:${host}`);

  return {
    url,
    title,
    body: sections.join('\n\n'),
    tags,
    capturedAt,
    parser: 'hatenabookmark',
    fromSelection: false,
    // Keyed on the bookmarked target so re-capturing the same entry updates in
    // place even if reached via a different entry-URL form.
    dedupeKey: `hatenabookmark:${
      bookmarkedUrl ?? stripTrailingSlash(window.location.pathname)
    }`,
  };
}

/**
 * Decode the bookmarked target URL from a Hatena Bookmark entry URL.
 *
 *   /entry/s/<host>/<path>   → https://<host>/<path>
 *   /entry/<host>/<path>     → http://<host>/<path>
 *   /entry?url=<encoded>     → the decoded target
 *   /entry/<numeric eid>     → undefined (no target host encoded in the path)
 *
 * Exported for unit testing — deterministic and DOM-free, so it's the robust
 * primary source for the target URL (the DOM is only a fallback).
 */
export function extractBookmarkedUrl(rawUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (parsed.hostname !== HATENA_BOOKMARK_HOST) return undefined;

  // Query form: /entry?url=<encoded target>.
  if (parsed.pathname === '/entry') {
    const target = parsed.searchParams.get('url');
    return target || undefined;
  }

  // Path form. Slice the RAW href (not the percent-decoded pathname) so the
  // target's own path, query, and fragment survive intact.
  const marker = rawUrl.indexOf('/entry/');
  if (marker === -1) return undefined;
  let rest = rawUrl.slice(marker + '/entry/'.length);
  let protocol = 'http://';
  if (rest.startsWith('s/')) {
    protocol = 'https://';
    rest = rest.slice(2);
  }
  // A numeric eid (e.g. /entry/4712345678) encodes no target host.
  const firstSegment = rest.split(/[/?#]/, 1)[0];
  if (!firstSegment.includes('.')) return undefined;
  return protocol + rest;
}

/** Fallback: a prominent outbound link in the entry header → the target URL. */
function extractBookmarkedUrlFromDom(): string | undefined {
  const anchors = document.querySelectorAll<HTMLAnchorElement>(
    '.entry-info a[href^="http"], a.js-entry-link[href^="http"], h1 a[href^="http"]'
  );
  for (const anchor of Array.from(anchors)) {
    const href = anchor.getAttribute('href') ?? '';
    if (href && safeHost(href) !== HATENA_BOOKMARK_HOST) return href;
  }
  return undefined;
}

function extractBookmarkTitle(bookmarkedUrl: string | undefined): string {
  const el = document.querySelector(
    '.entry-info-title, .entry-title a, .entry-title, h1 a, h1'
  );
  const domTitle = collapse(el?.textContent ?? '');
  if (domTitle) return domTitle;
  const og = metaContent('og:title', 'property');
  if (og) return stripBookmarkChrome(og);
  const docTitle = stripBookmarkChrome(document.title);
  if (docTitle) return docTitle;
  return bookmarkedUrl ?? 'Hatena Bookmark entry';
}

function extractBookmarkComments(): { comments: string[]; total: number } {
  let items = document.querySelectorAll('.entry-comment');
  if (items.length === 0) {
    items = document.querySelectorAll('.js-keyboard-selectable-item, .js-bookmark');
  }

  const comments: string[] = [];
  let total = 0;

  items.forEach((item) => {
    const username =
      collapse(item.querySelector('.entry-comment-username')?.textContent ?? '') ||
      collapse(item.querySelector('a[href^="/"]')?.textContent ?? '');
    const textEl = item.querySelector('.entry-comment-text');
    const commentMd = textEl ? htmlToMarkdown(textEl.innerHTML).trim() : '';
    // This is a discussion capture — keep only bookmarks that carry a comment.
    if (!username || !commentMd) return;

    total++;
    if (comments.length >= MAX_COMMENTS) return; // keep counting for the note

    const date = collapse(
      item.querySelector('time[datetime]')?.getAttribute('datetime') ??
        item.querySelector('time')?.textContent ??
        ''
    );
    const tags = uniqueText(
      item.querySelectorAll('.entry-comment-tags a, .entry-comment-tag')
    );
    const stars = countStars(item);

    const headerBits = [`**${username}**`];
    if (date) headerBits.push(formatBookmarkDate(date));
    if (stars > 0) headerBits.push(`★${stars}`);

    const block = [headerBits.join(' · '), commentMd];
    if (tags.length > 0) block.push(`*[${tags.join(', ')}]*`);
    comments.push(block.join('\n\n'));
  });

  return { comments, total };
}

/**
 * Best-effort star count. Hatena Star renders one node per star, but the widget
 * loads asynchronously, so stars are often absent from the captured DOM — which
 * is fine, we just omit them.
 */
function countStars(item: Element): number {
  return item.querySelectorAll('.hatena-star-star, .entry-comment-star').length;
}

function extractBookmarkCount(): number | undefined {
  const el = document.querySelector(
    '.entry-info-users .count, .js-users-count, .entry-info-number'
  );
  const n = el ? Number.parseInt(collapse(el.textContent ?? ''), 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** ISO `datetime` → `YYYY-MM-DD`; a non-ISO textContent value passes through. */
function formatBookmarkDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return raw;
}

/** Strip Hatena Bookmark's title chrome: `[B! tag]` prefix, ` - はてなブックマーク` suffix. */
function stripBookmarkChrome(text: string): string {
  return collapse(text)
    .replace(/\s*-\s*はてなブックマーク\s*$/, '')
    .replace(/^\[B![^\]]*\]\s*/, '')
    .trim();
}

// ===========================================================================
// Shared helpers
// ===========================================================================

function metaContent(key: string, attr: 'name' | 'property' = 'name'): string | undefined {
  const content = document
    .querySelector(`meta[${attr}="${key}"]`)
    ?.getAttribute('content')
    ?.trim();
  return content || undefined;
}

function normalizeIso(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function safeHost(u: string): string | undefined {
  try {
    return new URL(u).hostname || undefined;
  } catch {
    return undefined;
  }
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** Collapse all whitespace (incl. &nbsp; and newlines) to single spaces, trim. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function uniqueText(nodes: NodeListOf<Element>): string[] {
  const set = new Set<string>();
  nodes.forEach((node) => {
    const text = collapse(node.textContent ?? '');
    if (text) set.add(text);
  });
  return Array.from(set);
}
