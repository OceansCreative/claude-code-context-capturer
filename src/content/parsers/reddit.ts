import type { CaptureOptions, CapturedContext } from '@/shared/types';

/**
 * Reddit post + comment-thread parser.
 *
 * Strategy: do NOT scrape the modern "shreddit" web-component DOM — it is
 * unstable and heavily shadow-DOM'd. Instead we hit Reddit's public JSON
 * endpoint: appending `.json?raw_json=1` to any post URL returns
 * `[postListing, commentListing]`. The fetch runs from the content script's
 * same-origin context, so the user's session cookies attach automatically
 * (`credentials: 'include'`) and private/quarantined subreddits the user can
 * see in the browser are also capturable.
 *
 * `raw_json=1` matters: without it Reddit HTML-escapes `<`, `>`, `&` inside
 * `selftext` / `body`. With it, those fields are clean Markdown already, so
 * we pass them through untouched — no Turndown needed.
 *
 * Comment tree: rendered as nested blockquotes (one `>` per depth level),
 * which survives multi-line Markdown comment bodies where list indentation
 * would not. Deleted/removed bodies are skipped (their live replies are kept,
 * promoted to the deleted parent's depth). `kind: "more"` stubs are ignored
 * but flagged, and a hard cap keeps 10k-comment megathreads sane.
 */

const POST_PATH_RE = /^\/r\/[^/]+\/comments\/[a-z0-9]+/i;
const REDDIT_HOSTS = new Set(['www.reddit.com', 'reddit.com', 'old.reddit.com']);

/** Hard cap on rendered comments so megathreads don't explode the capture. */
export const MAX_COMMENTS = 100;

const FETCH_TIMEOUT_MS = 15_000;

interface RedditPost {
  id: string;
  title: string;
  subreddit?: string;
  author?: string;
  score?: number;
  scoreHidden?: boolean;
  upvoteRatio?: number;
  flair?: string;
  selftext?: string;
  isSelf: boolean;
  externalUrl?: string;
  createdUtc?: number;
  numComments?: number;
}

interface RedditComment {
  author?: string;
  score?: number;
  scoreHidden?: boolean;
  body: string;
  replies: RedditComment[];
}

interface ParsedThread {
  post: RedditPost;
  comments: RedditComment[];
  /** True if the listing contained `kind: "more"` stubs (tree truncated server-side). */
  hasMoreStubs: boolean;
}

export function canHandleReddit(): boolean {
  return (
    REDDIT_HOSTS.has(window.location.hostname) &&
    POST_PATH_RE.test(window.location.pathname)
  );
}

export async function parseReddit(_options: CaptureOptions = {}): Promise<CapturedContext> {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();

  const jsonUrl = buildJsonUrl(window.location.origin, window.location.pathname);
  const raw = await fetchThreadJson(jsonUrl);

  const thread = shapeThread(raw);
  if (!thread) {
    throw new Error(
      'Reddit returned an unexpected JSON shape for this post. The page may still be loading, or Reddit changed its API — retry in a moment.'
    );
  }

  const body = renderMarkdown(thread);
  const { post } = thread;

  const tags = ['reddit'];
  if (post.subreddit) tags.push(`sub:${post.subreddit}`);

  return {
    url,
    title: post.title || document.title,
    body,
    capturedAt,
    parser: 'reddit',
    fromSelection: false,
    author: post.author ? `u/${post.author}` : undefined,
    publishedAt:
      typeof post.createdUtc === 'number'
        ? new Date(post.createdUtc * 1000).toISOString()
        : undefined,
    tags,
    // Re-capturing the same post updates the stored entry rather than
    // accumulating snapshots (same pattern as youtube / claude-ai).
    dedupeKey: `reddit:${post.id}`,
  };
}

// ---------------------------------------------------------------------------
// URL + fetch
// ---------------------------------------------------------------------------

/**
 * `/r/x/comments/abc123/title/` → `<origin>/r/x/comments/abc123/title.json?raw_json=1`.
 * Works identically on www.reddit.com and old.reddit.com.
 */
export function buildJsonUrl(origin: string, pathname: string): string {
  const path = pathname.replace(/\/+$/, '');
  return `${origin}${path}.json?raw_json=1`;
}

async function fetchThreadJson(jsonUrl: string): Promise<unknown> {
  // AbortController + setTimeout rather than AbortSignal.timeout(): the latter
  // isn't available in every runtime (notably the test environment).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(jsonUrl, { credentials: 'include', signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new Error(
        `Reddit fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s. Retry, or check your network.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    // Reddit rate-limits unauthenticated JSON reads aggressively.
    throw new Error(
      'Reddit rate-limited this request (HTTP 429). Wait a minute and retry the capture.'
    );
  }
  if (res.status === 403) {
    throw new Error(
      'Reddit refused access (HTTP 403) — the subreddit may be private or quarantined. Make sure you can view it while logged in, then retry.'
    );
  }
  if (!res.ok) {
    throw new Error(`Reddit fetch failed: ${res.status} ${res.statusText}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error('Reddit returned a non-JSON response. Retry in a moment.');
  }
}

// ---------------------------------------------------------------------------
// JSON shaping
// ---------------------------------------------------------------------------

/**
 * The endpoint returns `[postListing, commentListing]`:
 *   postListing.data.children[0] = { kind: 't3', data: {...post} }
 *   commentListing.data.children = [{ kind: 't1' | 'more', data: {...} }, ...]
 * A missing/empty comment listing is tolerated (post-only capture); a missing
 * post is not.
 */
export function shapeThread(raw: unknown): ParsedThread | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const postChildren = listingChildren(raw[0]);
  const postWrapper = postChildren.find((c) => c.kind === 't3');
  if (!postWrapper) return undefined;
  const post = shapePost(postWrapper.data);
  if (!post) return undefined;

  const state = { hasMoreStubs: false };
  const comments =
    raw.length > 1 ? shapeComments(listingChildren(raw[1]), state) : [];

  return { post, comments, hasMoreStubs: state.hasMoreStubs };
}

interface ListingChild {
  kind: string;
  data: Record<string, unknown>;
}

function listingChildren(listing: unknown): ListingChild[] {
  const data = (listing as Record<string, unknown> | null | undefined)?.data as
    | Record<string, unknown>
    | undefined;
  const children = data?.children;
  if (!Array.isArray(children)) return [];
  return children.filter(
    (c): c is ListingChild =>
      !!c &&
      typeof c === 'object' &&
      typeof (c as Record<string, unknown>).kind === 'string' &&
      typeof (c as Record<string, unknown>).data === 'object' &&
      (c as Record<string, unknown>).data !== null
  );
}

function shapePost(data: Record<string, unknown>): RedditPost | undefined {
  const id = typeof data.id === 'string' ? data.id : undefined;
  const title = typeof data.title === 'string' ? data.title : undefined;
  if (!id || !title) return undefined;

  const isSelf = data.is_self === true;
  return {
    id,
    title,
    subreddit: str(data.subreddit),
    author: str(data.author),
    score: num(data.score),
    scoreHidden: data.hide_score === true,
    upvoteRatio: num(data.upvote_ratio),
    flair: str(data.link_flair_text),
    selftext: str(data.selftext),
    isSelf,
    // For link posts `url` points at the external target; for self posts it
    // points back at the permalink, which we don't want to repeat.
    externalUrl: !isSelf ? str(data.url) : undefined,
    createdUtc: num(data.created_utc),
    numComments: num(data.num_comments),
  };
}

function shapeComments(
  children: ListingChild[],
  state: { hasMoreStubs: boolean }
): RedditComment[] {
  const out: RedditComment[] = [];
  for (const child of children) {
    if (child.kind === 'more') {
      // "load more comments" stub — the JSON endpoint doesn't inline these.
      // Note the truncation instead of chasing paginated morechildren calls.
      state.hasMoreStubs = true;
      continue;
    }
    if (child.kind !== 't1') continue;
    const body = str(child.data.body) ?? '';
    // `replies` is `""` (empty string) when a comment has none — one of
    // Reddit's charming API quirks — and a full Listing object otherwise.
    const replies =
      child.data.replies && typeof child.data.replies === 'object'
        ? shapeComments(listingChildren(child.data.replies), state)
        : [];
    out.push({
      author: str(child.data.author),
      score: num(child.data.score),
      scoreHidden: child.data.score_hidden === true,
      body,
      replies,
    });
  }
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// ---------------------------------------------------------------------------
// Markdown render
// ---------------------------------------------------------------------------

function isDeleted(body: string): boolean {
  const t = body.trim();
  return t === '[deleted]' || t === '[removed]';
}

export function renderMarkdown(thread: ParsedThread): string {
  const { post } = thread;
  const lines: string[] = [];

  lines.push(`# ${post.title}`);
  lines.push('');

  const metaBits: string[] = [];
  if (post.subreddit) metaBits.push(`*r/${post.subreddit}*`);
  if (post.author) metaBits.push(`*by u/${post.author}*`);
  metaBits.push(`*${scoreLabel(post.score, post.scoreHidden, post.upvoteRatio)}*`);
  if (post.flair) metaBits.push(`*flair: ${post.flair}*`);
  lines.push(metaBits.join('  ·  '));
  lines.push('');

  if (post.isSelf) {
    const text = (post.selftext ?? '').trim();
    if (text.length > 0 && !isDeleted(text)) {
      // raw_json=1 means selftext is already clean Markdown — pass through.
      lines.push(text);
      lines.push('');
    }
  } else if (post.externalUrl) {
    lines.push(`**Link post:** <${post.externalUrl}>`);
    lines.push('');
  }

  const counter = { rendered: 0, capped: false };
  const commentLines: string[] = [];
  renderComments(thread.comments, 0, counter, commentLines);

  if (commentLines.length > 0) {
    const total =
      typeof post.numComments === 'number' ? ` (${counter.rendered} of ${post.numComments})` : '';
    lines.push(`## Comments${total}`);
    lines.push('');
    lines.push(...commentLines);
  } else {
    lines.push('## Comments');
    lines.push('');
    lines.push('*(no comments captured)*');
    lines.push('');
  }

  if (counter.capped || thread.hasMoreStubs) {
    lines.push(
      `*Comment tree truncated${counter.capped ? ` at ${MAX_COMMENTS} comments` : ''} — open the thread on Reddit for the rest.*`
    );
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function renderComments(
  comments: RedditComment[],
  depth: number,
  counter: { rendered: number; capped: boolean },
  out: string[]
): void {
  for (const comment of comments) {
    if (counter.rendered >= MAX_COMMENTS) {
      counter.capped = true;
      return;
    }
    if (isDeleted(comment.body)) {
      // Skip the tombstone but keep its live replies, promoted to this depth
      // so the surviving sub-thread stays readable.
      renderComments(comment.replies, depth, counter, out);
      continue;
    }
    counter.rendered++;
    const quote = '>'.repeat(depth + 1) + ' ';
    const header = `**u/${comment.author ?? '[unknown]'}** · ${scoreLabel(comment.score, comment.scoreHidden)}`;
    out.push(quote + header);
    out.push(quote.trimEnd());
    for (const line of comment.body.split('\n')) {
      out.push((quote + line).trimEnd());
    }
    out.push('');
    renderComments(comment.replies, depth + 1, counter, out);
  }
}

function scoreLabel(score?: number, hidden?: boolean, upvoteRatio?: number): string {
  if (hidden || typeof score !== 'number') return 'score hidden';
  const pts = `${score} point${score === 1 ? '' : 's'}`;
  if (typeof upvoteRatio === 'number') {
    return `${pts} (${Math.round(upvoteRatio * 100)}% upvoted)`;
  }
  return pts;
}
