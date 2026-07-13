import type { CaptureOptions, CapturedContext } from '@/shared/types';

/**
 * ChatGPT conversation parser.
 *
 * Like claude.ai, ChatGPT is a React SPA whose rendered DOM drops structure
 * (branches, tool turns, code fences collapse into styled spans). So instead of
 * scraping the DOM we hit ChatGPT's internal backend API from the content
 * script — which runs in the page's same-origin context, so the user's own
 * session cookie attaches automatically (`credentials: 'include'`).
 *
 * Endpoints used (relative to the current origin so both chatgpt.com and the
 * legacy chat.openai.com host work same-origin):
 *   GET /api/auth/session
 *     → JSON session blob containing `accessToken` (empty/absent when logged out).
 *   GET /backend-api/conversation/<id>   (Authorization: Bearer <accessToken>)
 *     → the conversation: a `mapping` node graph keyed by node id, plus
 *       `current_node`. Each node has `{ id, parent, children, message }`.
 *
 * We walk `mapping` from `current_node` up to the root via each node's
 * `parent`, then reverse — the same tree-walk claude-ai.ts uses for
 * `current_leaf` — to reconstruct the visible branch in chronological order.
 *
 * These are internal endpoints — OpenAI may change them without notice. The
 * parser is defensive: an unexpected shape yields a descriptive error rather
 * than a corrupt/empty capture.
 */

const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);
const CONVERSATION_PATH_RE = /^\/c\/([0-9a-f-]{8,})/i;

const FETCH_TIMEOUT_MS = 15_000;

const RATE_LIMIT_MSG =
  'ChatGPT rate-limited this request (HTTP 429). Wait a moment and retry the capture.';
const UNEXPECTED_SHAPE_MSG =
  'ChatGPT returned an unexpected response shape. The page may still be loading, or ChatGPT changed its API — reload the tab and retry.';
const LOGGED_OUT_MSG =
  'You appear to be logged out of ChatGPT. Log in to ChatGPT and open the conversation, then retry the capture.';

function authError(status: number): string {
  return `ChatGPT rejected the request (HTTP ${status}). Your session may have expired — reload the ChatGPT tab, confirm you're logged in, then retry.`;
}

// ---------------------------------------------------------------------------
// API shapes (partial — we only model the fields we read)
// ---------------------------------------------------------------------------

interface ChatGptAuthor {
  role?: string;
  name?: string;
}

interface ChatGptContent {
  content_type?: string;
  parts?: unknown[];
  text?: string;
  language?: string;
  [key: string]: unknown;
}

interface ChatGptMessageMetadata {
  is_visually_hidden_from_conversation?: boolean;
  model_slug?: string;
  [key: string]: unknown;
}

interface ChatGptMessage {
  id?: string;
  author?: ChatGptAuthor;
  content?: ChatGptContent;
  create_time?: number | null;
  metadata?: ChatGptMessageMetadata;
}

interface ChatGptNode {
  id?: string;
  parent?: string | null;
  children?: string[];
  message?: ChatGptMessage | null;
}

interface ChatGptConversation {
  title?: string;
  create_time?: number;
  update_time?: number;
  current_node?: string;
  mapping?: Record<string, ChatGptNode>;
}

/** A single rendered conversation turn. */
interface Turn {
  role: 'user' | 'assistant' | 'tool';
  name?: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function canHandleChatGpt(): boolean {
  return (
    CHATGPT_HOSTS.has(window.location.hostname) &&
    CONVERSATION_PATH_RE.test(window.location.pathname)
  );
}

export function extractConversationId(pathname: string): string | undefined {
  return pathname.match(CONVERSATION_PATH_RE)?.[1];
}

export async function parseChatGpt(_options: CaptureOptions = {}): Promise<CapturedContext> {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();
  const origin = window.location.origin;

  const conversationId = extractConversationId(window.location.pathname);
  if (!conversationId) {
    throw new Error(
      'Could not extract a conversation ID from the URL. Open a specific ChatGPT conversation (chatgpt.com/c/...) and retry.'
    );
  }

  const accessToken = await fetchAccessToken(origin);
  const conversation = await fetchConversation(origin, conversationId, accessToken);

  const nodes = orderedNodes(conversation);
  const turns = nodes
    .map(toTurn)
    .filter((t): t is Turn => t !== undefined);
  const modelSlug = findModelSlug(nodes);

  const title = (conversation.title ?? '').trim() || 'Untitled ChatGPT conversation';
  const body = renderConversationMarkdown(title, turns, modelSlug);

  const tags = ['chatgpt', 'ai-chat'];
  if (modelSlug) tags.push(`model:${modelSlug}`);

  return {
    url,
    title,
    body,
    capturedAt,
    publishedAt:
      typeof conversation.create_time === 'number'
        ? new Date(conversation.create_time * 1000).toISOString()
        : undefined,
    parser: 'chatgpt',
    fromSelection: false,
    tags,
    // Stable per conversation: re-capturing the same chat overwrites the
    // existing store file instead of accumulating duplicate snapshots.
    dedupeKey: `chatgpt:${conversationId}`,
  };
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  // AbortController + setTimeout rather than AbortSignal.timeout(): the latter
  // isn't available in every runtime (notably the test environment). Without a
  // timeout a hung connection leaves the popup spinning forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new Error(
        `ChatGPT request timed out after ${FETCH_TIMEOUT_MS / 1000}s. Retry, or check your network.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAccessToken(origin: string): Promise<string> {
  const res = await timedFetch(`${origin}/api/auth/session`, { credentials: 'include' });
  if (res.status === 401 || res.status === 403) throw new Error(authError(res.status));
  if (res.status === 429) throw new Error(RATE_LIMIT_MSG);
  if (!res.ok) throw new Error(`ChatGPT session request failed: ${res.status} ${res.statusText}`);

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(UNEXPECTED_SHAPE_MSG);
  }
  const token = (data as { accessToken?: unknown } | null)?.accessToken;
  if (typeof token !== 'string' || token.length === 0) {
    // A logged-out session endpoint returns 200 with an empty object.
    throw new Error(LOGGED_OUT_MSG);
  }
  return token;
}

async function fetchConversation(
  origin: string,
  conversationId: string,
  accessToken: string
): Promise<ChatGptConversation> {
  const res = await timedFetch(
    `${origin}/backend-api/conversation/${encodeURIComponent(conversationId)}`,
    {
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (res.status === 401 || res.status === 403) throw new Error(authError(res.status));
  if (res.status === 429) throw new Error(RATE_LIMIT_MSG);
  if (res.status === 404) {
    throw new Error(
      'ChatGPT could not find this conversation (HTTP 404). Make sure it still exists and belongs to the account signed in on this tab.'
    );
  }
  if (!res.ok) {
    throw new Error(`ChatGPT conversation request failed: ${res.status} ${res.statusText}`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(UNEXPECTED_SHAPE_MSG);
  }
  const conv = data as ChatGptConversation | null;
  if (!conv || typeof conv !== 'object' || !conv.mapping || typeof conv.mapping !== 'object') {
    throw new Error(UNEXPECTED_SHAPE_MSG);
  }
  return conv;
}

// ---------------------------------------------------------------------------
// Tree walker — reconstruct the visible branch from the node mapping.
// ---------------------------------------------------------------------------

/**
 * Returns the conversation nodes from root to `current_node` in chronological
 * order. The mapping is a graph (regenerate/edit create sibling branches); we
 * walk upward from `current_node` via each node's `parent`, then reverse.
 *
 * Falls back to ordering all message-bearing nodes by `create_time` when there
 * is no usable `current_node` pointer.
 */
export function orderedNodes(conv: ChatGptConversation): ChatGptNode[] {
  const mapping: Record<string, ChatGptNode> = conv.mapping ?? {};
  const keys = Object.keys(mapping);
  if (keys.length === 0) return [];

  if (conv.current_node && mapping[conv.current_node]) {
    const path: ChatGptNode[] = [];
    const seen = new Set<string>();
    let key: string | undefined = conv.current_node;
    while (key && mapping[key] && !seen.has(key)) {
      seen.add(key);
      const node: ChatGptNode = mapping[key];
      path.push(node);
      key = node.parent ?? undefined;
    }
    return path.reverse();
  }

  // No current_node — order every message-bearing node by create_time.
  return keys
    .map((k) => mapping[k])
    .filter((n) => !!n.message)
    .sort((a, b) => (a.message?.create_time ?? 0) - (b.message?.create_time ?? 0));
}

function toTurn(node: ChatGptNode): Turn | undefined {
  const msg = node.message;
  if (!msg || !msg.author) return undefined;
  const role = msg.author.role;
  // Keep user/assistant/tool; drop system (custom instructions, context) and
  // any unknown role.
  if (role !== 'user' && role !== 'assistant' && role !== 'tool') return undefined;
  // Skip messages ChatGPT hides from the transcript (tool-call stubs, safety
  // scaffolding, model-internal bookkeeping).
  if (msg.metadata?.is_visually_hidden_from_conversation) return undefined;

  const content = renderContent(msg.content).trim();
  if (content.length === 0) return undefined;

  return { role, name: msg.author.name, content };
}

function findModelSlug(nodes: ChatGptNode[]): string | undefined {
  for (const node of nodes) {
    const slug = node.message?.metadata?.model_slug;
    if (typeof slug === 'string' && slug.length > 0) return slug;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Content rendering
// ---------------------------------------------------------------------------

function renderContent(content?: ChatGptContent): string {
  if (!content) return '';
  switch (content.content_type) {
    case 'text':
      return joinStringParts(content.parts);
    case 'code': {
      const code = typeof content.text === 'string' ? content.text : '';
      if (code.trim().length === 0) return '';
      const lang =
        typeof content.language === 'string' && content.language !== 'unknown'
          ? content.language
          : '';
      return fence(lang, code);
    }
    case 'execution_output': {
      const text = typeof content.text === 'string' ? content.text : '';
      if (text.trim().length === 0) return '';
      return fence('', text);
    }
    case 'multimodal_text':
      return renderMultimodal(content.parts);
    default: {
      // Unknown / browsing / tether types — best effort: string parts, then a
      // flat `text` field, otherwise nothing (rather than dumping raw JSON).
      const fromParts = joinStringParts(content.parts);
      if (fromParts) return fromParts;
      return typeof content.text === 'string' ? content.text.trim() : '';
    }
  }
}

/** Join the string entries of a `parts` array, dropping non-strings and blanks. */
function joinStringParts(parts?: unknown[]): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join('\n\n');
}

/**
 * multimodal_text parts mix strings with asset-pointer objects (uploaded or
 * generated images/audio). Strings pass through; objects become a compact
 * placeholder so the turn stays readable without binary noise.
 */
function renderMultimodal(parts?: unknown[]): string {
  if (!Array.isArray(parts)) return '';
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      const t = part.trim();
      if (t.length > 0) out.push(t);
    } else if (part && typeof part === 'object') {
      const ct = (part as Record<string, unknown>).content_type;
      if (typeof ct === 'string' && ct.includes('audio')) out.push('[audio]');
      else out.push('[image]');
    }
  }
  return out.join('\n\n');
}

function fence(lang: string, code: string): string {
  return '```' + lang + '\n' + code.replace(/\n+$/, '') + '\n```';
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderConversationMarkdown(
  title: string,
  turns: Turn[],
  modelSlug?: string
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  if (modelSlug) {
    lines.push(`*Model: \`${modelSlug}\`*`);
    lines.push('');
  }

  if (turns.length === 0) {
    lines.push('*(no messages captured)*');
    return lines.join('\n').trimEnd() + '\n';
  }

  for (const turn of turns) {
    lines.push(headingFor(turn));
    lines.push('');
    lines.push(turn.content);
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function headingFor(turn: Turn): string {
  if (turn.role === 'user') return '## User';
  if (turn.role === 'assistant') return '## Assistant';
  // Tool turns render compactly, subordinate (h3) to the user/assistant turns.
  return `### Tool${turn.name ? ` · ${turn.name}` : ''}`;
}
