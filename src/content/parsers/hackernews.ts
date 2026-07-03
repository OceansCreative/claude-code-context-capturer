import { htmlToMarkdown } from '@/shared/markdown-converter';
import type { CapturedContext } from '@/shared/types';

/**
 * Hacker News (news.ycombinator.com) item-page parser.
 *
 * Captures the story (title, external link for link posts, points, author,
 * age, and the story text for Ask HN / Show HN self posts) plus the comment
 * tree, preserving nesting via HN's `td.ind` indent encoding rendered as
 * nested Markdown blockquotes.
 *
 * HN's table-based markup has been stable for years:
 *   - `table.fatitem` holds the story: `tr.athing` → `.titleline > a`,
 *     then a `.subtext` row (`.score`, `.hnuser`, `.age`), and for self
 *     posts a `.toptext` div with the story text.
 *   - `tr.comtr` rows are the comments (a FLAT list — nesting is encoded
 *     by `td.ind[indent=N]`, or the spacer img width = N × 40px).
 *   - `.commtext` is the comment body; dead comments get class `cdd` and/or
 *     a `[dead]` / `[flagged]` marker; children of a collapsed comment get
 *     class `noshow`.
 *
 * "More comments" pagination is out of scope: we capture what's on the page.
 */

/** Hard cap so a 1000-comment thread doesn't produce a megabyte of Markdown. */
const MAX_COMMENTS = 100;

/** Blockquote depth cap — beyond this, deeper replies stay at this level. */
const MAX_QUOTE_DEPTH = 10;

/** HN indents by 40px per level via the spacer image's width attribute. */
const INDENT_PX_PER_LEVEL = 40;

export function canHandleHackerNews(): boolean {
  return (
    window.location.hostname === 'news.ycombinator.com' &&
    window.location.pathname === '/item' &&
    extractItemId(window.location.href) !== undefined
  );
}

export function parseHackerNews(): CapturedContext {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();
  const itemId = extractItemId(url);
  const dedupeKey = itemId ? `hn:${itemId}` : undefined;

  const fatitem = document.querySelector('table.fatitem');
  const titleAnchor = fatitem?.querySelector<HTMLAnchorElement>(
    'tr.athing .titleline > a'
  );

  // Defensive fallback: if HN's markup shifted under us, capture the whole
  // page rather than throwing.
  if (!fatitem || !titleAnchor) {
    return {
      url,
      title: document.title,
      body: htmlToMarkdown(document.body.innerHTML),
      capturedAt,
      parser: 'hackernews',
      fromSelection: false,
      dedupeKey,
    };
  }

  const title = titleAnchor.textContent?.trim() || document.title;

  // Link posts point at an external URL; self posts (Ask HN / Show HN text
  // posts) link back to `item?id=N`.
  const rawHref = titleAnchor.getAttribute('href') ?? '';
  const isSelfPost = rawHref.startsWith('item?id=');
  const externalUrl = isSelfPost ? undefined : titleAnchor.href;

  // Story metadata from the subtext row.
  const subtext = fatitem.querySelector('.subtext');
  const author = subtext?.querySelector('.hnuser')?.textContent?.trim() || undefined;
  const points = parsePoints(subtext?.querySelector('.score')?.textContent);
  const ageEl = subtext?.querySelector('.age');
  const ageText = ageEl?.textContent?.trim() || undefined;
  const publishedAt = parseAgeTitle(ageEl?.getAttribute('title'));

  const sections: string[] = [`# ${title}`];

  const metaBits: string[] = [];
  if (points !== undefined) metaBits.push(`${points} points`);
  if (author) metaBits.push(`by ${author}`);
  if (ageText) metaBits.push(ageText);
  if (metaBits.length > 0) sections.push(`*${metaBits.join(' · ')}*`);

  if (externalUrl) sections.push(`**Link:** ${externalUrl}`);

  // Story text for Ask HN / Show HN self posts.
  const topText = fatitem.querySelector('.toptext');
  if (topText) {
    const storyMd = htmlToMarkdown(topText.innerHTML).trim();
    if (storyMd.length > 0) sections.push(storyMd);
  }

  const { blocks, total } = renderComments();
  if (total > 0) {
    sections.push(`## Comments (${total})`);
    sections.push(blocks.join('\n\n'));
    if (blocks.length < total) {
      sections.push(
        `*…truncated: showing the first ${blocks.length} of ${total} comments on this page.*`
      );
    }
  }

  const tags = ['hn'];
  if (points !== undefined) tags.push(`points:${points}`);

  return {
    url,
    title,
    body: sections.join('\n\n'),
    author,
    publishedAt,
    tags,
    capturedAt,
    parser: 'hackernews',
    fromSelection: false,
    // Re-capturing the same thread updates the stored entry rather than
    // accumulating snapshots.
    dedupeKey,
  };
}

// ---------------------------------------------------------------------------
// Comment tree
// ---------------------------------------------------------------------------

function renderComments(): { blocks: string[]; total: number } {
  const rows = document.querySelectorAll<HTMLTableRowElement>('tr.comtr');
  const blocks: string[] = [];
  let total = 0;

  rows.forEach((row) => {
    // Children of a collapsed comment are present in the DOM but hidden.
    if (row.classList.contains('noshow')) return;

    const commtext = row.querySelector('.commtext');
    if (!commtext) return;

    // Skip dead / flagged comments: `cdd` class on the body, or a
    // `[dead]` / `[flagged]` marker in the header or as the whole body.
    if (commtext.classList.contains('cdd')) return;
    const comheadText = row.querySelector('.comhead')?.textContent ?? '';
    if (/\[(dead|flagged)\]/.test(comheadText)) return;
    const plainText = commtext.textContent?.trim() ?? '';
    if (plainText === '[dead]' || plainText === '[flagged]') return;

    total++;
    if (blocks.length >= MAX_COMMENTS) return; // keep counting for the note

    const commentAuthor = row.querySelector('.hnuser')?.textContent?.trim() || 'unknown';
    const commentAge = row.querySelector('.comhead .age')?.textContent?.trim();
    const header = `**${commentAuthor}**${commentAge ? ` · ${commentAge}` : ''}`;

    // The reply link lives in a sibling `.reply` div, but clone-and-strip in
    // case HN ever nests it inside `.commtext`.
    const clone = commtext.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.reply').forEach((el) => el.remove());
    const bodyMd = htmlToMarkdown(clone.innerHTML).trim();

    const depth = Math.min(readIndent(row), MAX_QUOTE_DEPTH);
    blocks.push(prefixLines(`${header}\n\n${bodyMd}`, depth));
  });

  return { blocks, total };
}

/**
 * HN encodes nesting depth on each flat comment row: `td.ind` carries an
 * `indent` attribute, and its spacer image's width is depth × 40px.
 */
function readIndent(row: Element): number {
  const ind = row.querySelector('td.ind');
  const attr = ind?.getAttribute('indent');
  if (attr !== null && attr !== undefined) {
    const n = Number.parseInt(attr, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const width = ind?.querySelector('img')?.getAttribute('width');
  if (width) {
    const px = Number.parseInt(width, 10);
    if (Number.isFinite(px) && px >= 0) return Math.round(px / INDENT_PX_PER_LEVEL);
  }
  return 0;
}

/** Prefix every line with `> ` × depth so replies render as nested quotes. */
function prefixLines(md: string, depth: number): string {
  if (depth <= 0) return md;
  const prefix = '> '.repeat(depth);
  return md
    .split('\n')
    .map((line) => (line.length > 0 ? prefix + line : prefix.trimEnd()))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Field parsing helpers
// ---------------------------------------------------------------------------

export function extractItemId(rawUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  const id = parsed.searchParams.get('id');
  return id && /^\d+$/.test(id) ? id : undefined;
}

function parsePoints(text: string | null | undefined): number | undefined {
  const match = text?.match(/(\d+)\s*point/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/**
 * The `.age` element's title attribute looks like
 * `2026-07-02T10:00:00 1751450400` (ISO-ish UTC timestamp + epoch seconds).
 * Prefer the unambiguous epoch; fall back to the timestamp string.
 */
function parseAgeTitle(title: string | null | undefined): string | undefined {
  if (!title) return undefined;
  const [iso, epoch] = title.trim().split(/\s+/);
  if (epoch && /^\d+$/.test(epoch)) {
    const date = new Date(Number.parseInt(epoch, 10) * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (iso) {
    const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return undefined;
}
