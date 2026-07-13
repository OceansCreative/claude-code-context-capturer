import { useEffect, useState } from 'react';
import {
  loadOptions,
  saveOptions,
  resetOptions,
  loadOnboardingState,
  saveOnboardingState,
} from '@/shared/options-storage';
import OnboardingChecklist from './OnboardingChecklist';
import { deriveOnboardingSteps } from './onboarding';
import {
  readBuffer,
  removeFromBuffer,
  clearBuffer,
  exportBufferAsMarkdown,
  type BufferEntry,
} from '@/shared/buffer-storage';
import {
  listRoutes,
  saveRoute,
  deleteRoute,
  saveMcpDir,
  getMcpDir,
  clearMcpDir,
} from '@/shared/handle-store';
import {
  DEFAULT_OPTIONS,
  type ClaudeMdRoute,
  type OutputMode,
  type UserOptions,
} from '@/shared/types';

interface RouteRow extends ClaudeMdRoute {
  /** Aggregate permission: 'granted' iff every handle is granted. */
  permission: PermissionState;
  /** Per-handle perm state for the per-file UI badges. */
  perHandle: { name: string; permission: PermissionState }[];
}

export default function App() {
  const [options, setOptions] = useState<UserOptions>(DEFAULT_OPTIONS);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<BufferEntry[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [mcpDirName, setMcpDirName] = useState<string | null>(null);
  const [mcpDirPermission, setMcpDirPermission] = useState<PermissionState | null>(null);

  // First-run onboarding. `onboardingReady` gates the initial render so the
  // checklist never flashes for users who already dismissed it. It's visible
  // when opened via ?welcome=1 OR while it hasn't been dismissed yet.
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [everCaptured, setEverCaptured] = useState(false);

  useEffect(() => {
    void loadOptions().then(setOptions);
    void readBuffer().then(setBuffer);
    void refreshRoutes();
    void refreshMcpDir();

    const welcome =
      new URLSearchParams(window.location.search).get('welcome') === '1';
    // Strip ?welcome=1 so a manual reload (or "Got it") doesn't force it back.
    if (welcome) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    void loadOnboardingState().then((state) => {
      setEverCaptured(state.everCaptured);
      setOnboardingVisible(welcome || !state.dismissed);
      setOnboardingReady(true);
    });
  }, []);

  async function refreshMcpDir() {
    const dir = await getMcpDir();
    if (!dir) {
      setMcpDirName(null);
      setMcpDirPermission(null);
      return;
    }
    setMcpDirName(dir.name);
    setMcpDirPermission(await dir.queryPermission({ mode: 'readwrite' }));
  }

  async function handleLinkMcpDir() {
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support the File System Access directory picker.');
      return;
    }
    let dir: FileSystemDirectoryHandle;
    try {
      // @ts-expect-error showDirectoryPicker is not in older lib.dom typings
      dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      alert(`Could not pick directory: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const perm = await dir.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      alert('Write permission was not granted.');
      return;
    }
    await saveMcpDir(dir);
    await refreshMcpDir();
  }

  async function handleRegrantMcpDir() {
    const dir = await getMcpDir();
    if (!dir) return;
    try {
      await dir.requestPermission({ mode: 'readwrite' });
      await refreshMcpDir();
    } catch (err) {
      alert(`Could not re-grant: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleUnlinkMcpDir() {
    if (!confirm('Unlink the MCP contexts directory? Captured files on disk are not deleted.')) {
      return;
    }
    await clearMcpDir();
    await refreshMcpDir();
  }

  async function refreshRoutes() {
    const list = await listRoutes();
    const enriched: RouteRow[] = await Promise.all(
      list.map(async (r) => {
        const perHandle = await Promise.all(
          r.handles.map(async (h) => ({
            name: h.name,
            permission: await h.queryPermission({ mode: 'readwrite' }),
          }))
        );
        const allGranted =
          perHandle.length > 0 && perHandle.every((p) => p.permission === 'granted');
        return {
          ...r,
          perHandle,
          // Aggregate badge: only "granted" when every handle is good. Any
          // lapsed handle drops the route's overall status — the per-handle
          // badges below tell the user exactly which file needs a re-grant.
          permission: allGranted ? 'granted' : 'prompt',
        };
      })
    );
    setRoutes(enriched);
  }

  async function refreshBuffer() {
    setBuffer(await readBuffer());
  }

  async function handleAddRoute() {
    if (!('showOpenFilePicker' in window)) {
      alert('Your browser does not support the File System Access API.');
      return;
    }
    let handle: FileSystemFileHandle;
    try {
      [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }],
        multiple: false,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      alert(`Could not pick file: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      alert('Write permission was not granted.');
      return;
    }

    const label = (prompt('Label for this route', handle.name) ?? '').trim() || handle.name;
    const isFirst = routes.length === 0;
    const patternInput = prompt(
      isFirst
        ? 'URL pattern (use * as wildcard). Leave empty to make this the default route for unmatched URLs.'
        : 'URL pattern (use * as wildcard), e.g. github.com/anthropic/*',
      ''
    );
    if (patternInput === null) return; // user cancelled
    const pattern = patternInput.trim();
    const isDefault = pattern === '';

    // Demote any existing default if this route claims that role.
    if (isDefault) {
      for (const r of routes.filter((x) => x.isDefault)) {
        await saveRoute({ ...r, isDefault: false });
      }
    }

    const route: ClaudeMdRoute = {
      id: crypto.randomUUID(),
      label,
      pattern,
      isDefault,
      createdAt: new Date().toISOString(),
      handles: [handle],
    };
    await saveRoute(route);
    await refreshRoutes();
  }

  /** v0.9.0+: append another target file to an existing route. */
  async function handleAddHandleToRoute(routeId: string) {
    if (!('showOpenFilePicker' in window)) {
      alert('Your browser does not support the File System Access API.');
      return;
    }
    const r = routes.find((x) => x.id === routeId);
    if (!r) return;

    let handle: FileSystemFileHandle;
    try {
      [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }],
        multiple: false,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      alert(`Could not pick file: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      alert('Write permission was not granted.');
      return;
    }
    // Reject the same file twice — comparing by name is loose but
    // FileSystemFileHandle has isSameEntry; not all Chromes implement it
    // synchronously, so fall back to name comparison if needed.
    for (const existing of r.handles) {
      try {
        if (await existing.isSameEntry?.(handle)) {
          alert(`"${handle.name}" is already linked to this route.`);
          return;
        }
      } catch {
        if (existing.name === handle.name) {
          alert(`"${handle.name}" is already linked to this route.`);
          return;
        }
      }
    }

    await saveRoute({ ...r, handles: [...r.handles, handle] });
    await refreshRoutes();
  }

  async function handleRemoveHandleFromRoute(routeId: string, idx: number) {
    const r = routes.find((x) => x.id === routeId);
    if (!r) return;
    const nextHandles = r.handles.filter((_, i) => i !== idx);
    if (nextHandles.length === 0) {
      if (!confirm('That is the last file on this route. Remove the whole route?')) return;
      await deleteRoute(r.id);
    } else {
      await saveRoute({ ...r, handles: nextHandles });
    }
    await refreshRoutes();
  }

  async function handleRemoveRoute(id: string) {
    if (!confirm('Remove this route? The file on disk is not deleted.')) return;
    await deleteRoute(id);
    await refreshRoutes();
  }

  async function handleRegrant(id: string) {
    const r = routes.find((x) => x.id === id);
    if (!r) return;
    try {
      // Re-request for every handle on the route; Chrome only prompts once per
      // origin per user gesture, but stale handles still need the call to
      // refresh their internal state.
      for (const h of r.handles) {
        await h.requestPermission({ mode: 'readwrite' });
      }
      await refreshRoutes();
    } catch (err) {
      alert(`Could not re-grant: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleEditPattern(id: string) {
    const r = routes.find((x) => x.id === id);
    if (!r) return;
    const next = prompt('New URL pattern (empty = default route)', r.pattern);
    if (next === null) return;
    const trimmed = next.trim();
    const becomingDefault = trimmed === '';

    if (becomingDefault && !r.isDefault) {
      // Clear the existing default before promoting this one.
      for (const other of routes.filter((x) => x.isDefault && x.id !== id)) {
        await saveRoute({ ...other, isDefault: false });
      }
    }

    await saveRoute({ ...r, pattern: trimmed, isDefault: becomingDefault });
    await refreshRoutes();
  }

  async function handleDismissOnboarding() {
    setOnboardingVisible(false);
    await saveOnboardingState({ dismissed: true });
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

  const onboardingSteps = deriveOnboardingSteps({
    // "granted handle" = the same per-handle permission the route list renders.
    routeHandleGrants: routes.map((r) =>
      r.perHandle.some((h) => h.permission === 'granted')
    ),
    mcpDirGranted: mcpDirPermission === 'granted',
    everCaptured,
    bufferCount: buffer.length,
  });

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 font-sans">
      <h1 className="mb-2 text-2xl font-semibold">Claude Code Context Capturer</h1>
      <p className="mb-8 text-sm text-slate-600">Settings &amp; capture buffer</p>

      {onboardingReady && onboardingVisible && (
        <OnboardingChecklist
          steps={onboardingSteps}
          onLinkContext={() => void handleAddRoute()}
          onDismiss={() => void handleDismissOnboarding()}
        />
      )}

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
            <option value="mcp-store">
              Save to MCP contexts directory (on-demand via Claude Code)
            </option>
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
        <Toggle
          label="Preview before write"
          description="Open a preview window so you can trim navigation menus or other cruft before the capture is committed to clipboard / buffer / CLAUDE.md / MCP store."
          checked={options.previewBeforeWrite}
          onChange={(v) => setOptions({ ...options, previewBeforeWrite: v })}
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

        <div className="mt-6 border-t border-slate-100 pt-5">
          <h3 className="mb-1 text-sm font-semibold text-slate-700">
            claude.ai conversations
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            Controls applied when capturing a claude.ai chat.
          </p>

          <Toggle
            label="Artifacts only"
            description="Capture just the code/documents Claude wrote (as clean code blocks), dropping the surrounding conversation."
            checked={options.claudeAiArtifactsOnly}
            onChange={(v) => setOptions({ ...options, claudeAiArtifactsOnly: v })}
          />

          <Field label="Keep only the last N messages (0 = whole conversation)">
            <input
              type="number"
              min={0}
              value={options.claudeAiMaxMessages}
              onChange={(e) =>
                setOptions({
                  ...options,
                  claudeAiMaxMessages: Math.max(0, Number(e.target.value)),
                })
              }
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
        </div>

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
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Context file routes ({routes.length})
          </h2>
          <button
            type="button"
            onClick={() => void handleAddRoute()}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            + Add route
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Each capture is appended to the first route whose URL pattern matches.
          Mark a route as <em>default</em> (empty pattern) to catch unmatched URLs.
          Use <code className="rounded bg-slate-100 px-1">*</code> as a wildcard,
          e.g. <code className="rounded bg-slate-100 px-1">github.com/anthropic/*</code>.
          A single route can write to multiple files — pick the one your AI
          agent reads (<code className="rounded bg-slate-100 px-1">CLAUDE.md</code>
          for Claude Code,
          <code className="rounded bg-slate-100 px-1"> .cursorrules</code> or
          <code className="rounded bg-slate-100 px-1"> .cursor/rules/*.mdc</code>
          for Cursor,
          <code className="rounded bg-slate-100 px-1"> .windsurfrules</code> for
          Windsurf, etc.) and add others with &ldquo;+ Link another file&rdquo;.
        </p>

        {routes.length === 0 ? (
          <p className="text-sm text-slate-500">
            No routes linked yet. Captures with the &ldquo;Append to linked
            CLAUDE.md file&rdquo; mode will fail until you add at least one.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {routes.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{r.label}</span>
                      {r.isDefault && (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                          default
                        </span>
                      )}
                      <span
                        className={
                          'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ' +
                          (r.permission === 'granted'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700')
                        }
                      >
                        {r.permission === 'granted' ? 'write granted' : 'needs re-grant'}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      <div className="mb-1">
                        pattern:{' '}
                        <code className="rounded bg-slate-100 px-1">
                          {r.pattern || '(default)'}
                        </code>
                      </div>
                      <ul className="space-y-1">
                        {r.perHandle.map((h, idx) => (
                          <li key={`${h.name}-${idx}`} className="flex items-center gap-2">
                            <code className="truncate rounded bg-slate-100 px-1">{h.name}</code>
                            {h.permission !== 'granted' && (
                              <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold uppercase text-amber-700">
                                needs re-grant
                              </span>
                            )}
                            {r.handles.length > 1 && (
                              <button
                                type="button"
                                onClick={() => void handleRemoveHandleFromRoute(r.id, idx)}
                                className="text-[10px] text-slate-400 hover:text-rose-600"
                                title="Stop writing this route to this file"
                              >
                                unlink
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        onClick={() => void handleAddHandleToRoute(r.id)}
                        className="mt-1 text-[11px] text-slate-600 underline hover:text-slate-900"
                      >
                        + Link another file (e.g. .cursorrules, .windsurfrules)
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-2">
                    {r.permission !== 'granted' && (
                      <button
                        type="button"
                        onClick={() => void handleRegrant(r.id)}
                        className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50"
                      >
                        Re-grant
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleEditPattern(r.id)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                    >
                      Edit pattern
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemoveRoute(r.id)}
                      className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">MCP contexts directory</h2>
          {mcpDirName ? (
            <button
              type="button"
              onClick={() => void handleUnlinkMcpDir()}
              className="rounded border border-rose-300 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50"
            >
              Unlink
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleLinkMcpDir()}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
            >
              Link directory
            </button>
          )}
        </div>
        <p className="mb-4 text-xs text-slate-500">
          With the <strong>&ldquo;Save to MCP contexts directory&rdquo;</strong>{' '}
          output mode, each capture is written as a standalone{' '}
          <code className="rounded bg-slate-100 px-1">.md</code> file here. The
          companion MCP server then exposes these to Claude Code{' '}
          <strong>on demand</strong> — so your research and claude.ai
          conversations are available without bloating{' '}
          <code className="rounded bg-slate-100 px-1">CLAUDE.md</code>.
        </p>

        {mcpDirName ? (
          <div className="flex items-center gap-2">
            <code className="rounded bg-slate-100 px-2 py-1 text-xs">
              {mcpDirName}/
            </code>
            <span
              className={
                'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ' +
                (mcpDirPermission === 'granted'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700')
              }
            >
              {mcpDirPermission === 'granted' ? 'write granted' : 'needs re-grant'}
            </span>
            {mcpDirPermission !== 'granted' && (
              <button
                type="button"
                onClick={() => void handleRegrantMcpDir()}
                className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50"
              >
                Re-grant
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No directory linked yet. Captures in &ldquo;Save to MCP contexts
            directory&rdquo; mode will fail until you link one.
          </p>
        )}

        <details className="mt-4 text-xs text-slate-500">
          <summary className="cursor-pointer font-medium text-slate-600">
            How to connect this to Claude Code
          </summary>
          <ol className="ml-4 mt-2 list-decimal space-y-1">
            <li>
              Pick a directory inside your project (e.g.{' '}
              <code className="rounded bg-slate-100 px-1">.ccc-contexts</code>).
            </li>
            <li>
              Register the MCP server, pointing it at that directory:
              <pre className="mt-1 overflow-x-auto rounded bg-slate-900 px-3 py-2 text-[11px] text-slate-100">
{`claude mcp add ccc-contexts \\
  -- npx -y claude-code-context-capturer-mcp \\
  ./.ccc-contexts`}
              </pre>
            </li>
            <li>
              In Claude Code, ask it to{' '}
              <em>list_contexts</em> or <em>search_contexts</em>.
            </li>
          </ol>
        </details>
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

      <footer className="mt-10 border-t border-slate-100 pt-4 text-center text-xs text-slate-400">
        <p>
          Enjoying this?{' '}
          <a
            href="https://oceanscreative.lemonsqueezy.com/checkout/buy/145f2e53-a428-4b5e-b5a8-3cb4f7a740b0?utm_source=cccc-ext&utm_medium=options"
            target="_blank"
            rel="noreferrer"
            className="text-slate-500 underline hover:text-slate-700"
          >
            Claude Code Power Pack ($29)
          </a>{' '}
          — the parallel-agent workflow this extension feeds context into.
        </p>
        <p className="mt-1">
          <a
            href="https://github.com/OceansCreative/claude-code-context-capturer"
            target="_blank"
            rel="noreferrer"
            className="text-slate-500 underline hover:text-slate-700"
          >
            GitHub
          </a>{' '}
          · MIT License · 100% local processing
        </p>
      </footer>
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
