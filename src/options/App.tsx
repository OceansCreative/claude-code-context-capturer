import { useEffect, useState } from 'react';
import {
  loadOptions,
  saveOptions,
  resetOptions,
} from '@/shared/options-storage';
import {
  readBuffer,
  removeFromBuffer,
  clearBuffer,
  exportBufferAsMarkdown,
  type BufferEntry,
} from '@/shared/buffer-storage';
import {
  loadClaudeMdHandle,
  saveClaudeMdHandle,
  clearClaudeMdHandle,
} from '@/shared/handle-store';
import { DEFAULT_OPTIONS, type UserOptions, type OutputMode } from '@/shared/types';

type LinkedFileState =
  | { status: 'none' }
  | { status: 'linked'; name: string; permission: PermissionState }
  | { status: 'error'; message: string };

export default function App() {
  const [options, setOptions] = useState<UserOptions>(DEFAULT_OPTIONS);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<BufferEntry[]>([]);
  const [linkedFile, setLinkedFile] = useState<LinkedFileState>({ status: 'none' });

  useEffect(() => {
    void loadOptions().then(setOptions);
    void readBuffer().then(setBuffer);
    void refreshLinkedFile();
  }, []);

  async function refreshLinkedFile() {
    try {
      const handle = await loadClaudeMdHandle();
      if (!handle) {
        setLinkedFile({ status: 'none' });
        return;
      }
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      setLinkedFile({ status: 'linked', name: handle.name, permission: perm });
    } catch (err) {
      setLinkedFile({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleLinkClaudeMd() {
    if (!('showOpenFilePicker' in window)) {
      alert('Your browser does not support the File System Access API.');
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'Markdown',
            accept: { 'text/markdown': ['.md', '.markdown'] },
          },
        ],
        multiple: false,
      });
      // Request readwrite up-front so subsequent appends from the offscreen
      // doc don't fail the permission check (the offscreen doc has no user
      // gesture and can't re-prompt).
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        alert('Write permission was not granted.');
        return;
      }
      await saveClaudeMdHandle(handle);
      await refreshLinkedFile();
    } catch (err) {
      // AbortError (user closed the picker) is normal — ignore quietly.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      alert(`Could not link file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleUnlinkClaudeMd() {
    await clearClaudeMdHandle();
    await refreshLinkedFile();
  }

  async function handleRegrant() {
    try {
      const handle = await loadClaudeMdHandle();
      if (!handle) return;
      await handle.requestPermission({ mode: 'readwrite' });
      await refreshLinkedFile();
    } catch (err) {
      alert(`Could not re-grant permission: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function refreshBuffer() {
    setBuffer(await readBuffer());
  }

  async function handleSave() {
    await saveOptions(options);
    setSavedAt(new Date().toLocaleTimeString());
  }

  async function handleReset() {
    await resetOptions();
    setOptions(DEFAULT_OPTIONS);
    setSavedAt(new Date().toLocaleTimeString());
  }

  async function handleExportBuffer() {
    const md = await exportBufferAsMarkdown();
    if (!md) return;
    await navigator.clipboard.writeText(md);
    alert('All buffered captures copied to clipboard.');
  }

  async function handleClearBuffer() {
    if (!confirm('Clear all buffered captures? This cannot be undone.')) return;
    await clearBuffer();
    await refreshBuffer();
  }

  async function handleRemoveEntry(id: string) {
    await removeFromBuffer(id);
    await refreshBuffer();
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 font-sans">
      <h1 className="mb-2 text-2xl font-semibold">Claude Code Context Capturer</h1>
      <p className="mb-8 text-sm text-slate-600">Settings &amp; capture buffer</p>

      <section className="mb-10 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Output</h2>

        <Field label="Default action">
          <select
            value={options.defaultMode}
            onChange={(e) =>
              setOptions({ ...options, defaultMode: e.target.value as OutputMode })
            }
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="clipboard">Copy to clipboard</option>
            <option value="append-buffer">Append to in-extension buffer</option>
            <option value="claude-md">Append to linked CLAUDE.md file</option>
            <option value="both">Clipboard + buffer</option>
          </select>
        </Field>

        <Toggle
          label="Include YAML frontmatter"
          description="Adds metadata (URL, title, captured_at) at the top of the output."
          checked={options.includeFrontmatter}
          onChange={(v) => setOptions({ ...options, includeFrontmatter: v })}
        />
        <Toggle
          label="Include source footer"
          description="Adds a 'Source: …' link at the bottom."
          checked={options.includeSourceFooter}
          onChange={(v) => setOptions({ ...options, includeSourceFooter: v })}
        />
        <Toggle
          label="Wrap output in fenced code block"
          description="Useful when pasting into chat windows that auto-format Markdown."
          checked={options.wrapInCodeBlock}
          onChange={(v) => setOptions({ ...options, wrapInCodeBlock: v })}
        />

        <Field label="Maximum body length (characters, 0 = no limit)">
          <input
            type="number"
            min={0}
            value={options.maxBodyLength}
            onChange={(e) =>
              setOptions({
                ...options,
                maxBodyLength: Math.max(0, Number(e.target.value)),
              })
            }
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Locale">
          <select
            value={options.locale}
            onChange={(e) =>
              setOptions({
                ...options,
                locale: e.target.value as UserOptions['locale'],
              })
            }
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </Field>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void handleReset()}
            className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
          >
            Reset to defaults
          </button>
          {savedAt && (
            <span className="text-xs text-slate-500">Saved at {savedAt}</span>
          )}
        </div>
      </section>

      <section className="mb-10 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">Linked CLAUDE.md file</h2>
        <p className="mb-4 text-xs text-slate-500">
          Pick a file once. Subsequent captures (when &ldquo;Append to linked
          CLAUDE.md file&rdquo; is the default action) write directly to it —
          no copy and paste.
        </p>

        {linkedFile.status === 'none' && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">No file linked yet.</span>
            <button
              type="button"
              onClick={() => void handleLinkClaudeMd()}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Link CLAUDE.md…
            </button>
          </div>
        )}

        {linkedFile.status === 'linked' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">
                <span className="font-medium text-slate-900">{linkedFile.name}</span>
                <span
                  className={
                    'ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ' +
                    (linkedFile.permission === 'granted'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700')
                  }
                >
                  {linkedFile.permission === 'granted' ? 'write granted' : 'needs re-grant'}
                </span>
              </span>
              <div className="flex gap-2">
                {linkedFile.permission !== 'granted' && (
                  <button
                    type="button"
                    onClick={() => void handleRegrant()}
                    className="rounded border border-amber-300 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50"
                  >
                    Re-grant write
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleLinkClaudeMd()}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => void handleUnlinkClaudeMd()}
                  className="rounded border border-rose-300 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50"
                >
                  Unlink
                </button>
              </div>
            </div>
          </div>
        )}

        {linkedFile.status === 'error' && (
          <p className="rounded bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {linkedFile.message}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Capture buffer ({buffer.length})
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleExportBuffer()}
              disabled={buffer.length === 0}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-50"
            >
              Copy all as Markdown
            </button>
            <button
              type="button"
              onClick={() => void handleClearBuffer()}
              disabled={buffer.length === 0}
              className="rounded border border-rose-300 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              Clear all
            </button>
          </div>
        </div>

        {buffer.length === 0 ? (
          <p className="text-sm text-slate-500">No captures buffered yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {buffer.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <div className="min-w-0 flex-1 pr-3">
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-medium text-slate-900 hover:underline"
                  >
                    {entry.title}
                  </a>
                  <span className="text-xs text-slate-500">
                    {new Date(entry.capturedAt).toLocaleString()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemoveEntry(entry.id)}
                  className="text-xs text-slate-400 hover:text-rose-600"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="mb-3 flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
      />
      <span className="flex-1">
        <span className="block font-medium text-slate-700">{label}</span>
        <span className="block text-xs text-slate-500">{description}</span>
      </span>
    </label>
  );
}
