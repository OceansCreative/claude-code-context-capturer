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
import { DEFAULT_OPTIONS, type UserOptions, type OutputMode } from '@/shared/types';

export default function App() {
  const [options, setOptions] = useState<UserOptions>(DEFAULT_OPTIONS);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<BufferEntry[]>([]);

  useEffect(() => {
    void loadOptions().then(setOptions);
    void readBuffer().then(setBuffer);
  }, []);

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
            <option value="append-buffer">Append to buffer</option>
            <option value="both">Both</option>
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
