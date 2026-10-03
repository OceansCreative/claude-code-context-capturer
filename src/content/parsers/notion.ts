import type { CaptureOptions, CapturedContext } from '@/shared/types';

/**
 * Notion page parser.
 *
 * Notion is a React SPA that renders blocks dynamically and virtualizes long
 * pages (off-screen blocks are unmounted), so scraping the rendered DOM alone
 * misses content. Like the claude.ai / chatgpt parsers, we prefer Notion's
 * internal block API, reached same-origin from the content script so the user's
 * session cookies attach automatically (`credentials: 'include'`):
 *
 *   POST /api/v3/loadPageChunk
 *     body: { pageId, limit, cursor: { stack }, chunkNumber, verticalColumns }
 *     → { recordMap: { block: { <id>: { role, value: <block> } } }, cursor }
 *
 * Each block's `value` carries `{ type, properties, content, format, ... }`:
 *   - properties.title  rich-text array:  [[ "text", [["b"], ["a", url]] ], …]
 *   - content           child block ids (recursed to build the tree)
 *   - format            per-type extras (code language, callout icon, table
 *                       column order, …)
 * We walk the tree from the page's root block and convert it to Markdown.
 * Pagination follows the returned `cursor.stack` until it empties.
 *
 * These are internal endpoints — Notion may change them without notice. If the
 * API call fails (shape change, network, auth), we fall back to a best-effort
 * DOM parse of the rendered page (see DOM ANCHORS below). Logged-out / private /
 * empty / unexpected-shape cases all surface a friendly error rather than an
 * empty or corrupt capture.
 *
 * ============================================================================
 * DOM ANCHORS THE FALLBACK DEPENDS ON (check these first when Notion breaks it)
 * ============================================================================
 *   .notion-page-content          scroll container holding top-level blocks
 *   [data-block-id]               one block (nesting mirrors DOM containment)
 *   .notion-<type>-block          block type, e.g. notion-header-block,
 *                                 notion-text-block, notion-code-block,
 *                                 notion-bulleted_list-block, notion-to_do-block
 *   .notion-page-block            the page title block (above the content)
 * The DOM fallback is lossy (Notion styles inline text with CSS, not semantic
 * tags) and virtualization-limited; the API path above is the fidelity path.
 * ============================================================================
 */

const FETCH_TIMEOUT_MS = 15_000;
/** Cap paginated chunk requests so a huge page can't spin forever. */
const MAX_CHUNKS = 20;
const CHUNK_LIMIT = 100;

const AUTH_MSG =
  'Notion rejected the request — you may be logged out, or not have access to this page. Sign in to Notion in this tab, open the page, then retry the capture.';
const RATE_LIMIT_MSG =
  'Notion rate-limited this request (HTTP 429). Wait a moment and retry the capture.';
const NOT_FOUND_MSG =
  'Notion could not find this page (HTTP 404). Make sure it still exists and is in the workspace you are signed into.';
const UNEXPECTED_SHAPE_MSG =
  'Notion returned an unexpected response shape. The page may still be loading, or Notion changed its API — reload the tab and retry.';
const PRIVATE_OR_EMPTY_MSG =
  'This Notion page looks empty, private, or still loading. Make sure you can see its content while signed in to Notion in this tab, then retry.';

// ---------------------------------------------------------------------------
// Intermediate block model — both the API and DOM extractors produce this, so
// a single renderer turns either source into Markdown.
// ---------------------------------------------------------------------------

type BlockType =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'p'
  | 'bulleted'
  | 'numbered'
  | 'todo'
  | 'code'
  | 'quote'
  | 'callout'
  | 'toggle'
  | 'divider'
  | 'table'
  | 'image'
  | 'page'
  | 'container';

interface NotionBlock {
  type: BlockType;
  /** Inline Markdown for the block's own text (empty for structural blocks). */
  text: string;
  children: NotionBlock[];
  /** code: fenced language hint. */
  lang?: string;
  /** todo: checkbox state. */
  checked?: boolean;
  /** callout: leading emoji icon. */
  icon?: string;
  /** table: rows of already-rendered cell Markdown (first row = header). */
  rows?: string[][];
  /** image / sub-page: link target. */
  url?: string;
}

interface ParsedPage {
  title: string;
  blocks: NotionBlock[];
  /** Page creation time (ms epoch) when the API provides it. */
  createdTime?: number;
  /** True when pagination hit MAX_CHUNKS with more still pending. */
  truncated?: boolean;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function isNotionHost(hostname: string): boolean {
  return (
    hostname === 'notion.so' ||
    hostname === 'www.notion.so' ||
    hostname === 'app.notion.com' ||
    hostname.endsWith('.notion.site')
  );
}

export function canHandleNotion(): boolean {
  return (
    isNotionHost(window.location.hostname) &&
    extractPageId(window.location.pathname) !== undefined
  );
}

/**
 * Pull the page id out of a Notion path.
 *
 * Page URLs end in a 32-hex id, optionally preceded by a human slug and/or a
 * workspace segment:
 *   /My-Spec-1a2b3c4d5e6f7890abcdef1234567890
 *   /myteam/Design-Notes-1a2b...                (workspace-prefixed)
 *   /1a2b3c4d5e6f7890abcdef1234567890           (bare id)
 *   /1a2b3c4d-5e6f-7890-abcd-ef1234567890       (dashed uuid)
 * The dashboard, login, templates index etc. have no trailing id → undefined,
 * so `canHandleNotion` ignores them and they fall through to the generic parser.
 */
export function extractPageId(pathname: string): string | undefined {
  const segment = pathname.split('/').filter(Boolean).pop() ?? '';
  // Strip dashes (a slug separates words with '-', a dashed uuid has them too),
  // then take the final 32 hex chars — always exactly the page id.
  const match = segment.replace(/-/g, '').match(/([0-9a-f]{32})$/i);
  return match ? dashifyId(match[1]) : undefined;
}

/** `1a2b…` (32 hex) → `1a2b…-…-…-…-…` (8-4-4-4-12 dashed uuid). */
export function dashifyId(hex: string): string {
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function parseNotion(_options: CaptureOptions = {}): Promise<CapturedContext> {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();

  const pageId = extractPageId(window.location.pathname);
  if (!pageId) {
    throw new Error(
      'Could not find a Notion page ID in this URL. Open a specific Notion page (not the dashboard) and retry.'
    );
  }

  let page: ParsedPage;
  try {
    page = await parseViaApi(pageId);
  } catch (apiErr) {
    // API unreachable or shape changed — try the rendered DOM before giving up.
    const dom = parseViaDom();
    if (dom && dom.blocks.length > 0) {
      page = dom;
    } else {
      throw apiErr instanceof Error ? apiErr : new Error(UNEXPECTED_SHAPE_MSG);
    }
  }

  if (page.blocks.length === 0) {
    throw new Error(PRIVATE_OR_EMPTY_MSG);
  }

  const title = page.title.trim() || cleanDocTitle() || 'Untitled Notion page';
  const body = renderMarkdown(title, page.blocks, page.truncated);

  // tags: ['notion'] + the page title (task spec), whitespace-collapsed.
  const titleTag = title.replace(/\s+/g, ' ').trim();
  const tags = titleTag ? ['notion', titleTag] : ['notion'];

  return {
    url,
    title,
    body,
    capturedAt,
    publishedAt:
      typeof page.createdTime === 'number'
        ? new Date(page.createdTime).toISOString()
        : undefined,
    parser: 'notion',
    fromSelection: false,
    tags,
    // Stable per page: re-capturing the same page overwrites the existing store
    // file instead of accumulating snapshots (same pattern as claude-ai / x).
    dedupeKey: `notion:${pageId}`,
  };
}

// ---------------------------------------------------------------------------
// API path
// ---------------------------------------------------------------------------

/** Minimal shape of a Notion block `value` (only the fields we read). */
interface NotionRecordValue {
  id?: string;
  type?: string;
  properties?: Record<string, unknown>;
  content?: string[];
  format?: Record<string, unknown>;
  created_time?: number;
}

type BlockMap = Record<string, unknown>;

async function parseViaApi(pageId: string): Promise<ParsedPage> {
  const { blocks, truncated } = await fetchAllChunks(pageId);
  return buildTreeFromRecordMap(blocks, pageId, truncated);
}

async function fetchAllChunks(
  pageId: string
): Promise<{ blocks: BlockMap; truncated: boolean }> {
  const merged: BlockMap = {};
  let cursor: unknown = { stack: [] };
  let truncated = false;

  for (let chunkNumber = 0; chunkNumber < MAX_CHUNKS; chunkNumber++) {
    const data = await loadChunk(pageId, cursor, chunkNumber);
    const block = (data as { recordMap?: { block?: unknown } } | null)?.recordMap?.block;
    if (!block || typeof block !== 'object') {
      if (chunkNumber === 0) throw new Error(UNEXPECTED_SHAPE_MSG);
      break;
    }
    Object.assign(merged, block as BlockMap);

    const nextStack = (data as { cursor?: { stack?: unknown } } | null)?.cursor?.stack;
    if (Array.isArray(nextStack) && nextStack.length > 0) {
      cursor = (data as { cursor: unknown }).cursor;
      if (chunkNumber === MAX_CHUNKS - 1) truncated = true;
    } else {
      break;
    }
  }

  if (Object.keys(merged).length === 0) throw new Error(UNEXPECTED_SHAPE_MSG);
  return { blocks: merged, truncated };
}

async function loadChunk(
  pageId: string,
  cursor: unknown,
  chunkNumber: number
): Promise<unknown> {
  const res = await timedFetch(`${window.location.origin}/api/v3/loadPageChunk`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pageId,
      limit: CHUNK_LIMIT,
      cursor,
      chunkNumber,
      verticalColumns: false,
    }),
  });
  if (res.status === 401 || res.status === 403) throw new Error(AUTH_MSG);
  if (res.status === 429) throw new Error(RATE_LIMIT_MSG);
  if (res.status === 404) throw new Error(NOT_FOUND_MSG);
  if (!res.ok) {
    throw new Error(`Notion loadPageChunk failed: ${res.status} ${res.statusText}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error(UNEXPECTED_SHAPE_MSG);
  }
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  // AbortController + setTimeout rather than AbortSignal.timeout(): the latter
  // isn't available in every runtime (notably the test environment).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === 'AbortError' || err.name === 'TimeoutError')
    ) {
      throw new Error(
        `Notion request timed out after ${FETCH_TIMEOUT_MS / 1000}s. Retry, or check your network.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A block entry is normally `{ role, value: <block> }`, but Notion sometimes
 * double-wraps it as `{ value: { value: <block> } }`. Unwrap until we reach the
 * object carrying a `type`.
 */
function unwrapBlock(entry: unknown): NotionRecordValue | undefined {
  let v = (entry as { value?: unknown } | null)?.value ?? entry;
  if (
    v &&
    typeof v === 'object' &&
    !(v as NotionRecordValue).type &&
    typeof (v as { value?: unknown }).value === 'object' &&
    (v as { value?: unknown }).value !== null
  ) {
    v = (v as { value: unknown }).value;
  }
  return v && typeof v === 'object' ? (v as NotionRecordValue) : undefined;
}

export function buildTreeFromRecordMap(
  blockMap: BlockMap,
  pageId: string,
  truncated = false
): ParsedPage {
  const get = (id: string): NotionRecordValue | undefined => unwrapBlock(blockMap[id]);
  const root = get(pageId);
  if (!root) throw new Error(PRIVATE_OR_EMPTY_MSG);

  const title = richTextToMarkdown(root.properties?.title);

  const seen = new Set<string>([pageId]);
  const build = (id: string): NotionBlock | undefined => {
    if (seen.has(id)) return undefined;
    seen.add(id);
    const value = get(id);
    if (!value) return undefined;
    return toNotionBlock(value, build, get);
  };

  const blocks = (root.content ?? [])
    .map(build)
    .filter((b): b is NotionBlock => b !== undefined);

  return { title, blocks, createdTime: root.created_time, truncated };
}

function toNotionBlock(
  value: NotionRecordValue,
  build: (id: string) => NotionBlock | undefined,
  get: (id: string) => NotionRecordValue | undefined
): NotionBlock | undefined {
  const kids = (value.content ?? [])
    .map(build)
    .filter((b): b is NotionBlock => b !== undefined);
  const text = richTextToMarkdown(value.properties?.title);

  switch (value.type) {
    case 'header':
      return { type: 'h1', text, children: kids };
    case 'sub_header':
      return { type: 'h2', text, children: kids };
    case 'sub_sub_header':
      return { type: 'h3', text, children: kids };
    case 'text':
      return { type: 'p', text, children: kids };
    case 'bulleted_list':
      return { type: 'bulleted', text, children: kids };
    case 'numbered_list':
      return { type: 'numbered', text, children: kids };
    case 'to_do':
      return { type: 'todo', text, checked: isChecked(value), children: kids };
    case 'code':
      return {
        type: 'code',
        text: plainText(value.properties?.title),
        lang: fenceLang(firstProp(value.properties?.language)),
        children: [],
      };
    case 'quote':
      return { type: 'quote', text, children: kids };
    case 'callout':
      return { type: 'callout', text, icon: calloutIcon(value), children: kids };
    case 'toggle':
      return { type: 'toggle', text, children: kids };
    case 'divider':
      return { type: 'divider', text: '', children: [] };
    case 'column_list':
    case 'column':
      return { type: 'container', text: '', children: kids };
    case 'table':
      return { type: 'table', text: '', rows: buildTableRows(value, get), children: [] };
    case 'table_row':
      // Consumed by the parent `table`; never a standalone block.
      return undefined;
    case 'page':
      return { type: 'page', text, url: pageUrl(value.id), children: [] };
    case 'image':
      return {
        type: 'image',
        text: '',
        url: imageUrl(value),
        children: [],
      };
    case 'bookmark':
      return { type: 'p', text: bookmarkMarkdown(value), children: [] };
    case 'equation':
      return { type: 'p', text: blockEquation(value), children: [] };
    default:
      // Unknown type: keep its text if any, else flatten its children so we
      // don't drop nested content (synced blocks, unsupported embeds, …).
      if (text) return { type: 'p', text, children: kids };
      if (kids.length > 0) return { type: 'container', text: '', children: kids };
      return undefined;
  }
}

function buildTableRows(
  table: NotionRecordValue,
  get: (id: string) => NotionRecordValue | undefined
): string[][] {
  const order = asStringArray(table.format?.['table_block_column_order']);
  const rows: string[][] = [];
  for (const rowId of table.content ?? []) {
    const row = get(rowId);
    if (!row || row.type !== 'table_row') continue;
    const props = (row.properties ?? {}) as Record<string, unknown>;
    const cols = order.length > 0 ? order : Object.keys(props);
    rows.push(cols.map((cid) => richTextToMarkdown(props[cid])));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Rich text → inline Markdown
// ---------------------------------------------------------------------------

type RichSegment = [string, unknown[]?];

/**
 * Notion stores inline text as `[[ "text", [["b"], ["a", url], …] ], …]`.
 * Decoration codes we map: b(old) i(talic) s(trikethrough) c(ode) a(nchor/link)
 * e(quation) d(ate). Others (underline, color, page/user mentions) pass through
 * as plain text or are dropped when they are only a mention glyph.
 */
export function richTextToMarkdown(title: unknown): string {
  if (!Array.isArray(title)) return '';
  let out = '';
  for (const raw of title) {
    if (!Array.isArray(raw)) continue;
    const seg = raw as RichSegment;
    let text = typeof seg[0] === 'string' ? seg[0] : '';
    const decos = Array.isArray(seg[1]) ? (seg[1] as unknown[]) : [];

    let href: string | undefined;
    let bold = false;
    let italic = false;
    let strike = false;
    let code = false;
    let isMentionGlyph = text === '‣' || text === '⁍';

    for (const d of decos) {
      if (!Array.isArray(d)) continue;
      const kind = d[0];
      switch (kind) {
        case 'b':
          bold = true;
          break;
        case 'i':
          italic = true;
          break;
        case 's':
          strike = true;
          break;
        case 'c':
          code = true;
          break;
        case 'a':
          if (typeof d[1] === 'string') href = d[1];
          break;
        case 'e':
          // Inline equation; the LaTeX lives in the decoration, glyph is '⁍'.
          if (typeof d[1] === 'string') {
            text = `$${d[1]}$`;
            isMentionGlyph = false;
          }
          break;
        case 'd': {
          // Inline date mention; glyph is '‣'.
          const date = formatDateMention(d[1]);
          if (date) {
            text = date;
            isMentionGlyph = false;
          }
          break;
        }
        default:
          break;
      }
    }

    // Drop bare page/user mention glyphs we can't resolve to readable text.
    if (isMentionGlyph) continue;
    if (text === '') continue;

    if (code) {
      text = '`' + text + '`';
    } else {
      if (bold) text = `**${text}**`;
      if (italic) text = `*${text}*`;
      if (strike) text = `~~${text}~~`;
    }
    if (href) text = `[${text}](${absolutize(href)})`;

    out += text;
  }
  return out.trim();
}

/** Concatenate segment text with no decoration — for code blocks. */
function plainText(title: unknown): string {
  if (!Array.isArray(title)) return '';
  return title
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
    .join('');
}

function formatDateMention(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const d = value as { start_date?: unknown; end_date?: unknown };
  const start = typeof d.start_date === 'string' ? d.start_date : undefined;
  if (!start) return undefined;
  const end = typeof d.end_date === 'string' ? d.end_date : undefined;
  return end ? `${start} → ${end}` : start;
}

function absolutize(href: string): string {
  try {
    return new URL(href, window.location.origin).toString();
  } catch {
    return href;
  }
}

// ---------------------------------------------------------------------------
// Per-block field helpers
// ---------------------------------------------------------------------------

function firstProp(prop: unknown): string | undefined {
  if (!Array.isArray(prop)) return undefined;
  const first = prop[0];
  if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
  return undefined;
}

function isChecked(value: NotionRecordValue): boolean {
  return firstProp(value.properties?.['checked']) === 'Yes';
}

function calloutIcon(value: NotionRecordValue): string | undefined {
  const icon = value.format?.['page_icon'];
  // Emoji icons are short strings; file/URL icons we skip (not inlineable).
  if (typeof icon === 'string' && icon.length > 0 && !/^https?:\/\//.test(icon)) {
    return icon;
  }
  return undefined;
}

function imageUrl(value: NotionRecordValue): string | undefined {
  const display = value.format?.['display_source'];
  if (typeof display === 'string' && /^https?:\/\//.test(display)) return display;
  const source = firstProp(value.properties?.['source']);
  if (source && /^https?:\/\//.test(source)) return source;
  return undefined;
}

function bookmarkMarkdown(value: NotionRecordValue): string {
  const link = firstProp(value.properties?.['link']);
  const caption = richTextToMarkdown(value.properties?.title) || link || 'bookmark';
  return link ? `[${caption}](${absolutize(link)})` : caption;
}

function blockEquation(value: NotionRecordValue): string {
  const latex = plainText(value.properties?.title).trim();
  return latex ? `$$${latex}$$` : '';
}

function pageUrl(id?: string): string | undefined {
  if (!id) return undefined;
  return `${window.location.origin}/${id.replace(/-/g, '')}`;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Map a Notion language label to a Markdown fence tag. */
function fenceLang(label?: string): string | undefined {
  if (!label) return undefined;
  const key = label.toLowerCase();
  const map: Record<string, string> = {
    'plain text': '',
    plaintext: '',
    shell: 'bash',
    'c++': 'cpp',
    'c#': 'csharp',
    'f#': 'fsharp',
    'objective-c': 'objectivec',
  };
  if (key in map) return map[key] || undefined;
  return key.replace(/\s+/g, '');
}

// ---------------------------------------------------------------------------
// DOM fallback (best effort — see DOM ANCHORS in the file header)
// ---------------------------------------------------------------------------

function parseViaDom(): ParsedPage | undefined {
  const content = document.querySelector('.notion-page-content');
  if (!content) return undefined;

  const title =
    domText(document.querySelector('.notion-page-block')) || cleanDocTitle();
  const blocks = domBlockTree(content);
  return { title, blocks };
}

function domBlockTree(root: Element): NotionBlock[] {
  const els = Array.from(root.querySelectorAll('[data-block-id]'));
  const nodeFor = new Map<Element, NotionBlock>();
  for (const el of els) {
    const node = domBlock(el);
    if (node) nodeFor.set(el, node);
  }

  const roots: NotionBlock[] = [];
  for (const el of els) {
    const node = nodeFor.get(el);
    if (!node) continue;
    const parentEl = el.parentElement?.closest('[data-block-id]') ?? null;
    if (parentEl && root.contains(parentEl) && nodeFor.has(parentEl)) {
      nodeFor.get(parentEl)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function domBlock(el: Element): NotionBlock | undefined {
  const type = domBlockType(el);
  if (type === 'code') {
    return { type, text: domOwnText(el), lang: undefined, children: [] };
  }
  if (type === 'divider') {
    return { type, text: '', children: [] };
  }
  const node: NotionBlock = { type, text: domOwnInlineMarkdown(el), children: [] };
  if (type === 'todo') {
    node.checked =
      el.querySelector('[aria-checked="true"]') !== null ||
      el.querySelector('input[type="checkbox"]:checked') !== null;
  }
  return node;
}

function domBlockType(el: Element): BlockType {
  const cls = Array.from(el.classList).find((c) => /^notion-.+-block$/.test(c));
  const raw = cls ? cls.replace(/^notion-/, '').replace(/-block$/, '') : '';
  switch (raw) {
    case 'header':
      return 'h1';
    case 'sub_header':
      return 'h2';
    case 'sub_sub_header':
      return 'h3';
    case 'bulleted_list':
      return 'bulleted';
    case 'numbered_list':
      return 'numbered';
    case 'to_do':
      return 'todo';
    case 'code':
      return 'code';
    case 'quote':
      return 'quote';
    case 'callout':
      return 'callout';
    case 'toggle':
      return 'toggle';
    case 'divider':
      return 'divider';
    case 'column_list':
    case 'column':
      return 'container';
    default:
      return 'p';
  }
}

/** Plain text of an element, ignoring nested block subtrees. */
function domOwnText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const nested of Array.from(clone.querySelectorAll('[data-block-id]'))) {
    nested.remove();
  }
  return (clone.textContent ?? '').replace(/\u00a0/g, ' ').trimEnd();
}

/**
 * Inline Markdown of a block's own text, excluding nested block subtrees.
 * Notion styles bold/italic with CSS (no semantic tags), so we can only reliably
 * recover links and inline code here — the API path preserves the rest.
 */
function domOwnInlineMarkdown(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const nested of Array.from(clone.querySelectorAll('[data-block-id]'))) {
    nested.remove();
  }
  return inlineMarkdown(clone).replace(/\u00a0/g, ' ').trim();
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName;
  if (tag === 'BR') return '\n';
  const inner = Array.from(el.childNodes).map(inlineMarkdown).join('');
  if (tag === 'A') {
    const href = el.getAttribute('href');
    const text = inner.trim();
    if (!href || !text) return inner;
    return `[${text}](${absolutize(href)})`;
  }
  if (tag === 'CODE') {
    const text = inner.trim();
    return text ? '`' + text + '`' : '';
  }
  return inner;
}

function cleanDocTitle(): string {
  return (document.title || '').replace(/\s*[|\-–]\s*Notion\s*$/i, '').trim();
}

function domText(el: Element | null): string {
  return el ? (el.textContent ?? '').replace(/\u00a0/g, ' ').trim() : '';
}

// ---------------------------------------------------------------------------
// Markdown rendering (shared by both paths)
// ---------------------------------------------------------------------------

export function renderMarkdown(
  title: string,
  blocks: NotionBlock[],
  truncated = false
): string {
  const lines: string[] = [`# ${title}`, ''];
  lines.push(...renderBlocks(blocks, ''));
  if (truncated) {
    lines.push('');
    lines.push(
      `*Page truncated at ${MAX_CHUNKS * CHUNK_LIMIT} blocks — open it in Notion for the rest.*`
    );
  }
  return lines.join('\n').trimEnd() + '\n';
}

function isListType(type: BlockType): boolean {
  return type === 'bulleted' || type === 'numbered' || type === 'todo';
}

function renderBlocks(blocks: NotionBlock[], indent: string): string[] {
  const out: string[] = [];
  let numberCounter = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === 'numbered') numberCounter += 1;
    else numberCounter = 0;

    const lines = renderBlock(block, indent, numberCounter);
    if (lines.length === 0) continue;
    out.push(...lines);

    // Keep consecutive list items tight; separate everything else with a blank.
    const next = blocks[i + 1];
    const tight = isListType(block.type) && next !== undefined && isListType(next.type);
    if (next && !tight) out.push('');
  }
  return out;
}

function renderBlock(block: NotionBlock, indent: string, n: number): string[] {
  switch (block.type) {
    case 'h1':
      return block.text ? [`${indent}# ${block.text}`] : [];
    case 'h2':
      return block.text ? [`${indent}## ${block.text}`] : [];
    case 'h3':
      return block.text ? [`${indent}### ${block.text}`] : [];
    case 'divider':
      return [`${indent}---`];
    case 'code': {
      const lines = [`${indent}\`\`\`${block.lang ?? ''}`];
      for (const line of block.text.replace(/\n+$/, '').split('\n')) {
        lines.push(indent + line);
      }
      lines.push(`${indent}\`\`\``);
      return lines;
    }
    case 'bulleted':
    case 'numbered':
    case 'todo': {
      const marker =
        block.type === 'numbered'
          ? `${n}. `
          : block.type === 'todo'
            ? block.checked
              ? '- [x] '
              : '- [ ] '
            : '- ';
      const out = [`${indent}${marker}${block.text}`];
      if (block.children.length > 0) {
        // Children nest under the LIST marker's width. A numbered marker
        // ("1. " / "10. ") is 3-4 columns wide, so a fixed 2-space indent
        // un-nests sub-items (CommonMark then reads them as a new top-level
        // list restarting at 1). Bulleted/todo markers are "- " (2 cols; the
        // "[x] " in a todo is content, not part of the list marker).
        const childIndent =
          block.type === 'numbered' ? ' '.repeat(`${n}. `.length) : '  ';
        out.push(...renderBlocks(block.children, indent + childIndent));
      }
      return out;
    }
    case 'quote': {
      const out = quoted(block.text, indent);
      if (block.children.length > 0) {
        for (const line of renderBlocks(block.children, '')) {
          out.push(`${indent}> ${line}`.trimEnd());
        }
      }
      return out;
    }
    case 'callout': {
      const head = (block.icon ? `${block.icon} ` : '') + block.text;
      const out = [`${indent}> ${head}`.trimEnd()];
      if (block.children.length > 0) {
        for (const line of renderBlocks(block.children, '')) {
          out.push(`${indent}> ${line}`.trimEnd());
        }
      }
      return out;
    }
    case 'toggle': {
      const out = [
        `${indent}<details>`,
        `${indent}<summary>${block.text || 'Toggle'}</summary>`,
        '',
      ];
      out.push(...renderBlocks(block.children, indent));
      out.push('', `${indent}</details>`);
      return out;
    }
    case 'table':
      return renderTable(block, indent);
    case 'image': {
      if (block.url) return [`${indent}![image](${block.url})`];
      return [`${indent}*(image)*`];
    }
    case 'page': {
      const label = block.text || 'Untitled';
      return [`${indent}- 📄 ${block.url ? `[${label}](${block.url})` : label}`];
    }
    case 'container':
      return renderBlocks(block.children, indent);
    case 'p':
    default: {
      if (!block.text && block.children.length === 0) return [];
      const out: string[] = [];
      if (block.text) {
        for (const line of block.text.split('\n')) out.push(indent + line);
      }
      if (block.children.length > 0) {
        if (block.text) out.push('');
        out.push(...renderBlocks(block.children, indent));
      }
      return out;
    }
  }
}

function quoted(text: string, indent: string): string[] {
  const body = text || '';
  return body.split('\n').map((line) => `${indent}> ${line}`.trimEnd());
}

function renderTable(block: NotionBlock, indent: string): string[] {
  const rows = (block.rows ?? []).filter((r) => r.length > 0);
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]): string[] =>
    Array.from({ length: width }, (_, i) => cellEscape(r[i] ?? ''));

  const header = pad(rows[0]);
  const body = rows.slice(1).map(pad);

  const out = [
    `${indent}| ${header.join(' | ')} |`,
    `${indent}| ${header.map(() => '---').join(' | ')} |`,
  ];
  for (const row of body) out.push(`${indent}| ${row.join(' | ')} |`);
  return out;
}

function cellEscape(cell: string): string {
  return cell.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}
