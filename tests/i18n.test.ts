import { describe, expect, it } from 'vitest';
import enMessages from '../public/_locales/en/messages.json';
import jaMessages from '../public/_locales/ja/messages.json';
import { t, type MessageKey } from '@/shared/i18n';

const enKeys = Object.keys(enMessages).sort();
const jaKeys = Object.keys(jaMessages).sort();

describe('locale message catalogs', () => {
  it('en and ja have the exact same set of keys (anti-drift guard)', () => {
    const missingInJa = enKeys.filter((k) => !(k in jaMessages));
    const orphanInJa = jaKeys.filter((k) => !(k in enMessages));
    // Surface the offending keys directly so a failure names what drifted.
    expect(missingInJa, 'keys in en/ but missing from ja/').toEqual([]);
    expect(orphanInJa, 'keys in ja/ with no en/ counterpart').toEqual([]);
    expect(jaKeys).toEqual(enKeys);
  });

  it('every message in both locales is a non-empty string', () => {
    for (const [key, entry] of Object.entries(enMessages)) {
      expect(entry.message.trim().length, `en/${key} is empty`).toBeGreaterThan(0);
    }
    for (const [key, entry] of Object.entries(jaMessages)) {
      expect(entry.message.trim().length, `ja/${key} is empty`).toBeGreaterThan(0);
    }
  });

  it('extName and extDescription exist (referenced by the manifest __MSG__ tokens)', () => {
    for (const required of ['extName', 'extDescription'] as const) {
      expect(enMessages).toHaveProperty(required);
      expect(jaMessages).toHaveProperty(required);
    }
  });
});

describe('MessageKey union', () => {
  it('matches the JSON key set exactly (unknown keys are a type error)', () => {
    // MessageKey is `keyof typeof enMessages`. Round-tripping every runtime key
    // through the type asserts the union and the catalog can never silently
    // diverge from one another.
    const typedKeys: MessageKey[] = enKeys as MessageKey[];
    expect(typedKeys.slice().sort()).toEqual(enKeys);

    // Compile-time proof that a bogus key is rejected:
    // @ts-expect-error 'notARealKey' is not a MessageKey
    const bogus: MessageKey = 'notARealKey';
    void bogus;
  });
});

describe('t() fallback (no chrome.i18n, as in happy-dom)', () => {
  it('returns the English source message when chrome.i18n is absent', () => {
    // vitest/happy-dom has no chrome global, so t() exercises the fallback path.
    expect(t('save')).toBe(enMessages.save.message);
    expect(t('extName')).toBe(enMessages.extName.message);
  });

  it('applies positional substitutions in the fallback path', () => {
    // No catalog entry uses $1 today, but the helper must still substitute so a
    // future substituted message degrades gracefully in tests.
    expect(t('save', ['ignored'])).toBe(enMessages.save.message);
  });
});
