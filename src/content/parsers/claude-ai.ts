import type { CaptureOptions, CapturedContext } from '@/shared/types';

/**
 * claude.ai conversation parser.
 *
 * Unlike the other site-specific parsers, this one cannot read the rendered
 * DOM — claude.ai is a React SPA whose rendered output drops thinking blocks,
 * tool_use entries, and merges branches. Instead, we hit claude.ai's internal
 * REST API from the content script (which inherits the user's session cookies
 * since it runs in the same origin) and reconstruct the conversation tree.
 *
 * Endpoints used:
 *   GET /api/organizations
 *     → list of organizations the user belongs to. We try them in order until
 *       one returns the conversation.
 *   GET /api/organizations/{org_uuid}/chat_conversations/{uuid}?tree=True&rendering_mode=raw
 *     → full conversation including branches, thinking, tool_use, artifacts.
 *
 * These are internal endpoints — Anthropic may change them without notice.
 * The parser is defensive: if the shape doesn't match, the user gets a
 * descriptive error rather than a corrupted capture.
 */

export function canHandleClaudeAi(): boolean {
  return (
    window.location.hostname === 'claude.ai' &&
    /^\/chat\/[0-9a-f-]{8,}/i.test(window.location.pathname)
  );
}

export async function parseClaudeAi(
  options: CaptureOptions = {}
): Promise<CapturedContext> {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();
  const conversationUuid = extractConversationUuid(window.location.pathname);
  if (!conversationUuid) {
    throw new Error(
      'Could not extract a conversation ID from the URL. Open a specific chat (claude.ai/chat/...) and retry.'
    );
  }

  const orgUuid = await findOrgWithConversation(conversationUuid);
  if (!orgUuid) {
    throw new Error(
      'No organization found for this conversation. Make sure you are signed in to claude.ai in this tab.'
    );
  }

  const conversation = await fetchConversation(orgUuid, conversationUuid);
  let messages = orderedMessages(conversation);

  // Range selection: keep only the last N messages of the (chronological)
  // thread, so long planning conversations don't dump their whole history.
  const maxMessages = options.claudeAiMaxMessages ?? 0;
  if (maxMessages > 0 && messages.length > maxMessages) {
    messages = messages.slice(-maxMessages);
  }

  const title = (conversation.name ?? '').trim() || 'Untitled Claude conversation';
  const artifacts = collectArtifacts(messages);

  // Artifacts-only: extract just the code/documents Claude authored, dropping
  // the surrounding conversation entirely.
  if (options.claudeAiArtifactsOnly) {
    if (artifacts.length === 0) {
      throw new Error(
        'No artifacts found in this conversation. Turn off "artifacts only" to capture the full chat.'
      );
    }
    return {
      url,
      title,
      body: renderArtifactsMarkdown(title, artifacts),
      capturedAt,
      publishedAt: conversation.created_at,
      parser: 'claude-ai',
      fromSelection: false,
      tags: tagsFor(conversation, artifacts),
      artifacts,
    };
  }

  const body = renderConversationMarkdown(title, conversation, messages);

  return {
    url,
    title,
    body,
    capturedAt,
    publishedAt: conversation.created_at,
    parser: 'claude-ai',
    fromSelection: false,
    tags: tagsFor(conversation),
    // Expose artifacts so mcp-store mode can split them into one file each,
    // even when the body is the full conversation.
    artifacts: artifacts.length > 0 ? artifacts : undefined,
  };
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

interface OrgListItem {
  uuid: string;
  name?: string;
}

interface ConversationMessageContent {
  type: string;
  text?: string;
  thinking?: string;
  input?: unknown;
  content?: ConversationMessageContent[];
  // tool_use / tool_result fields vary; we render unknown types as a noted block.
  [key: string]: unknown;
}

interface ConversationMessage {
  uuid: string;
  parent_message_uuid?: string;
  sender: 'human' | 'assistant';
  content?: ConversationMessageContent[];
  text?: string;
  created_at?: string;
}

interface Conversation {
  uuid: string;
  name?: string;
  summary?: string;
  model?: string;
  created_at?: string;
  updated_at?: string;
  current_leaf_message_uuid?: string;
  chat_messages?: ConversationMessage[];
}

async function findOrgWithConversation(conversationUuid: string): Promise<string | undefined> {
  const orgs = await apiGet<OrgListItem[]>('/api/organizations');
  if (!Array.isArray(orgs) || orgs.length === 0) return undefined;

  // Most users have a single org; try it first. If that 404s, walk the rest.
  for (const org of orgs) {
    if (!org.uuid) continue;
    const ok = await probeConversation(org.uuid, conversationUuid);
    if (ok) return org.uuid;
  }
  return undefined;
}

async function probeConversation(orgUuid: string, conversationUuid: string): Promise<boolean> {
  // HEAD isn't supported, so we issue a small GET (no tree flag) and check status.
  const res = await fetch(
    `/api/organizations/${encodeURIComponent(orgUuid)}/chat_conversations/${encodeURIComponent(conversationUuid)}`,
    { credentials: 'include' }
  );
  return res.ok;
}

async function fetchConversation(
  orgUuid: string,
  conversationUuid: string
): Promise<Conversation> {
  const url = `/api/organizations/${encodeURIComponent(orgUuid)}/chat_conversations/${encodeURIComponent(conversationUuid)}?tree=True&rendering_mode=raw`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`claude.ai API returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as Conversation;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`claude.ai API ${path} returned ${res.status}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Tree walker — pick the current leaf branch from a tree of messages.
// ---------------------------------------------------------------------------

/**
 * Returns messages from root to current leaf in chronological order.
 *
 * `chat_messages` from the tree=True endpoint is a flat array, but messages
 * may have multiple children (branches from regenerate / edit). We walk
 * upward from `current_leaf_message_uuid` to root, then reverse.
 *
 * Falls back to ordering by `created_at` if no leaf pointer exists, which
 * approximates "the longest happy path" for un-branched conversations.
 */
export function orderedMessages(conv: Conversation): ConversationMessage[] {
  const all = conv.chat_messages ?? [];
  if (all.length === 0) return [];

  const byUuid = new Map<string, ConversationMessage>();
  for (const m of all) byUuid.set(m.uuid, m);

  if (conv.current_leaf_message_uuid && byUuid.has(conv.current_leaf_message_uuid)) {
    const path: ConversationMessage[] = [];
    let cur: ConversationMessage | undefined = byUuid.get(conv.current_leaf_message_uuid);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.uuid)) {
      seen.add(cur.uuid);
      path.push(cur);
      cur = cur.parent_message_uuid ? byUuid.get(cur.parent_message_uuid) : undefined;
    }
    return path.reverse();
  }

  // No leaf pointer — order by created_at, then by parent depth as a tiebreaker.
  return [...all].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return ta - tb;
  });
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderConversationMarkdown(
  title: string,
  conv: Conversation,
  messages: ConversationMessage[]
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  if (conv.model) lines.push(`*Model: \`${conv.model}\`*`);
  if (conv.summary) lines.push(`*Summary: ${conv.summary}*`);
  if (conv.model || conv.summary) lines.push('');

  for (const msg of messages) {
    const role = msg.sender === 'human' ? 'Human' : 'Assistant';
    lines.push(`## ${role}`);
    lines.push('');
    lines.push(renderMessageContent(msg));
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function renderMessageContent(msg: ConversationMessage): string {
  // Newer messages use `content: ContentBlock[]`; older ones may have a flat `text`.
  if (Array.isArray(msg.content) && msg.content.length > 0) {
    return msg.content.map(renderContentBlock).filter(Boolean).join('\n\n');
  }
  return (msg.text ?? '').trim();
}

function renderContentBlock(block: ConversationMessageContent): string {
  switch (block.type) {
    case 'text':
      return (block.text ?? '').trim();
    case 'thinking': {
      const text = (block.thinking ?? '').trim();
      if (!text) return '';
      // Collapsible block so the captured CLAUDE.md remains readable.
      return `<details>\n<summary>thinking</summary>\n\n${text}\n\n</details>`;
    }
    case 'tool_use': {
      const name = (block as { name?: string }).name ?? 'tool_use';
      // The artifacts tool carries the code/documents Claude writes. Render it
      // as a real fenced code block (with language + title) instead of raw
      // JSON, so it's directly usable in CLAUDE.md / a project.
      if (name === 'artifacts') {
        const art = artifactFromInput((block as { input?: unknown }).input);
        if (art) return renderArtifactBlock(art);
      }
      const input = (block as { input?: unknown }).input;
      const inputStr = input ? '\n\n```json\n' + safeJson(input) + '\n```' : '';
      return `> **tool_use**: \`${name}\`${inputStr}`;
    }
    case 'tool_result': {
      const content = (block as { content?: unknown }).content;
      const rendered = renderToolResultContent(content);
      return `> **tool_result**:\n\n${rendered}`;
    }
    default:
      // Unknown content type — preserve as JSON for fidelity.
      return `> *(unsupported content block: \`${block.type}\`)*\n\n\`\`\`json\n${safeJson(block)}\n\`\`\``;
  }
}

function renderToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map(renderContentBlock).filter(Boolean).join('\n\n');
  }
  return '```json\n' + safeJson(content) + '\n```';
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function tagsFor(conv: Conversation, artifacts?: Artifact[]): string[] | undefined {
  const tags: string[] = [];
  if (conv.model) tags.push(`model:${conv.model}`);
  if (artifacts && artifacts.length > 0) {
    tags.push('artifacts-only');
    const langs = new Set(
      artifacts.map((a) => a.language).filter((l): l is string => !!l)
    );
    for (const lang of langs) tags.push(`lang:${lang}`);
  }
  return tags.length > 0 ? tags : undefined;
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

/** A code or document artifact Claude authored during the conversation. */
export interface Artifact {
  /** Stable artifact id (used to dedupe updates to the same artifact). */
  id?: string;
  /** Human title, e.g. "Auth middleware". */
  title?: string;
  /** Fence language hint, e.g. "ts", "python", "markdown". */
  language?: string;
  /** Artifact MIME-ish type, e.g. "application/vnd.ant.code", "text/markdown". */
  type?: string;
  /** The artifact body. */
  content: string;
}

/**
 * Parse the `input` of an `artifacts` tool_use block into an Artifact.
 * claude.ai's artifact tool uses fields like:
 *   { command: "create"|"update"|"rewrite", id, type, title, language, content }
 * Updates may carry only a diff (old_str/new_str); those have no full content
 * and are skipped (the create/rewrite that follows carries the full text).
 */
export function artifactFromInput(input: unknown): Artifact | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const o = input as Record<string, unknown>;
  const content = typeof o.content === 'string' ? o.content : undefined;
  if (!content || content.trim() === '') return undefined;
  return {
    id: typeof o.id === 'string' ? o.id : undefined,
    title: typeof o.title === 'string' ? o.title : undefined,
    language: typeof o.language === 'string' ? o.language : undefined,
    type: typeof o.type === 'string' ? o.type : undefined,
    content,
  };
}

/**
 * Collect all artifacts across the given messages, in order. When the same
 * artifact id is created then updated/rewritten, the LATER (most complete)
 * version wins — so we capture the final state, not every intermediate edit.
 */
export function collectArtifacts(messages: ConversationMessage[]): Artifact[] {
  const byId = new Map<string, Artifact>();
  const anon: Artifact[] = [];

  for (const msg of messages) {
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    for (const block of blocks) {
      if (block.type !== 'tool_use') continue;
      if ((block as { name?: string }).name !== 'artifacts') continue;
      const art = artifactFromInput((block as { input?: unknown }).input);
      if (!art) continue;
      if (art.id) {
        byId.set(art.id, art); // later create/rewrite replaces earlier
      } else {
        anon.push(art);
      }
    }
  }

  return [...byId.values(), ...anon];
}

/** Render a single artifact as a titled, fenced code block. */
function renderArtifactBlock(art: Artifact): string {
  const lines: string[] = [];
  if (art.title) lines.push(`#### ${art.title}`);
  const fence = fenceLangFor(art);
  lines.push('```' + fence);
  lines.push(art.content.replace(/\n+$/, ''));
  lines.push('```');
  return lines.join('\n');
}

/** Render an artifacts-only capture: title + each artifact as a code block. */
function renderArtifactsMarkdown(title: string, artifacts: Artifact[]): string {
  const lines: string[] = [`# ${title} — artifacts`, ''];
  artifacts.forEach((art, i) => {
    lines.push(renderArtifactBlock(art));
    if (i < artifacts.length - 1) lines.push('');
  });
  return lines.join('\n').trimEnd() + '\n';
}

/** Choose a fenced-code language label from the artifact's language/type. */
function fenceLangFor(art: Artifact): string {
  if (art.language) return art.language;
  if (art.type) {
    if (art.type.includes('markdown')) return 'markdown';
    if (art.type.includes('html')) return 'html';
    if (art.type.includes('svg')) return 'svg';
    if (art.type.includes('mermaid')) return 'mermaid';
  }
  return '';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractConversationUuid(pathname: string): string | undefined {
  // Pathname looks like /chat/<uuid> with optional trailing segments.
  const match = pathname.match(/^\/chat\/([0-9a-f-]{8,})/i);
  return match?.[1];
}
