import { describe, it, expect, beforeEach } from 'vitest';
import { canHandleX, parseX, MAX_REPLIES } from '@/content/parsers/x';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
  });
}

interface TweetFixture {
  name: string;
  handle: string;
  statusId: string;
  datetime?: string;
  /** Inner HTML of the tweetText div. */
  textHtml?: string;
  mediaHtml?: string;
  quote?: { name: string; handle: string; datetime?: string; textHtml: string };
  promoted?: boolean;
  counts?: { replies?: string; reposts?: string; likes?: string };
}

/** One timeline cell mirroring X's data-testid structure. */
function tweetCell(t: TweetFixture): string {
  const quoteHtml = t.quote
    ? `
      <div role="link" tabindex="0">
        <div data-testid="User-Name">
          <a href="/${t.quote.handle}" role="link"><span>${t.quote.name}</span></a>
          <a href="/${t.quote.handle}" role="link"><span>@${t.quote.handle}</span></a>
        </div>
        ${t.quote.datetime ? `<time datetime="${t.quote.datetime}">Jun 30</time>` : ''}
        <div data-testid="tweetText">${t.quote.textHtml}</div>
      </div>`
    : '';
  const countsHtml = t.counts
    ? `
      <div role="group">
        ${t.counts.replies ? `<button data-testid="reply" aria-label="${t.counts.replies} Replies. Reply"></button>` : ''}
        ${t.counts.reposts ? `<button data-testid="retweet" aria-label="${t.counts.reposts} reposts. Repost"></button>` : ''}
        ${t.counts.likes ? `<button data-testid="like" aria-label="${t.counts.likes} Likes. Like"></button>` : ''}
      </div>`
    : '';
  const inner = `
    <article data-testid="tweet" tabindex="-1">
      ${t.promoted ? '<div data-testid="placementTracking">' : ''}
      <div data-testid="User-Name">
        <a href="/${t.handle}" role="link"><span>${t.name}</span></a>
        <a href="/${t.handle}" role="link"><span>@${t.handle}</span></a>
      </div>
      <a href="/${t.handle}/status/${t.statusId}" role="link">
        <time datetime="${t.datetime ?? '2026-07-01T10:00:00.000Z'}">Jul 1</time>
      </a>
      ${t.textHtml !== undefined ? `<div data-testid="tweetText">${t.textHtml}</div>` : ''}
      ${t.mediaHtml ?? ''}
      ${quoteHtml}
      ${countsHtml}
      ${t.promoted ? '</div>' : ''}
    </article>`;
  return `<div data-testid="cellInnerDiv">${inner}</div>`;
}

const FOCAL_URL = 'https://x.com/alice/status/1234567890123456789';

describe('X parser', () => {
  describe('canHandleX', () => {
    it('accepts x.com status URLs', () => {
      setLocation('https://x.com/alice/status/12345');
      expect(canHandleX()).toBe(true);
    });

    it('accepts twitter.com and mobile.twitter.com status URLs', () => {
      setLocation('https://twitter.com/alice/status/12345');
      expect(canHandleX()).toBe(true);
      setLocation('https://mobile.twitter.com/alice/status/12345');
      expect(canHandleX()).toBe(true);
    });

    it('accepts /i/web/status/ URLs', () => {
      setLocation('https://x.com/i/web/status/12345');
      expect(canHandleX()).toBe(true);
    });

    it('rejects profile / timeline pages', () => {
      setLocation('https://x.com/alice');
      expect(canHandleX()).toBe(false);
      setLocation('https://x.com/home');
      expect(canHandleX()).toBe(false);
      setLocation('https://x.com/alice/status/not-a-number');
      expect(canHandleX()).toBe(false);
    });

    it('rejects other hosts', () => {
      setLocation('https://example.com/alice/status/12345');
      expect(canHandleX()).toBe(false);
    });
  });

  describe('parseX', () => {
    beforeEach(() => {
      setLocation(FOCAL_URL);
      document.title = 'Alice on X';
      document.body.innerHTML = '';
    });

    it('throws a friendly error when no tweet article is rendered (login wall)', () => {
      document.body.innerHTML = '<div>Sign in to X</div>';
      expect(() => parseX()).toThrow(/logged in/i);
    });

    it('captures a single tweet with metadata, counts, and dedupeKey', () => {
      document.body.innerHTML = tweetCell({
        name: 'Alice Dev',
        handle: 'alice',
        statusId: '1234567890123456789',
        datetime: '2026-07-01T10:00:00.000Z',
        textHtml: '<span>Shipping the new parser today.</span>',
        counts: { replies: '12', reposts: '3', likes: '1,024' },
      });

      const ctx = parseX();
      expect(ctx.parser).toBe('x');
      expect(ctx.url).toBe(FOCAL_URL);
      expect(ctx.title).toContain('Alice Dev (@alice) on X');
      expect(ctx.author).toBe('@alice');
      expect(ctx.publishedAt).toBe('2026-07-01T10:00:00.000Z');
      expect(ctx.tags).toEqual(['x', 'author:alice']);
      expect(ctx.dedupeKey).toBe('x:1234567890123456789');
      expect(ctx.fromSelection).toBe(false);
      expect(ctx.body).toContain('**Alice Dev** (@alice) · 2026-07-01T10:00:00.000Z');
      expect(ctx.body).toContain('Shipping the new parser today.');
      expect(ctx.body).toContain('*replies: 12 · reposts: 3 · likes: 1024*');
      // Single tweet → no thread / replies sections.
      expect(ctx.body).not.toContain('## Thread');
      expect(ctx.body).not.toContain('## Replies');
    });

    it('converts mentions, hashtags, and links to Markdown links', () => {
      document.body.innerHTML = tweetCell({
        name: 'Alice Dev',
        handle: 'alice',
        statusId: '1234567890123456789',
        textHtml:
          'Ping <a href="/bob">@bob</a> about ' +
          '<a href="/hashtag/ClaudeCode?src=hashtag_click">#ClaudeCode</a> — see ' +
          '<a href="https://t.co/abc123"><span>example.com/post</span></a>',
      });

      const ctx = parseX();
      expect(ctx.body).toContain('[@bob](https://x.com/bob)');
      expect(ctx.body).toContain('[#ClaudeCode](https://x.com/hashtag/ClaudeCode?src=hashtag_click)');
      expect(ctx.body).toContain('[example.com/post](https://t.co/abc123)');
    });

    it('substitutes emoji <img alt> in tweet text and display names', () => {
      document.body.innerHTML = tweetCell({
        name: 'Alice <img alt="🚀" src="emoji.svg">',
        handle: 'alice',
        statusId: '1234567890123456789',
        textHtml: 'Launch day <img alt="🎉" src="emoji.svg"><span>!</span>',
      });

      const ctx = parseX();
      expect(ctx.body).toContain('Launch day 🎉!');
      expect(ctx.body).toContain('**Alice 🚀** (@alice)');
    });

    it('renders media placeholders with alt text', () => {
      document.body.innerHTML = tweetCell({
        name: 'Alice Dev',
        handle: 'alice',
        statusId: '1234567890123456789',
        textHtml: 'Architecture diagram below.',
        mediaHtml:
          '<div data-testid="tweetPhoto"><img alt="diagram of the capture pipeline" src="pic.jpg"></div>' +
          '<div data-testid="videoComponent"></div>',
      });

      const ctx = parseX();
      expect(ctx.body).toContain('[image: diagram of the capture pipeline]');
      expect(ctx.body).toContain('[video]');
    });

    it('renders same-author continuation tweets as a numbered Thread section', () => {
      document.body.innerHTML =
        tweetCell({
          name: 'Alice Dev',
          handle: 'alice',
          statusId: '1234567890123456789',
          textHtml: 'Thread on parser design. 1/3',
        }) +
        tweetCell({
          name: 'Alice Dev',
          handle: 'alice',
          statusId: '1234567890123456790',
          datetime: '2026-07-01T10:05:00.000Z',
          textHtml: 'Anchor on data-testid, never class names. 2/3',
        }) +
        tweetCell({
          name: 'Alice Dev',
          handle: 'alice',
          statusId: '1234567890123456791',
          datetime: '2026-07-01T10:10:00.000Z',
          textHtml: 'Ship it. 3/3',
        });

      const ctx = parseX();
      expect(ctx.body).toContain('Thread on parser design. 1/3');
      expect(ctx.body).toContain('## Thread (2 more from @alice)');
      expect(ctx.body).toContain('1. **Alice Dev** (@alice) · 2026-07-01T10:05:00.000Z');
      expect(ctx.body).toContain('2. **Alice Dev** (@alice) · 2026-07-01T10:10:00.000Z');
      expect(ctx.body).not.toContain('## Replies');
    });

    it('finds the focal tweet by status id even when it is not first in the DOM', () => {
      // Opened mid-thread: an earlier same-author tweet renders above focal.
      document.body.innerHTML =
        tweetCell({
          name: 'Alice Dev',
          handle: 'alice',
          statusId: '1111',
          textHtml: 'Earlier tweet in the thread.',
        }) +
        tweetCell({
          name: 'Alice Dev',
          handle: 'alice',
          statusId: '1234567890123456789',
          datetime: '2026-07-01T11:00:00.000Z',
          textHtml: 'The focal tweet.',
        });

      const ctx = parseX();
      expect(ctx.publishedAt).toBe('2026-07-01T11:00:00.000Z');
      expect(ctx.title).toContain('The focal tweet.');
      expect(ctx.body).toContain('Earlier tweet in the thread.');
    });

    it('renders other-author tweets under a flat Replies section', () => {
      document.body.innerHTML =
        tweetCell({
          name: 'Alice Dev',
          handle: 'alice',
          statusId: '1234567890123456789',
          textHtml: 'Original post.',
        }) +
        tweetCell({
          name: 'Bob',
          handle: 'bob',
          statusId: '2222',
          textHtml: 'Great write-up!',
        }) +
        tweetCell({
          name: 'Carol',
          handle: 'carol',
          statusId: '3333',
          textHtml: 'Bookmarking this.',
        });

      const ctx = parseX();
      expect(ctx.body).toContain('## Replies (2 shown)');
      expect(ctx.body).toContain('**Bob** (@bob)');
      expect(ctx.body).toContain('Great write-up!');
      expect(ctx.body).toContain('**Carol** (@carol)');
      expect(ctx.body).not.toContain('truncated');
    });

    it(`caps replies at ${MAX_REPLIES} with a truncation note`, () => {
      let html = tweetCell({
        name: 'Alice Dev',
        handle: 'alice',
        statusId: '1234567890123456789',
        textHtml: 'Original post.',
      });
      for (let i = 0; i < MAX_REPLIES + 5; i++) {
        html += tweetCell({
          name: `Replier ${i}`,
          handle: `replier${i}`,
          statusId: `${10000 + i}`,
          textHtml: `Reply number ${i}`,
        });
      }
      document.body.innerHTML = html;

      const ctx = parseX();
      expect(ctx.body).toContain(`## Replies (${MAX_REPLIES} shown)`);
      expect(ctx.body).toContain(`Reply number ${MAX_REPLIES - 1}`);
      expect(ctx.body).not.toContain(`Reply number ${MAX_REPLIES}`);
      expect(ctx.body).toContain(`*Replies truncated at ${MAX_REPLIES}`);
    });

    it('renders a quoted tweet as a blockquote inside the quoting tweet', () => {
      document.body.innerHTML = tweetCell({
        name: 'Alice Dev',
        handle: 'alice',
        statusId: '1234567890123456789',
        textHtml: 'This is exactly right:',
        quote: {
          name: 'Dan',
          handle: 'dan',
          datetime: '2026-06-30T09:00:00.000Z',
          textHtml: 'Parsers should anchor on semantics, not styling.',
        },
      });

      const ctx = parseX();
      expect(ctx.body).toContain('This is exactly right:');
      expect(ctx.body).toContain('> **Dan** (@dan) · 2026-06-30T09:00:00.000Z');
      expect(ctx.body).toContain('> Parsers should anchor on semantics, not styling.');
      // The quoted author must NOT leak into the outer tweet's header.
      expect(ctx.author).toBe('@alice');
      expect(ctx.body).not.toContain('## Replies');
    });

    it('skips promoted tweets', () => {
      document.body.innerHTML =
        tweetCell({
          name: 'Alice Dev',
          handle: 'alice',
          statusId: '1234567890123456789',
          textHtml: 'Original post.',
        }) +
        tweetCell({
          name: 'BuyStuff Inc',
          handle: 'buystuff',
          statusId: '9999',
          textHtml: 'Amazing product, buy now!',
          promoted: true,
        });

      const ctx = parseX();
      expect(ctx.body).not.toContain('Amazing product');
      expect(ctx.body).not.toContain('@buystuff');
    });

    it('notes when the thread appears longer than what is rendered', () => {
      document.body.innerHTML =
        tweetCell({
          name: 'Alice Dev',
          handle: 'alice',
          statusId: '1234567890123456789',
          textHtml: 'Original post.',
        }) +
        '<div data-testid="cellInnerDiv"><button><span>Show more replies</span></button></div>';

      const ctx = parseX();
      expect(ctx.body).toContain('appears to continue beyond what was rendered');
    });

    it('falls back to the first rendered tweet when the focal status id is not found', () => {
      // Virtualization unmounted the focal tweet; capture what's there.
      document.body.innerHTML = tweetCell({
        name: 'Alice Dev',
        handle: 'alice',
        statusId: '5555',
        textHtml: 'Some visible tweet.',
      });

      const ctx = parseX();
      expect(ctx.title).toContain('Some visible tweet.');
      // dedupeKey still keys off the URL's status id.
      expect(ctx.dedupeKey).toBe('x:1234567890123456789');
    });
  });
});
