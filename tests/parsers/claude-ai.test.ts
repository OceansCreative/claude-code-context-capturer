import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canHandleClaudeAi,
  parseClaudeAi,
  orderedMessages,
  collectArtifacts,
  artifactFromInput,
} from '@/content/parsers/claude-ai';

const ORG_UUID = 'org-uuid-1';
const CONVERSATION_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function setLocation(url: string) {
  const u = new URL(url);
  Object.defineProperty(window, 'location', {
    value: {
      href: u.href,
      hostname: u.hostname,
      pathname: u.pathname,
      search: u.search,
    },
    writable: true,
  });
}

describe('canHandleClaudeAi', () => {
  it('returns true on a chat URL', () => {
    setLocation(`https://claude.ai/chat/${CONVERSATION_UUID}`);
    expect(canHandleClaudeAi()).toBe(true);
  });

  it('returns false on the chat list', () => {
    setLocation('https://claude.ai/chats');
    expect(canHandleClaudeAi()).toBe(false);
  });

  it('returns false on a non-claude.ai host', () => {
    setLocation('https://example.com/chat/abc');
    expect(canHandleClaudeAi()).toBe(false);
  });

  it('returns false on /new (no UUID yet)', () => {
    setLocation('https://claude.ai/new');
    expect(canHandleClaudeAi()).toBe(false);
  });
});

describe('orderedMessages', () => {
  it('walks from current_leaf back to root, returning chronological order', () => {
    const conv = {
      uuid: 'c',
      current_leaf_message_uuid: 'm3',
      chat_messages: [
        { uuid: 'm1', sender: 'human' as const, parent_message_uuid: undefined },
        { uuid: 'm2', sender: 'assistant' as const, parent_message_uuid: 'm1' },
        { uuid: 'm2-alt', sender: 'assistant' as const, parent_message_uuid: 'm1' }, // sibling branch
        { uuid: 'm3', sender: 'human' as const, parent_message_uuid: 'm2' },
      ],
    };
    const ordered = orderedMessages(conv);
    expect(ordered.map((m) => m.uuid)).toEqual(['m1', 'm2', 'm3']);
  });

  it('falls back to created_at order when no leaf pointer is set', () => {
    const conv = {
      uuid: 'c',
      chat_messages: [
        { uuid: 'b', sender: 'assistant' as const, created_at: '2026-01-01T00:01:00Z' },
        { uuid: 'a', sender: 'human' as const, created_at: '2026-01-01T00:00:00Z' },
        { uuid: 'c', sender: 'human' as const, created_at: '2026-01-01T00:02:00Z' },
      ],
    };
    expect(orderedMessages(conv).map((m) => m.uuid)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for an empty conversation', () => {
    expect(orderedMessages({ uuid: 'c', chat_messages: [] })).toEqual([]);
  });

  it('terminates on cycles defensively', () => {
    const conv = {
      uuid: 'c',
      current_leaf_message_uuid: 'm1',
      chat_messages: [
        { uuid: 'm1', sender: 'human' as const, parent_message_uuid: 'm1' }, // self-loop
      ],
    };
    expect(orderedMessages(conv).map((m) => m.uuid)).toEqual(['m1']);
  });
});

describe('parseClaudeAi (with mocked fetch)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setLocation(`https://claude.ai/chat/${CONVERSATION_UUID}`);
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

  it('renders a simple human/assistant exchange', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      if (input === '/api/organizations') {
        return jsonResponse([{ uuid: ORG_UUID, name: 'Personal' }]);
      }
      if (input.endsWith(`/chat_conversations/${CONVERSATION_UUID}`)) {
        return jsonResponse({}, true);
      }
      if (input.includes('?tree=True')) {
        return jsonResponse({
          uuid: CONVERSATION_UUID,
          name: 'Async cancellation',
          model: 'claude-sonnet-4-7',
          current_leaf_message_uuid: 'm2',
          chat_messages: [
            {
              uuid: 'm1',
              sender: 'human',
              content: [{ type: 'text', text: 'How do I shield asyncio cleanup?' }],
            },
            {
              uuid: 'm2',
              sender: 'assistant',
              parent_message_uuid: 'm1',
              content: [
                { type: 'thinking', thinking: 'Hmm, let me consider...' },
                { type: 'text', text: 'Use `asyncio.shield()`.' },
              ],
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch URL: ${input}`);
    });

    const ctx = await parseClaudeAi();
    expect(ctx.parser).toBe('claude-ai');
    expect(ctx.title).toBe('Async cancellation');
    expect(ctx.body).toContain('# Async cancellation');
    expect(ctx.body).toContain('## Human');
    expect(ctx.body).toContain('How do I shield asyncio cleanup?');
    expect(ctx.body).toContain('## Assistant');
    expect(ctx.body).toContain('Use `asyncio.shield()`.');
    // Thinking is rendered as a collapsible <details> block.
    expect(ctx.body).toContain('<details>');
    expect(ctx.body).toContain('Hmm, let me consider...');
    // Tags include the model.
    expect(ctx.tags).toContain('model:claude-sonnet-4-7');
  });

  it('walks the org list when the first org returns 404', async () => {
    const probedOrgs: string[] = [];
    fetchMock.mockImplementation(async (input: string) => {
      if (input === '/api/organizations') {
        return jsonResponse([{ uuid: 'org-A' }, { uuid: 'org-B' }]);
      }
      const m = input.match(/\/organizations\/([^/]+)\/chat_conversations\/[^?]+$/);
      if (m && !input.includes('?tree=True')) {
        probedOrgs.push(m[1]);
        return jsonResponse({}, m[1] === 'org-B');
      }
      if (input.includes('?tree=True')) {
        return jsonResponse({
          uuid: CONVERSATION_UUID,
          name: 'In second org',
          chat_messages: [
            { uuid: 'm1', sender: 'human', content: [{ type: 'text', text: 'hi' }] },
          ],
        });
      }
      throw new Error(`unexpected: ${input}`);
    });

    const ctx = await parseClaudeAi();
    expect(probedOrgs).toEqual(['org-A', 'org-B']);
    expect(ctx.title).toBe('In second org');
  });

  it('throws a friendly error when the user is not signed in', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);
    await expect(parseClaudeAi()).rejects.toThrow(/401/);
  });

  it('renders unknown content blocks as JSON without crashing', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      if (input === '/api/organizations') return jsonResponse([{ uuid: ORG_UUID }]);
      if (input.endsWith(`/chat_conversations/${CONVERSATION_UUID}`)) return jsonResponse({});
      if (input.includes('?tree=True')) {
        return jsonResponse({
          uuid: CONVERSATION_UUID,
          name: 'Unknown blocks',
          chat_messages: [
            {
              uuid: 'm1',
              sender: 'assistant',
              content: [
                { type: 'mystery_block_v2', some_payload: { foo: 'bar' } },
              ],
            },
          ],
        });
      }
      throw new Error(`unexpected: ${input}`);
    });

    const ctx = await parseClaudeAi();
    expect(ctx.body).toContain('unsupported content block: `mystery_block_v2`');
    expect(ctx.body).toContain('"foo": "bar"');
  });

  it('errors out cleanly when the URL has no conversation UUID', async () => {
    setLocation('https://claude.ai/chats');
    await expect(parseClaudeAi()).rejects.toThrow(/extract a conversation ID/i);
  });

  // -------------------------------------------------------------------------
  // Artifact extraction + capture options
  // -------------------------------------------------------------------------

  function mockArtifactConversation() {
    fetchMock.mockImplementation(async (input: string) => {
      if (input === '/api/organizations') return jsonResponse([{ uuid: ORG_UUID }]);
      if (input.endsWith(`/chat_conversations/${CONVERSATION_UUID}`)) return jsonResponse({});
      if (input.includes('?tree=True')) {
        return jsonResponse({
          uuid: CONVERSATION_UUID,
          name: 'Build auth middleware',
          model: 'claude-opus-4',
          current_leaf_message_uuid: 'm4',
          chat_messages: [
            {
              uuid: 'm1',
              sender: 'human',
              content: [{ type: 'text', text: 'Write auth middleware.' }],
            },
            {
              uuid: 'm2',
              sender: 'assistant',
              parent_message_uuid: 'm1',
              content: [
                { type: 'text', text: 'Here you go.' },
                {
                  type: 'tool_use',
                  name: 'artifacts',
                  input: {
                    command: 'create',
                    id: 'auth-mw',
                    type: 'application/vnd.ant.code',
                    language: 'ts',
                    title: 'Auth middleware',
                    content: 'export const auth = () => {};',
                  },
                },
              ],
            },
            {
              uuid: 'm3',
              sender: 'human',
              parent_message_uuid: 'm2',
              content: [{ type: 'text', text: 'Add logging.' }],
            },
            {
              uuid: 'm4',
              sender: 'assistant',
              parent_message_uuid: 'm3',
              content: [
                {
                  type: 'tool_use',
                  name: 'artifacts',
                  input: {
                    command: 'rewrite',
                    id: 'auth-mw',
                    type: 'application/vnd.ant.code',
                    language: 'ts',
                    title: 'Auth middleware',
                    content: 'export const auth = () => { log(); };',
                  },
                },
              ],
            },
          ],
        });
      }
      throw new Error(`unexpected: ${input}`);
    });
  }

  it('renders artifacts as clean code blocks inside a full capture', async () => {
    mockArtifactConversation();
    const ctx = await parseClaudeAi();
    expect(ctx.body).toContain('#### Auth middleware');
    expect(ctx.body).toContain('```ts');
    expect(ctx.body).toContain('export const auth');
    // Not dumped as raw JSON.
    expect(ctx.body).not.toContain('"command": "create"');
  });

  it('artifacts-only mode keeps only the final artifact version, no chat', async () => {
    mockArtifactConversation();
    const ctx = await parseClaudeAi({ claudeAiArtifactsOnly: true });
    expect(ctx.title).toBe('Build auth middleware');
    expect(ctx.body).toContain('# Build auth middleware — artifacts');
    // Final (rewrite) version wins; intermediate create is gone.
    expect(ctx.body).toContain('export const auth = () => { log(); };');
    expect(ctx.body).not.toContain('export const auth = () => {};');
    // Conversation text is dropped.
    expect(ctx.body).not.toContain('Add logging.');
    expect(ctx.body).not.toContain('## Human');
    expect(ctx.tags).toContain('artifacts-only');
    expect(ctx.tags).toContain('lang:ts');
  });

  it('artifacts-only throws a friendly error when there are no artifacts', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      if (input === '/api/organizations') return jsonResponse([{ uuid: ORG_UUID }]);
      if (input.endsWith(`/chat_conversations/${CONVERSATION_UUID}`)) return jsonResponse({});
      if (input.includes('?tree=True')) {
        return jsonResponse({
          uuid: CONVERSATION_UUID,
          name: 'No artifacts here',
          chat_messages: [
            { uuid: 'm1', sender: 'human', content: [{ type: 'text', text: 'hi' }] },
          ],
        });
      }
      throw new Error(`unexpected: ${input}`);
    });
    await expect(parseClaudeAi({ claudeAiArtifactsOnly: true })).rejects.toThrow(
      /No artifacts found/i
    );
  });

  it('maxMessages keeps only the last N messages', async () => {
    mockArtifactConversation();
    const ctx = await parseClaudeAi({ claudeAiMaxMessages: 1 });
    // Only m4 (the last assistant turn with the rewrite) remains.
    expect(ctx.body).toContain('export const auth = () => { log(); };');
    expect(ctx.body).not.toContain('Write auth middleware.');
    expect(ctx.body).not.toContain('Add logging.');
  });
});

describe('artifactFromInput', () => {
  it('parses a well-formed artifact input', () => {
    const art = artifactFromInput({
      id: 'x',
      title: 'T',
      language: 'python',
      type: 'application/vnd.ant.code',
      content: 'print(1)',
    });
    expect(art).toEqual({
      id: 'x',
      title: 'T',
      language: 'python',
      type: 'application/vnd.ant.code',
      content: 'print(1)',
    });
  });

  it('returns undefined for diff-only updates (no content)', () => {
    expect(artifactFromInput({ id: 'x', old_str: 'a', new_str: 'b' })).toBeUndefined();
    expect(artifactFromInput({ content: '   ' })).toBeUndefined();
    expect(artifactFromInput(null)).toBeUndefined();
  });
});

describe('collectArtifacts', () => {
  it('dedupes by id, keeping the latest version, then anon artifacts', () => {
    const messages = [
      {
        uuid: 'a',
        sender: 'assistant' as const,
        content: [
          {
            type: 'tool_use',
            name: 'artifacts',
            input: { id: 'k', title: 'K', content: 'v1' },
          },
        ],
      },
      {
        uuid: 'b',
        sender: 'assistant' as const,
        content: [
          {
            type: 'tool_use',
            name: 'artifacts',
            input: { id: 'k', title: 'K', content: 'v2' },
          },
          {
            type: 'tool_use',
            name: 'artifacts',
            input: { title: 'Anon', content: 'anon-body' },
          },
        ],
      },
    ];
    const arts = collectArtifacts(messages);
    expect(arts).toHaveLength(2);
    expect(arts[0].content).toBe('v2');
    expect(arts[1].content).toBe('anon-body');
  });

  it('ignores non-artifact tool_use blocks', () => {
    const messages = [
      {
        uuid: 'a',
        sender: 'assistant' as const,
        content: [
          { type: 'tool_use', name: 'repl', input: { code: 'x' } },
          { type: 'text', text: 'hi' },
        ],
      },
    ];
    expect(collectArtifacts(messages)).toHaveLength(0);
  });
});
