import { Readability, isProbablyReaderable } from '@mozilla/readability';
import { htmlToMarkdown } from '@/shared/markdown-converter';
import type { CapturedContext } from '@/shared/types';

/**
 * Generic parser for arbitrary web pages.
 *
 * Uses Mozilla Readability to extract the main article content,
 * then converts the result to Markdown.
 */
export function parseGenericPage(): CapturedContext {
  const documentClone = document.cloneNode(true) as Document;
  const url = window.location.href;
  const title = extractTitle();
  const capturedAt = new Date().toISOString();

  // Readability mutates the document, so we work on a clone.
  let bodyHtml: string;
  let parserUsed: 'generic' = 'generic';
  let author: string | undefined;
  let publishedAt: string | undefined;

  if (isProbablyReaderable(documentClone)) {
    const reader = new Readability(documentClone, { charThreshold: 200 });
    const article = reader.parse();
    if (article && article.content) {
      bodyHtml = article.content;
      author = article.byline ?? undefined;
      publishedAt = article.publishedTime ?? undefined;
    } else {
      bodyHtml = fallbackBodyHtml();
    }
  } else {
    bodyHtml = fallbackBodyHtml();
  }

  const markdown = htmlToMarkdown(bodyHtml);

  return {
    url,
    title,
    body: markdown,
    author,
    publishedAt,
    capturedAt,
    parser: parserUsed,
    fromSelection: false,
  };
}

function extractTitle(): string {
  // Prefer Open Graph title, then <title>.
  const og = document.querySelector('meta[property="og:title"]');
  if (og) {
    const content = og.getAttribute('content');
    if (content && content.trim()) return content.trim();
  }
  return document.title || window.location.href;
}

/** Fallback when Readability declines to handle the page. */
function fallbackBodyHtml(): string {
  // Try common content containers before falling back to body.
  const candidates = [
    'article',
    'main',
    '[role="main"]',
    '#content',
    '#main-content',
    '.content',
    '.post',
    '.entry-content',
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el && el.textContent && el.textContent.trim().length > 200) {
      return el.innerHTML;
    }
  }
  return document.body.innerHTML;
}
