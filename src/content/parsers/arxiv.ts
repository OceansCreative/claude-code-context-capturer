import type { CaptureOptions, CapturedContext } from '@/shared/types';

/**
 * arXiv paper parser.
 *
 * Target: abstract pages `arxiv.org/abs/<id>` (and `arxiv.org/pdf/<id>`, which
 * is treated as the same paper via its abs page). AI researchers live on arXiv,
 * so dropping a paper's title / authors / abstract / metadata straight into
 * CLAUDE.md is a real workflow.
 *
 * Abstract pages are static, server-rendered HTML (no SPA), so we parse the DOM
 * directly — no internal API calls. We anchor FIRST on the stable `citation_*`
 * meta tags arXiv emits for Google Scholar (title / authors / abstract / date /
 * pdf url / arxiv id), falling back to the visible DOM when a tag is absent.
 * Those meta tags have been stable for well over a decade and are the most
 * robust anchor available.
 *
 * ============================================================================
 * ANCHORS THIS PARSER DEPENDS ON (check these first when arXiv breaks it)
 * ============================================================================
 *   meta[name="citation_title"]      paper title (clean, no "Title:" label)
 *   meta[name="citation_author"]     one per author, "Last, First" order
 *   meta[name="citation_abstract"]   full abstract text (clean, single block)
 *   meta[name="citation_date"]       original submission date, "YYYY/MM/DD"
 *   meta[name="citation_pdf_url"]    canonical PDF url
 *   meta[name="citation_arxiv_id"]   the id, versionless
 *   h1.title                         DOM title (has a "Title:" .descriptor span)
 *   div.authors a                    author links, natural "First Last" order
 *   blockquote.abstract              DOM abstract (has an "Abstract:" descriptor)
 *   td.tablecell.subjects            categories, e.g.
 *                                      "Computation and Language (cs.CL); …"
 *     span.primary-subject             the primary category within it
 *   div.dateline                     "[Submitted on … (v1), last revised … (v7)]"
 *   span.arxivid / td.tablecell.arxividv a   versioned id link (→ current vN)
 *   td.tablecell.comments            author comments, e.g. "15 pages, 5 figures"
 *   td.tablecell.doi a[href]         publisher / "Related DOI" (absent for most
 *                                      preprints — captured only when present)
 *   td.tablecell label / value rows  generic label→value lookup (journal ref,
 *                                      whose cell class `jref` is shared with
 *                                      the report-number row, so we key on the
 *                                      label text instead)
 * ============================================================================
 */

const ARXIV_HOSTS = new Set(['arxiv.org', 'www.arxiv.org']);

// New-style id: `1706.03762` (YYMM.NNNNN, 4–5 trailing digits). Old-style id:
// `hep-ph/9901001`, `math.AG/0601001` (archive[.subject]/YYMMNNN).
const NEW_ID = String.raw`\d{4}\.\d{4,5}`;
const OLD_ID = String.raw`[a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7}`;
/** `/abs/<id>` or `/pdf/<id>`, optional `vN` version and `.pdf` suffix. */
const ID_PATH_RE = new RegExp(
  `^/(?:abs|pdf)/(${NEW_ID}|${OLD_ID})(v\\d+)?(?:\\.pdf)?/?$`
);

const FETCH_TIMEOUT_MS = 15_000;
/** How many authors to list inline before collapsing to "(+N more)". */
const MAX_AUTHORS_SHOWN = 20;

/** A parsed arXiv identifier split from a page path. */
export interface ArxivRef {
  /** Versionless id, e.g. `1706.03762` or `hep-ph/9901001`. */
  id: string;
  /** Version number without the `v`, e.g. `7`, when the path carried one. */
  version?: string;
}

/**
 * Pull the arXiv id (and version, if any) out of a page path.
 * Returns undefined for anything that isn't an `/abs/` or `/pdf/` paper page —
 * `/list/cs.AI/recent`, `/find/…`, the root, etc. all fall through to generic.
 */
export function extractArxivRef(pathname: string): ArxivRef | undefined {
  const m = pathname.match(ID_PATH_RE);
  if (!m) return undefined;
  return { id: m[1], version: m[2] ? m[2].slice(1) : undefined };
}

export function canHandleArxiv(): boolean {
  return (
    ARXIV_HOSTS.has(window.location.hostname) &&
    extractArxivRef(window.location.pathname) !== undefined
  );
}

export async function parseArxiv(_options: CaptureOptions = {}): Promise<CapturedContext> {
  const capturedAt = new Date().toISOString();
  const ref = extractArxivRef(window.location.pathname);
  if (!ref) {
    // canHandleArxiv gates this, but guard anyway so a direct call fails loudly
    // rather than producing a corrupt capture.
    throw new Error(
      'This does not look like an arXiv paper page. Open an abstract page (arxiv.org/abs/<id>) and retry.'
    );
  }

  // On `/abs/` the metadata is already in the DOM. On `/pdf/` the page is the
  // raw PDF (no citation meta), so fetch the abs page same-origin and parse that
  // — "treat /pdf as the same paper via its abs page".
  const onAbsPage = /^\/abs\//.test(window.location.pathname);
  let doc: Document = document;
  if (!onAbsPage) {
    doc = await fetchAbsDocument(ref);
  }

  return extractPaper(doc, ref, capturedAt);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function extractPaper(doc: Document, ref: ArxivRef, capturedAt: string): CapturedContext {
  const abstract = extractAbstract(doc);
  if (!abstract) {
    // Never write an empty/corrupt capture — surface a friendly error instead.
    throw new Error(
      `Could not find the abstract for arXiv:${ref.id}. arXiv may have changed its page layout, or the page may still be loading — reload the abstract page and retry.`
    );
  }

  const title = extractTitle(doc) || `arXiv:${ref.id}`;
  const authors = extractAuthors(doc);
  const subjectsText = cellText(doc.querySelector('.tablecell.subjects'));
  const categories = extractCategories(doc, subjectsText);
  const version = ref.version ?? resolveVersion(doc);
  const idDisplay = version ? `${ref.id}v${version}` : ref.id;

  const pdfUrl =
    metaContent(doc, 'citation_pdf_url') ?? `https://arxiv.org/pdf/${ref.id}`;
  // Canonical human page for this paper — used as the capture's url so routing
  // and the source footer point at the abstract page whether the capture was
  // triggered from /abs or /pdf.
  const absUrl = `https://arxiv.org/abs/${idDisplay}`;

  const dateline = cleanDateline(doc);
  const comments = cellText(doc.querySelector('.tablecell.comments'));
  const journalRef = cellByLabel(doc, /^Journal\s*reference/i);
  const doi = extractDoi(doc);
  const submittedIso = parseCitationDate(metaContent(doc, 'citation_date'));

  const body = renderMarkdown({
    title,
    authors,
    abstract,
    idDisplay,
    subjectsText,
    dateline,
    comments,
    journalRef,
    doi,
    pdfUrl,
    absUrl,
  });

  return {
    url: absUrl,
    title,
    body,
    author: formatAuthorField(authors),
    publishedAt: submittedIso,
    capturedAt,
    parser: 'arxiv',
    fromSelection: false,
    tags: ['arxiv', ...categories],
    // Version-stripped: re-capturing v2 of a paper UPDATES the same store entry
    // instead of piling up one file per version (same subject-keyed pattern as
    // notion / x). The specific version captured is preserved in the body's
    // metadata block and in the `url`.
    dedupeKey: `arxiv:${ref.id}`,
  };
}

function extractTitle(doc: Document): string | undefined {
  const meta = metaContent(doc, 'citation_title');
  if (meta) return meta;
  const h1 = stripDescriptor(doc.querySelector('h1.title'));
  if (h1) return h1;
  // doc.title is "[1706.03762] Attention Is All You Need" — drop the id prefix.
  const docTitle = (doc.title || '').replace(/^\[[^\]]+\]\s*/, '').trim();
  return docTitle || undefined;
}

/**
 * Prefer the DOM author links (natural "First Last" order) over the
 * `citation_author` meta tags ("Last, First"), reformatting the latter when the
 * DOM is unavailable (e.g. the /pdf fetch path returned a stripped page).
 */
function extractAuthors(doc: Document): string[] {
  const domAuthors = Array.from(doc.querySelectorAll('.authors a'))
    .map((a) => collapse(a.textContent ?? ''))
    .filter(Boolean);
  if (domAuthors.length > 0) return domAuthors;

  return metaAll(doc, 'citation_author').map(reformatMetaAuthor);
}

/** `"Vaswani, Ashish"` → `"Ashish Vaswani"`; no-comma values pass through. */
function reformatMetaAuthor(name: string): string {
  const comma = name.indexOf(',');
  if (comma === -1) return name.trim();
  const last = name.slice(0, comma).trim();
  const first = name.slice(comma + 1).trim();
  return first ? `${first} ${last}` : last;
}

function extractAbstract(doc: Document): string | undefined {
  const meta = metaContent(doc, 'citation_abstract');
  if (meta) return collapse(meta);
  const blockquote = stripDescriptor(doc.querySelector('blockquote.abstract'));
  return blockquote ? collapse(blockquote) : undefined;
}

/**
 * Category codes for tags (`cs.CL`, `hep-ex`, `cond-mat.stat-mech`, …), primary
 * first, de-duplicated. Pulled from the parenthesised codes in the subjects cell.
 */
function extractCategories(doc: Document, subjectsText: string): string[] {
  const codes = parenCodes(subjectsText);
  const primary = parenCodes(cellText(doc.querySelector('.primary-subject')))[0];
  const ordered = primary ? [primary, ...codes.filter((c) => c !== primary)] : codes;
  return Array.from(new Set(ordered));
}

/** Extract arXiv-style category codes from any `(code)` groups in a string. */
function parenCodes(text: string): string[] {
  const out: string[] = [];
  const re = /\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const code = m[1].trim();
    if (/^[a-z][a-z-]*(?:\.[A-Za-z-]+)?$/.test(code)) out.push(code);
  }
  return out;
}

/**
 * Current version shown on the page, when the URL itself didn't carry one.
 * The versioned id link (`…/abs/1706.03762v7`) is the cleanest source; the
 * dateline's "(this version, v7)" is the fallback.
 */
function resolveVersion(doc: Document): string | undefined {
  const href = doc
    .querySelector('.tablecell.arxividv a[href], .arxividv a[href]')
    ?.getAttribute('href');
  const fromHref = href?.match(/v(\d+)\s*$/);
  if (fromHref) return fromHref[1];

  const dateline = doc.querySelector('.dateline')?.textContent ?? '';
  const fromDateline = dateline.match(/this version,\s*v(\d+)/i);
  return fromDateline ? fromDateline[1] : undefined;
}

/** `"Submitted on 12 Jun 2017 (v1), last revised 2 Aug 2023 (this version, v7)"` */
function cleanDateline(doc: Document): string | undefined {
  const raw = collapse(doc.querySelector('.dateline')?.textContent ?? '');
  if (!raw) return undefined;
  return raw.replace(/^\[/, '').replace(/\]$/, '').trim() || undefined;
}

/** Publisher / "Related DOI" link — absent for most preprints. */
function extractDoi(doc: Document): { id: string; url: string } | undefined {
  const anchor = doc.querySelector<HTMLAnchorElement>('.tablecell.doi a[href]');
  if (!anchor) return undefined;
  const url = anchor.getAttribute('href')?.trim();
  if (!url) return undefined;
  const id =
    anchor.getAttribute('data-doi')?.trim() ||
    url.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  return { id, url };
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

interface PaperView {
  title: string;
  authors: string[];
  abstract: string;
  idDisplay: string;
  subjectsText: string;
  dateline?: string;
  comments: string;
  journalRef?: string;
  doi?: { id: string; url: string };
  pdfUrl: string;
  absUrl: string;
}

function renderMarkdown(p: PaperView): string {
  const lines: string[] = [`# ${p.title}`, ''];

  if (p.authors.length > 0) {
    lines.push(`**Authors:** ${formatAuthorsLine(p.authors)}`, '');
  }

  lines.push('## Abstract', '', p.abstract, '');

  lines.push('## Metadata', '');
  lines.push(`- **arXiv:** ${p.idDisplay}`);
  if (p.subjectsText) lines.push(`- **Categories:** ${p.subjectsText}`);
  if (p.dateline) {
    // dateline is "Submitted on 12 Jun 2017 (v1), last revised … (v7)" — drop
    // the redundant leading verb so the bold label carries it.
    lines.push(`- **Submitted:** ${p.dateline.replace(/^Submitted on\s*/i, '')}`);
  }
  if (p.comments) lines.push(`- **Comments:** ${p.comments}`);
  if (p.journalRef) lines.push(`- **Journal reference:** ${p.journalRef}`);
  if (p.doi) lines.push(`- **DOI:** [${p.doi.id}](${p.doi.url})`);
  lines.push(`- **PDF:** ${p.pdfUrl}`);
  lines.push(`- **Abstract page:** ${p.absUrl}`);

  return lines.join('\n').trimEnd() + '\n';
}

function formatAuthorsLine(authors: string[]): string {
  if (authors.length <= MAX_AUTHORS_SHOWN) return authors.join(', ');
  const shown = authors.slice(0, MAX_AUTHORS_SHOWN).join(', ');
  return `${shown}, … (+${authors.length - MAX_AUTHORS_SHOWN} more)`;
}

/** Compact single-string author for the frontmatter `author:` field. */
function formatAuthorField(authors: string[]): string | undefined {
  if (authors.length === 0) return undefined;
  if (authors.length <= 3) return authors.join(', ');
  return `${authors[0]} et al.`;
}

// ---------------------------------------------------------------------------
// /pdf → abs fetch (same-origin, public page; no credentials)
// ---------------------------------------------------------------------------

async function fetchAbsDocument(ref: ArxivRef): Promise<Document> {
  const idDisplay = ref.version ? `${ref.id}v${ref.version}` : ref.id;
  const absUrl = `${window.location.origin}/abs/${idDisplay}`;
  let res: Response;
  try {
    res = await timedFetch(absUrl, { credentials: 'omit' });
  } catch {
    throw new Error(
      `Could not load the arXiv abstract page for arXiv:${ref.id}. Open it directly at ${absUrl} and retry.`
    );
  }
  if (!res.ok) {
    throw new Error(
      `arXiv returned HTTP ${res.status} for the abstract page of arXiv:${ref.id}. Open it directly at ${absUrl} and retry.`
    );
  }
  const html = await res.text();
  return new DOMParser().parseFromString(html, 'text/html');
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  // AbortController + setTimeout rather than AbortSignal.timeout(): the latter
  // isn't available in every runtime (notably the test environment).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function metaContent(doc: Document, name: string): string | undefined {
  const content = doc
    .querySelector(`meta[name="${name}"]`)
    ?.getAttribute('content')
    ?.trim();
  return content || undefined;
}

function metaAll(doc: Document, name: string): string[] {
  return Array.from(doc.querySelectorAll(`meta[name="${name}"]`))
    .map((el) => el.getAttribute('content')?.trim())
    .filter((c): c is string => Boolean(c));
}

/** Element text with the leading `.descriptor` label ("Title:", "Abstract:") removed. */
function stripDescriptor(el: Element | null): string {
  if (!el) return '';
  const clone = el.cloneNode(true) as Element;
  clone.querySelector('.descriptor')?.remove();
  return collapse(clone.textContent ?? '');
}

function cellText(el: Element | null): string {
  return el ? collapse(el.textContent ?? '') : '';
}

/**
 * Value of the metadata-table row whose label matches `labelRe`. Used for the
 * journal-reference row, whose value-cell class (`jref`) is shared with the
 * report-number row — so the label text is the only reliable key.
 */
function cellByLabel(doc: Document, labelRe: RegExp): string | undefined {
  for (const row of Array.from(doc.querySelectorAll('.metatable tr'))) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) continue;
    const label = collapse(cells[0].textContent ?? '').replace(/:$/, '');
    if (labelRe.test(label)) {
      const value = collapse(cells[1].textContent ?? '');
      return value || undefined;
    }
  }
  return undefined;
}

/** Collapse all whitespace (incl. &nbsp; and newlines) to single spaces, trim. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `citation_date` is `YYYY/MM/DD` (original submission) → ISO 8601, or undefined. */
function parseCitationDate(value: string | undefined): string | undefined {
  const m = value?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return undefined;
  const [, y, mo, d] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}
