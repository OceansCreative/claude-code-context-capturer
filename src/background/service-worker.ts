import { buildFrontmatter, buildSourceFooter } from '@/shared/frontmatter-builder';
import { loadOptions } from '@/shared/options-storage';
import { appendToBuffer } from '@/shared/buffer-storage';
import { buildEntryHeading } from '@/shared/file-appender';
import { listRoutes } from '@/shared/handle-store';
import { resolveRoute } from '@/shared/route-matcher';
import { buildContextSlug } from '@/shared/slug';
import type {
  CapturedContext,
  OffscreenAppendResult,
  OffscreenClipboardResult,
  OffscreenMcpStoreResult,
  OffscreenMessage,
  RuntimeMessage,
  UserOptions,
} from '@/shared/types';

/**
 * Background service worker.
 *
 * Responsibilities:
 * - Listen for keyboard shortcuts and context menu clicks
 * - Forward capture requests to the active tab's content script
 * - Render the captured context into final Markdown
 * - Copy to clipboard or append to the buffer
 */

// ---------------------------------------------------------------------------
// Context menu setup
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ccc-capture-page',
    title: 'Capture page as Claude Code context',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: 'ccc-capture-selection',
    title: 'Capture selection as Claude Code context',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'ccc-capture-page') {
    void requestCapture(tab.id, 'CAPTURE_PAGE');
  } else if (info.menuItemId === 'ccc-capture-selection') {
    void requestCapture(tab.id, 'CAPTURE_SELECTION');
  }
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return;
    if (command === 'capture-page') {
      await requestCapture(tab.id, 'CAPTURE_PAGE');
    } else if (command === 'capture-selection') {
      await requestCapture(tab.id, 'CAPTURE_SELECTION');
    }
  })();
});

// ---------------------------------------------------------------------------
// Popup-driven captures (via runtime.sendMessage)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === 'CAPTURE_PAGE' || message.type === 'CAPTURE_SELECTION') {
    void (async () => {
      const tab = await getActiveTab();
      if (!tab?.id) {
        sendResponse({ type: 'CAPTURE_ERROR', error: 'No active tab.' });
        return;
      }
      const result = await requestCapture(tab.id, message.type);
      sendResponse(result);
    })();
    return true; // keep the message channel open for async response
  }
  return false;
});

// ---------------------------------------------------------------------------
// Capture pipeline
// ---------------------------------------------------------------------------

async function requestCapture(
  tabId: number,
  type: 'CAPTURE_PAGE' | 'CAPTURE_SELECTION'
): Promise<RuntimeMessage> {
  try {
    const response = await chrome.tabs.sendMessage<RuntimeMessage, RuntimeMessage>(
      tabId,
      { type }
    );

    if (response.type === 'CAPTURE_ERROR') {
      await notify(response.error, 'error');
      return response;
    }

    if (response.type !== 'CAPTURE_RESULT') {
      return { type: 'CAPTURE_ERROR', error: 'Unexpected response from content script.' };
    }

    const options = await loadOptions();
    const finalMarkdown = renderFinalMarkdown(response.payload, options);

    await deliver(finalMarkdown, response.payload, options, tabId);
    await notify('Captured ✓', 'success');

    return { type: 'CAPTURE_RESULT', payload: response.payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await notify(message, 'error');
    return { type: 'CAPTURE_ERROR', error: message };
  }
}

/** Build the final Markdown string by composing frontmatter + body + footer. */
function renderFinalMarkdown(ctx: CapturedContext, options: UserOptions): string {
  let body = ctx.body;

  if (options.maxBodyLength > 0 && body.length > options.maxBodyLength) {
    body =
      body.slice(0, options.maxBodyLength) +
      `\n\n*[truncated at ${options.maxBodyLength} chars]*`;
  }

  const parts: string[] = [];
  if (options.includeFrontmatter) {
    parts.push(buildFrontmatter(ctx));
  }
  parts.push(body);
  if (options.includeSourceFooter) {
    parts.push(buildSourceFooter(ctx, options.locale));
  }

  let output = parts.join('\n');

  if (options.wrapInCodeBlock) {
    output = `\`\`\`markdown\n${output}\n\`\`\``;
  }

  return output;
}

/** Send the rendered Markdown to the configured destination(s). */
async function deliver(
  markdown: string,
  ctx: CapturedContext,
  options: UserOptions,
  _tabId: number
): Promise<void> {
  if (options.defaultMode === 'clipboard' || options.defaultMode === 'both') {
    await writeToClipboardViaOffscreen(markdown);
  }
  if (options.defaultMode === 'append-buffer' || options.defaultMode === 'both') {
    await appendToBuffer(ctx, markdown);
  }
  if (options.defaultMode === 'claude-md') {
    await appendToClaudeMd(ctx, markdown);
  }
  if (options.defaultMode === 'mcp-store') {
    await writeToMcpStore(ctx, markdown);
  }
}

/**
 * Write the capture as a standalone `<slug>.md` file into the linked MCP
 * contexts directory (via the offscreen document's FSA access). The companion
 * MCP server reads that directory to expose captures to Claude Code on demand.
 */
async function writeToMcpStore(
  ctx: CapturedContext,
  markdown: string
): Promise<void> {
  const fileName = `${buildContextSlug(ctx)}.md`;
  const result = await sendToOffscreenWithRetry<OffscreenMcpStoreResult>({
    target: 'offscreen',
    type: 'WRITE_TO_MCP_STORE',
    fileName,
    content: markdown,
  });
  if (!result?.ok) {
    const reason = result?.reason ?? 'write-failed';
    const detail = result?.message ?? 'Unknown error';
    throw new Error(`${reason}: ${detail}`);
  }
}

/**
 * Resolve the right route for this capture's URL and forward the rendered
 * Markdown to the offscreen document, which performs the FSA write.
 */
async function appendToClaudeMd(
  ctx: CapturedContext,
  markdown: string
): Promise<void> {
  const routes = await listRoutes();
  if (routes.length === 0) {
    throw new Error('no-route: No CLAUDE.md is linked. Configure routes in settings.');
  }
  const route = resolveRoute(ctx.url, routes);
  if (!route) {
    throw new Error(
      `no-route: No route matches ${ctx.url}. Add a matching pattern or set a default route in settings.`
    );
  }

  const heading = buildEntryHeading(ctx);
  const result = await sendToOffscreenWithRetry<OffscreenAppendResult>({
    target: 'offscreen',
    type: 'APPEND_TO_CLAUDE_MD',
    routeId: route.id,
    content: markdown,
    heading,
  });
  if (!result?.ok) {
    // Throw so requestCapture's try/catch surfaces the error to the popup.
    const reason = result?.reason ?? 'write-failed';
    const detail = result?.message ?? 'Unknown error';
    throw new Error(`${reason}: ${detail}`);
  }
}

/**
 * Write to the system clipboard via the offscreen document.
 *
 * Why not chrome.scripting.executeScript on the active tab:
 *   navigator.clipboard.writeText() rejects with "Document is not focused"
 *   when the popup is open (the popup steals focus from the tab). Worse,
 *   chrome.scripting.executeScript silently swallows the inner Promise
 *   rejection — the outer call resolves successfully and the rejection
 *   sits in result.error which the previous implementation didn't check.
 *   So captures looked like they succeeded but the clipboard stayed empty.
 *
 * The offscreen document's clipboard access doesn't depend on tab focus,
 * because the offscreen reasons array includes CLIPBOARD and the offscreen
 * uses the legacy textarea + execCommand("copy") path.
 */
async function writeToClipboardViaOffscreen(text: string): Promise<void> {
  const result = await sendToOffscreenWithRetry<OffscreenClipboardResult>({
    target: 'offscreen',
    type: 'WRITE_TO_CLIPBOARD',
    content: text,
  });
  if (!result?.ok) {
    throw new Error(`clipboard-failed: ${result?.message ?? 'Unknown error'}`);
  }
}

/**
 * Send a message to the offscreen document, retrying transparently if the
 * runtime says "Receiving end does not exist". That error fires whenever
 * the offscreen's onMessage listener isn't fully registered yet — which
 * can happen even after createDocument resolves and even after a successful
 * PING handshake, because Chrome's message routing has subtle timing
 * windows when the SW just cold-started or the offscreen page is still
 * loading its ESM chunks.
 *
 * Retries: up to 8 attempts, 50ms between, ~400ms worst case before throw.
 */
async function sendToOffscreenWithRetry<T>(
  message: OffscreenMessage,
  retries = 8,
  delayMs = 50
): Promise<T> {
  await ensureOffscreen();
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return (await chrome.runtime.sendMessage(message)) as T;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Only retry on the specific race-condition error. Anything else is
      // a real failure and should propagate immediately.
      if (!/Receiving end does not exist|Could not establish connection/.test(msg)) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError ?? new Error('offscreen sendMessage failed after retries');
}

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument?.()) {
    // Document exists, but verify the listener is actually wired up. After a
    // service worker restart, chrome.offscreen.hasDocument() can return true
    // for a document whose script context hasn't fully bootstrapped.
    await waitForOffscreenReady();
    return;
  }
  if (creatingOffscreen) {
    await creatingOffscreen;
    await waitForOffscreenReady();
    return;
  }
  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: 'src/offscreen/index.html',
      // BLOBS for FSA writes to the linked CLAUDE.md.
      // CLIPBOARD so the textarea + execCommand("copy") fallback works
      // without active-tab focus (the popup steals focus from the captured
      // tab; writes from a content-script-injected navigator.clipboard call
      // silently fail in that case).
      reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.CLIPBOARD],
      justification:
        'Append captured Markdown to the user-linked CLAUDE.md file and write to the system clipboard.',
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
  // createDocument resolves on the document's "load" event, before its ESM
  // script chunks have finished executing and registered their onMessage
  // handler. Without this readiness probe, the very next runtime.sendMessage
  // races and fails with "Receiving end does not exist".
  await waitForOffscreenReady();
}

async function waitForOffscreenReady(timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const reply = (await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'PING',
      })) as { ok?: boolean } | undefined;
      if (reply?.ok) return;
    } catch (err) {
      lastError = err;
    }
    // Short backoff — the listener usually wires up within a few ms.
    await new Promise((r) => setTimeout(r, 25));
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`offscreen-not-ready: gave up after ${timeoutMs}ms (${detail})`);
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function notify(message: string, level: 'success' | 'error'): Promise<void> {
  // Simple badge feedback. Notifications API would require an extra permission.
  const text = level === 'success' ? '✓' : '!';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({
    color: level === 'success' ? '#22c55e' : '#ef4444',
  });
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: '' });
  }, 2000);

  // Log for debugging.
  if (level === 'error') {
    console.error('[CCC]', message);
  } else {
    console.info('[CCC]', message);
  }
}
