import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/**
 * A configured Turndown service that produces clean Markdown
 * suitable for pasting into Claude Code or any LLM context.
 */
export function createConverter(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    hr: '---',
  });

  // GitHub Flavored Markdown: tables, strikethrough, task lists, etc.
  td.use(gfm);

  // Drop elements that add noise.
  td.remove(['script', 'style', 'noscript', 'iframe', 'form']);

  // Normalize <pre><code class="language-xxx">...</code></pre>
  // so the language hint survives in fenced code blocks.
  td.addRule('languageAwareCodeBlock', {
    filter: function filter(node) {
      return (
        node.nodeName === 'PRE' &&
        node.firstChild !== null &&
        node.firstChild.nodeName === 'CODE'
      );
    },
    replacement: function replacement(_, node) {
      const codeEl = (node as HTMLElement).querySelector('code');
      if (!codeEl) return '';
      const language = detectLanguage(codeEl);
      const code = codeEl.textContent ?? '';
      const fence = '```';
      return `\n\n${fence}${language}\n${code.replace(/\n$/, '')}\n${fence}\n\n`;
    },
  });

  // Strip footnote and aria attributes that don't translate to Markdown.
  td.addRule('cleanupAriaSpans', {
    filter: function filter(node) {
      return (
        node.nodeName === 'SPAN' &&
        (node as HTMLElement).getAttribute('aria-hidden') === 'true'
      );
    },
    replacement: function replacement() {
      return '';
    },
  });

  return td;
}

/**
 * Convert an HTML element (or string) to Markdown.
 */
export function htmlToMarkdown(html: string | HTMLElement): string {
  const td = createConverter();
  const md = td.turndown(html);
  return collapseWhitespace(md);
}

/**
 * Detect the language hint from a <code> element's class list.
 * Supports both `language-foo` and `lang-foo` conventions.
 */
function detectLanguage(codeEl: Element): string {
  const classes = codeEl.className.split(/\s+/);
  for (const cls of classes) {
    const m = cls.match(/^(?:language|lang)-(.+)$/);
    if (m) return m[1];
  }
  return '';
}

/** Collapse runs of 3+ blank lines into 2. */
function collapseWhitespace(md: string): string {
  return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
