import { useEffect, useState } from 'react';
import type { RuntimeMessage, UserOptions } from '@/shared/types';
import { readBuffer, type BufferEntry } from '@/shared/buffer-storage';
import { loadOptions, saveOptions } from '@/shared/options-storage';
import { t } from '@/shared/i18n';

type Status = 'idle' | 'capturing' | 'success' | 'preview-pending' | 'error';

export default function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<BufferEntry[]>([]);
  const [options, setOptions] = useState<UserOptions | null>(null);
  const [isClaudeAi, setIsClaudeAi] = useState(false);

  useEffect(() => {
    void refreshBuffer();
    void loadOptions().then(setOptions);
    void detectClaudeAi();
  }, []);

  async function refreshBuffer() {
    const entries = await readBuffer();
    setBuffer(entries);
  }

  async function detectClaudeAi() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? '';
      setIsClaudeAi(/^https:\/\/claude\.ai\/chat\/[0-9a-f-]{8,}/i.test(url));
    } catch {
      setIsClaudeAi(false);
    }
  }

  /** Persist a single option change immediately (next capture picks it up). */
  async function patchOption<K extends keyof UserOptions>(
    key: K,
    value: UserOptions[K]
  ) {
    if (!options) return;
    const next = { ...options, [key]: value };
    setOptions(next);
    await saveOptions(next);
  }

  async function dispatch(type: 'CAPTURE_PAGE' | 'CAPTURE_SELECTION') {
    setStatus('capturing');
    setErrorMessage(null);
    try {
      const response = (await chrome.runtime.sendMessage({ type })) as RuntimeMessage;
      if (response.type === 'CAPTURE_ERROR') {
        setErrorMessage(response.error);
        setStatus('error');
      } else if (response.type === 'CAPTURE_PENDING_PREVIEW') {
        setStatus('preview-pending');
        // Popup auto-closes when the new preview window grabs focus, which is
        // the cleanest exit — but if focus stays here for some reason, fall
        // back to a short idle reset.
        setTimeout(() => setStatus('idle'), 2500);
      } else {
        setStatus('success');
        await refreshBuffer();
        setTimeout(() => setStatus('idle'), 1500);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      setStatus('error');
    }
  }

  function openOptions() {
    chrome.runtime.openOptionsPage();
  }

  return (
    <div className="w-[340px] p-4 font-sans">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-base font-semibold text-slate-900">
          {t('extName')}
        </h1>
        <button
          type="button"
          aria-label={t('popupOpenSettings')}
          onClick={openOptions}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          ⚙ {t('settings')}
        </button>
      </header>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void dispatch('CAPTURE_PAGE')}
          disabled={status === 'capturing'}
          className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
        >
          {status === 'capturing' ? t('capturing') : t('capturePage')}
        </button>
        <button
          type="button"
          onClick={() => void dispatch('CAPTURE_SELECTION')}
          disabled={status === 'capturing'}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-100 disabled:opacity-60"
        >
          {t('captureSelection')}
        </button>
      </div>

      {isClaudeAi && options && (
        <section className="mt-3 rounded border border-violet-200 bg-violet-50 p-2.5">
          <h2 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
            <span aria-hidden>✦</span> {t('claudeAiChat')}
          </h2>

          <label className="flex cursor-pointer items-center justify-between gap-2 text-xs text-slate-700">
            <span>
              <span className="font-medium">{t('artifactsOnly')}</span>
              <span className="block text-[10px] text-slate-500">
                {t('artifactsOnlyShortHint')}
              </span>
            </span>
            <input
              type="checkbox"
              checked={options.claudeAiArtifactsOnly}
              onChange={(e) =>
                void patchOption('claudeAiArtifactsOnly', e.target.checked)
              }
              className="h-4 w-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
            />
          </label>

          <label className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-700">
            <span>
              <span className="font-medium">{t('lastNMessages')}</span>
              <span className="block text-[10px] text-slate-500">
                {t('wholeConversationHint')}
              </span>
            </span>
            <input
              type="number"
              min={0}
              value={options.claudeAiMaxMessages}
              onChange={(e) =>
                void patchOption(
                  'claudeAiMaxMessages',
                  Math.max(0, Number(e.target.value))
                )
              }
              className="w-16 shrink-0 rounded border border-slate-300 px-2 py-1 text-xs"
            />
          </label>
        </section>
      )}

      {status === 'success' && (
        <p className="mt-3 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
          {t('captured')}
        </p>
      )}
      {status === 'preview-pending' && (
        <p className="mt-3 rounded bg-sky-50 px-2 py-1 text-xs text-sky-700">
          {t('previewWindowOpened')}
        </p>
      )}
      {status === 'error' && errorMessage && (
        <div className="mt-3 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">
          <p>{errorMessage}</p>
          {/no-handle|permission-denied/.test(errorMessage) && (
            <button
              type="button"
              onClick={openOptions}
              className="mt-1 underline hover:text-rose-900"
            >
              {t('popupOpenSettingsToRelink')}
            </button>
          )}
        </div>
      )}

      {buffer.length > 0 && (
        <section className="mt-4 border-t border-slate-200 pt-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('recentCaptures')} ({buffer.length})
          </h2>
          <ul className="space-y-1.5">
            {buffer.slice(0, 5).map((entry) => (
              <li key={entry.id} className="text-xs">
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-slate-700 hover:text-slate-900"
                  title={entry.title}
                >
                  {entry.title}
                </a>
                <span className="text-slate-400">
                  {new Date(entry.capturedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={openOptions}
            className="mt-2 text-xs text-slate-500 underline hover:text-slate-700"
          >
            {t('manageAllCaptures')}
          </button>
        </section>
      )}

      <footer className="mt-4 border-t border-slate-200 pt-3 text-[10px] text-slate-400">
        {t('popupShortcuts')}
      </footer>
    </div>
  );
}
