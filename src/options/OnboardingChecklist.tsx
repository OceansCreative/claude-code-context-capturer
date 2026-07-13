import type { OnboardingStepId, OnboardingStepState } from './onboarding';

const README_URL =
  'https://github.com/OceansCreative/claude-code-context-capturer#readme';

interface OnboardingChecklistProps {
  /** Derived step states (see deriveOnboardingSteps). */
  steps: OnboardingStepState[];
  /** Triggers the existing "add route / link file" flow (handleAddRoute). */
  onLinkContext: () => void;
  /** Marks onboarding dismissed and hides the checklist for good. */
  onDismiss: () => void;
}

/**
 * First-run onboarding checklist shown at the top of the options page. Styled to
 * match the page's existing cards/badges (Tailwind slate/emerald palette). The
 * three steps auto-check from real state; the "Got it" control dismisses it
 * permanently.
 */
export default function OnboardingChecklist({
  steps,
  onLinkContext,
  onDismiss,
}: OnboardingChecklistProps) {
  const done = (id: OnboardingStepId) => steps.find((s) => s.id === id)?.done ?? false;
  const completedCount = steps.filter((s) => s.done).length;

  return (
    <section className="mb-10 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Get started</h2>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-100"
        >
          {completedCount === steps.length ? 'Got it' : 'Dismiss'}
        </button>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Three quick steps to start piping web context into your AI agent
        ({completedCount}/{steps.length} done).
      </p>

      <ol className="space-y-3">
        <Step
          index={1}
          done={done('link')}
          title="Link a context file"
          description={
            <>
              Point the extension at the file your AI agent reads —{' '}
              <code className="rounded bg-slate-100 px-1">CLAUDE.md</code>,{' '}
              <code className="rounded bg-slate-100 px-1">.cursorrules</code>, or
              similar. Every capture gets appended there. (An MCP contexts
              directory counts too.)
            </>
          }
        >
          {!done('link') && (
            <button
              type="button"
              onClick={onLinkContext}
              className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
            >
              Link a file
            </button>
          )}
        </Step>

        <Step
          index={2}
          done={done('capture')}
          title="Try a capture"
          description={
            <>
              Open any page worth keeping — a GitHub issue, a docs page, a
              claude.ai chat — then press{' '}
              <kbd className="rounded border border-slate-300 bg-slate-50 px-1 text-[11px]">
                Ctrl/⌘+Shift+L
              </kbd>{' '}
              or click the toolbar icon. It lands in your linked file.
            </>
          }
        />

        <Step
          index={3}
          done={done('ready')}
          title="You're set"
          description={
            <>
              Capture anytime from the toolbar icon, the keyboard shortcuts (
              <kbd className="rounded border border-slate-300 bg-slate-50 px-1 text-[11px]">
                Ctrl/⌘+Shift+L
              </kbd>{' '}
              for the page,{' '}
              <kbd className="rounded border border-slate-300 bg-slate-50 px-1 text-[11px]">
                Ctrl/⌘+Shift+K
              </kbd>{' '}
              for a selection), or the right-click menu.{' '}
              <a
                href={README_URL}
                target="_blank"
                rel="noreferrer"
                className="text-slate-500 underline hover:text-slate-700"
              >
                Read the docs
              </a>
              .
            </>
          }
        />
      </ol>
    </section>
  );
}

function Step({
  index,
  done,
  title,
  description,
  children,
}: {
  index: number;
  done: boolean;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={
          'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ' +
          (done
            ? 'bg-emerald-100 text-emerald-700'
            : 'border border-slate-300 bg-white text-slate-500')
        }
        aria-hidden="true"
      >
        {done ? '✓' : index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={
              'text-sm font-medium ' +
              (done ? 'text-slate-400 line-through' : 'text-slate-800')
            }
          >
            {title}
          </span>
          {done && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
              done
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">{description}</div>
        {children}
      </div>
    </li>
  );
}
