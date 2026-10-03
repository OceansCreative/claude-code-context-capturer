import { htmlToMarkdown } from '@/shared/markdown-converter';
import type { CaptureOptions, CapturedContext } from '@/shared/types';

/**
 * Gemini (gemini.google.com) conversation parser.
 *
 * Unlike claude.ai and ChatGPT — which expose clean, same-origin JSON endpoints
 * we can fetch with the user's session cookie — Gemini has NO usable JSON API.
 * Its only data path is Google's obfuscated `batchexecute` RPC
 * (POST /_/BardChatUi/data/batchexecute), which requires an `at` XSRF token, an
 * RPC id, and a deeply nested `f.req` payload whose array indices are
 * undocumented and change without notice. Reconstructing a conversation from it
 * is far more fragile than reading the rendered DOM. So, like the X parser, we
 * parse the DOM — but Gemini (an Angular app) gives us *semantic custom-element*
 * anchors that are stable across deploys, not the obfuscated class names X uses.
 *
 * ============================================================================
 * DOM ANCHORS THIS PARSER DEPENDS ON (check these first when Gemini breaks it)
 * ============================================================================
 *   .conversation-container     one Q&A turn (one user query + one model
 *                               response). Rendered in chronological DOM order.
 *   user-query .query-text      the user's prompt. NOTE: .query-text embeds a
 *                               hidden <h5 class="cdk-visually-hidden"> screen-
 *                               reader label that DUPLICATES the prompt text, so
 *                               we strip `.cdk-visually-hidden` before reading.
 *   model-response
 *     .model-response-text      the response wrapper (a <structured-content-
 *                               container>); its `.markdown` child is the
 *                               rendered Markdown (paragraphs, lists, tables,
 *                               inline <code>, <code-block>s, …).
 *   code-block                  a fenced code block (custom element). Language
 *                               label lives in `.code-block-decoration` (first
 *                               <span>; a `.buttons` subtree holds copy/download
 *                               and is dropped). Code text is in
 *                               `code[data-test-id="code-content"]`.
 *   .cdk-visually-hidden        Angular CDK screen-reader-only nodes — stripped
 *                               everywhere as "hidden/system" content.
 * ============================================================================
 *
 * Thinking blocks (reasoning models' collapsed "Show thinking" panel) are not
 * captured: their DOM structure could not be verified and guessing an anchor
 * risks injecting UI noise. Documented limitation, not an oversight.
 *
 * These are undocumented internals — Google may change them. The parser is
 * defensive: a missing/renamed anchor yields a descriptive error or a skipped
 * turn, never a corrupt or empty capture.
 */

const GEMINI_HOST = 'gemini.google.com';
/** `/app/<id>` (your own chats) or `/share/<id>` (public shares). */
const CONVERSATION_PATH_RE = /^\/(?:app|share)\/([a-z0-9_-]{6,})/i;

/** One rendered conversation turn. */
interface Turn {
  role: 'user' | 'model';
  /** Markdown body (prompt text, or the response with fenced code blocks). */
  content: string;
}

// ---------------------------------------------------------------------------
// Bounded wait — Gemini is an SPA; the conversation may still be hydrating or
// streaming when the content script (document_idle) runs. We wait up to 15s for
// the first turn to render, driven by an AbortController-backed timeout (the
// same budget the fetch-based AI-chat parsers use). The fast path returns
// immediately once turns are present, which is the usual case at capture time.
// ---------------------------------------------------------------------------

const WAIT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 200;

const TIMEOUT_MSG =
  'No Gemini conversation was found on this page. Make sure you are signed in and the conversation has finished loading, then retry the capture.';

function waitForTurns(timeoutMs = WAIT_TIMEOUT_MS): Promise<Element[]> {
  const found = (): Element[] =>
    Array.from(document.querySelectorAll('.conversation-container'));

  const immediate = found();
  if (immediate.length > 0) return Promise.resolve(immediate);

  return new Promise<Element[]>((resolve, reject) => {
    const controller = new AbortController();
    const interval = setInterval(() => {
      const turns = found();
      if (turns.length > 0) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(turns);
      }
    }, POLL_INTERVAL_MS);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    controller.signal.addEventListener('abort', () => {
      clearInterval(interval);
      reject(new Error(TIMEOUT_MSG));
    });
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function canHandleGemini(): boolean {
  return (
    window.location.hostname === GEMINI_HOST &&
    CONVERSATION_PATH_RE.test(window.location.pathname)
  );
}

export function extractConversationId(pathname: string): string | undefined {
  return pathname.match(CONVERSATION_PATH_RE)?.[1];
}

export async function parseGemini(
  _options: CaptureOptions = {}
): Promise<CapturedContext> {
  const url = window.location.href;
  const capturedAt = new Date().toISOString();

  const conversationId = extractConversationId(window.location.pathname);
  if (!conversationId) {
    throw new Error(
      'Could not extract a conversation ID from the URL. Open a specific Gemini conversation (gemini.google.com/app/...) and retry.'
    );
  }

  const containers = await waitForTurns();
  const turns = collectTurns(containers);
  if (turns.length === 0) {
    throw new Error(TIMEOUT_MSG);
  }

  const title = resolveTitle(turns);
  const body = renderConversationMarkdown(title, turns);

  return {
    url,
    title,
    body,
    capturedAt,
    parser: 'gemini',
    fromSelection: false,
    tags: ['gemini', 'ai-chat'],
    // Stable per conversation: re-capturing the same chat overwrites the
    // existing store file instead of accumulating duplicate snapshots.
    dedupeKey: `gemini:${conversationId}`,
  };
}

// ---------------------------------------------------------------------------
// Turn collection
// ---------------------------------------------------------------------------

/**
 * Walk each `.conversation-container` in DOM (chronological) order, pulling the
 * user prompt and the model response out of each. Exported for unit testing.
 */
export function collectTurns(containers: Element[]): Turn[] {
  const turns: Turn[] = [];
  for (const container of containers) {
    const prompt = extractUserPrompt(container);
    if (prompt) turns.push({ role: 'user', content: prompt });

    const response = extractModelResponse(container);
    if (response) turns.push({ role: 'model', content: response });
  }
  return turns;
}

/** Extract the user's prompt Markdown from a conversation container. */
function extractUserPrompt(container: Element): string {
  const queryText = container.querySelector('.query-text');
  if (!queryText) return '';
  const clone = queryText.cloneNode(true) as HTMLElement;
  stripNoise(clone);
  const md = htmlToMarkdown(clone).trim();
  // Fall back to plain text if the Markdown conversion came back empty.
  return md || (clone.textContent ?? '').trim();
}

/** Extract the model's response Markdown (code blocks preserved) from a turn. */
function extractModelResponse(container: Element): string {
  const root =
    container.querySelector('.model-response-text .markdown') ??
    container.querySelector('.model-response-text') ??
    container.querySelector('model-response');
  if (!root) return '';

  const clone = root.cloneNode(true) as HTMLElement;
  // Replace Gemini's <code-block> custom elements with standard
  // <pre><code class="language-xxx"> so Turndown emits clean fenced blocks
  // (and the copy/download buttons inside them are dropped).
  for (const cb of Array.from(clone.querySelectorAll('code-block'))) {
    cb.replaceWith(buildPreCode(cb));
  }
  stripNoise(clone);
  return htmlToMarkdown(clone).trim();
}

/** Build a `<pre><code class="language-xxx">` node from a Gemini code-block. */
function buildPreCode(codeBlock: Element): HTMLElement {
  const lang = extractCodeLanguage(codeBlock).toLowerCase();
  const code = extractCodeText(codeBlock);

  const pre = document.createElement('pre');
  const codeEl = document.createElement('code');
  if (lang) codeEl.className = `language-${lang}`;
  codeEl.textContent = code;
  pre.appendChild(codeEl);
  return pre;
}

/** Language label from `.code-block-decoration` (minus its button subtree). */
function extractCodeLanguage(codeBlock: Element): string {
  const decoration = codeBlock.querySelector('.code-block-decoration');
  if (!decoration) return '';
  const clone = decoration.cloneNode(true) as HTMLElement;
  for (const buttons of Array.from(clone.querySelectorAll('.buttons'))) {
    buttons.remove();
  }
  return (clone.textContent ?? '').trim();
}

/** Raw code text from a Gemini code-block. */
function extractCodeText(codeBlock: Element): string {
  const code =
    codeBlock.querySelector('code[data-test-id="code-content"]') ??
    codeBlock.querySelector('pre code') ??
    codeBlock.querySelector('pre');
  return code?.textContent ?? '';
}

/** Remove screen-reader-only and other non-content nodes from a clone. */
function stripNoise(root: HTMLElement): void {
  const selectors = [
    '.cdk-visually-hidden',
    '[aria-hidden="true"]',
    'mat-icon',
    'gem-icon',
    'gem-icon-button',
    'button',
  ];
  for (const sel of selectors) {
    for (const el of Array.from(root.querySelectorAll(sel))) el.remove();
  }
}

// ---------------------------------------------------------------------------
// Title + Markdown rendering
// ---------------------------------------------------------------------------

/** Document title (minus the " - Google Gemini" suffix), else a prompt snippet. */
function resolveTitle(turns: Turn[]): string {
  const fromDoc = stripGeminiSuffix(document.title ?? '');
  if (fromDoc) return fromDoc;

  const firstPrompt = turns.find((t) => t.role === 'user')?.content;
  if (firstPrompt) return truncate(firstPrompt.replace(/\s+/g, ' ').trim(), 60);

  return 'Untitled Gemini conversation';
}

function stripGeminiSuffix(title: string): string {
  return title.replace(/\s*[-|–]\s*(?:Google\s+)?Gemini\s*$/i, '').trim();
}

function renderConversationMarkdown(title: string, turns: Turn[]): string {
  const lines: string[] = [`# ${title}`, ''];

  for (const turn of turns) {
    lines.push(turn.role === 'user' ? '## User' : '## Gemini');
    lines.push('');
    lines.push(turn.content);
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '') + '…';
}
