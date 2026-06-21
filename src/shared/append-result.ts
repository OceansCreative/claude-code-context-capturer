import type { OffscreenAppendResult } from './types';

/**
 * Classify the outcome of fanning one capture out to a route's file handles.
 *
 * Pure: takes the file names that wrote and the per-file failures, returns the
 * result the service worker acts on. Extracted from the offscreen document so
 * the branching is unit-testable without the File System Access API.
 *
 * - some succeeded → ok; any failures ride along as `partialFailures` so the
 *   SW can warn the user that those files went stale instead of flashing a
 *   plain success.
 * - none succeeded → not ok. A lapsed permission takes priority over a generic
 *   write error because the popup has a targeted "re-link in options" fix for
 *   it; the message names the first such file.
 */
export function classifyAppendResult(
  succeeded: string[],
  partialFailures: { fileName: string; reason: string }[]
): OffscreenAppendResult {
  if (succeeded.length === 0) {
    const permLapse = partialFailures.find((f) => f.reason.startsWith('permission lapsed'));
    if (permLapse) {
      return {
        ok: false,
        reason: 'permission-denied',
        message: `All targets failed. ${permLapse.fileName}: ${permLapse.reason}`,
      };
    }
    return {
      ok: false,
      reason: 'write-failed',
      message: partialFailures.map((f) => `${f.fileName}: ${f.reason}`).join(' · '),
    };
  }

  return {
    ok: true,
    fileNames: succeeded,
    ...(partialFailures.length > 0 ? { partialFailures } : {}),
  };
}
