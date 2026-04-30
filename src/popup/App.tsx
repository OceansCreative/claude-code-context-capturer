import { useEffect, useState } from 'react';
import type { RuntimeMessage } from '@/shared/types';
import { readBuffer, type BufferEntry } from '@/shared/buffer-storage';

type Status = 'idle' | 'capturing' | 'success' | 'error';

export default function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<BufferEntry[]>([]);

  useEffect(() => {
    void refreshBuffer();
  }, []);

  async function refreshBuffer() {
    const entries = await readBuffer();
    setBuffer(entries);
  }

  async function dispatch(type: 'CAPTURE_PAGE' | 'CAPTURE_SELECTION') {
    setStatus('capturing');
    setErrorMessage(null);
    try {
      const response = (await chrome.runtime.sendMessage({ type })) as RuntimeMessage;
      if (response.type === 'CAPTURE_ERROR') {
        setErrorMessage(response.error);
        setStatus('error');
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
          Claude Code Context Capturer
        </h1>
        <button
          type="button"
          aria-label="Open settings"
          onClick={openOptions}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          ⚙ Settings
        </button>
      </header>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void dispatch('CAPTURE_PAGE')}
          disabled={status === 'capturing'}
          className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
        >
          {status === 'capturing' ? 'Capturing…' : 'Capture page'}
        </button>
        <button
          type="button"
          onClick={() => void dispatch('CAPTURE_SELECTION')}
          disabled={status === 'capturing'}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-100 disabled:opacity-60"
        >
          Capture selection
        </button>
      </div>

      {status === 'success' && (
        <p className="mt-3 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
          Captured ✓
        </p>
      )}
      {status === 'error' && errorMessage && (
        <p className="mt-3 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">
          {errorMessage}
        </p>
      )}

      {buffer.length > 0 && (
        <section className="mt-4 border-t border-slate-200 pt-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Recent captures ({buffer.length})
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
            Manage all captures →
          </button>
        </section>
      )}

      <footer className="mt-4 border-t border-slate-200 pt-3 text-[10px] text-slate-400">
        Shortcuts: Ctrl/Cmd+Shift+L (page) · Ctrl/Cmd+Shift+K (selection)
      </footer>
    </div>
  );
}
