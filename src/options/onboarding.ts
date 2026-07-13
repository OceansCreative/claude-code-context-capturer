/**
 * Pure onboarding-step derivation.
 *
 * Given the same route / permission / buffer state the options page already
 * computes, decide which first-run steps are complete. Deliberately free of
 * React and chrome.* so it can be unit-tested in isolation — mirrors how the
 * repo extracts `classifyAppendResult` / `normalizeRouteHandles`.
 */

export type OnboardingStepId = 'link' | 'capture' | 'ready';

export interface OnboardingStepState {
  id: OnboardingStepId;
  done: boolean;
}

/** The minimal slice of state each step's completion is derived from. */
export interface OnboardingSignals {
  /**
   * One entry per route: does the route have at least one write-granted handle?
   * Derived from the same per-handle permission state the options page renders
   * in its route list.
   */
  routeHandleGrants: boolean[];
  /** The MCP contexts directory is linked AND write permission is granted. */
  mcpDirGranted: boolean;
  /**
   * A capture has landed at least once. Lightweight flag the service worker
   * flips on the first successful delivery, so this works across every output
   * mode (not only the buffer modes).
   */
  everCaptured: boolean;
  /** Current number of buffered captures (a buffered capture also implies one). */
  bufferCount: number;
}

/**
 * Step 1 — "Link a context file": at least one linked write target exists — a
 * route with a granted handle, or the MCP contexts directory. This is the exact
 * churn point onboarding exists to fix: with no linked target, nothing is ever
 * written and the user quietly drops off.
 */
export function isContextLinked(s: OnboardingSignals): boolean {
  return s.routeHandleGrants.some((granted) => granted) || s.mcpDirGranted;
}

/**
 * Step 2 — "Try a capture": a capture has happened. The primary signal is the
 * `everCaptured` flag the service worker sets on any successful delivery.
 * `bufferCount > 0` is an OR fallback so pre-existing buffered captures (from
 * before this flag existed) count too.
 */
export function hasCaptured(s: OnboardingSignals): boolean {
  return s.everCaptured || s.bufferCount > 0;
}

/**
 * Derive the three onboarding steps. Step 3 ("You're set") is informational and
 * lights up once the user has both linked a target and captured at least once.
 */
export function deriveOnboardingSteps(s: OnboardingSignals): OnboardingStepState[] {
  const linked = isContextLinked(s);
  const captured = hasCaptured(s);
  return [
    { id: 'link', done: linked },
    { id: 'capture', done: captured },
    { id: 'ready', done: linked && captured },
  ];
}

/** True once every onboarding step is complete. */
export function isOnboardingComplete(s: OnboardingSignals): boolean {
  return deriveOnboardingSteps(s).every((step) => step.done);
}
