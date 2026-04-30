import { htmlToMarkdown } from '@/shared/markdown-converter';
import type { CapturedContext } from '@/shared/types';

/**
 * Qiita (qiita.com) parser. Captures articles into Markdown
 * with frontmatter-friendly metadata.
 */
export function canHandleQiita(): boolean {
  return window.location.hostname === 'qiita.com';
}

export function parseQiita(): CapturedContext {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();
  const titleEl = document.querySelector<HTMLElement>('h1');
  const title = titleEl?.textContent?.trim() ?? document.title;

  // Qiita article body uses .it-MdContent or similar; fall back to <article>.
  const bodyEl = document.querySelector('.it-MdContent, article .markdownContent, article');
  const bodyHtml = bodyEl?.innerHTML ?? document.body.innerHTML;
  const bodyMarkdown = htmlToMarkdown(bodyHtml);

  const author =
    document.querySelector('a[href*="qiita.com/"][class*="UserName"]')?.textContent?.trim() ??
    document.querySelector('meta[name="author"]')?.getAttribute('content') ??
    undefined;

  // Tags.
  const tagEls = document.querySelectorAll('a[href^="/tags/"]');
  const tags = uniqueText(tagEls);

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
    parser: 'qiita',
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
