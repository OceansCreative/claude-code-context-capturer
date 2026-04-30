import { htmlToMarkdown } from '@/shared/markdown-converter';
import type { CapturedContext } from '@/shared/types';

/**
 * Zenn (zenn.dev) parser. Handles articles, books, and scraps.
 */
export function canHandleZenn(): boolean {
  return window.location.hostname === 'zenn.dev';
}

export function parseZenn(): CapturedContext {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();
  const titleEl = document.querySelector<HTMLElement>('h1');
  const title = titleEl?.textContent?.trim() ?? document.title;

  // Zenn article body lives in `.znc` (Zenn Native Content) or `.BodyContent`.
  const bodyEl = document.querySelector('.znc, .BodyContent_anchorToHeadings__Wrh1V, article');
  const bodyHtml = bodyEl?.innerHTML ?? document.body.innerHTML;
  const bodyMarkdown = htmlToMarkdown(bodyHtml);

  // Author handle.
  const author =
    document.querySelector('a[href^="/"][class*="UserLink"]')?.textContent?.trim() ??
    document.querySelector('meta[name="author"]')?.getAttribute('content') ??
    undefined;

  // Tags / topics.
  const topicEls = document.querySelectorAll('a[href^="/topics/"]');
  const tags = uniqueText(topicEls);

  // Published date.
  const publishedAt =
    document.querySelector('meta[property="article:published_time"]')?.getAttribute(
      'content'
    ) ?? undefined;

  return {
    url,
    title,
    body: `# ${title}\n\n${bodyMarkdown}`,
    author,
    publishedAt,
    tags: tags.length > 0 ? tags : undefined,
    capturedAt,
    parser: 'zenn',
    fromSelection: false,
  };
}

function uniqueText(nodes: NodeListOf<Element>): string[] {
  const set = new Set<string>();
  nodes.forEach((node) => {
    const text = node.textContent?.trim();
    if (text) set.add(text);
  });
  return Array.from(set);
}
