import { getRoute } from '@/shared/handle-store';
import { buildAppendBlock } from '@/shared/file-appender';
import type {
  OffscreenAppendResult,
  OffscreenClipboardResult,
  OffscreenMessage,
} from '@/shared/types';

/**
 * Hidden offscreen document.
 *
 * Hosts two operations the service worker can't run directly:
 *   1. File System Access API writes (CLAUDE.md append) — SW has no DOM
 *   2. Clipboard writes — SW has no navigator.clipboard, and writing via
 *      chrome.scripting in an active tab silently fails when the popup
 *      steals focus (executeScript resolves successfully even when the
 *      injected navigator.clipboard.writeText() rejects with "Document is
 *      not focused").
 */

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isOffscreenMessage(message)) return false;

  if (message.type === 'APPEND_TO_CLAUDE_MD') {
    void appendToRoute(message.routeId, message.content, message.heading).then(
      sendResponse
    );
    return true; // async response
  }
  if (message.type === 'WRITE_TO_CLIPBOARD') {
    void writeToClipboard(message.content).then(sendResponse);
    return true;
  }
  return false;
});

async function appendToRoute(
  routeId: string,
  content: string,
  heading: string
): Promise<OffscreenAppendResult> {
  const route = await getRoute(routeId);
  if (!route) {
    return { ok: false, reason: 'no-handle', message: 'Route is no longer linked.' };
  }

  // Permission may have lapsed since the user picked the file. We can only
  // re-prompt from a window with a transient user activation, which the
  // offscreen doc lacks — report back and let the UI ask the user to
  // re-grant from the options page.
  const perm = await route.handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') {
    return {
      ok: false,
      reason: 'permission-denied',
      message: `Re-link "${route.label}" from the options page to grant write access.`,
    };
  }

  try {
    const file = await route.handle.getFile();
    const existing = file.size > 0 ? await file.text() : '';
    const block = buildAppendBlock(heading, content);
    const next = existing + block;

    const writable = await route.handle.createWritable({ keepExistingData: false });
    await writable.write(next);
    await writable.close();

    return { ok: true, fileName: route.handle.name };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'write-failed', message: msg };
  }
}

async function writeToClipboard(content: string): Promise<OffscreenClipboardResult> {
  // We deliberately use the legacy textarea + document.execCommand('copy')
  // dance instead of navigator.clipboard.writeText.
  //
  // Why: navigator.clipboard.writeText rejects with "Document is not focused"
  // when called from an offscreen document (offscreen docs are never focused
  // by definition). The chrome.offscreen.Reason.CLIPBOARD value is intended
  // for exactly this legacy path — the recommended Chrome MV3 pattern for
  // SW-initiated clipboard writes.
  try {
    const textarea = document.createElement('textarea');
    textarea.value = content;
    // Position offscreen so it doesn't reflow anything visible.
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    if (!ok) {
      return {
        ok: false,
        reason: 'clipboard-failed',
        message: 'document.execCommand("copy") returned false',
      };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'clipboard-failed', message: msg };
  }
}

function isOffscreenMessage(m: unknown): m is OffscreenMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as { target?: unknown }).target === 'offscreen'
  );
}
