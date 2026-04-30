import { htmlToMarkdown } from '@/shared/markdown-converter';
import type { CapturedContext } from '@/shared/types';

/**
 * Stack Overflow parser. Captures the question and answers
 * (highest-voted first) into a single Markdown document.
 */
export function canHandleStackOverflow(): boolean {
  return (
    window.location.hostname === 'stackoverflow.com' ||
    window.location.hostname.endsWith('.stackoverflow.com') ||
    window.location.hostname === 'stackexchange.com' ||
    window.location.hostname.endsWith('.stackexchange.com')
  );
}

export function parseStackOverflow(): CapturedContext {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();
  const titleEl = document.querySelector('h1[itemprop="name"], h1.fs-headline1');
  const title = titleEl?.textContent?.trim() ?? document.title;

  const sections: string[] = [`# ${title}`];

  // Question body.
  const questionPost = document.querySelector('#question .s-prose, #question .post-text');
  if (questionPost) {
    sections.push('## Question\n\n' + htmlToMarkdown(questionPost.innerHTML));
  }

  // Tags.
  const tagEls = document.querySelectorAll('.post-tag');
  const tags = uniqueText(tagEls);

  // Answers.
  const answerPosts = document.querySelectorAll('.answer');
  const answers: string[] = [];
  answerPosts.forEach((answerEl, idx) => {
    const accepted = answerEl.classList.contains('accepted-answer');
    const score = answerEl.querySelector('.js-vote-count')?.textContent?.trim();
    const body = answerEl.querySelector('.s-prose, .post-text');
    if (!body) return;

    const heading = `### Answer ${idx + 1}` +
      (accepted ? ' (accepted)' : '') +
      (score ? ` — score ${score}` : '');
    answers.push(`${heading}\n\n${htmlToMarkdown(body.innerHTML)}`);
  });

  if (answers.length > 0) {
    sections.push('## Answers\n\n' + answers.join('\n\n'));
  }

  return {
    url,
    title,
    body: sections.join('\n\n'),
    tags: tags.length > 0 ? tags : undefined,
    capturedAt,
    parser: 'stackoverflow',
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
