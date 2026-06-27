import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canHandleYoutube,
  parseYoutube,
  extractVideoId,
  pickCaptionTrack,
  renderMarkdown,
  readPlayerResponse,
} from '@/content/parsers/youtube';

const VID = 'dQw4w9WgXcQ';

function setLocation(url: string) {
  const u = new URL(url);
  Object.defineProperty(window, 'location', {
    value: {
      href: u.href,
      hostname: u.hostname,
      pathname: u.pathname,
      search: u.search,
    },
    writable: true,
  });
}

/** Stash a fake `ytInitialPlayerResponse` blob into a <script> tag like YouTube does. */
function injectPlayerResponse(payload: Record<string, unknown>) {
  const tag = document.createElement('script');
  tag.textContent =
    'var ytInitialPlayerResponse = ' + JSON.stringify(payload) + ';';
  document.body.appendChild(tag);
}

const MIN_PAYLOAD = {
  videoDetails: {
    title: 'Hello World',
    author: 'Test Channel',
    shortDescription: 'A test video for the parser.',
    lengthSeconds: '125',
  },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: 'https://youtube.com/api/timedtext?lang=en&v=' + VID,
          languageCode: 'en',
          name: { simpleText: 'English' },
        },
      ],
    },
  },
};

const PAYLOAD_WITH_CHAPTERS = {
  ...MIN_PAYLOAD,
  playerOverlays: {
    playerOverlayRenderer: {
      decoratedPlayerBarRenderer: {
        decoratedPlayerBarRenderer: {
          playerBar: {
            multiMarkersPlayerBarRenderer: {
              markersMap: [
                {
                  value: {
                    chapters: [
                      {
                        chapterRenderer: {
                          title: { simpleText: 'Intro' },
                          timeRangeStartMillis: 0,
                        },
                      },
                      {
                        chapterRenderer: {
                          title: { simpleText: 'Main Topic' },
                          timeRangeStartMillis: 30_000,
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    },
  },
};

describe('extractVideoId', () => {
  it('extracts from a /watch?v= URL', () => {
    expect(extractVideoId(`https://www.youtube.com/watch?v=${VID}`)).toBe(VID);
  });

  it('extracts from a /shorts/ URL', () => {
    expect(extractVideoId(`https://www.youtube.com/shorts/${VID}`)).toBe(VID);
  });

  it('extracts from a youtu.be URL', () => {
    expect(extractVideoId(`https://youtu.be/${VID}`)).toBe(VID);
  });

  it('extracts from an /embed/ URL', () => {
    expect(extractVideoId(`https://www.youtube.com/embed/${VID}`)).toBe(VID);
  });

  it('returns undefined when there is no recognisable id', () => {
    expect(extractVideoId('https://www.youtube.com/feed/subscriptions')).toBeUndefined();
    expect(extractVideoId('https://example.com/')).toBeUndefined();
  });

  it('rejects malformed video ids', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=too@short')).toBeUndefined();
    expect(extractVideoId('https://www.youtube.com/watch?v=a')).toBeUndefined();
  });
});

describe('canHandleYoutube', () => {
  it('returns true on a youtube watch URL', () => {
    setLocation(`https://www.youtube.com/watch?v=${VID}`);
    expect(canHandleYoutube()).toBe(true);
  });

  it('returns false on a non-youtube host', () => {
    setLocation('https://example.com/watch?v=foo');
    expect(canHandleYoutube()).toBe(false);
  });

  it('returns false on a youtube homepage with no video id', () => {
    setLocation('https://www.youtube.com/');
    expect(canHandleYoutube()).toBe(false);
  });
});

describe('pickCaptionTrack', () => {
  const enManual = { baseUrl: 'X', languageCode: 'en', vssId: '.en' };
  const enAuto = { baseUrl: 'Y', languageCode: 'en', vssId: 'a.en', kind: 'asr' };
  const ja = { baseUrl: 'Z', languageCode: 'ja' };

  it('prefers manual English over auto-English', () => {
    expect(pickCaptionTrack([enAuto, enManual])).toBe(enManual);
  });

  it('falls back to auto-English when manual missing', () => {
    expect(pickCaptionTrack([ja, enAuto])).toBe(enAuto);
  });

  it('returns the first track when no English exists', () => {
    expect(pickCaptionTrack([ja])).toBe(ja);
  });
});

describe('readPlayerResponse', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts title / author / caption tracks from an injected script', () => {
    injectPlayerResponse(MIN_PAYLOAD);
    const meta = readPlayerResponse(VID);
    expect(meta?.title).toBe('Hello World');
    expect(meta?.author).toBe('Test Channel');
    expect(meta?.captionTracks).toHaveLength(1);
    expect(meta?.lengthSeconds).toBe(125);
  });

  it('walks the deeply-nested chapters path', () => {
    injectPlayerResponse(PAYLOAD_WITH_CHAPTERS);
    const meta = readPlayerResponse(VID);
    expect(meta?.chapters).toHaveLength(2);
    expect(meta?.chapters[0]).toEqual({ title: 'Intro', startSeconds: 0 });
    expect(meta?.chapters[1]).toEqual({ title: 'Main Topic', startSeconds: 30 });
  });

  it('returns undefined when no player response is on the page', () => {
    expect(readPlayerResponse(VID)).toBeUndefined();
  });
});

describe('renderMarkdown', () => {
  const meta = {
    videoId: VID,
    title: 'Hello World',
    author: 'Test Channel',
    description: 'Short desc.',
    lengthSeconds: 125,
    chapters: [],
    captionTracks: [],
  };
  const segments = [
    { startMs: 0, text: 'Hi there' },
    { startMs: 5_000, text: 'welcome' },
    { startMs: 65_000, text: 'and a minute later' },
  ];

  it('emits a top-level heading, meta line, description, and dialogue lines', () => {
    const md = renderMarkdown(meta, segments, { baseUrl: '', kind: undefined, languageCode: 'en' });
    expect(md).toContain('# Hello World');
    expect(md).toContain('Test Channel');
    expect(md).toContain('length: 02:05');
    expect(md).toContain('Short desc.');
    expect(md).toContain('`[00:00]` Hi there');
    expect(md).toContain('`[01:05]` and a minute later');
  });

  it('groups segments under chapter sub-headings when chapters exist', () => {
    const withChapters = {
      ...meta,
      chapters: [
        { title: 'Intro', startSeconds: 0 },
        { title: 'Body', startSeconds: 60 },
      ],
    };
    const md = renderMarkdown(withChapters, segments, { baseUrl: '', languageCode: 'en' });
    expect(md).toContain('### [00:00] Intro');
    expect(md).toContain('### [01:00] Body');
    // The 65s segment must land under "Body", not under "Intro".
    const bodyIdx = md.indexOf('### [01:00] Body');
    const lateSegIdx = md.indexOf('and a minute later');
    expect(lateSegIdx).toBeGreaterThan(bodyIdx);
  });

  it('marks auto-generated captions in the meta line', () => {
    const md = renderMarkdown(meta, segments, { baseUrl: '', kind: 'asr', languageCode: 'en' });
    expect(md).toContain('captions: auto-generated');
  });
});

describe('parseYoutube (integration)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = '';
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setLocation(`https://www.youtube.com/watch?v=${VID}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('end-to-end renders a Markdown capture for a minimal payload', async () => {
    injectPlayerResponse(MIN_PAYLOAD);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        events: [
          { tStartMs: 0, segs: [{ utf8: 'Hello, ' }, { utf8: 'world.' }] },
          { tStartMs: 2_000, segs: [{ utf8: 'Welcome to the show.' }] },
        ],
      }),
    });

    const ctx = await parseYoutube();
    expect(ctx.parser).toBe('youtube');
    expect(ctx.title).toBe('Hello World');
    expect(ctx.author).toBe('Test Channel');
    expect(ctx.dedupeKey).toBe(`youtube:${VID}`);
    expect(ctx.tags).toContain('youtube');
    expect(ctx.tags).toContain('channel:Test Channel');
    expect(ctx.tags).toContain('lang:en');
    expect(ctx.body).toContain('# Hello World');
    expect(ctx.body).toContain('`[00:00]` Hello, world.');
    expect(ctx.body).toContain('`[00:02]` Welcome to the show.');
  });

  it('throws a friendly error when the video has no captions', async () => {
    injectPlayerResponse({
      ...MIN_PAYLOAD,
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
    });
    await expect(parseYoutube()).rejects.toThrow(/no captions/i);
  });

  it('throws when the player response is missing entirely', async () => {
    await expect(parseYoutube()).rejects.toThrow(/player data/i);
  });

  it('throws with status info when the transcript fetch fails', async () => {
    injectPlayerResponse(MIN_PAYLOAD);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    });
    await expect(parseYoutube()).rejects.toThrow(/429/);
  });

  it('throws a clear error when the transcript fetch times out', async () => {
    injectPlayerResponse(MIN_PAYLOAD);
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    await expect(parseYoutube()).rejects.toThrow(/timed out/i);
  });

  it('end-to-end slots the transcript under chapter sub-headings', async () => {
    injectPlayerResponse(PAYLOAD_WITH_CHAPTERS);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        events: [
          { tStartMs: 0, segs: [{ utf8: 'intro line' }] },
          { tStartMs: 40_000, segs: [{ utf8: 'main line' }] },
        ],
      }),
    });

    const ctx = await parseYoutube();
    const introIdx = ctx.body.indexOf('### [00:00] Intro');
    const mainIdx = ctx.body.indexOf('### [00:30] Main Topic');
    expect(introIdx).toBeGreaterThanOrEqual(0);
    expect(mainIdx).toBeGreaterThan(introIdx);
    // The 40s line must land under "Main Topic", not "Intro".
    expect(ctx.body.indexOf('main line')).toBeGreaterThan(mainIdx);
  });

  it('selects auto-generated English through the full path when no manual track exists', async () => {
    injectPlayerResponse({
      ...MIN_PAYLOAD,
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: `https://youtube.com/api/timedtext?lang=ja&v=${VID}`,
              languageCode: 'ja',
              name: { simpleText: 'Japanese' },
            },
            {
              baseUrl: `https://youtube.com/api/timedtext?lang=en&v=${VID}`,
              languageCode: 'en',
              vssId: 'a.en',
              kind: 'asr',
              name: { simpleText: 'English (auto-generated)' },
            },
          ],
        },
      },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ events: [{ tStartMs: 0, segs: [{ utf8: 'hi' }] }] }),
    });

    const ctx = await parseYoutube();
    expect(ctx.tags).toContain('captions:auto');
    expect(ctx.tags).toContain('lang:en');
    expect(ctx.body).toContain('captions: auto-generated');
    // It must fetch the English auto track, not the Japanese one.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('lang=en'),
      expect.anything()
    );
  });
});
