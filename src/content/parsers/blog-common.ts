import { htmlToMarkdown } from '@/shared/markdown-converter';

/**
 * Shared helpers for developer-blog article parsers (Dev.to, Hashnode).
 *
 * Both platforms server-render the article and expose the same metadata anchor:
 * a schema.org `Article` JSON-LD block (`<script type="application/ld+json">`)
 * carrying headline / author / datePublished / keywords. We anchor on that
 * first — it's stable and framework-agnostic, unlike the sites' hashed CSS
 * classes — and let each site parser supply the body-container selector and any
 * DOM fallbacks.
 */

/** Minimal shape of the schema.org Article/BlogPosting JSON-LD we read. */
export interface ArticleLd {
  headline?: unknown;
  author?: unknown;
  datePublished?: unknown;
  keywords?: unknown;
}

const ARTICLE_LD_TYPE = /^(Article|BlogPosting|TechArticle|NewsArticle)$/i;

/** First schema.org Article-ish JSON-LD node on the page, if any. */
export function findArticleLd(doc: Document): ArticleLd | undefined {
  for (const script of Array.from(
    doc.querySelectorAll('script[type="application/ld+json"]')
  )) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    const found = searchLd(parsed);
    if (found) return found;
  }
  return undefined;
}

function searchLd(node: unknown): ArticleLd | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = searchLd(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === 'string' && ARTICLE_LD_TYPE.test(t))) {
    return obj as ArticleLd;
  }
  // schema.org documents often wrap their nodes in an `@graph` array.
  if (Array.isArray(obj['@graph'])) {
    return searchLd(obj['@graph']);
  }
  return undefined;
}

/** `author` → display name. Handles string, object, and array-of forms. */
export function ldAuthorName(ld: ArticleLd | undefined): string | undefined {
  const author = ld?.author;
  if (!author) return undefined;
  const first = Array.isArray(author) ? author[0] : author;
  if (typeof first === 'string') return first.trim() || undefined;
  if (first && typeof first === 'object') {
    const name = (first as { name?: unknown }).name;
    if (typeof name === 'string') return name.trim() || undefined;
  }
  return undefined;
}

/** `keywords` → tag list. Accepts a comma-joined string or an array. */
export function ldKeywords(ld: ArticleLd | undefined): string[] {
  const kw = ld?.keywords;
  if (Array.isArray(kw)) {
    return kw.map((k) => String(k).trim()).filter(Boolean);
  }
  if (typeof kw === 'string') {
    return kw
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  }
  return [];
}

/** A string value from the JSON-LD, trimmed, or undefined when empty/non-string. */
export function ldText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Normalize an ISO-ish date string to ISO 8601, or undefined when unparseable.
 * Dev.to and Hashnode both emit ISO already; this just validates + canonicalizes.
 */
export function normalizeDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const ms = Date.parse(raw.trim());
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** `2026-10-01T18:02:38.000Z` → `2026-10-01` for the human byline. */
export function dateDisplay(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

/** `<meta property|name="…">` content, trimmed, or undefined. */
export function metaContent(doc: Document, nameOrProp: string): string | undefined {
  const el =
    doc.querySelector(`meta[property="${nameOrProp}"]`) ??
    doc.querySelector(`meta[name="${nameOrProp}"]`);
  return el?.getAttribute('content')?.trim() || undefined;
}

/**
 * Prefix a platform tag onto the article's tags and de-duplicate
 * (case-insensitively), preserving order and dropping empties.
 */
export function withPlatformTag(platform: string, tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [platform, ...tags]) {
    const value = tag.trim();
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/**
 * Convert an article body element to Markdown, first normalizing its code
 * blocks so the fence language survives the shared converter. We clone the
 * element so the live page DOM is never mutated.
 */
export function bodyToMarkdown(bodyEl: Element): string {
  const clone = bodyEl.cloneNode(true) as HTMLElement;
  normalizeCodeBlocks(clone);
  return htmlToMarkdown(clone.innerHTML);
}

/**
 * The shared Markdown converter detects a fence language from a
 * `language-xxx` / `lang-xxx` class on the `<code>` element. Blog platforms
 * don't all follow that convention: Dev.to (Rouge) puts the lexer name as a
 * second class on the `<pre>` (`<pre class="highlight python">`), and some
 * renderers use a `data-language` attribute. Copy whatever hint we can find
 * onto the `<code>` as a `language-*` class so the fence comes out tagged.
 * (Hashnode already uses `language-*` on the code element — left untouched.)
 */
export function normalizeCodeBlocks(root: Element): void {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    const code = pre.querySelector('code');
    if (!code) continue;
    if (/\b(?:language|lang)-\S+/.test(code.className)) continue;
    const lang = detectPreLanguage(pre, code);
    if (lang) code.classList.add(`language-${lang}`);
  }
}

function detectPreLanguage(pre: Element, code: Element): string {
  // Explicit data attributes win.
  const dataLang =
    pre.getAttribute('data-language') ??
    pre.getAttribute('data-lang') ??
    code.getAttribute('data-language') ??
    code.getAttribute('data-lang');
  if (dataLang) return cleanLang(dataLang);

  // A `language-*` / `lang-*` class on the <pre> (Prism-style) rather than the
  // <code>.
  for (const cls of Array.from(pre.classList)) {
    const m = cls.match(/^(?:language|lang)-(.+)$/);
    if (m) return cleanLang(m[1]);
  }

  // Dev.to / Rouge: `<pre class="highlight python">` — the lexer name is the
  // class that isn't the `highlight` wrapper marker.
  const tokens = Array.from(pre.classList);
  if (tokens.includes('highlight')) {
    const lang = tokens.find((t) => t !== 'highlight' && t !== 'js-code-highlight');
    if (lang) return cleanLang(lang);
  }
  return '';
}

/** Lower-case a language token; drop "plain text" sentinels to a bare fence. */
function cleanLang(raw: string): string {
  const lang = raw.toLowerCase().trim();
  if (!lang || lang === 'plaintext' || lang === 'text' || lang === 'none') {
    return '';
  }
  return lang;
}

/** Fields a site parser extracts; `renderArticle` turns them into Markdown. */
export interface ArticleParts {
  title: string;
  author?: string;
  publishedAt?: string;
  /** Short platform label for the byline, e.g. "Dev.to" / "Hashnode". */
  platform: string;
  bodyMarkdown: string;
}

/**
 * `# title` + an author / date / platform byline + the body. Missing byline
 * bits (author, date) are omitted; the platform label is always shown.
 */
export function renderArticle(parts: ArticleParts): string {
  const lines: string[] = [`# ${parts.title}`, ''];
  const byline: string[] = [];
  if (parts.author) byline.push(parts.author);
  const date = dateDisplay(parts.publishedAt);
  if (date) byline.push(date);
  byline.push(parts.platform);
  lines.push(`_${byline.join(' · ')}_`, '');
  lines.push(parts.bodyMarkdown.trim());
  return lines.join('\n').trimEnd() + '\n';
}
