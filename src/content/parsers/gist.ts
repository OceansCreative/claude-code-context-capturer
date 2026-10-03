import { htmlToMarkdown } from '@/shared/markdown-converter';
import type { CapturedContext } from '@/shared/types';

/**
 * GitHub Gist parser. Handles single-gist pages on the dedicated host:
 *   gist.github.com/{user}/{id}
 *   gist.github.com/{id}            (bare id — older / own gists)
 *
 * A gist is a *separate host* from github.com (which the `github` parser owns),
 * and a different content model: one page holds one or more files. We capture
 * every file as a fenced code block, so the whole snippet collection lands in a
 * project's context in one shot.
 *
 * ---------------------------------------------------------------------------
 * Why its own ParserName ('gist'), not a sub-kind of 'github'
 * ---------------------------------------------------------------------------
 * The `github` parser is host-locked to `github.com` and models issues / PRs /
 * discussions / READMEs. Gist lives on `gist.github.com`, has a wholly separate
 * DOM and output shape (N files → N code blocks), and gets its own dispatcher
 * entry, tags (`['gist', 'github']`) and `dedupeKey` (`gist:<id>`). The codebase
 * already gives each distinct source its own ParserName (youtube, reddit,
 * notion, …) and even splits sub-kinds into separate names where they diverge
 * (`claude-ai` vs `claude-ai-artifact`). A distinct `gist` name keeps capture
 * provenance accurate without overloading `github`'s single-document model.
 *
 * ---------------------------------------------------------------------------
 * DOM anchors (check these first if GitHub changes the gist markup)
 * ---------------------------------------------------------------------------
 *   [itemprop="about"]             the gist description (absent when none set)
 *   .gisthead .author a            the author handle + profile link
 *   .gisthead relative-time        created time (ISO in [datetime])
 *   .gist-content .file            one per file in the gist
 *   .gist-blob-name                the file's name (carries its extension)
 *   .js-file-line-container        the syntax-highlighted source table…
 *     td.blob-code                 …one cell per line (blank lines are "\n")
 *   .file-actions a[href*="/raw/"] the "Raw" link → exact source bytes
 *   .markdown-body                 rendered Markdown/rST (no source table)
 *
 * Code files are reconstructed from the rendered highlight table (no network).
 * Markdown/rST files render to HTML with *no* source table, so — per the spec's
 * "prefer the source over the rendered HTML for fidelity" — we fetch the Raw
 * link (same-origin, cookies attach) and fall back to converting the rendered
 * `.markdown-body` only if that fetch is unavailable or fails.
 */

const RESERVED_FIRST_SEGMENTS = new Set([
  'discover',
  'search',
  'starred',
  'auth',
  'login',
  'join',
  'settings',
  'mine',
  'followers',
  'following',
]);

export function canHandleGist(): boolean {
  if (window.location.hostname !== 'gist.github.com') return false;
  return extractGistId(window.location.pathname) !== undefined;
}

/**
 * Pull the gist id out of the path.
 *
 * Accepts `/{user}/{id}` and the bare `/{id}` form; the id is 20+ hex chars.
 * The discover / search / home pages have no hex id (or a reserved first
 * segment) → undefined, so `canHandleGist` ignores them and they fall through
 * to the generic parser.
 */
export function extractGistId(pathname: string): string | undefined {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length === 0) return undefined;

  const userSeg = segs.length >= 2 ? segs[0] : undefined;
  const idSeg = segs.length >= 2 ? segs[1] : segs[0];

  if (userSeg && RESERVED_FIRST_SEGMENTS.has(userSeg.toLowerCase())) {
    return undefined;
  }
  if (!/^[0-9a-f]{20,}$/i.test(idSeg)) return undefined;

  return idSeg.toLowerCase();
}

interface GistFile {
  filename: string;
  content: string;
  /** Fenced-code language hint (empty when unknown). */
  lang: string;
}

export async function parseGist(): Promise<CapturedContext> {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();

  const gistId = extractGistId(window.location.pathname);
  if (!gistId) {
    throw new Error(
      'Could not find a Gist ID in this URL. Open a specific gist (gist.github.com/<user>/<id>) and retry.'
    );
  }

  const fileEls = Array.from(
    document.querySelectorAll('.gist-content .file')
  );
  // Fallback selector in case the `.gist-content` wrapper changes.
  const els = fileEls.length > 0 ? fileEls : Array.from(document.querySelectorAll('.file'));

  const files: GistFile[] = [];
  for (const el of els) {
    const file = await extractFile(el);
    if (file && file.content.trim()) files.push(file);
  }

  if (files.length === 0) {
    throw new Error(
      'No file content found in this gist. It may be empty, still loading, or made up of unsupported binary files — reload the page and retry.'
    );
  }

  const description = getDescription();
  const author = getAuthorInfo();
  const heading = description || files[0].filename;

  const body = renderMarkdown(heading, author, files);

  return {
    url,
    title: `[Gist] ${heading}`,
    body,
    author: author?.name,
    publishedAt: getPublishedAt(),
    tags: ['gist', 'github'],
    capturedAt,
    parser: 'gist',
    fromSelection: false,
    // Stable per gist: re-capturing the same gist overwrites the existing store
    // file instead of accumulating snapshots (same pattern as claude-ai / notion).
    dedupeKey: `gist:${gistId}`,
  };
}

// ---------------------------------------------------------------------------
// Header metadata
// ---------------------------------------------------------------------------

function getDescription(): string | undefined {
  const text = document
    .querySelector('[itemprop="about"]')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

interface AuthorInfo {
  name: string;
  url: string;
}

function getAuthorInfo(): AuthorInfo | undefined {
  const a = document.querySelector<HTMLAnchorElement>(
    '.gisthead .author a, .author a'
  );
  const name = a?.textContent?.trim();
  if (name) {
    const href = a?.getAttribute('href');
    return { name, url: href ? absolutize(href) : `https://gist.github.com/${name}` };
  }
  // Fallback: the `/{user}/{id}` path carries the handle even if the DOM shifts.
  const segs = window.location.pathname.split('/').filter(Boolean);
  if (segs.length >= 2) {
    const fromPath = segs[0];
    return { name: fromPath, url: `https://gist.github.com/${fromPath}` };
  }
  return undefined;
}

function getPublishedAt(): string | undefined {
  const t = document.querySelector('.gisthead relative-time, relative-time');
  const dt = t?.getAttribute('datetime');
  if (!dt) return undefined;
  const parsed = Date.parse(dt);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

// ---------------------------------------------------------------------------
// Per-file content extraction
// ---------------------------------------------------------------------------

async function extractFile(fileEl: Element): Promise<GistFile | undefined> {
  const filename =
    fileEl.querySelector('.gist-blob-name')?.textContent?.trim() ||
    fileEl.querySelector('.file-info a')?.textContent?.trim();
  if (!filename) return undefined;

  const extLang = langForFilename(filename);

  // 1. Syntax-highlighted source table — the common case for code files.
  const codeCells = fileEl.querySelectorAll(
    '.js-file-line-container td.blob-code, table.highlight td.blob-code'
  );
  if (codeCells.length > 0) {
    return {
      filename,
      content: reconstructCode(codeCells),
      lang: extLang || langFromHighlight(fileEl),
    };
  }

  // 2. Rendered Markdown / rST (and other rendered types) have no source table.
  //    Prefer the raw bytes for fidelity.
  const raw = await fetchRawSource(fileEl);
  if (raw !== undefined && raw.trim()) {
    return { filename, content: raw, lang: extLang };
  }

  // 3. Last resort: convert the rendered Markdown HTML so we never emit nothing.
  const mdBody = fileEl.querySelector('.markdown-body');
  if (mdBody) {
    const converted = htmlToMarkdown(mdBody.innerHTML);
    if (converted.trim()) {
      return { filename, content: converted, lang: extLang || 'markdown' };
    }
  }

  return undefined;
}

/**
 * Rebuild the file source from the highlight table. Each `td.blob-code` holds
 * one line; GitHub renders a blank line as a lone "\n" text node and content
 * lines with no trailing newline, so stripping a single trailing "\n" and
 * joining with "\n" reproduces the source (indentation is preserved verbatim).
 */
function reconstructCode(cells: NodeListOf<Element>): string {
  return Array.from(cells)
    .map((cell) => (cell.textContent ?? '').replace(/\n$/, ''))
    .join('\n');
}

async function fetchRawSource(fileEl: Element): Promise<string | undefined> {
  const href = fileEl
    .querySelector('.file-actions a[href*="/raw/"]')
    ?.getAttribute('href');
  if (!href) return undefined;
  if (typeof fetch !== 'function') return undefined;
  try {
    const res = await fetch(absolutize(href), { credentials: 'include' });
    if (!res.ok) return undefined;
    return await res.text();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderMarkdown(
  heading: string,
  author: AuthorInfo | undefined,
  files: GistFile[]
): string {
  const lines: string[] = [`# ${heading}`, ''];
  if (author) {
    lines.push(`*by [${author.name}](${author.url})*`);
    lines.push('');
  }

  files.forEach((file, i) => {
    lines.push(`## ${file.filename}`);
    lines.push('');
    const fence = fenceFor(file.content);
    lines.push(`${fence}${file.lang}`);
    lines.push(file.content.replace(/\n+$/, ''));
    lines.push(fence);
    if (i < files.length - 1) lines.push('');
  });

  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Pick a fence long enough to wrap `content` even when it already contains a
 * run of backticks (common for `.md` files that embed their own code fences).
 */
function fenceFor(content: string): string {
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

/** filename extension → Markdown fence language. */
const EXT_LANG: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  php: 'php',
  pl: 'perl',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  clj: 'clojure',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  dart: 'dart',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  ps1: 'powershell',
  sql: 'sql',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  json: 'json',
  jsonc: 'json',
  ipynb: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  rst: 'rst',
  tex: 'latex',
  gradle: 'groovy',
  groovy: 'groovy',
  diff: 'diff',
  patch: 'diff',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  tf: 'hcl',
  hcl: 'hcl',
  vue: 'vue',
  svelte: 'svelte',
};

export function langForFilename(filename: string): string {
  const lower = filename.toLowerCase();
  // Extension-less files that are their own language by convention.
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) return 'dockerfile';
  if (lower === 'makefile') return 'makefile';

  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : '';
  return EXT_LANG[ext] ?? '';
}

/**
 * Secondary language hint from GitHub's `highlight-source-<lang>` /
 * `highlight-text-<lang>` class, used only when the filename has no known
 * extension. Takes the first token (e.g. `html-basic` → `html`).
 */
function langFromHighlight(fileEl: Element): string {
  const container = fileEl.querySelector('[class*="highlight-source-"], [class*="highlight-text-"]');
  if (!container) return '';
  for (const cls of Array.from(container.classList)) {
    const m = cls.match(/^highlight-(?:source|text)-(.+)$/);
    if (m) return m[1].split('-')[0];
  }
  return '';
}

function absolutize(href: string): string {
  try {
    return new URL(href, window.location.origin).toString();
  } catch {
    return href;
  }
}
