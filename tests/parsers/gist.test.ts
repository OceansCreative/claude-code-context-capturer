import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canHandleGist,
  parseGist,
  extractGistId,
  langForFilename,
} from '@/content/parsers/gist';

const GIST_ID = 'ded7f0e629937be4887950b74991aa08'; // 32 hex
const GIST_URL = `https://gist.github.com/alice/${GIST_ID}`;

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// DOM fixture builders — mirror gist.github.com's single-gist markup.
// ---------------------------------------------------------------------------

interface FileFixture {
  name: string;
  /** Code files: one entry per line ('' → a blank line). */
  lines?: string[];
  /** Markdown/rST files: the rendered HTML inside `.markdown-body`. */
  markdownHtml?: string;
  /** The "Raw" link href (relative). */
  rawHref?: string;
}

interface GistFixture {
  description?: string;
  author?: string;
  datetime?: string;
  files: FileFixture[];
}

function buildFile(f: FileFixture): HTMLElement {
  const file = document.createElement('div');
  file.className = 'file my-2';

  const header = document.createElement('div');
  header.className = 'file-header';

  const actions = document.createElement('div');
  actions.className = 'file-actions';
  if (f.rawHref) {
    const raw = document.createElement('a');
    raw.setAttribute('href', f.rawHref);
    raw.textContent = 'Raw';
    actions.appendChild(raw);
  }

  const info = document.createElement('div');
  info.className = 'file-info';
  const nameA = document.createElement('a');
  nameA.className = 'gist-blob-name css-truncate-target';
  nameA.textContent = f.name;
  info.appendChild(nameA);

  header.appendChild(actions);
  header.appendChild(info);
  file.appendChild(header);

  if (f.lines) {
    const wrapper = document.createElement('div');
    wrapper.className = 'blob-wrapper';
    const table = document.createElement('table');
    table.className = 'highlight tab-size js-file-line-container';
    const tbody = document.createElement('tbody');
    for (const line of f.lines) {
      const tr = document.createElement('tr');
      const num = document.createElement('td');
      num.className = 'blob-num';
      const code = document.createElement('td');
      code.className = 'blob-code blob-code-inner';
      // GitHub renders a blank line as a lone newline, content lines without one.
      code.textContent = line === '' ? '\n' : line;
      tr.appendChild(num);
      tr.appendChild(code);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    file.appendChild(wrapper);
  } else if (f.markdownHtml) {
    const box = document.createElement('div');
    box.className = 'Box-body readme blob';
    const article = document.createElement('article');
    article.className = 'markdown-body';
    article.innerHTML = f.markdownHtml;
    box.appendChild(article);
    file.appendChild(box);
  }

  return file;
}

function buildGist(fixture: GistFixture): void {
  document.body.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'gisthead';
  if (fixture.author) {
    const span = document.createElement('span');
    span.className = 'author';
    const a = document.createElement('a');
    a.setAttribute('href', `/${fixture.author}`);
    a.textContent = fixture.author;
    span.appendChild(a);
    head.appendChild(span);
  }
  if (fixture.datetime) {
    const rt = document.createElement('relative-time');
    rt.setAttribute('datetime', fixture.datetime);
    rt.textContent = 'October 3, 2026';
    head.appendChild(rt);
  }
  if (fixture.description) {
    const about = document.createElement('div');
    about.setAttribute('itemprop', 'about');
    about.textContent = fixture.description;
    head.appendChild(about);
  }
  document.body.appendChild(head);

  const content = document.createElement('div');
  content.className = 'gist-content';
  for (const f of fixture.files) content.appendChild(buildFile(f));
  document.body.appendChild(content);
}

// ---------------------------------------------------------------------------
// canHandleGist
// ---------------------------------------------------------------------------

describe('canHandleGist', () => {
  it('rejects non-gist hosts', () => {
    setLocation('https://example.com/alice/foo');
    expect(canHandleGist()).toBe(false);
  });

  it('rejects github.com (owned by the github parser)', () => {
    setLocation('https://github.com/owner/repo/issues/42');
    expect(canHandleGist()).toBe(false);
  });

  it('accepts a /<user>/<id> gist URL', () => {
    setLocation(GIST_URL);
    expect(canHandleGist()).toBe(true);
  });

  it('accepts a bare /<id> gist URL', () => {
    setLocation(`https://gist.github.com/${GIST_ID}`);
    expect(canHandleGist()).toBe(true);
  });

  it('rejects the gist home page', () => {
    setLocation('https://gist.github.com/');
    expect(canHandleGist()).toBe(false);
  });

  it('rejects the discover page', () => {
    setLocation('https://gist.github.com/discover');
    expect(canHandleGist()).toBe(false);
  });

  it('rejects a user profile page (no gist id)', () => {
    setLocation('https://gist.github.com/alice');
    expect(canHandleGist()).toBe(false);
  });
});

describe('extractGistId', () => {
  it('pulls the id from /<user>/<id>', () => {
    expect(extractGistId(`/alice/${GIST_ID}`)).toBe(GIST_ID);
  });
  it('pulls the id from a bare /<id>', () => {
    expect(extractGistId(`/${GIST_ID}`)).toBe(GIST_ID);
  });
  it('lowercases the id (dedupe stability)', () => {
    expect(extractGistId(`/alice/${GIST_ID.toUpperCase()}`)).toBe(GIST_ID);
  });
  it('returns undefined for non-gist paths', () => {
    expect(extractGistId('/discover')).toBeUndefined();
    expect(extractGistId('/alice')).toBeUndefined();
    expect(extractGistId('/')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// langForFilename
// ---------------------------------------------------------------------------

describe('langForFilename', () => {
  it('maps common extensions to fence languages', () => {
    expect(langForFilename('hello.py')).toBe('python');
    expect(langForFilename('app.ts')).toBe('typescript');
    expect(langForFilename('component.tsx')).toBe('tsx');
    expect(langForFilename('index.html')).toBe('html');
    expect(langForFilename('style.scss')).toBe('scss');
    expect(langForFilename('data.json')).toBe('json');
    expect(langForFilename('notes.md')).toBe('markdown');
    expect(langForFilename('run.sh')).toBe('bash');
  });

  it('recognizes extension-less convention files', () => {
    expect(langForFilename('Dockerfile')).toBe('dockerfile');
    expect(langForFilename('Makefile')).toBe('makefile');
  });

  it('returns empty for unknown or absent extensions', () => {
    expect(langForFilename('scripts')).toBe('');
    expect(langForFilename('mystery.xyz')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseGist — code files (pure DOM, no network)
// ---------------------------------------------------------------------------

describe('parseGist - single code file', () => {
  beforeEach(() => {
    setLocation(GIST_URL);
    buildGist({
      description: 'My handy snippet',
      author: 'alice',
      datetime: '2026-10-03T09:03:44Z',
      files: [
        {
          name: 'hello.py',
          lines: ['def hello():', '', '    return "hi"'],
        },
      ],
    });
  });

  it('captures title, author, file block, and metadata', async () => {
    const ctx = await parseGist();
    expect(ctx.parser).toBe('gist');
    expect(ctx.title).toBe('[Gist] My handy snippet');
    expect(ctx.author).toBe('alice');
    expect(ctx.tags).toEqual(['gist', 'github']);
    expect(ctx.dedupeKey).toBe(`gist:${GIST_ID}`);
    expect(ctx.publishedAt).toBe('2026-10-03T09:03:44.000Z');
    expect(ctx.fromSelection).toBe(false);

    expect(ctx.body).toContain('# My handy snippet');
    expect(ctx.body).toContain('*by [alice](https://gist.github.com/alice)*');
    expect(ctx.body).toContain('## hello.py');
    expect(ctx.body).toContain('```python');
    // Blank line between the two statements is preserved verbatim.
    expect(ctx.body).toContain('def hello():\n\n    return "hi"');
  });

  it('falls back to the first filename when there is no description', async () => {
    buildGist({
      author: 'alice',
      files: [{ name: 'gistfile1.txt', lines: ['plain text'] }],
    });
    const ctx = await parseGist();
    expect(ctx.title).toBe('[Gist] gistfile1.txt');
    expect(ctx.body).toContain('# gistfile1.txt');
    // .txt has no mapped language → bare fence.
    expect(ctx.body).toContain('```\nplain text\n```');
  });
});

describe('parseGist - multiple files', () => {
  beforeEach(() => {
    setLocation(GIST_URL);
    buildGist({
      description: 'Two files',
      author: 'bob',
      files: [
        { name: 'app.js', lines: ['const x = 1;'] },
        { name: 'styles.css', lines: ['body { margin: 0; }'] },
      ],
    });
  });

  it('renders one heading + fenced block per file, in order, with per-file language', async () => {
    const ctx = await parseGist();
    expect(ctx.body).toContain('## app.js');
    expect(ctx.body).toContain('```javascript\nconst x = 1;\n```');
    expect(ctx.body).toContain('## styles.css');
    expect(ctx.body).toContain('```css\nbody { margin: 0; }\n```');
    // app.js comes before styles.css.
    expect(ctx.body.indexOf('## app.js')).toBeLessThan(ctx.body.indexOf('## styles.css'));
  });
});

// ---------------------------------------------------------------------------
// parseGist — rendered Markdown files (prefer raw source; DOM fallback)
// ---------------------------------------------------------------------------

describe('parseGist - rendered markdown file', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    setLocation(GIST_URL);
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    buildGist({
      description: 'A readme gist',
      author: 'carol',
      files: [
        {
          name: 'README.md',
          markdownHtml: '<h1>Rendered Heading</h1><p>rendered body</p>',
          rawHref: `/carol/${GIST_ID}/raw/abc123/README.md`,
        },
      ],
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('prefers the raw source over the rendered HTML', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '# Real Source\n\nThe true markdown.',
    } as unknown as Response);

    const ctx = await parseGist();
    expect(ctx.body).toContain('## README.md');
    expect(ctx.body).toContain('```markdown');
    expect(ctx.body).toContain('# Real Source');
    expect(ctx.body).toContain('The true markdown.');
    // The rendered HTML text must NOT be used when raw source is available.
    expect(ctx.body).not.toContain('rendered body');

    // Raw link was fetched same-origin, resolved to an absolute URL.
    const [calledUrl] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(`https://gist.github.com/carol/${GIST_ID}/raw/abc123/README.md`);
  });

  it('falls back to the rendered HTML when the raw fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as unknown as Response);

    const ctx = await parseGist();
    expect(ctx.body).toContain('## README.md');
    expect(ctx.body).toContain('Rendered Heading');
    expect(ctx.body).toContain('rendered body');
  });
});

// ---------------------------------------------------------------------------
// parseGist — error paths (never an empty/corrupt capture)
// ---------------------------------------------------------------------------

describe('parseGist - no content', () => {
  beforeEach(() => setLocation(GIST_URL));

  it('throws a friendly error when a file has no extractable content', async () => {
    buildGist({
      description: 'Broken',
      author: 'dan',
      // A file element with a name but neither a code table, markdown body, nor raw link.
      files: [{ name: 'empty.bin' }],
    });
    await expect(parseGist()).rejects.toThrow(/No file content found/i);
  });

  it('throws a friendly error when the gist has no files at all', async () => {
    document.body.innerHTML = '<div class="gisthead"></div><div class="gist-content"></div>';
    await expect(parseGist()).rejects.toThrow(/No file content found/i);
  });
});
