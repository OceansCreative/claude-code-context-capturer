import { htmlToMarkdown } from '@/shared/markdown-converter';
import type { CapturedContext } from '@/shared/types';

/**
 * GitHub parser. Handles:
 * - Issues:        github.com/{owner}/{repo}/issues/{n}
 * - Pull Requests: github.com/{owner}/{repo}/pull/{n}
 * - Discussions:   github.com/{owner}/{repo}/discussions/{n}
 * - README files:  github.com/{owner}/{repo}
 *
 * Falls back to the generic parser for anything else.
 */
export function canHandleGitHub(): boolean {
  if (window.location.hostname !== 'github.com') return false;
  const path = window.location.pathname;
  return (
    /\/issues\/\d+/.test(path) ||
    /\/pull\/\d+/.test(path) ||
    /\/discussions\/\d+/.test(path) ||
    isRepoRoot(path)
  );
}

export function parseGitHub(): CapturedContext {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();
  const path = window.location.pathname;

  if (/\/issues\/\d+/.test(path)) {
    return parseIssueOrPr('issue', url, capturedAt);
  }
  if (/\/pull\/\d+/.test(path)) {
    return parseIssueOrPr('pr', url, capturedAt);
  }
  if (/\/discussions\/\d+/.test(path)) {
    return parseDiscussion(url, capturedAt);
  }
  if (isRepoRoot(path)) {
    return parseReadme(url, capturedAt);
  }
  // Should not reach here if canHandleGitHub returned true.
  return parseFallback(url, capturedAt);
}

function parseIssueOrPr(
  kind: 'issue' | 'pr',
  url: string,
  capturedAt: string
): CapturedContext {
  const titleEl = document.querySelector<HTMLElement>('bdi.js-issue-title, h1 bdi');
  const title = titleEl?.textContent?.trim() ?? document.title;

  // The first comment is the body of the issue/PR.
  const bodyEl = document.querySelector('.js-comment-body, .markdown-body');
  const bodyHtml = bodyEl?.innerHTML ?? '';
  const bodyMarkdown = htmlToMarkdown(bodyHtml);

  // Subsequent comments.
  const commentEls = document.querySelectorAll('.timeline-comment .js-comment-body');
  const comments: string[] = [];
  // Skip the first one (we already used it as the body).
  commentEls.forEach((el, i) => {
    if (i === 0) return;
    const author = findCommentAuthor(el);
    const md = htmlToMarkdown(el.innerHTML);
    if (md.trim()) {
      comments.push(`### ${author ?? 'Comment'}\n\n${md}`);
    }
  });

  // Labels.
  const labelEls = document.querySelectorAll('.js-issue-labels .IssueLabel');
  const tags = Array.from(labelEls)
    .map((el) => el.textContent?.trim())
    .filter((t): t is string => Boolean(t));

  // Author of the original post.
  const author =
    document.querySelector('.timeline-comment-header a.author')?.textContent?.trim() ??
    undefined;

  const sections: string[] = [];
  sections.push(`# ${title}`);
  sections.push(bodyMarkdown);
  if (comments.length > 0) {
    sections.push('## Comments\n\n' + comments.join('\n\n'));
  }

  return {
    url,
    title: `[${kind === 'issue' ? 'Issue' : 'PR'}] ${title}`,
    body: sections.join('\n\n'),
    author,
    tags: tags.length > 0 ? tags : undefined,
    capturedAt,
    parser: 'github',
    fromSelection: false,
  };
}

function parseDiscussion(url: string, capturedAt: string): CapturedContext {
  const titleEl = document.querySelector<HTMLElement>('h1');
  const title = titleEl?.textContent?.trim() ?? document.title;

  const bodyEl = document.querySelector('.js-comment-body, .markdown-body');
  const bodyHtml = bodyEl?.innerHTML ?? '';
  const bodyMarkdown = htmlToMarkdown(bodyHtml);

  return {
    url,
    title: `[Discussion] ${title}`,
    body: `# ${title}\n\n${bodyMarkdown}`,
    capturedAt,
    parser: 'github',
    fromSelection: false,
  };
}

function parseReadme(url: string, capturedAt: string): CapturedContext {
  // The README is rendered into <article class="markdown-body">.
  const article = document.querySelector('article.markdown-body, #readme article');
  const bodyHtml = article?.innerHTML ?? '';
  const bodyMarkdown = htmlToMarkdown(bodyHtml);

  // Repo name from path: /{owner}/{repo}.
  const segments = window.location.pathname.split('/').filter(Boolean);
  const repoFullName = segments.slice(0, 2).join('/');

  return {
    url,
    title: `[Repo] ${repoFullName}`,
    body: bodyMarkdown,
    capturedAt,
    parser: 'github',
    fromSelection: false,
  };
}

function parseFallback(url: string, capturedAt: string): CapturedContext {
  return {
    url,
    title: document.title,
    body: htmlToMarkdown(document.body.innerHTML),
    capturedAt,
    parser: 'github',
    fromSelection: false,
  };
}

function findCommentAuthor(commentEl: Element): string | undefined {
  let current: Element | null = commentEl;
  while (current) {
    if (current.classList?.contains('timeline-comment')) {
      const a = current.querySelector('a.author');
      return a?.textContent?.trim();
    }
    current = current.parentElement;
  }
  return undefined;
}

function isRepoRoot(path: string): boolean {
  // /{owner}/{repo} or /{owner}/{repo}/
  const segments = path.split('/').filter(Boolean);
  return segments.length === 2;
}
