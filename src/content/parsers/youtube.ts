import type { CaptureOptions, CapturedContext } from '@/shared/types';

/**
 * YouTube video parser.
 *
 * A lot of AI / dev content lives on YouTube (Anthropic talks, conference
 * recordings, tutorials) and nothing else in the Web→Markdown clipper space
 * captures transcripts directly into a project's CLAUDE.md. This fills that
 * gap.
 *
 * Strategy:
 *   1. Extract the video id from window.location (handles /watch?v=, /shorts/,
 *      and embed.youtube.com/embed/...; youtu.be URLs typically never reach
 *      a content script because the page redirects to youtube.com first).
 *   2. Find `ytInitialPlayerResponse` — YouTube embeds the entire player
 *      payload as a global on the page (and also in a <script> tag, accessible
 *      from the page's main world but not the isolated content-script world).
 *      We read the script tag's text directly since content scripts can't
 *      see page-world globals.
 *   3. Pull title / author / chapters / caption track list from that JSON.
 *   4. Fetch the first English (or first-available) caption track's baseUrl
 *      with `&fmt=json3` to get a structured transcript without XML parsing.
 *   5. Render Markdown: frontmatter + metadata + (optionally) chapter
 *      headings + dialogue lines with `mm:ss` timestamps.
 *
 * This is internal-API territory and YouTube changes shape often. We're
 * defensive: any missing field falls back gracefully and a clear error
 * surfaces if no captions are available rather than producing an empty body.
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,15}$/;

interface CaptionTrack {
  baseUrl: string;
  vssId?: string;
  languageCode?: string;
  name?: { simpleText?: string };
  kind?: string; // "asr" for auto-generated
}

interface Chapter {
  title: string;
  startSeconds: number;
}

interface YouTubeMeta {
  videoId: string;
  title: string;
  author?: string;
  description?: string;
  lengthSeconds?: number;
  chapters: Chapter[];
  captionTracks: CaptionTrack[];
}

interface TranscriptSegment {
  startMs: number;
  text: string;
}

export function canHandleYoutube(): boolean {
  const host = window.location.hostname;
  if (host !== 'www.youtube.com' && host !== 'youtube.com' && host !== 'm.youtube.com') {
    return false;
  }
  return !!extractVideoId(window.location.href);
}

export async function parseYoutube(_options: CaptureOptions = {}): Promise<CapturedContext> {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();

  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('Could not extract a YouTube video id from this URL.');
  }

  const meta = readPlayerResponse(videoId);
  if (!meta) {
    throw new Error(
      'Could not find YouTube player data on this page. Wait for the page to finish loading and retry.'
    );
  }

  if (meta.captionTracks.length === 0) {
    throw new Error(
      'This video has no captions / transcript available. YouTube only exposes captions when the creator enabled them (or auto-generated ones exist).'
    );
  }

  const track = pickCaptionTrack(meta.captionTracks);
  const segments = await fetchTranscript(track.baseUrl);

  const body = renderMarkdown(meta, segments, track);
  const title = meta.title || `YouTube video ${videoId}`;

  return {
    url,
    title,
    body,
    capturedAt,
    parser: 'youtube',
    fromSelection: false,
    author: meta.author,
    tags: tagsFor(meta, track),
    // Re-capturing the same video updates the stored entry rather than
    // accumulating snapshots.
    dedupeKey: `youtube:${videoId}`,
  };
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

export function extractVideoId(rawUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  const host = parsed.hostname;

  // /watch?v=ID
  if (parsed.pathname === '/watch') {
    const v = parsed.searchParams.get('v');
    if (v && VIDEO_ID_RE.test(v)) return v;
    return undefined;
  }
  // /shorts/ID
  const shorts = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]+)/);
  if (shorts && VIDEO_ID_RE.test(shorts[1])) return shorts[1];
  // /embed/ID
  const embed = parsed.pathname.match(/^\/embed\/([A-Za-z0-9_-]+)/);
  if (embed && VIDEO_ID_RE.test(embed[1])) return embed[1];
  // youtu.be/ID (rare in content-script context but harmless)
  if (host === 'youtu.be') {
    const id = parsed.pathname.replace(/^\//, '');
    if (VIDEO_ID_RE.test(id)) return id;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Player response extraction
// ---------------------------------------------------------------------------

/**
 * YouTube embeds its full player state as a JSON blob inside a <script>
 * element in the page. Content scripts can't read page-world globals but
 * they CAN read script-element text content. We pluck the JSON out with a
 * non-greedy regex and parse it.
 */
export function readPlayerResponse(videoId: string): YouTubeMeta | undefined {
  const raw = extractPlayerResponseJSON();
  if (!raw) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return shapeMeta(videoId, json);
}

function extractPlayerResponseJSON(): string | undefined {
  for (const script of Array.from(document.querySelectorAll('script'))) {
    const text = script.textContent ?? '';
    const idx = text.indexOf('ytInitialPlayerResponse');
    if (idx === -1) continue;
    // Look for `ytInitialPlayerResponse = {...};` — balance braces so we
    // don't get fooled by `}` inside string literals (rare for this payload
    // but worth defending against).
    const start = text.indexOf('{', idx);
    if (start === -1) continue;
    const end = balancedBraceEnd(text, start);
    if (end === -1) continue;
    return text.slice(start, end + 1);
  }
  return undefined;
}

function balancedBraceEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function shapeMeta(videoId: string, raw: unknown): YouTubeMeta {
  const obj = raw as Record<string, unknown>;
  const videoDetails = (obj.videoDetails ?? {}) as Record<string, unknown>;
  const captions = (obj.captions ?? {}) as Record<string, unknown>;
  const tracklist = (captions.playerCaptionsTracklistRenderer ?? {}) as Record<string, unknown>;
  const captionTracks = Array.isArray(tracklist.captionTracks)
    ? (tracklist.captionTracks as CaptionTrack[]).filter(
        (t) => typeof t.baseUrl === 'string' && t.baseUrl.length > 0
      )
    : [];

  return {
    videoId,
    title: typeof videoDetails.title === 'string' ? videoDetails.title : '',
    author: typeof videoDetails.author === 'string' ? videoDetails.author : undefined,
    description:
      typeof videoDetails.shortDescription === 'string'
        ? videoDetails.shortDescription
        : undefined,
    lengthSeconds:
      typeof videoDetails.lengthSeconds === 'string'
        ? Number.parseInt(videoDetails.lengthSeconds, 10) || undefined
        : undefined,
    chapters: extractChapters(obj),
    captionTracks,
  };
}

/**
 * Chapters live at a deeply-nested path in the player overlays. The path has
 * varied historically — we walk what we know about and degrade to no chapters
 * rather than throwing.
 */
function extractChapters(obj: Record<string, unknown>): Chapter[] {
  // markersMap → first entry → value.chapters → chapters[]
  // Each entry: { chapterRenderer: { title: {simpleText}, timeRangeStartMillis } }
  const markers = walk(obj, [
    'playerOverlays',
    'playerOverlayRenderer',
    'decoratedPlayerBarRenderer',
    'decoratedPlayerBarRenderer',
    'playerBar',
    'multiMarkersPlayerBarRenderer',
    'markersMap',
  ]);
  if (!Array.isArray(markers)) return [];
  for (const entry of markers as unknown[]) {
    const e = entry as Record<string, unknown>;
    const chapters = walk(e, ['value', 'chapters']);
    if (Array.isArray(chapters)) {
      return (chapters as unknown[])
        .map((c) => {
          const renderer = walk(c as Record<string, unknown>, ['chapterRenderer']) as
            | Record<string, unknown>
            | undefined;
          if (!renderer) return undefined;
          const title = walk(renderer, ['title', 'simpleText']);
          const ms = renderer.timeRangeStartMillis;
          if (typeof title !== 'string' || typeof ms !== 'number') return undefined;
          return { title, startSeconds: Math.floor(ms / 1000) };
        })
        .filter((c): c is Chapter => c !== undefined);
    }
  }
  return [];
}

function walk(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur && typeof cur === 'object' && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Caption track selection + transcript fetch
// ---------------------------------------------------------------------------

export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack {
  // Prefer manual English, fall back to auto-English, then anything.
  const enManual = tracks.find(
    (t) => (t.languageCode === 'en' || (t.vssId ?? '').startsWith('.en')) && t.kind !== 'asr'
  );
  if (enManual) return enManual;
  const enAuto = tracks.find((t) => t.languageCode === 'en' || (t.vssId ?? '').startsWith('a.en'));
  if (enAuto) return enAuto;
  return tracks[0];
}

interface Json3Response {
  events?: Array<{
    tStartMs?: number;
    segs?: Array<{ utf8?: string }>;
  }>;
}

async function fetchTranscript(baseUrl: string): Promise<TranscriptSegment[]> {
  const url = baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=json3`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`YouTube transcript fetch failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as Json3Response;
  const out: TranscriptSegment[] = [];
  for (const ev of json.events ?? []) {
    if (!ev.segs || typeof ev.tStartMs !== 'number') continue;
    const text = ev.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\n/g, ' ')
      .trim();
    if (text.length === 0) continue;
    out.push({ startMs: ev.tStartMs, text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Markdown render
// ---------------------------------------------------------------------------

export function renderMarkdown(
  meta: YouTubeMeta,
  segments: TranscriptSegment[],
  track: CaptionTrack
): string {
  const lines: string[] = [];
  const title = meta.title || `YouTube video ${meta.videoId}`;
  lines.push(`# ${title}`);
  lines.push('');
  const metaLine: string[] = [];
  if (meta.author) metaLine.push(`*by ${meta.author}*`);
  if (meta.lengthSeconds) metaLine.push(`*length: ${formatHms(meta.lengthSeconds)}*`);
  metaLine.push(
    track.kind === 'asr' ? '*captions: auto-generated*' : '*captions: manual*'
  );
  lines.push(metaLine.join('  ·  '));
  lines.push('');

  if (meta.description) {
    const desc = meta.description.trim();
    if (desc.length > 0) {
      lines.push('## Description');
      lines.push('');
      lines.push(truncate(desc, 800));
      lines.push('');
    }
  }

  if (segments.length === 0) {
    lines.push('## Transcript');
    lines.push('');
    lines.push('*(empty)*');
    return lines.join('\n');
  }

  lines.push('## Transcript');
  lines.push('');

  // If we have chapters, slot the segments into them. Otherwise dump linearly.
  if (meta.chapters.length > 0) {
    const chapters = [...meta.chapters].sort((a, b) => a.startSeconds - b.startSeconds);
    let segIdx = 0;
    for (let i = 0; i < chapters.length; i++) {
      const start = chapters[i].startSeconds * 1000;
      const end =
        i + 1 < chapters.length ? chapters[i + 1].startSeconds * 1000 : Number.POSITIVE_INFINITY;
      lines.push(`### [${formatMs(start)}] ${chapters[i].title}`);
      lines.push('');
      while (segIdx < segments.length && segments[segIdx].startMs < end) {
        if (segments[segIdx].startMs >= start) {
          lines.push(`- \`[${formatMs(segments[segIdx].startMs)}]\` ${segments[segIdx].text}`);
        }
        segIdx++;
      }
      lines.push('');
    }
  } else {
    for (const seg of segments) {
      lines.push(`- \`[${formatMs(seg.startMs)}]\` ${seg.text}`);
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

function tagsFor(meta: YouTubeMeta, track: CaptionTrack): string[] {
  const tags: string[] = ['youtube'];
  if (meta.author) tags.push(`channel:${meta.author}`);
  if (track.kind === 'asr') tags.push('captions:auto');
  else tags.push('captions:manual');
  if (track.languageCode) tags.push(`lang:${track.languageCode}`);
  return tags;
}

function formatMs(ms: number): string {
  return formatHms(Math.floor(ms / 1000));
}

function formatHms(seconds: number): string {
  const s = seconds % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '') + '…';
}
