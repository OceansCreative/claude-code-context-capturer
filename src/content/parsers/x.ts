import type { CaptureOptions, CapturedContext } from '@/shared/types';

/**
 * X / Twitter status-page (thread) parser.
 *
 * X is a hostile scraping target: class names are obfuscated and rotate on
 * every deploy, the timeline is virtualized (tweets unmount as you scroll),
 * and there is no free JSON endpoint. We therefore:
 *
 *   - Parse the DOM only. NO internal API calls (guest tokens / GraphQL
 *     endpoints change constantly and risk account flags).
 *   - Anchor exclusively on `data-testid` attributes, aria-labels, and
 *     semantic elements — NEVER on obfuscated class names.
 *   - Capture only what is currently rendered: the focal tweet, same-author
 *     thread continuations, and visible replies. We do not auto-scroll; when
 *     the thread appears longer than what's rendered we append a note.
 *
 * ============================================================================
 * DOM ANCHORS THIS PARSER DEPENDS ON (check these first when X breaks it)
 * ============================================================================
 *   article[data-testid="tweet"]        one rendered tweet
 *   [data-testid="cellInnerDiv"]        timeline cell wrapper (used for the
 *                                       "thread continues" heuristic: cells
 *                                       without an article are "Show more
 *                                       replies"-style loaders)
 *   [data-testid="User-Name"]           author block: display name + @handle
 *   [data-testid="tweetText"]           tweet body; contains <a> for links /
 *                                       mentions / hashtags and <img alt="…">
 *                                       for emoji (we use the alt text)
 *   time[datetime]                      ISO timestamp
 *   a[href*="/status/"]                 permalink (used to find the focal
 *                                       tweet's status id)
 *   [data-testid="tweetPhoto"]          image attachment (img[alt] inside)
 *   [data-testid="videoPlayer"] /
 *   [data-testid="videoComponent"]      video attachment
 *   div[role="link"][tabindex="0"]      quoted-tweet container (a nested
 *                                       User-Name / tweetText inside it)
 *   [data-testid="reply"|"retweet"|"like"]  action buttons; engagement counts
 *                                       read from their aria-label prefix
 *   [data-testid="placementTracking"]   promoted/ad wrapper (skipped), plus a
 *                                       bare "Ad"/"Promoted" span outside
 *                                       tweetText as a fallback marker
 * ============================================================================
 */

const X_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
]);

/** `/<user>/status/<digits>` (also `/statuses/` and `/i/web/status/`). */
const STATUS_PATH_RE = /^\/(?:[A-Za-z0-9_]{1,15}\/status(?:es)?|i\/web\/status)\/(\d+)/;

/** Hard cap on rendered replies so viral threads don't explode the capture. */
export const MAX_REPLIES = 50;

interface XTweet {
  displayName: string;
  /** Handle without the leading @. */
  handle?: string;
  /** ISO 8601 from time[datetime]. */
  timestamp?: string;
  statusId?: string;
  /** Tweet body already converted to inline Markdown. */
  text: string;
  /** `[image: alt]` / `[video]` placeholders. */
  media: string[];
  quote?: XTweet;
  counts: { replies?: number; reposts?: number; likes?: number };
}

export function canHandleX(): boolean {
  return (
    X_HOSTS.has(window.location.hostname) &&
    STATUS_PATH_RE.test(window.location.pathname)
  );
}

export function parseX(_options: CaptureOptions = {}): CapturedContext {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();
  const statusId = window.location.pathname.match(STATUS_PATH_RE)?.[1];

  const articles = Array.from(
    document.querySelectorAll('article[data-testid="tweet"]')
  );
  if (articles.length === 0) {
    throw new Error(
      'No tweet found on this page. Make sure the tweet is visible (you may need to be logged in, or the post may be deleted/protected), then retry.'
    );
  }

  const tweets: XTweet[] = [];
  for (const article of articles) {
    if (isPromoted(article)) continue; // skip ads
    tweets.push(extractTweet(article));
  }
  if (tweets.length === 0) {
    throw new Error(
      'Only promoted content was found on this page — the tweet itself does not appear to be rendered. Retry once it is visible.'
    );
  }

  // The focal tweet is the one whose permalink matches the URL's status id;
  // if virtualization already unmounted it (or ids don't match), fall back to
  // the first rendered tweet.
  const focal = tweets.find((t) => t.statusId && t.statusId === statusId) ?? tweets[0];
  const focalHandle = (focal.handle ?? '').toLowerCase();

  // Same-author tweets = self-thread continuation (numbered). Everything else
  // rendered on the page goes under Replies, flat — X's reply UI doesn't
  // expose reliable nesting depth, so we don't pretend it does.
  const threadTweets: XTweet[] = [];
  const replies: XTweet[] = [];
  for (const t of tweets) {
    if (t === focal) continue;
    if (focalHandle && (t.handle ?? '').toLowerCase() === focalHandle) {
      threadTweets.push(t);
    } else {
      replies.push(t);
    }
  }

  const title = buildTitle(focal);
  const body = renderMarkdown(title, focal, threadTweets, replies);

  const tags = ['x'];
  if (focal.handle) tags.push(`author:${focal.handle}`);

  return {
    url,
    title,
    body,
    capturedAt,
    parser: 'x',
    fromSelection: false,
    author: focal.handle ? `@${focal.handle}` : focal.displayName || undefined,
    publishedAt: focal.timestamp,
    tags,
    // Re-capturing the same tweet updates the stored entry rather than
    // accumulating snapshots (same pattern as youtube / reddit).
    dedupeKey: statusId ? `x:${statusId}` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Per-tweet extraction
// ---------------------------------------------------------------------------

/**
 * Promoted tweets are wrapped in (or contain) `[data-testid="placementTracking"]`.
 * As a fallback we also treat a bare "Ad" / "Promoted" span OUTSIDE the tweet
 * text as an ad marker (inside tweetText it could be legitimate content).
 */
function isPromoted(article: Element): boolean {
  if (article.closest('[data-testid="placementTracking"]')) return true;
  if (article.querySelector('[data-testid="placementTracking"]')) return true;
  for (const span of Array.from(article.querySelectorAll('span'))) {
    if (span.closest('[data-testid="tweetText"]')) continue;
    const text = span.textContent?.trim();
    if (text === 'Ad' || text === 'Promoted') return true;
  }
  return false;
}

function extractTweet(article: Element): XTweet {
  // Quoted tweet: a div[role="link"] container holding its own User-Name /
  // tweetText. Everything inside it belongs to the QUOTED tweet, so the outer
  // extraction must skip that subtree.
  const quoteEl = findQuoteContainer(article);
  const tweet = extractTweetParts(article, quoteEl);
  if (quoteEl) {
    tweet.quote = extractTweetParts(quoteEl, null);
  }
  tweet.counts = extractCounts(article);
  return tweet;
}

function findQuoteContainer(article: Element): Element | null {
  for (const el of Array.from(
    article.querySelectorAll('div[role="link"][tabindex="0"]')
  )) {
    if (
      el.querySelector('[data-testid="tweetText"]') ||
      el.querySelector('[data-testid="User-Name"]')
    ) {
      return el;
    }
  }
  return null;
}

/** Extract name/handle/time/text/media from `root`, ignoring `exclude`'s subtree. */
function extractTweetParts(root: Element, exclude: Element | null): XTweet {
  const outside = (el: Element): boolean => !exclude || !exclude.contains(el);
  const first = (selector: string): Element | undefined =>
    Array.from(root.querySelectorAll(selector)).find(outside);

  // Author block: display name (may contain emoji <img>) + @handle.
  let displayName = '';
  let handle: string | undefined;
  const userName = first('[data-testid="User-Name"]');
  if (userName) {
    const raw = inlineText(userName);
    const at = raw.match(/@([A-Za-z0-9_]{1,15})/);
    if (at) handle = at[1];
    const firstLink = userName.querySelector('a');
    const nameText = firstLink ? inlineText(firstLink).trim() : '';
    displayName = nameText && !nameText.startsWith('@')
      ? nameText
      : raw.split('@')[0].trim();
  }

  const timeEl = first('time[datetime]');
  const timestamp = timeEl?.getAttribute('datetime') ?? undefined;

  // Status id: prefer the permalink wrapping the timestamp, fall back to any
  // /status/<digits> link in this tweet.
  let statusId: string | undefined;
  for (const a of Array.from(root.querySelectorAll('a[href*="/status/"]'))) {
    if (!outside(a)) continue;
    const m = a.getAttribute('href')?.match(/\/status(?:es)?\/(\d+)/);
    if (!m) continue;
    if (a.querySelector('time')) {
      statusId = m[1];
      break;
    }
    statusId = statusId ?? m[1];
  }

  const textEl = first('[data-testid="tweetText"]');
  const text = textEl ? inlineMarkdown(textEl).trim() : '';

  const media: string[] = [];
  for (const photo of Array.from(root.querySelectorAll('[data-testid="tweetPhoto"]'))) {
    if (!outside(photo)) continue;
    const alt = photo.querySelector('img')?.getAttribute('alt')?.trim();
    media.push(alt && alt.toLowerCase() !== 'image' ? `[image: ${alt}]` : '[image]');
  }
  for (const video of Array.from(
    root.querySelectorAll('[data-testid="videoPlayer"], [data-testid="videoComponent"]')
  )) {
    if (!outside(video)) continue;
    media.push('[video]');
  }

  return { displayName, handle, timestamp, statusId, text, media, counts: {} };
}

/**
 * Engagement counts from the action buttons' aria-labels (e.g.
 * `aria-label="1,024 Likes. Like"`). Localized/absent labels simply yield
 * undefined — counts are decoration, never worth failing a capture over.
 */
function extractCounts(article: Element): XTweet['counts'] {
  const read = (testid: string): number | undefined => {
    const label = article
      .querySelector(`[data-testid="${testid}"]`)
      ?.getAttribute('aria-label');
    const m = label?.match(/^\s*([\d,]+)/);
    if (!m) return undefined;
    const n = Number.parseInt(m[1].replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    replies: read('reply'),
    reposts: read('retweet'),
    likes: read('like'),
  };
}

// ---------------------------------------------------------------------------
// tweetText → inline Markdown
// ---------------------------------------------------------------------------

/**
 * Convert a tweetText subtree to Markdown. X renders mentions / hashtags /
 * URLs as <a> (relative hrefs for mentions and hashtags) and emoji as
 * <img alt="😀"> — we linkify the former and substitute alt text for the
 * latter. Plain Turndown would mangle both, hence the hand-rolled walker.
 */
function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName;
  if (tag === 'IMG') return el.getAttribute('alt') ?? '';
  if (tag === 'BR') return '\n';
  const inner = Array.from(el.childNodes).map(inlineMarkdown).join('');
  if (tag === 'A') {
    const href = el.getAttribute('href');
    const text = inner.trim();
    if (!href || !text) return inner;
    let abs = href;
    try {
      abs = new URL(href, window.location.origin).toString();
    } catch {
      /* keep raw href */
    }
    return `[${text}](${abs})`;
  }
  return inner;
}

/** Like inlineMarkdown but without linkification (for author names). */
function inlineText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  if (el.tagName === 'IMG') return el.getAttribute('alt') ?? '';
  return Array.from(el.childNodes).map(inlineText).join('');
}

// ---------------------------------------------------------------------------
// Markdown render
// ---------------------------------------------------------------------------

function buildTitle(focal: XTweet): string {
  const who =
    focal.displayName && focal.handle
      ? `${focal.displayName} (@${focal.handle})`
      : focal.displayName || (focal.handle ? `@${focal.handle}` : '');
  const snippet = truncate(focal.text.replace(/\s+/g, ' ').trim(), 60);
  if (who && snippet) return `${who} on X: ${snippet}`;
  if (who) return `${who} on X`;
  return document.title || 'X thread';
}

function renderMarkdown(
  title: string,
  focal: XTweet,
  threadTweets: XTweet[],
  replies: XTweet[]
): string {
  const lines: string[] = [`# ${title}`, ''];

  lines.push(...renderTweetBlock(focal));

  if (threadTweets.length > 0) {
    lines.push(`## Thread (${threadTweets.length} more from @${focal.handle ?? '?'})`);
    lines.push('');
    threadTweets.forEach((t, i) => {
      lines.push(...renderTweetBlock(t, `${i + 1}. `));
    });
  }

  if (replies.length > 0) {
    const shown = replies.slice(0, MAX_REPLIES);
    lines.push(`## Replies (${shown.length} shown)`);
    lines.push('');
    for (const r of shown) {
      lines.push(...renderTweetBlock(r));
    }
    if (replies.length > MAX_REPLIES) {
      lines.push(
        `*Replies truncated at ${MAX_REPLIES} — open the thread on X for the rest.*`
      );
      lines.push('');
    }
  }

  if (threadLooksLonger()) {
    lines.push(
      '*Note: the thread appears to continue beyond what was rendered — X virtualizes long timelines, so only visible tweets are captured. Scroll to load more before capturing if you need the rest.*'
    );
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function renderTweetBlock(t: XTweet, prefix = ''): string[] {
  const lines: string[] = [];
  lines.push(`${prefix}${tweetHeader(t)}`);
  lines.push('');
  if (t.text) {
    lines.push(t.text);
    lines.push('');
  }
  for (const m of t.media) {
    lines.push(m);
  }
  if (t.media.length > 0) lines.push('');
  if (t.quote) {
    for (const q of renderQuote(t.quote)) lines.push(q);
    lines.push('');
  }
  const counts = countsLabel(t.counts);
  if (counts) {
    lines.push(`*${counts}*`);
    lines.push('');
  }
  return lines;
}

function renderQuote(q: XTweet): string[] {
  const out: string[] = [`> ${tweetHeader(q)}`, '>'];
  const body = [q.text, ...q.media].filter((s) => s.length > 0).join('\n');
  for (const line of body.split('\n')) {
    out.push(`> ${line}`.trimEnd());
  }
  return out;
}

function tweetHeader(t: XTweet): string {
  const name = t.displayName || t.handle || '[unknown]';
  const handle = t.handle ? ` (@${t.handle})` : '';
  const time = t.timestamp ? ` · ${t.timestamp}` : '';
  return `**${name}**${handle}${time}`;
}

function countsLabel(counts: XTweet['counts']): string {
  const bits: string[] = [];
  if (typeof counts.replies === 'number') bits.push(`replies: ${counts.replies}`);
  if (typeof counts.reposts === 'number') bits.push(`reposts: ${counts.reposts}`);
  if (typeof counts.likes === 'number') bits.push(`likes: ${counts.likes}`);
  return bits.join(' · ');
}

/**
 * Heuristic for "there is more than what we captured": X renders "Show more
 * replies" / "Show probable spam" / loaders as timeline cells WITHOUT a tweet
 * article inside them.
 */
function threadLooksLonger(): boolean {
  for (const cell of Array.from(
    document.querySelectorAll('[data-testid="cellInnerDiv"]')
  )) {
    if (cell.querySelector('article[data-testid="tweet"]')) continue;
    const text = cell.textContent?.trim() ?? '';
    if (/show\s+(more\s+)?(repl|additional)/i.test(text)) return true;
  }
  return false;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '') + '…';
}
