import { loadClaudeMdHandle } from '@/shared/handle-store';
import { buildAppendBlock } from '@/shared/file-appender';
import type { OffscreenMessage, OffscreenResult } from '@/shared/types';

/**
 * Hidden offscreen document.
 *
 * MV3 service workers can't use the File System Access API (no DOM, no window).
 * This document is spun up by the SW via chrome.offscreen.createDocument
 * solely to host the FSA write call. It exits quietly when the SW closes it.
 */

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isOffscreenMessage(message)) return false;

  if (message.type === 'APPEND_TO_CLAUDE_MD') {
    void appendToClaudeMd(message.content, message.heading).then(sendResponse);
    return true; // async response
  }
  return false;
});

async function appendToClaudeMd(
  content: string,
  heading: string
): Promise<OffscreenResult> {
  const handle = await loadClaudeMdHandle();
  if (!handle) {
    return { ok: false, reason: 'no-handle', message: 'No CLAUDE.md is linked.' };
  }

  // Permission may have lapsed since the user picked the file. We can only
  // re-prompt from a window that has a transient user activation, which the
  // offscreen doc lacks — so we report back and let the UI ask the user
  // to re-link from the options page.
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') {
    return {
      ok: false,
      reason: 'permission-denied',
      message: 'Re-link CLAUDE.md from the options page to grant write access.',
    };
  }

  try {
    const file = await handle.getFile();
    const existing = file.size > 0 ? await file.text() : '';
    const block = buildAppendBlock(heading, content);
    const next = existing + block;

    const writable = await handle.createWritable({ keepExistingData: false });
    await writable.write(next);
    await writable.close();

    return { ok: true, fileName: handle.name };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'write-failed', message: msg };
  }
}

function isOffscreenMessage(m: unknown): m is OffscreenMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    (m as { target?: unknown }).target === 'offscreen'
  );
}
