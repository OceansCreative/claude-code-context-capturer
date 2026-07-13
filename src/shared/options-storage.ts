import { DEFAULT_OPTIONS, type UserOptions } from './types';

const STORAGE_KEY = 'ccc.options';
const ONBOARDING_KEY = 'ccc.onboarding';

/** Read user options from chrome.storage.sync, falling back to defaults. */
export async function loadOptions(): Promise<UserOptions> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY], (result) => {
      const stored = result[STORAGE_KEY] as Partial<UserOptions> | undefined;
      resolve({ ...DEFAULT_OPTIONS, ...stored });
    });
  });
}

/** Persist user options to chrome.storage.sync. */
export async function saveOptions(options: UserOptions): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: options }, () => resolve());
  });
}

/** Reset all options back to defaults. */
export async function resetOptions(): Promise<void> {
  return saveOptions(DEFAULT_OPTIONS);
}

/**
 * First-run onboarding state.
 *
 * Stored under its own key rather than inside UserOptions so the onboarding
 * feature stays self-contained (and doesn't touch the shared UserOptions
 * shape). `dismissed` hides the checklist permanently once the user is done;
 * `everCaptured` is a lightweight flag the service worker flips on the first
 * successful capture so the "Try a capture" step can auto-check in every output
 * mode — not just the buffer modes.
 */
export interface OnboardingState {
  dismissed: boolean;
  everCaptured: boolean;
}

const DEFAULT_ONBOARDING: OnboardingState = {
  dismissed: false,
  everCaptured: false,
};

/** Read onboarding state from chrome.storage.sync, falling back to defaults. */
export async function loadOnboardingState(): Promise<OnboardingState> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([ONBOARDING_KEY], (result) => {
      const stored = result[ONBOARDING_KEY] as Partial<OnboardingState> | undefined;
      resolve({ ...DEFAULT_ONBOARDING, ...stored });
    });
  });
}

/** Merge a partial patch into the persisted onboarding state. */
export async function saveOnboardingState(
  patch: Partial<OnboardingState>
): Promise<void> {
  const current = await loadOnboardingState();
  const next: OnboardingState = { ...current, ...patch };
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [ONBOARDING_KEY]: next }, () => resolve());
  });
}

/**
 * Record that at least one capture has landed. No-op once already set, to avoid
 * a needless chrome.storage.sync write on every capture (sync storage has
 * write-rate limits). Called by the service worker from `notifyDelivery`.
 */
export async function markCaptured(): Promise<void> {
  const current = await loadOnboardingState();
  if (current.everCaptured) return;
  await saveOnboardingState({ everCaptured: true });
}
