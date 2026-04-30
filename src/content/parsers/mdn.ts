import { htmlToMarkdown } from '@/shared/markdown-converter';
import type { CapturedContext } from '@/shared/types';

/**
 * MDN Web Docs (developer.mozilla.org) parser.
 * Strips navigation, sidebars, and survey widgets.
 */
export function canHandleMdn(): boolean {
  return window.location.hostname === 'developer.mozilla.org';
}

export function parseMdn(): CapturedContext {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();
  const titleEl = document.querySelector<HTMLElement>('h1');
  const title = titleEl?.textContent?.trim() ?? document.title;

  // MDN main content lives under <article class="main-page-content">.
  const articleEl = document.querySelector('article.main-page-content, article.text-content');
  if (!articleEl) {
    return {
      url,
      title,
      body: `# ${title}\n\n${htmlToMarkdown(document.body.innerHTML)}`,
      capturedAt,
      parser: 'mdn',
      fromSelection: false,
    };
  }

  // Clone so we can prune without affecting the live page.
  const clone = articleEl.cloneNode(true) as HTMLElement;

  // Drop common MDN noise: in-page surveys, "this article", related-content sidebars.
  const noiseSelectors = [
    '.in-nav-toc',
    '.metadata',
    '.on-github',
    '.section-content > .notecard.experimental',
    'aside',
    '.document-toc-container',
    '.survey',
    '.mdn-cta',
  ];
  noiseSelectors.forEach((sel) => {
    clone.querySelectorAll(sel).forEach((el) => el.remove());
  });

  const bodyMarkdown = htmlToMarkdown(clone.innerHTML);

  // Tags from MDN's metadata block.
  const tagEls = document.querySelectorAll('.metadata a[href*="/tags/"]');
  const tags = Array.from(tagEls)
    .map((el) => el.textContent?.trim())
    .filter((t): t is string => Boolean(t));

  return {
    url,
    title,
    body: `# ${title}\n\n${bodyMarkdown}`,
    tags: tags.length > 0 ? tags : undefined,
    capturedAt,
    parser: 'mdn',
    fromSelection: false,
  };
}
