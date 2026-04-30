import { buildFrontmatter, buildSourceFooter } from '@/shared/frontmatter-builder';
import { loadOptions } from '@/shared/options-storage';
import { appendToBuffer } from '@/shared/buffer-storage';
import type {
  CapturedContext,
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
  tabId: number
): Promise<void> {
  if (options.defaultMode === 'clipboard' || options.defaultMode === 'both') {
    await copyToClipboardViaTab(tabId, markdown);
  }
  if (options.defaultMode === 'append-buffer' || options.defaultMode === 'both') {
    await appendToBuffer(ctx, markdown);
  }
}

/**
 * Service workers can't access the system clipboard directly in MV3,
 * so we ask the content script to write via the page's clipboard API.
 */
async function copyToClipboardViaTab(tabId: number, text: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (value: string) => {
      return navigator.clipboard.writeText(value);
    },
    args: [text],
  });
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
