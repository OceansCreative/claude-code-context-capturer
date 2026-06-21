import { getRoute, getMcpDir } from '@/shared/handle-store';
import { buildAppendBlock } from '@/shared/file-appender';
import { classifyAppendResult } from '@/shared/append-result';
import { slugFileNamesToRemove } from '@/shared/artifact-file';
import type {
  OffscreenAppendResult,
  OffscreenClipboardResult,
  OffscreenMcpStoreResult,
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

  if (message.type === 'PING') {
    // Synchronous response so the SW knows the listener is wired up.
    // Returning true (not false) keeps the channel open until sendResponse
    // is delivered — some Chrome versions discard the response when the
    // listener returns false even after calling sendResponse synchronously.
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'APPEND_TO_CLAUDE_MD') {
    void appendToRoute(message.routeId, message.content, message.heading).then(
      sendResponse
    );
    return true; // async response
  }
  if (message.type === 'WRITE_TO_MCP_STORE') {
    void writeToMcpStore(message.fileName, message.content).then(sendResponse);
    return true; // async response
  }
  if (message.type === 'WRITE_MCP_FILESET') {
    void writeMcpFileset(message.cleanupPrefix, message.files).then(sendResponse);
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

  if (!route.handles || route.handles.length === 0) {
    return {
      ok: false,
      reason: 'no-handle',
      message: `Route "${route.label}" has no linked files. Link at least one in the options page.`,
    };
  }

  const block = buildAppendBlock(heading, content);
  const succeeded: string[] = [];
  const partialFailures: { fileName: string; reason: string }[] = [];

  for (const handle of route.handles) {
    const fileName = handle.name;
    // Permission may have lapsed since the user picked the file. We can only
    // re-prompt from a window with a transient user activation, which the
    // offscreen doc lacks — record this handle as a partial failure so the
    // UI can ask the user to re-grant from the options page without losing
    // writes that DID succeed to sibling handles.
    let perm: PermissionState;
    try {
      perm = await handle.queryPermission({ mode: 'readwrite' });
    } catch (err) {
      partialFailures.push({
        fileName,
        reason: `permission probe failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (perm !== 'granted') {
      partialFailures.push({
        fileName,
        reason: `permission lapsed (re-link "${route.label}" → ${fileName} in options)`,
      });
      continue;
    }

    try {
      const file = await handle.getFile();
      const existing = file.size > 0 ? await file.text() : '';
      const next = existing + block;

      const writable = await handle.createWritable({ keepExistingData: false });
      await writable.write(next);
      await writable.close();

      succeeded.push(fileName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      partialFailures.push({ fileName, reason: msg });
    }
  }

  return classifyAppendResult(succeeded, partialFailures);
}

/**
 * Write one capture as a standalone `<slug>.md` file into the linked MCP
 * contexts directory. Each capture is its own file (not appended), so the
 * companion MCP server can list/get/search them individually — and CLAUDE.md
 * never bloats.
 */
async function writeToMcpStore(
  fileName: string,
  content: string
): Promise<OffscreenMcpStoreResult> {
  const acquired = await acquireMcpDir();
  if ('error' in acquired) return acquired.error;
  const dir = acquired.dir;

  try {
    await writeFile(dir, fileName, content);
    return { ok: true, fileName };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'write-failed', message: msg };
  }
}

/**
 * Write a complete file set for one capture, replacing any previous version.
 *
 * Before writing, removes the existing main file (`<baseSlug>.md`) and any
 * derived per-artifact files (`<baseSlug>--*.md`). This is what makes
 * re-capturing the same claude.ai conversation an UPDATE rather than a pile of
 * duplicate snapshots — the "no silos / single source of truth" behaviour.
 */
async function writeMcpFileset(
  cleanupPrefix: string | null,
  files: Array<{ fileName: string; content: string }>
): Promise<OffscreenMcpStoreResult> {
  const acquired = await acquireMcpDir();
  if ('error' in acquired) return acquired.error;
  const dir = acquired.dir;

  try {
    if (cleanupPrefix) {
      await removeSlugFiles(dir, cleanupPrefix);
    }
    for (const f of files) {
      await writeFile(dir, f.fileName, f.content);
    }
    return { ok: true, fileName: files[0]?.fileName ?? '' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'write-failed', message: msg };
  }
}

/** Resolve the linked MCP dir + verify write permission, or an error result. */
async function acquireMcpDir(): Promise<
  { dir: FileSystemDirectoryHandle } | { error: OffscreenMcpStoreResult }
> {
  const dir = await getMcpDir();
  if (!dir) {
    return {
      error: {
        ok: false,
        reason: 'no-handle',
        message: 'No MCP contexts directory is linked. Link one in the options page.',
      },
    };
  }
  const perm = await dir.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') {
    return {
      error: {
        ok: false,
        reason: 'permission-denied',
        message:
          'Re-link the MCP contexts directory from the options page to grant write access.',
      },
    };
  }
  return { dir };
}

async function writeFile(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  content: string
): Promise<void> {
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable({ keepExistingData: false });
  await writable.write(content);
  await writable.close();
}

/** Remove all `<cleanupPrefix>*.md` files (the prior version of a capture). */
async function removeSlugFiles(
  dir: FileSystemDirectoryHandle,
  cleanupPrefix: string
): Promise<void> {
  const names: string[] = [];
  // FileSystemDirectoryHandle is async-iterable over [name, handle] entries.
  for await (const [name, handle] of (
    dir as unknown as AsyncIterable<[string, FileSystemHandle]>
  )) {
    if (handle.kind === 'file') names.push(name);
  }

  for (const name of slugFileNamesToRemove(names, cleanupPrefix)) {
    try {
      await dir.removeEntry(name);
    } catch {
      // Best-effort: a file we couldn't remove will simply be overwritten if
      // it's part of the new set, or left behind otherwise.
    }
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
