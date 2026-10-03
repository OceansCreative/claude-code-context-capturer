import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canHandleNotion,
  parseNotion,
  extractPageId,
  dashifyId,
  buildTreeFromRecordMap,
  richTextToMarkdown,
  renderMarkdown,
} from '@/content/parsers/notion';

const PAGE_HEX = '1a2b3c4d5e6f7890abcdef1234567890';
const PAGE_ID = '1a2b3c4d-5e6f-7890-abcd-ef1234567890';
const PAGE_URL = `https://www.notion.so/My-Spec-${PAGE_HEX}`;

function setLocation(url: string): void {
  const u = new URL(url);
  Object.defineProperty(window, 'location', {
    value: {
      href: u.href,
      origin: u.origin,
      hostname: u.hostname,
      pathname: u.pathname,
      search: u.search,
    },
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// recordMap fixture builders — mirror `{ <id>: { role, value: {...block} } }`.
// ---------------------------------------------------------------------------

type Rich = unknown[];
function text(s: string): Rich {
  return [[s]];
}

function block(
  id: string,
  type: string,
  extra: Record<string, unknown> = {}
): [string, unknown] {
  return [id, { role: 'reader', value: { id, type, ...extra } }];
}

/** A full one-page recordMap exercising every supported block type. */
function fullRecordMap(): Record<string, unknown> {
  const entries: [string, unknown][] = [
    block(PAGE_ID, 'page', {
      created_time: 1_700_000_000_000,
      properties: { title: text('My Spec') },
      content: [
        'h1',
        'h2',
        'h3',
        'para',
        'bul',
        'num1',
        'num2',
        'code',
        'todo1',
        'todo2',
        'quote',
        'callout',
        'toggle',
        'table',
      ],
    }),
    block('h1', 'header', { properties: { title: text('Overview') } }),
    block('h2', 'sub_header', { properties: { title: text('Design') } }),
    block('h3', 'sub_sub_header', { properties: { title: text('Specifics') } }),
    block('para', 'text', {
      properties: { title: [['Hello ', []], ['world', [['b']]], ['!', []]] },
    }),
    block('bul', 'bulleted_list', {
      properties: { title: text('Parent item') },
      content: ['bul-child'],
    }),
    block('bul-child', 'bulleted_list', {
      properties: { title: text('Nested item') },
    }),
    block('num1', 'numbered_list', { properties: { title: text('First') } }),
    block('num2', 'numbered_list', { properties: { title: text('Second') } }),
    block('code', 'code', {
      properties: {
        title: [['const x: number = 1;\nreturn x;']],
        language: [['TypeScript']],
      },
    }),
    block('todo1', 'to_do', {
      properties: { title: text('Ship it'), checked: [['Yes']] },
    }),
    block('todo2', 'to_do', { properties: { title: text('Write docs') } }),
    block('quote', 'quote', { properties: { title: text('A pithy remark') } }),
    block('callout', 'callout', {
      properties: { title: text('Heads up') },
      format: { page_icon: '💡' },
    }),
    block('toggle', 'toggle', {
      properties: { title: text('Details') },
      content: ['toggle-child'],
    }),
    block('toggle-child', 'text', {
      properties: { title: text('Hidden content') },
    }),
    block('table', 'table', {
      format: { table_block_column_order: ['cA', 'cB'] },
      content: ['row1', 'row2'],
    }),
    block('row1', 'table_row', {
      properties: { cA: text('Name'), cB: text('Role') },
    }),
    block('row2', 'table_row', {
      properties: { cA: text('Alice'), cB: text('Dev') },
    }),
  ];
  return Object.fromEntries(entries);
}

// ---------------------------------------------------------------------------
// canHandleNotion / extractPageId / dashifyId
// ---------------------------------------------------------------------------

describe('canHandleNotion', () => {
  it('accepts a www.notion.so page URL with a slug + id', () => {
    setLocation(PAGE_URL);
    expect(canHandleNotion()).toBe(true);
  });

  it('accepts a public notion.site page URL', () => {
    setLocation(`https://acme.notion.site/Release-Notes-${PAGE_HEX}`);
    expect(canHandleNotion()).toBe(true);
  });

  it('accepts a bare-id URL', () => {
    setLocation(`https://www.notion.so/${PAGE_HEX}`);
    expect(canHandleNotion()).toBe(true);
  });

  it('rejects the dashboard / workspace root (no page id)', () => {
    setLocation('https://www.notion.so/myteam');
    expect(canHandleNotion()).toBe(false);
  });

  it('rejects the login page', () => {
    setLocation('https://www.notion.so/login');
    expect(canHandleNotion()).toBe(false);
  });

  it('rejects a non-Notion host even with an id-like tail', () => {
    setLocation(`https://example.com/page-${PAGE_HEX}`);
    expect(canHandleNotion()).toBe(false);
  });
});

describe('extractPageId / dashifyId', () => {
  it('extracts + dashifies the id from a slugged path', () => {
    expect(extractPageId(`/My-Spec-${PAGE_HEX}`)).toBe(PAGE_ID);
  });

  it('extracts from a workspace-prefixed path', () => {
    expect(extractPageId(`/myteam/Design-Notes-${PAGE_HEX}`)).toBe(PAGE_ID);
  });

  it('accepts an already-dashed uuid segment', () => {
    expect(extractPageId(`/${PAGE_ID}`)).toBe(PAGE_ID);
  });

  it('returns undefined when there is no id', () => {
    expect(extractPageId('/login')).toBeUndefined();
    expect(extractPageId('/')).toBeUndefined();
  });

  it('dashifies a 32-hex string into 8-4-4-4-12', () => {
    expect(dashifyId(PAGE_HEX)).toBe(PAGE_ID);
  });
});

// ---------------------------------------------------------------------------
// richTextToMarkdown (pure)
// ---------------------------------------------------------------------------

describe('richTextToMarkdown', () => {
  it('maps bold / italic / strike / code / link decorations', () => {
    setLocation(PAGE_URL);
    const rich = [
      ['plain '],
      ['bold', [['b']]],
      [' '],
      ['italic', [['i']]],
      [' '],
      ['struck', [['s']]],
      [' '],
      ['snippet', [['c']]],
      [' '],
      ['link', [['a', 'https://example.com']]],
    ];
    expect(richTextToMarkdown(rich)).toBe(
      'plain **bold** *italic* ~~struck~~ `snippet` [link](https://example.com/)'
    );
  });

  it('renders inline equations and drops unresolved mention glyphs', () => {
    const rich = [
      ['before '],
      ['⁍', [['e', 'E = mc^2']]],
      [' after '],
      ['‣', [['p', 'some-page-id']]],
    ];
    expect(richTextToMarkdown(rich)).toBe('before $E = mc^2$ after');
  });

  it('returns empty string for non-array input', () => {
    expect(richTextToMarkdown(undefined)).toBe('');
    expect(richTextToMarkdown('nope')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildTreeFromRecordMap (pure) + renderMarkdown
// ---------------------------------------------------------------------------

describe('buildTreeFromRecordMap', () => {
  beforeEach(() => setLocation(PAGE_URL));

  it('builds the title + ordered block tree from the record map', () => {
    const { title, blocks, createdTime } = buildTreeFromRecordMap(
      fullRecordMap(),
      PAGE_ID
    );
    expect(title).toBe('My Spec');
    expect(createdTime).toBe(1_700_000_000_000);
    expect(blocks.map((b) => b.type)).toEqual([
      'h1',
      'h2',
      'h3',
      'p',
      'bulleted',
      'numbered',
      'numbered',
      'code',
      'todo',
      'todo',
      'quote',
      'callout',
      'toggle',
      'table',
    ]);
    // Nested bullet is a child of the parent bullet, not a top-level block.
    const bullet = blocks.find((b) => b.type === 'bulleted')!;
    expect(bullet.children.map((c) => c.text)).toEqual(['Nested item']);
  });

  it('throws a private/empty error when the root block is absent', () => {
    expect(() => buildTreeFromRecordMap({}, PAGE_ID)).toThrow(/empty, private/i);
  });

  it('terminates on a cyclic content reference', () => {
    const map = Object.fromEntries([
      block(PAGE_ID, 'page', { properties: { title: text('Cycle') }, content: ['a'] }),
      block('a', 'text', { properties: { title: text('A') }, content: ['a'] }),
    ]);
    const { blocks } = buildTreeFromRecordMap(map, PAGE_ID);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('A');
    expect(blocks[0].children).toHaveLength(0);
  });
});

describe('renderMarkdown (via the full tree)', () => {
  beforeEach(() => setLocation(PAGE_URL));

  it('renders every supported block type to Markdown', () => {
    const { title, blocks } = buildTreeFromRecordMap(fullRecordMap(), PAGE_ID);
    const md = renderMarkdown(title, blocks);

    expect(md).toContain('# My Spec');
    expect(md).toContain('# Overview');
    expect(md).toContain('## Design');
    expect(md).toContain('### Specifics');
    expect(md).toContain('Hello **world**!');
    expect(md).toContain('- Parent item');
    expect(md).toContain('  - Nested item');
    expect(md).toContain('1. First');
    expect(md).toContain('2. Second');
    expect(md).toContain('```typescript');
    expect(md).toContain('const x: number = 1;');
    expect(md).toContain('- [x] Ship it');
    expect(md).toContain('- [ ] Write docs');
    expect(md).toContain('> A pithy remark');
    expect(md).toContain('> 💡 Heads up');
    expect(md).toContain('<summary>Details</summary>');
    expect(md).toContain('Hidden content');
    expect(md).toContain('| Name | Role |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| Alice | Dev |');
  });
});

// ---------------------------------------------------------------------------
// parseNotion (with mocked fetch)
// ---------------------------------------------------------------------------

describe('parseNotion (with mocked fetch)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    document.body.innerHTML = '';
    setLocation(PAGE_URL);
  });

  afterEach(() => vi.restoreAllMocks());

  function chunkResponse(block: Record<string, unknown>, stack: unknown[] = []): Response {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ recordMap: { block }, cursor: { stack } }),
    } as unknown as Response;
  }

  it('captures a page end to end with metadata + dedupeKey', async () => {
    fetchMock.mockResolvedValue(chunkResponse(fullRecordMap()));

    const ctx = await parseNotion();
    expect(ctx.parser).toBe('notion');
    expect(ctx.title).toBe('My Spec');
    expect(ctx.fromSelection).toBe(false);
    expect(ctx.dedupeKey).toBe(`notion:${PAGE_ID}`);
    expect(ctx.tags).toEqual(['notion', 'My Spec']);
    expect(ctx.publishedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(ctx.body).toContain('# My Spec');
    expect(ctx.body).toContain('```typescript');

    // The chunk fetch is a same-origin POST with the dashed page id.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.notion.so/api/v3/loadPageChunk');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).pageId).toBe(PAGE_ID);
  });

  it('merges paginated chunks until the cursor stack empties', async () => {
    const first = Object.fromEntries([
      block(PAGE_ID, 'page', {
        properties: { title: text('Paged') },
        content: ['a', 'b'],
      }),
      block('a', 'text', { properties: { title: text('Alpha') } }),
    ]);
    const second = Object.fromEntries([
      block('b', 'text', { properties: { title: text('Bravo') } }),
    ]);
    fetchMock
      .mockResolvedValueOnce(chunkResponse(first, [{ table: 'block', id: 'b' }]))
      .mockResolvedValueOnce(chunkResponse(second, []));

    const ctx = await parseNotion();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ctx.body).toContain('Alpha');
    expect(ctx.body).toContain('Bravo');
  });

  it('throws a friendly logged-out error on HTTP 401', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);
    await expect(parseNotion()).rejects.toThrow(/logged out|access to this page/i);
  });

  it('throws a private/empty error when the root block is missing', async () => {
    fetchMock.mockResolvedValue(chunkResponse({ 'other-id': { value: {} } }));
    await expect(parseNotion()).rejects.toThrow(/empty, private/i);
  });

  it('throws an unexpected-shape error when recordMap.block is absent', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ nope: true }),
    } as unknown as Response);
    await expect(parseNotion()).rejects.toThrow(/unexpected response shape/i);
  });

  it('errors cleanly when the URL carries no page id', async () => {
    setLocation('https://www.notion.so/login');
    await expect(parseNotion()).rejects.toThrow(/page ID/i);
  });
});

// ---------------------------------------------------------------------------
// DOM fallback — used when the internal API is unreachable.
// ---------------------------------------------------------------------------

describe('parseNotion DOM fallback', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    // API unreachable → the parser falls back to the rendered DOM.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setLocation(PAGE_URL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('parses blocks from .notion-page-content when the API fails', async () => {
    document.title = 'DOM Spec';
    document.body.innerHTML = `
      <div class="notion-page-block" data-block-id="p"><div>DOM Spec</div></div>
      <div class="notion-page-content">
        <div class="notion-header-block" data-block-id="h"><div>DOM Heading</div></div>
        <div class="notion-text-block" data-block-id="t">
          A paragraph with a <a href="https://example.com">link</a>.
        </div>
        <div class="notion-bulleted_list-block" data-block-id="b1">
          <div>Outer bullet</div>
          <div class="notion-bulleted_list-block" data-block-id="b2"><div>Inner bullet</div></div>
        </div>
      </div>
    `;

    const ctx = await parseNotion();
    expect(ctx.parser).toBe('notion');
    expect(ctx.title).toBe('DOM Spec');
    expect(ctx.body).toContain('# DOM Spec');
    expect(ctx.body).toContain('# DOM Heading');
    expect(ctx.body).toContain('[link](https://example.com/)');
    expect(ctx.body).toContain('- Outer bullet');
    expect(ctx.body).toContain('  - Inner bullet');
    expect(ctx.dedupeKey).toBe(`notion:${PAGE_ID}`);
  });

  it('surfaces the API error when the DOM has no Notion content', async () => {
    document.body.innerHTML = '<div>not a notion page</div>';
    await expect(parseNotion()).rejects.toThrow();
  });
});
