/**
 * Staging helpers for the preview-before-write flow.
 *
 * When the user has `previewBeforeWrite` enabled, the service worker stages
 * the captured payload (plus everything `deliver()` needs to re-enter) into
 * chrome.storage.session under a fresh id, opens the preview window with
 * `?id=<stageId>`, and waits for the user to Confirm or Cancel.
 *
 * Why chrome.storage.session and not local: the staged data is per-pending-
 * capture and never needs to survive a browser session. Session storage is
 * auto-cleared on browser close, which is the cleanest possible lifetime.
 */

import type { StagedCapture, UserOptions, CapturedContext } from './types';

const PREFIX = 'ccc.preview.';

export async function stageCapture(
  payload: CapturedContext,
  finalMarkdown: string,
  options: UserOptions,
  tabId: number
): Promise<string> {
  const id = crypto.randomUUID();
  const staged: StagedCapture = {
    id,
    payload,
    finalMarkdown,
    options,
    tabId,
    stagedAt: new Date().toISOString(),
  };
  await chrome.storage.session.set({ [PREFIX + id]: staged });
  return id;
}

export async function loadStagedCapture(id: string): Promise<StagedCapture | undefined> {
  const result = await chrome.storage.session.get(PREFIX + id);
  return result[PREFIX + id] as StagedCapture | undefined;
}

export async function removeStagedCapture(id: string): Promise<void> {
  await chrome.storage.session.remove(PREFIX + id);
}
