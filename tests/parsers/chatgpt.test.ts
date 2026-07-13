import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canHandleChatGpt,
  parseChatGpt,
  orderedNodes,
  extractConversationId,
} from '@/content/parsers/chatgpt';

const CONVERSATION_ID = 'abcdef01-2345-6789-abcd-ef0123456789';
const ACCESS_TOKEN = 'tok-abc-123';

function setLocation(url: string) {
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
// canHandleChatGpt / extractConversationId
// ---------------------------------------------------------------------------

describe('canHandleChatGpt', () => {
  it('returns true on a chatgpt.com conversation URL', () => {
    setLocation(`https://chatgpt.com/c/${CONVERSATION_ID}`);
    expect(canHandleChatGpt()).toBe(true);
  });

  it('returns true on the legacy chat.openai.com conversation URL', () => {
    setLocation(`https://chat.openai.com/c/${CONVERSATION_ID}`);
    expect(canHandleChatGpt()).toBe(true);
  });

  it('returns false on the ChatGPT home / new-chat page', () => {
    setLocation('https://chatgpt.com/');
    expect(canHandleChatGpt()).toBe(false);
  });

  it('returns false on a GPTs page (not a conversation)', () => {
    setLocation('https://chatgpt.com/g/g-abc123-some-gpt');
    expect(canHandleChatGpt()).toBe(false);
  });

  it('returns false on a non-ChatGPT host', () => {
    setLocation(`https://example.com/c/${CONVERSATION_ID}`);
    expect(canHandleChatGpt()).toBe(false);
  });
});

describe('extractConversationId', () => {
  it('extracts the id from a /c/<id> path', () => {
    expect(extractConversationId(`/c/${CONVERSATION_ID}`)).toBe(CONVERSATION_ID);
  });

  it('returns undefined for a non-conversation path', () => {
    expect(extractConversationId('/gpts')).toBeUndefined();
    expect(extractConversationId('/')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// orderedNodes (mapping walk)
// ---------------------------------------------------------------------------

describe('orderedNodes', () => {
  it('walks from current_node back to root, excluding sibling branches', () => {
    const conv = {
      current_node: 'a2',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: { id: 'u1', parent: 'root', children: ['a1', 'a1b'], message: { id: 'u1' } },
        a1: { id: 'a1', parent: 'u1', children: [], message: { id: 'a1' } }, // sibling branch
        a1b: { id: 'a1b', parent: 'u1', children: ['u2'], message: { id: 'a1b' } },
        u2: { id: 'u2', parent: 'a1b', children: ['a2'], message: { id: 'u2' } },
        a2: { id: 'a2', parent: 'u2', children: [], message: { id: 'a2' } },
      },
    };
    expect(orderedNodes(conv).map((n) => n.id)).toEqual(['root', 'u1', 'a1b', 'u2', 'a2']);
  });

  it('falls back to create_time order when there is no current_node', () => {
    const conv = {
      mapping: {
        b: { id: 'b', message: { id: 'b', create_time: 20 } },
        a: { id: 'a', message: { id: 'a', create_time: 10 } },
        c: { id: 'c', message: { id: 'c', create_time: 30 } },
      },
    };
    expect(orderedNodes(conv).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for an empty mapping', () => {
    expect(orderedNodes({ mapping: {} })).toEqual([]);
  });

  it('terminates on cycles defensively', () => {
    const conv = {
      current_node: 'x',
      mapping: {
        x: { id: 'x', parent: 'x', message: { id: 'x' } }, // self-loop
      },
    };
    expect(orderedNodes(conv).map((n) => n.id)).toEqual(['x']);
  });
});

// ---------------------------------------------------------------------------
// parseChatGpt (with mocked fetch)
// ---------------------------------------------------------------------------

describe('parseChatGpt (with mocked fetch)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setLocation(`https://chatgpt.com/c/${CONVERSATION_ID}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: async () => body,
    } as unknown as Response;
  }

  /** Mock the two-step session → conversation fetch, capturing the auth header. */
  function mockConversation(
    conversation: unknown,
    opts: { token?: string | null } = {}
  ): { authHeader: () => string | undefined } {
    const token = 'token' in opts ? opts.token : ACCESS_TOKEN;
    let sentAuth: string | undefined;
    fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/api/auth/session')) {
        return jsonResponse(token ? { accessToken: token } : {});
      }
      if (input.includes('/backend-api/conversation/')) {
        sentAuth = (init?.headers as Record<string, string> | undefined)?.Authorization;
        return jsonResponse(conversation);
      }
      throw new Error(`Unexpected fetch URL: ${input}`);
    });
    return { authHeader: () => sentAuth };
  }

  it('renders a simple user/assistant exchange with model + tags + dedupeKey', async () => {
    const { authHeader } = mockConversation({
      title: 'Async cancellation',
      create_time: 1_700_000_000,
      current_node: 'a1',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: {
          id: 'u1',
          parent: 'root',
          children: ['a1'],
          message: {
            id: 'u1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['How do I shield asyncio cleanup?'] },
          },
        },
        a1: {
          id: 'a1',
          parent: 'u1',
          children: [],
          message: {
            id: 'a1',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['Use `asyncio.shield()`.'] },
            metadata: { model_slug: 'gpt-4o' },
          },
        },
      },
    });

    const ctx = await parseChatGpt();
    expect(ctx.parser).toBe('chatgpt');
    expect(ctx.title).toBe('Async cancellation');
    expect(ctx.body).toContain('# Async cancellation');
    expect(ctx.body).toContain('*Model: `gpt-4o`*');
    expect(ctx.body).toContain('## User');
    expect(ctx.body).toContain('How do I shield asyncio cleanup?');
    expect(ctx.body).toContain('## Assistant');
    expect(ctx.body).toContain('Use `asyncio.shield()`.');
    expect(ctx.tags).toEqual(['chatgpt', 'ai-chat', 'model:gpt-4o']);
    expect(ctx.dedupeKey).toBe(`chatgpt:${CONVERSATION_ID}`);
    // The conversation fetch carries the bearer token from the session endpoint.
    expect(authHeader()).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it('orders multiple turns via the mapping walk and drops the sibling branch', async () => {
    mockConversation({
      title: 'Multi turn',
      current_node: 'a2',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: {
          id: 'u1',
          parent: 'root',
          children: ['a1', 'a1b'],
          message: { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['first question'] } },
        },
        a1: {
          id: 'a1',
          parent: 'u1',
          children: [],
          message: { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['discarded branch answer'] } },
        },
        a1b: {
          id: 'a1b',
          parent: 'u1',
          children: ['u2'],
          message: { id: 'a1b', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['kept answer one'] } },
        },
        u2: {
          id: 'u2',
          parent: 'a1b',
          children: ['a2'],
          message: { id: 'u2', author: { role: 'user' }, content: { content_type: 'text', parts: ['second question'] } },
        },
        a2: {
          id: 'a2',
          parent: 'u2',
          children: [],
          message: { id: 'a2', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['kept answer two'] } },
        },
      },
    });

    const ctx = await parseChatGpt();
    expect(ctx.body).not.toContain('discarded branch answer');
    const order = ['first question', 'kept answer one', 'second question', 'kept answer two'].map(
      (s) => ctx.body.indexOf(s)
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('renders code (fenced) and multimodal (image placeholder) content, and a tool turn', async () => {
    mockConversation({
      title: 'Code and images',
      current_node: 't1',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: {
          id: 'u1',
          parent: 'root',
          children: ['t1'],
          message: {
            id: 'u1',
            author: { role: 'user' },
            content: {
              content_type: 'multimodal_text',
              parts: ['What is in this screenshot?', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://x' }],
            },
          },
        },
        t1: {
          id: 't1',
          parent: 'u1',
          children: [],
          message: {
            id: 't1',
            author: { role: 'tool', name: 'python' },
            content: { content_type: 'code', language: 'python', text: 'print("hi")' },
          },
        },
      },
    });

    const ctx = await parseChatGpt();
    expect(ctx.body).toContain('What is in this screenshot?');
    expect(ctx.body).toContain('[image]');
    expect(ctx.body).toContain('### Tool · python');
    expect(ctx.body).toContain('```python');
    expect(ctx.body).toContain('print("hi")');
  });

  it('skips system and hidden messages', async () => {
    mockConversation({
      title: 'With noise',
      current_node: 'a1',
      mapping: {
        root: { id: 'root', parent: null, children: ['sys'], message: null },
        sys: {
          id: 'sys',
          parent: 'root',
          children: ['u1'],
          message: { id: 'sys', author: { role: 'system' }, content: { content_type: 'text', parts: ['custom instructions'] } },
        },
        u1: {
          id: 'u1',
          parent: 'sys',
          children: ['hidden'],
          message: { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['real question'] } },
        },
        hidden: {
          id: 'hidden',
          parent: 'u1',
          children: ['a1'],
          message: {
            id: 'hidden',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['hidden scaffolding'] },
            metadata: { is_visually_hidden_from_conversation: true },
          },
        },
        a1: {
          id: 'a1',
          parent: 'hidden',
          children: [],
          message: { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['real answer'] } },
        },
      },
    });

    const ctx = await parseChatGpt();
    expect(ctx.body).toContain('real question');
    expect(ctx.body).toContain('real answer');
    expect(ctx.body).not.toContain('custom instructions');
    expect(ctx.body).not.toContain('hidden scaffolding');
  });

  it('falls back to a default title when the conversation has none', async () => {
    mockConversation({
      current_node: 'u1',
      mapping: {
        u1: { id: 'u1', parent: null, children: [], message: { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['hi'] } } },
      },
    });
    const ctx = await parseChatGpt();
    expect(ctx.title).toBe('Untitled ChatGPT conversation');
    // No model_slug anywhere → no model tag.
    expect(ctx.tags).toEqual(['chatgpt', 'ai-chat']);
  });

  it('throws a friendly logged-out error when the session has no accessToken', async () => {
    mockConversation({ mapping: {} }, { token: null });
    await expect(parseChatGpt()).rejects.toThrow(/log in to chatgpt/i);
  });

  it('surfaces a rate-limit hint on HTTP 429 from the session endpoint', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      if (input.endsWith('/api/auth/session')) {
        return { ok: false, status: 429, statusText: 'Too Many Requests' } as Response;
      }
      throw new Error(`unexpected: ${input}`);
    });
    await expect(parseChatGpt()).rejects.toThrow(/429/);
  });

  it('surfaces an auth hint on HTTP 401 from the conversation endpoint', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      if (input.endsWith('/api/auth/session')) return jsonResponse({ accessToken: ACCESS_TOKEN });
      if (input.includes('/backend-api/conversation/')) {
        return { ok: false, status: 401, statusText: 'Unauthorized' } as Response;
      }
      throw new Error(`unexpected: ${input}`);
    });
    await expect(parseChatGpt()).rejects.toThrow(/HTTP 401/);
  });

  it('throws an "unexpected response shape" error when mapping is missing', async () => {
    mockConversation({ title: 'No mapping here' });
    await expect(parseChatGpt()).rejects.toThrow(/unexpected response shape/i);
  });

  it('errors out cleanly when the URL has no conversation id', async () => {
    setLocation('https://chatgpt.com/');
    await expect(parseChatGpt()).rejects.toThrow(/extract a conversation ID/i);
  });
});
