import enMessages from '../../public/_locales/en/messages.json';

/**
 * Typed wrapper around chrome.i18n for the extension UI.
 *
 * At runtime in an extension context, `t(key)` resolves through
 * `chrome.i18n.getMessage`, which reads the active locale's
 * `_locales/<lang>/messages.json` (see `public/_locales/`). English is the
 * `default_locale`; Japanese ships alongside.
 *
 * `MessageKey` is derived from the English catalog, so referencing a key that
 * doesn't exist is a compile-time error — the anti-typo guard for the whole UI.
 *
 * In non-extension contexts (vitest / happy-dom) `chrome.i18n` is undefined; we
 * fall back to the bundled English source so components render real strings
 * instead of crashing or showing raw keys.
 */

interface MessageEntry {
  message: string;
  description?: string;
}

const EN = enMessages as Record<string, MessageEntry>;

/** Union of every message key present in the English catalog. */
export type MessageKey = keyof typeof enMessages;

/**
 * Look up a localized message.
 *
 * @param key  A key from the message catalog (type-checked).
 * @param subs Optional positional substitutions ($1..$9 in the message).
 * @returns    The localized string, or the English fallback, or the key itself
 *             if the key is somehow absent.
 */
export function t(key: MessageKey, subs?: string[]): string {
  const i18n = (globalThis as typeof globalThis & { chrome?: typeof chrome })
    .chrome?.i18n;
  if (i18n?.getMessage) {
    const msg = i18n.getMessage(key as string, subs);
    // getMessage returns '' for an unknown key; fall through to the source.
    if (msg) return msg;
  }

  const fallback = EN[key as string]?.message;
  if (fallback === undefined) return key as string;
  if (!subs?.length) return fallback;
  return fallback.replace(/\$(\d)/g, (_, d) => subs[Number(d) - 1] ?? '');
}
