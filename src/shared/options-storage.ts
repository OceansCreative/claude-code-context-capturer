import { DEFAULT_OPTIONS, type UserOptions } from './types';

const STORAGE_KEY = 'ccc.options';

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
