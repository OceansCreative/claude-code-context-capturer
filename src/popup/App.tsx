import { useEffect, useState } from 'react';
import type { ClaudeMdRoute, RuntimeMessage, UserOptions } from '@/shared/types';
import { readBuffer, type BufferEntry } from '@/shared/buffer-storage';
import { listRoutes } from '@/shared/handle-store';
import { loadOptions, saveOptions } from '@/shared/options-storage';
import {
  selectRecentCaptures,
  formatCaptureRow,
  outputModeIncludesBuffer,
} from '@/shared/recent-captures';
import { t } from '@/shared/i18n';

/** How many recent captures the popup surfaces. */
const RECENT_LIMIT = 5;

/**
 * localStorage key remembering the last per-capture route override. Purely a
 * per-viewer convenience — the authoritative routing still happens in the
 * service worker, and a stale/removed id degrades gracefully to "Auto".
 */
const ROUTE_OVERRIDE_KEY = 'ccc.popup.routeOverride';

/** Sentinel for the "Auto (match by URL)" selection — send no override. */
const AUTO_ROUTE = '';

/** Read the remembered override id; defensive against disabled storage. */
function readStoredRouteOverride(): string {
  try {
    return localStorage.getItem(ROUTE_OVERRIDE_KEY) ?? AUTO_ROUTE;
  } catch {
    return AUTO_ROUTE;
  }
}

/** Persist (or clear) the remembered override id; best-effort. */
function storeRouteOverride(value: string): void {
  try {
    if (value === AUTO_ROUTE) localStorage.removeItem(ROUTE_OVERRIDE_KEY);
    else localStorage.setItem(ROUTE_OVERRIDE_KEY, value);
  } catch {
    // Ignore — the override just won't be remembered next time.
  }
}

type Status = 'idle' | 'capturing' | 'success' | 'preview-pending' | 'error';

export default function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<BufferEntry[]>([]);
  const [options, setOptions] = useState<UserOptions | null>(null);
  const [routes, setRoutes] = useState<ClaudeMdRoute[]>([]);
  // Per-capture route override ('' = Auto). Seeded from localStorage; validated
  // against the loaded routes once they arrive.
  const [routeOverride, setRouteOverride] = useState<string>(readStoredRouteOverride);
  const [isClaudeAi, setIsClaudeAi] = useState(false);
  // Transient per-row feedback for the re-copy button.
  const [copyFeedback, setCopyFeedback] = useState<{
    id: string;
    status: 'copied' | 'error';
  } | null>(null);

  useEffect(() => {
    void refreshBuffer();
    void loadOptions().then(setOptions);
    void loadRoutes();
    void detectClaudeAi();
  }, []);

  async function refreshBuffer() {
    const entries = await readBuffer();
    setBuffer(entries);
  }

  async function loadRoutes() {
    const list = await listRoutes();
    setRoutes(list);
    // Drop a remembered override that points at a route that no longer exists,
    // so the selector shows "Auto" instead of a blank/phantom choice.
    setRouteOverride((cur) =>
      cur !== AUTO_ROUTE && !list.some((r) => r.id === cur) ? AUTO_ROUTE : cur
    );
  }

  function changeRouteOverride(value: string) {
    setRouteOverride(value);
    storeRouteOverride(value);
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
      // Only send the override when it's active AND meaningful for this capture
      // (claude-md mode with a chosen route). Otherwise the SW auto-resolves.
      const routeId = showRouteSelector && routeOverride ? routeOverride : undefined;
      const response = (await chrome.runtime.sendMessage({
        type,
        ...(routeId ? { routeId } : {}),
      })) as RuntimeMessage;
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

  /**
   * Re-copy a buffered capture to the clipboard. Routed through the service
   * worker so it reuses the same offscreen clipboard path as a fresh capture
   * (navigator.clipboard is unreliable from the popup once it loses focus).
   */
  async function handleRecopy(id: string) {
    let ok = false;
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'RECOPY_BUFFER_ENTRY',
        id,
      })) as { ok: boolean; error?: string };
      ok = res?.ok === true;
    } catch {
      ok = false;
    }
    setCopyFeedback({ id, status: ok ? 'copied' : 'error' });
    setTimeout(
      () => setCopyFeedback((cur) => (cur?.id === id ? null : cur)),
      1500
    );
  }

  const now = Date.now();
  const uiLocale = chrome.i18n.getUILanguage();
  const recent = selectRecentCaptures(buffer, RECENT_LIMIT).map((entry) =>
    formatCaptureRow(entry, now, uiLocale)
  );

  // The per-capture route override only makes sense when captures land in a
  // context file AND there's more than one route to choose between. Otherwise
  // routing is unambiguous, so we don't clutter the popup.
  const showRouteSelector =
    options?.defaultMode === 'claude-md' && routes.length > 1;

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

      {showRouteSelector && (
        <section className="mt-3">
          <label className="block text-xs text-slate-700">
            <span className="mb-1 flex items-center gap-1 font-medium">
              <span aria-hidden>→</span> {t('routeOverrideLabel')}
            </span>
            <select
              value={routeOverride}
              onChange={(e) => changeRouteOverride(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
            >
              <option value={AUTO_ROUTE}>{t('routeOverrideAuto')}</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] text-slate-500">
              {t('routeOverrideHint')}
            </span>
          </label>
        </section>
      )}

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

      <section className="mt-4 border-t border-slate-200 pt-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t('recentCaptures')}
          {recent.length > 0 ? ` (${buffer.length})` : ''}
        </h2>

        {recent.length === 0 ? (
          <div className="text-xs text-slate-400">
            <p>{t('recentEmpty')}</p>
            {options && !outputModeIncludesBuffer(options.defaultMode) && (
              <p className="mt-1 text-[10px] leading-snug">
                {t('recentEmptyBufferHint')}
              </p>
            )}
          </div>
        ) : (
          <>
            <ul className="space-y-1.5">
              {recent.map((row) => {
                const title = row.title || t('recentUntitled');
                const meta = [row.source, row.relativeTime]
                  .filter(Boolean)
                  .join(' · ');
                const feedback =
                  copyFeedback?.id === row.id ? copyFeedback.status : null;
                return (
                  <li
                    key={row.id}
                    className="flex items-start justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-slate-700 hover:text-slate-900"
                        title={title}
                      >
                        {title}
                      </a>
                      {meta && (
                        <span className="block text-[10px] text-slate-400">
                          {meta}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRecopy(row.id)}
                      aria-label={t('recentCopyTitle')}
                      title={t('recentCopyTitle')}
                      className={
                        'shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors ' +
                        (feedback === 'error'
                          ? 'border-rose-200 text-rose-600'
                          : feedback === 'copied'
                            ? 'border-emerald-200 text-emerald-700'
                            : 'border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700')
                      }
                    >
                      {feedback === 'copied'
                        ? t('recentCopied')
                        : feedback === 'error'
                          ? t('recentCopyFailed')
                          : t('recentCopy')}
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={openOptions}
              className="mt-2 text-xs text-slate-500 underline hover:text-slate-700"
            >
              {t('manageAllCaptures')}
            </button>
          </>
        )}
      </section>

      <footer className="mt-4 border-t border-slate-200 pt-3 text-[10px] text-slate-400">
        {t('popupShortcuts')}
      </footer>
    </div>
  );
}
