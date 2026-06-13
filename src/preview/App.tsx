import { useEffect, useState } from 'react';
import { loadStagedCapture } from '@/shared/preview-stage';
import type { RuntimeMessage, StagedCapture } from '@/shared/types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; staged: StagedCapture; edited: string }
  | { kind: 'missing' }
  | { kind: 'submitting' }
  | { kind: 'done'; ok: boolean; message?: string };

function getStageIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function describeDestination(staged: StagedCapture): string {
  const mode = staged.options.defaultMode;
  switch (mode) {
    case 'clipboard':
      return 'System clipboard';
    case 'append-buffer':
      return 'In-extension buffer';
    case 'claude-md':
      return 'Linked CLAUDE.md (URL-matched route)';
    case 'mcp-store':
      return 'MCP captures directory';
    case 'both':
      return 'Clipboard + in-extension buffer';
    default:
      return mode;
  }
}

export default function App() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [skipFuture, setSkipFuture] = useState(false);

  useEffect(() => {
    const id = getStageIdFromUrl();
    if (!id) {
      setState({ kind: 'missing' });
      return;
    }
    void loadStagedCapture(id).then((staged) => {
      if (!staged) {
        setState({ kind: 'missing' });
        return;
      }
      setState({ kind: 'ready', staged, edited: staged.finalMarkdown });
    });
  }, []);

  async function handleConfirm() {
    if (state.kind !== 'ready') return;
    setState({ kind: 'submitting' });
    const message: RuntimeMessage = {
      type: 'PREVIEW_CONFIRM',
      stageId: state.staged.id,
      editedMarkdown: state.edited,
      skipFutureWrites: skipFuture,
    };
    try {
      const reply = (await chrome.runtime.sendMessage(message)) as
        | { ok: true }
        | { ok: false; error: string };
      if (reply.ok) {
        setState({ kind: 'done', ok: true });
        setTimeout(() => window.close(), 800);
      } else {
        setState({ kind: 'done', ok: false, message: reply.error });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setState({ kind: 'done', ok: false, message: errMsg });
    }
  }

  async function handleCancel() {
    if (state.kind === 'ready') {
      const message: RuntimeMessage = {
        type: 'PREVIEW_CANCEL',
        stageId: state.staged.id,
      };
      void chrome.runtime.sendMessage(message);
    }
    window.close();
  }

  if (state.kind === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-500">
        Loading capture…
      </div>
    );
  }

  if (state.kind === 'missing') {
    return (
      <div className="mx-auto max-w-xl px-6 py-10 font-sans">
        <h1 className="mb-2 text-xl font-semibold text-rose-700">
          This preview expired
        </h1>
        <p className="text-sm text-slate-600">
          The staged capture is no longer in session storage. This usually
          means the service worker restarted or the browser was closed.
          Trigger the capture again — the new preview will land here.
        </p>
        <button
          type="button"
          onClick={() => window.close()}
          className="mt-6 rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
        >
          Close
        </button>
      </div>
    );
  }

  if (state.kind === 'submitting') {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-slate-500">
        Writing…
      </div>
    );
  }

  if (state.kind === 'done') {
    return (
      <div className="mx-auto max-w-xl px-6 py-10 font-sans">
        {state.ok ? (
          <>
            <h1 className="mb-2 text-xl font-semibold text-emerald-700">
              Captured ✓
            </h1>
            <p className="text-sm text-slate-600">Closing this window…</p>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-xl font-semibold text-rose-700">
              Write failed
            </h1>
            <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {state.message ?? 'Unknown error'}
            </p>
            <button
              type="button"
              onClick={() => window.close()}
              className="mt-6 rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
            >
              Close
            </button>
          </>
        )}
      </div>
    );
  }

  const { staged, edited } = state;
  const charCount = edited.length;
  const byteCount = new Blob([edited]).size;
  const originalChars = staged.finalMarkdown.length;
  const delta = charCount - originalChars;

  return (
    <div className="flex h-screen flex-col font-sans">
      <header className="border-b border-slate-200 bg-slate-50 px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-slate-900">
              {staged.payload.title}
            </h1>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              <span className="font-mono">{staged.payload.url}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              parser: <span className="font-mono">{staged.payload.parser}</span>
              {' · '}
              destination:{' '}
              <span className="font-medium text-slate-700">
                {describeDestination(staged)}
              </span>
            </p>
          </div>
          <div className="flex-shrink-0 text-right text-xs text-slate-500">
            <div>
              {charCount.toLocaleString()} chars · {byteCount.toLocaleString()} bytes
            </div>
            {delta !== 0 && (
              <div className={delta < 0 ? 'text-emerald-600' : 'text-amber-600'}>
                {delta > 0 ? '+' : ''}
                {delta.toLocaleString()} vs original
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-6">
        <label className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Markdown to write (editable)
        </label>
        <textarea
          value={edited}
          onChange={(e) =>
            setState({ kind: 'ready', staged, edited: e.target.value })
          }
          className="min-h-0 flex-1 resize-none rounded border border-slate-300 p-3 font-mono text-xs leading-relaxed focus:border-slate-500 focus:outline-none"
          spellCheck={false}
        />
      </main>

      <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={skipFuture}
            onChange={(e) => setSkipFuture(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Skip preview for future captures (re-enable in Options)
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleCancel()}
            className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Confirm &amp; write
          </button>
        </div>
      </footer>
    </div>
  );
}
