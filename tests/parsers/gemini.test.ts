import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canHandleGemini,
  parseGemini,
  collectTurns,
  extractConversationId,
} from '@/content/parsers/gemini';

const CONVERSATION_ID = 'fa34f7a4dc8c14ac';

function setLocation(url: string): void {
  const u = new URL(url);
  Object.defineProperty(window, 'location', {
    value: {
      href: u.href,
      hostname: u.hostname,
      pathname: u.pathname,
      search: u.search,
      origin: u.origin,
    },
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Fixtures — mirror the real gemini.google.com DOM (verified live).
// ---------------------------------------------------------------------------

interface TurnFixture {
  id: string;
  /** Visible prompt text. */
  prompt: string;
  /** Inner HTML of the response `.markdown` div (omit for an unanswered turn). */
  responseHtml?: string;
}

/** A Gemini code-block custom element, matching the live decoration/code shape. */
function codeBlock(lang: string, code: string): string {
  return `
    <response-element class="no-md">
      <code-block>
        <div class="code-block">
          <div class="formatted-code-block-internal-container">
            <div class="animated-opacity">
              <div class="code-block-decoration header-formatted">
                <span>${lang}</span>
                <div class="buttons">
                  <gem-icon-button><button aria-label="Copy code"><mat-icon>copy</mat-icon></button></gem-icon-button>
                </div>
              </div>
              <pre><code data-test-id="code-content" class="code-container formatted">${code}</code></pre>
            </div>
          </div>
        </div>
      </code-block>
    </response-element>`;
}

function conversationContainer(t: TurnFixture): string {
  const response =
    t.responseHtml !== undefined
      ? `
      <model-response>
        <response-container>
          <message-content id="message-content-id-${t.id}">
            <structured-content-container class="model-response-text">
              <div class="markdown">${t.responseHtml}</div>
            </structured-content-container>
          </message-content>
        </response-container>
      </model-response>`
      : '';
  // .query-text embeds the hidden screen-reader label that duplicates the prompt.
  return `
    <div class="conversation-container" id="${t.id}">
      <user-query>
        <user-query-content>
          <div class="query-text">
            <h5 class="cdk-visually-hidden"><span>あなたのプロンプト</span> ${t.prompt} </h5>
            <p>${t.prompt}</p>
          </div>
        </user-query-content>
      </user-query>
      ${response}
    </div>`;
}

function renderConversation(turns: TurnFixture[]): void {
  document.body.innerHTML = turns.map(conversationContainer).join('\n');
}

// ---------------------------------------------------------------------------
// canHandleGemini / extractConversationId
// ---------------------------------------------------------------------------

describe('canHandleGemini', () => {
  it('returns true on an /app/<id> conversation URL', () => {
    setLocation(`https://gemini.google.com/app/${CONVERSATION_ID}`);
    expect(canHandleGemini()).toBe(true);
  });

  it('returns true on a /share/<id> public conversation URL', () => {
    setLocation('https://gemini.google.com/share/abc123def456');
    expect(canHandleGemini()).toBe(true);
  });

  it('returns false on the Gemini home / new-chat page', () => {
    setLocation('https://gemini.google.com/app');
    expect(canHandleGemini()).toBe(false);
  });

  it('returns false on a non-Gemini host', () => {
    setLocation(`https://example.com/app/${CONVERSATION_ID}`);
    expect(canHandleGemini()).toBe(false);
  });

  it('returns false on another Google product host', () => {
    setLocation(`https://mail.google.com/app/${CONVERSATION_ID}`);
    expect(canHandleGemini()).toBe(false);
  });
});

describe('extractConversationId', () => {
  it('extracts the id from an /app/<id> path', () => {
    expect(extractConversationId(`/app/${CONVERSATION_ID}`)).toBe(CONVERSATION_ID);
  });

  it('extracts the id from a /share/<id> path', () => {
    expect(extractConversationId('/share/abc123def456')).toBe('abc123def456');
  });

  it('returns undefined for a non-conversation path', () => {
    expect(extractConversationId('/app')).toBeUndefined();
    expect(extractConversationId('/')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// collectTurns (pure DOM walk)
// ---------------------------------------------------------------------------

describe('collectTurns', () => {
  it('pairs each container into user + model turns in DOM order', () => {
    renderConversation([
      { id: 'c1', prompt: 'First question', responseHtml: '<p>First answer</p>' },
      { id: 'c2', prompt: 'Second question', responseHtml: '<p>Second answer</p>' },
    ]);
    const turns = collectTurns(
      Array.from(document.querySelectorAll('.conversation-container'))
    );
    expect(turns.map((t) => t.role)).toEqual(['user', 'model', 'user', 'model']);
    expect(turns.map((t) => t.content)).toEqual([
      'First question',
      'First answer',
      'Second question',
      'Second answer',
    ]);
  });

  it('strips the hidden screen-reader label (prompt not duplicated)', () => {
    renderConversation([{ id: 'c1', prompt: 'Only once please', responseHtml: '<p>ok</p>' }]);
    const turns = collectTurns(
      Array.from(document.querySelectorAll('.conversation-container'))
    );
    const prompt = turns[0].content;
    expect(prompt).toBe('Only once please');
    // The screen-reader label text must not leak in.
    expect(prompt).not.toContain('あなたのプロンプト');
    // And the prompt must appear exactly once.
    expect(prompt.match(/Only once please/g)).toHaveLength(1);
  });

  it('keeps a trailing user turn that has no response yet', () => {
    renderConversation([
      { id: 'c1', prompt: 'Answered', responseHtml: '<p>answer</p>' },
      { id: 'c2', prompt: 'Still streaming' },
    ]);
    const turns = collectTurns(
      Array.from(document.querySelectorAll('.conversation-container'))
    );
    expect(turns.map((t) => t.role)).toEqual(['user', 'model', 'user']);
    expect(turns[2].content).toBe('Still streaming');
  });
});

// ---------------------------------------------------------------------------
// parseGemini (DOM fixtures)
// ---------------------------------------------------------------------------

describe('parseGemini', () => {
  beforeEach(() => {
    setLocation(`https://gemini.google.com/app/${CONVERSATION_ID}`);
    document.title = 'Python Factorial Function - Google Gemini';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('renders a user/model exchange with title, tags, and dedupeKey', async () => {
    renderConversation([
      { id: 'c1', prompt: 'What is recursion?', responseHtml: '<p>A function that calls itself.</p>' },
    ]);

    const ctx = await parseGemini();
    expect(ctx.parser).toBe('gemini');
    // " - Google Gemini" suffix stripped from document.title.
    expect(ctx.title).toBe('Python Factorial Function');
    expect(ctx.body).toContain('# Python Factorial Function');
    expect(ctx.body).toContain('## User');
    expect(ctx.body).toContain('What is recursion?');
    expect(ctx.body).toContain('## Gemini');
    expect(ctx.body).toContain('A function that calls itself.');
    expect(ctx.tags).toEqual(['gemini', 'ai-chat']);
    expect(ctx.dedupeKey).toBe(`gemini:${CONVERSATION_ID}`);
    expect(ctx.fromSelection).toBe(false);
  });

  it('orders multiple turns chronologically', async () => {
    renderConversation([
      { id: 'c1', prompt: 'Q one', responseHtml: '<p>A one</p>' },
      { id: 'c2', prompt: 'Q two', responseHtml: '<p>A two</p>' },
    ]);

    const ctx = await parseGemini();
    const order = ['Q one', 'A one', 'Q two', 'A two'].map((s) => ctx.body.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('preserves a code block as a fenced block with its language', async () => {
    renderConversation([
      {
        id: 'c1',
        prompt: 'Write factorial',
        responseHtml:
          codeBlock('Python', 'def factorial(n):\n    return 1 if n == 0 else n * factorial(n - 1)\n') +
          '<p>This uses <code>recursion</code> to compute it.</p>',
      },
    ]);

    const ctx = await parseGemini();
    expect(ctx.body).toContain('```python');
    expect(ctx.body).toContain('def factorial(n):');
    expect(ctx.body).toContain('return 1 if n == 0 else n * factorial(n - 1)');
    // Inline code survives too.
    expect(ctx.body).toContain('`recursion`');
    // The copy-button label must not leak into the capture.
    expect(ctx.body).not.toContain('Copy code');
  });

  it('renders a bulleted list from the model response', async () => {
    renderConversation([
      {
        id: 'c1',
        prompt: 'List benefits',
        responseHtml:
          '<ul><li><p><b>Simplicity:</b> cleaner code</p></li><li><p>Shorter code</p></li></ul>',
      },
    ]);

    const ctx = await parseGemini();
    // Turndown renders list items with a `-` marker; assert on marker + content
    // without pinning its exact indentation.
    expect(ctx.body).toMatch(/-\s+\*\*Simplicity:\*\* cleaner code/);
    expect(ctx.body).toMatch(/-\s+Shorter code/);
  });

  it('errors out cleanly when the URL has no conversation id', async () => {
    setLocation('https://gemini.google.com/app');
    await expect(parseGemini()).rejects.toThrow(/extract a conversation ID/i);
  });

  it('rejects with a friendly error when no conversation has rendered (logged-out / loading)', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div>Sign in to continue</div>';

    const promise = parseGemini();
    // Attach the rejection assertion before advancing timers so the rejection
    // is always handled (no unhandled-rejection warning).
    const assertion = expect(promise).rejects.toThrow(
      /signed in|finished loading|No Gemini conversation was found/i
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });
});
