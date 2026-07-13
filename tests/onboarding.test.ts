import { describe, expect, it } from 'vitest';
import {
  deriveOnboardingSteps,
  hasCaptured,
  isContextLinked,
  isOnboardingComplete,
  type OnboardingSignals,
} from '@/options/onboarding';

/** A fresh install: nothing linked, nothing captured. */
function base(): OnboardingSignals {
  return {
    routeHandleGrants: [],
    mcpDirGranted: false,
    everCaptured: false,
    bufferCount: 0,
  };
}

function stepDone(signals: OnboardingSignals, id: 'link' | 'capture' | 'ready') {
  return deriveOnboardingSteps(signals).find((s) => s.id === id)?.done;
}

describe('isContextLinked (step 1)', () => {
  it('false on a fresh install with no linked target', () => {
    expect(isContextLinked(base())).toBe(false);
  });

  it('true when a route has at least one granted handle', () => {
    expect(isContextLinked({ ...base(), routeHandleGrants: [true] })).toBe(true);
  });

  it('true when ANY route has a granted handle, even if others lapsed', () => {
    expect(
      isContextLinked({ ...base(), routeHandleGrants: [false, true, false] })
    ).toBe(true);
  });

  it('false when routes exist but every handle needs a re-grant', () => {
    expect(
      isContextLinked({ ...base(), routeHandleGrants: [false, false] })
    ).toBe(false);
  });

  it('true when the MCP contexts directory is linked and granted', () => {
    expect(isContextLinked({ ...base(), mcpDirGranted: true })).toBe(true);
  });
});

describe('hasCaptured (step 2)', () => {
  it('false when never captured and buffer empty', () => {
    expect(hasCaptured(base())).toBe(false);
  });

  it('true once the everCaptured flag is set (any output mode)', () => {
    expect(hasCaptured({ ...base(), everCaptured: true })).toBe(true);
  });

  it('true when the buffer is non-empty even if the flag is unset', () => {
    // Covers captures made before the everCaptured flag existed.
    expect(hasCaptured({ ...base(), bufferCount: 3 })).toBe(true);
  });
});

describe('deriveOnboardingSteps', () => {
  it('all three incomplete on a fresh install', () => {
    const steps = deriveOnboardingSteps(base());
    expect(steps.map((s) => s.done)).toEqual([false, false, false]);
    expect(steps.map((s) => s.id)).toEqual(['link', 'capture', 'ready']);
  });

  it('linked but not captured: step 1 done, steps 2 and 3 pending', () => {
    const signals = { ...base(), routeHandleGrants: [true] };
    expect(stepDone(signals, 'link')).toBe(true);
    expect(stepDone(signals, 'capture')).toBe(false);
    expect(stepDone(signals, 'ready')).toBe(false);
  });

  it('captured but not linked: step 2 done, "ready" still pending', () => {
    const signals = { ...base(), everCaptured: true };
    expect(stepDone(signals, 'link')).toBe(false);
    expect(stepDone(signals, 'capture')).toBe(true);
    // "You're set" requires BOTH a linked target and a capture.
    expect(stepDone(signals, 'ready')).toBe(false);
  });

  it('linked AND captured: every step complete', () => {
    const signals = {
      ...base(),
      routeHandleGrants: [true],
      everCaptured: true,
    };
    expect(deriveOnboardingSteps(signals).every((s) => s.done)).toBe(true);
  });
});

describe('isOnboardingComplete', () => {
  it('false unless linked and captured', () => {
    expect(isOnboardingComplete(base())).toBe(false);
    expect(
      isOnboardingComplete({ ...base(), routeHandleGrants: [true] })
    ).toBe(false);
    expect(isOnboardingComplete({ ...base(), everCaptured: true })).toBe(false);
  });

  it('true once a granted route (or MCP dir) plus a capture exist', () => {
    expect(
      isOnboardingComplete({
        ...base(),
        mcpDirGranted: true,
        bufferCount: 1,
      })
    ).toBe(true);
  });
});
