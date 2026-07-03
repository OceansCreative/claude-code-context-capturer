import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canHandleReddit,
  parseReddit,
  buildJsonUrl,
  shapeThread,
  renderMarkdown,
  MAX_COMMENTS,
} from '@/content/parsers/reddit';

const POST_URL = 'https://www.reddit.com/r/ClaudeAI/comments/abc123/great_post/';

function setLocation(url: string) {
  const u = new URL(url);
  Object.defineProperty(window, 'location', {
    value: {
      href: u.href,
      origin: u.origin,
      hostname: u.hostname,
      pathname: u.pathname,
      search: u.search,
    },
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Fixture builders — mirror the `[postListing, commentListing]` JSON shape
// returned by `<post-url>.json?raw_json=1`.
// ---------------------------------------------------------------------------

function postListing(data: Record<string, unknown>) {
  return { kind: 'Listing', data: { children: [{ kind: 't3', data }] } };
}

function commentListing(children: unknown[]) {
  return { kind: 'Listing', data: { children } };
}

function comment(
  data: Record<string, unknown>,
  replies: unknown[] = []
): Record<string, unknown> {
  return {
    kind: 't1',
    data: {
      ...data,
      // Reddit sends `""` when a comment has no replies, a Listing otherwise.
      replies: replies.length > 0 ? commentListing(replies) : '',
    },
  };
}

const SELF_POST = {
  id: 'abc123',
  title: 'How I feed Reddit threads to Claude',
  subreddit: 'ClaudeAI',
  author: 'capturer_fan',
  score: 321,
  upvote_ratio: 0.94,
  link_flair_text: 'Workflow',
  is_self: true,
  selftext: 'Here is my **workflow**:\n\n1. Capture\n2. Paste',
  url: 'https://www.reddit.com/r/ClaudeAI/comments/abc123/great_post/',
  created_utc: 1_750_000_000,
  num_comments: 3,
};

const LINK_POST = {
  id: 'def456',
  title: 'Anthropic ships something new',
  subreddit: 'programming',
  author: 'linker',
  score: 12,
  is_self: false,
  selftext: '',
  url: 'https://www.anthropic.com/news/something',
  created_utc: 1_750_000_000,
  num_comments: 0,
};

function mockFetchJson(fetchMock: ReturnType<typeof vi.fn>, payload: unknown) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
  });
}

// ---------------------------------------------------------------------------

describe('canHandleReddit', () => {
  it('accepts www.reddit.com post URLs', () => {
    setLocation(POST_URL);
    expect(canHandleReddit()).toBe(true);
  });

  it('accepts old.reddit.com post URLs', () => {
    setLocation('https://old.reddit.com/r/ClaudeAI/comments/abc123/great_post/');
    expect(canHandleReddit()).toBe(true);
  });

  it('accepts bare reddit.com post URLs', () => {
    setLocation('https://reddit.com/r/ClaudeAI/comments/abc123');
    expect(canHandleReddit()).toBe(true);
  });

  it('rejects reddit listing / non-post pages', () => {
    setLocation('https://www.reddit.com/r/ClaudeAI/');
    expect(canHandleReddit()).toBe(false);
    setLocation('https://www.reddit.com/user/foo/comments/');
    expect(canHandleReddit()).toBe(false);
  });

  it('rejects non-reddit hosts even with a matching path', () => {
    setLocation('https://example.com/r/ClaudeAI/comments/abc123/');
    expect(canHandleReddit()).toBe(false);
  });
});

describe('buildJsonUrl', () => {
  it('appends .json?raw_json=1 and strips the trailing slash', () => {
    expect(buildJsonUrl('https://www.reddit.com', '/r/x/comments/abc123/title/')).toBe(
      'https://www.reddit.com/r/x/comments/abc123/title.json?raw_json=1'
    );
  });

  it('works without a trailing slash or title slug', () => {
    expect(buildJsonUrl('https://old.reddit.com', '/r/x/comments/abc123')).toBe(
      'https://old.reddit.com/r/x/comments/abc123.json?raw_json=1'
    );
  });
});

describe('shapeThread', () => {
  it('returns undefined for non-array or empty payloads', () => {
    expect(shapeThread({ kind: 'Listing' })).toBeUndefined();
    expect(shapeThread([])).toBeUndefined();
    expect(shapeThread(null)).toBeUndefined();
  });

  it('returns undefined when the post listing has no t3 child', () => {
    expect(shapeThread([commentListing([]), commentListing([])])).toBeUndefined();
  });

  it('tolerates a missing comment listing (post-only payload)', () => {
    const thread = shapeThread([postListing(SELF_POST)]);
    expect(thread?.post.id).toBe('abc123');
    expect(thread?.comments).toEqual([]);
    expect(thread?.hasMoreStubs).toBe(false);
  });

  it('flags `more` stubs without throwing', () => {
    const thread = shapeThread([
      postListing(SELF_POST),
      commentListing([
        comment({ author: 'a', score: 1, body: 'hi' }),
        { kind: 'more', data: { count: 57, children: ['x1', 'x2'] } },
      ]),
    ]);
    expect(thread?.comments).toHaveLength(1);
    expect(thread?.hasMoreStubs).toBe(true);
  });
});

describe('renderMarkdown', () => {
  it('nests replies as deepening blockquotes', () => {
    const thread = shapeThread([
      postListing(SELF_POST),
      commentListing([
        comment({ author: 'parent_user', score: 10, body: 'top level' }, [
          comment({ author: 'child_user', score: 2, body: 'nested reply' }, [
            comment({ author: 'grandchild', score: 1, body: 'deeper still' }),
          ]),
        ]),
      ]),
    ]);
    const md = renderMarkdown(thread!);
    expect(md).toContain('> **u/parent_user** · 10 points');
    expect(md).toContain('> top level');
    expect(md).toContain('>> **u/child_user** · 2 points');
    expect(md).toContain('>> nested reply');
    expect(md).toContain('>>> **u/grandchild** · 1 point');
  });

  it('skips deleted/removed bodies but keeps their live replies', () => {
    const thread = shapeThread([
      postListing(SELF_POST),
      commentListing([
        comment({ author: '[deleted]', score: 0, body: '[deleted]' }, [
          comment({ author: 'survivor', score: 5, body: 'still here' }),
        ]),
        comment({ author: 'mod_removed', score: 0, body: '[removed]' }),
      ]),
    ]);
    const md = renderMarkdown(thread!);
    expect(md).not.toContain('[deleted]');
    expect(md).not.toContain('[removed]');
    // The surviving reply is promoted to its deleted parent's depth.
    expect(md).toContain('> **u/survivor** · 5 points');
    expect(md).toContain('> still here');
  });

  it('caps comments at MAX_COMMENTS and notes the truncation', () => {
    const many = Array.from({ length: MAX_COMMENTS + 20 }, (_, i) =>
      comment({ author: `u${i}`, score: 1, body: `comment ${i}` })
    );
    const thread = shapeThread([
      postListing({ ...SELF_POST, num_comments: MAX_COMMENTS + 20 }),
      commentListing(many),
    ]);
    const md = renderMarkdown(thread!);
    expect(md).toContain(`comment ${MAX_COMMENTS - 1}`);
    expect(md).not.toContain(`comment ${MAX_COMMENTS}\n`);
    expect(md).toContain(`truncated at ${MAX_COMMENTS} comments`);
    expect(md).toContain(`(${MAX_COMMENTS} of ${MAX_COMMENTS + 20})`);
  });

  it('shows "score hidden" instead of a number when score_hidden is set', () => {
    const thread = shapeThread([
      postListing(SELF_POST),
      commentListing([comment({ author: 'shy', score: 0, score_hidden: true, body: 'hi' })]),
    ]);
    expect(renderMarkdown(thread!)).toContain('**u/shy** · score hidden');
  });
});

describe('parseReddit (integration)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setLocation(POST_URL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures a selftext post with metadata, tags, and dedupe key', async () => {
    mockFetchJson(fetchMock, [
      postListing(SELF_POST),
      commentListing([comment({ author: 'replier', score: 7, body: 'Nice writeup' })]),
    ]);

    const ctx = await parseReddit();
    expect(ctx.parser).toBe('reddit');
    expect(ctx.title).toBe('How I feed Reddit threads to Claude');
    expect(ctx.author).toBe('u/capturer_fan');
    expect(ctx.tags).toEqual(['reddit', 'sub:ClaudeAI']);
    expect(ctx.dedupeKey).toBe('reddit:abc123');
    expect(ctx.publishedAt).toBe(new Date(1_750_000_000 * 1000).toISOString());
    expect(ctx.body).toContain('# How I feed Reddit threads to Claude');
    expect(ctx.body).toContain('*r/ClaudeAI*');
    expect(ctx.body).toContain('321 points (94% upvoted)');
    expect(ctx.body).toContain('flair: Workflow');
    // selftext passes through as raw Markdown.
    expect(ctx.body).toContain('Here is my **workflow**:');
    expect(ctx.body).toContain('> **u/replier** · 7 points');
    // The fetch must target the .json endpoint with cookies attached.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.reddit.com/r/ClaudeAI/comments/abc123/great_post.json?raw_json=1',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('renders the external URL for link posts instead of selftext', async () => {
    setLocation('https://www.reddit.com/r/programming/comments/def456/anthropic_ships/');
    mockFetchJson(fetchMock, [postListing(LINK_POST), commentListing([])]);

    const ctx = await parseReddit();
    expect(ctx.body).toContain('**Link post:** <https://www.anthropic.com/news/something>');
    expect(ctx.body).toContain('*(no comments captured)*');
    expect(ctx.dedupeKey).toBe('reddit:def456');
    expect(ctx.tags).toContain('sub:programming');
  });

  it('notes truncation when the listing contains `more` stubs', async () => {
    mockFetchJson(fetchMock, [
      postListing(SELF_POST),
      commentListing([
        comment({ author: 'a', score: 1, body: 'visible' }),
        { kind: 'more', data: { count: 400, children: [] } },
      ]),
    ]);

    const ctx = await parseReddit();
    expect(ctx.body).toContain('visible');
    expect(ctx.body).toContain('Comment tree truncated');
  });

  it('throws a rate-limit-specific error on HTTP 429', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests' });
    await expect(parseReddit()).rejects.toThrow(/rate.limited.*retry/i);
  });

  it('throws a private/quarantined hint on HTTP 403', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' });
    await expect(parseReddit()).rejects.toThrow(/private or quarantined/i);
  });

  it('throws status info on other HTTP failures', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
    await expect(parseReddit()).rejects.toThrow(/500/);
  });

  it('throws a clear error when the fetch times out', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    await expect(parseReddit()).rejects.toThrow(/timed out/i);
  });

  it('throws a friendly error on an unexpected JSON shape', async () => {
    mockFetchJson(fetchMock, { error: 404, message: 'Not Found' });
    await expect(parseReddit()).rejects.toThrow(/unexpected JSON shape/i);
  });

  it('throws a friendly error on a non-JSON response body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });
    await expect(parseReddit()).rejects.toThrow(/non-JSON/i);
  });
});
