/**
 * Shared types used across background, content, popup, and options.
 */

/** A single captured context that gets converted to Markdown. */
export interface CapturedContext {
  /** The page URL at the time of capture. */
  url: string;
  /** The page title (document.title or og:title). */
  title: string;
  /** The captured Markdown body. */
  body: string;
  /** Optional author/site info, when detected by a parser. */
  author?: string;
  /** Optional published date in ISO 8601 format. */
  publishedAt?: string;
  /** Optional tags or labels detected on the page. */
  tags?: string[];
  /** When this capture happened (ISO 8601). */
  capturedAt: string;
  /** Which parser produced this context (e.g. 'github', 'generic'). */
  parser: ParserName;
  /** True if this came from a user text selection (not the whole page). */
  fromSelection: boolean;
}

/** Names of all built-in parsers. */
export type ParserName =
  | 'github'
  | 'stackoverflow'
  | 'zenn'
  | 'qiita'
  | 'mdn'
  | 'claude-ai'
  | 'generic'
  | 'selection';

/** User-configurable options stored in chrome.storage.sync. */
export interface UserOptions {
  /** Include YAML frontmatter at the top of the output. */
  includeFrontmatter: boolean;
  /** Include the source URL as a footer note. */
  includeSourceFooter: boolean;
  /** Wrap output in fenced code block for direct paste into chat. */
  wrapInCodeBlock: boolean;
  /** Maximum body length in characters (0 = no limit). */
  maxBodyLength: number;
  /** Output mode for the popup default action. */
  defaultMode: OutputMode;
  /** Locale for date formatting and built-in messages. */
  locale: 'en' | 'ja';
}

/** Where the captured Markdown should go. */
export type OutputMode =
  /** Copy to system clipboard. */
  | 'clipboard'
  /** Append to a hidden CLAUDE.md-style buffer in chrome.storage. */
  | 'append-buffer'
  /** Append to the user-linked CLAUDE.md file on disk. */
  | 'claude-md'
  /** Clipboard + buffer. */
  | 'both';

export const DEFAULT_OPTIONS: UserOptions = {
  includeFrontmatter: true,
  includeSourceFooter: true,
  wrapInCodeBlock: false,
  maxBodyLength: 0,
  defaultMode: 'clipboard',
  locale: 'en',
};

/** Messages exchanged between background and content scripts. */
export type RuntimeMessage =
  | { type: 'CAPTURE_PAGE' }
  | { type: 'CAPTURE_SELECTION' }
  | { type: 'CAPTURE_RESULT'; payload: CapturedContext }
  | { type: 'CAPTURE_ERROR'; error: string };

/**
 * One CLAUDE.md routing rule. Captures whose URL matches `pattern` are
 * appended to the file held by `handle`. Exactly one route may be marked
 * default — it catches captures that no other pattern matches.
 */
export interface ClaudeMdRoute {
  /** Stable identifier (crypto.randomUUID). */
  id: string;
  /** User-visible label, e.g. "anthropic project". */
  label: string;
  /**
   * Glob pattern matched against the full URL (substring + `*` wildcard).
   * Empty when isDefault=true.
   */
  pattern: string;
  /** True if this route receives captures that no pattern matches. */
  isDefault: boolean;
  /** ISO 8601 — used only to display "linked at …" in the UI. */
  createdAt: string;
  /** The actual on-disk file. */
  handle: FileSystemFileHandle;
}

/**
 * Messages targeted at the offscreen document. The `target` field lets
 * other contexts (popup, options) ignore them — runtime.sendMessage is broadcast.
 */
export type OffscreenMessage = {
  target: 'offscreen';
  type: 'APPEND_TO_CLAUDE_MD';
  /** Which route's handle to write into. */
  routeId: string;
  /** Pre-rendered Markdown body (frontmatter + body + footer). */
  content: string;
  /** Heading prefix line, e.g. `## 2026-04-30 22:35 — <title>`. */
  heading: string;
};

/** Result returned from the offscreen document. */
export type OffscreenResult =
  | { ok: true; fileName: string }
  | {
      ok: false;
      reason: 'no-handle' | 'permission-denied' | 'write-failed' | 'no-route';
      message: string;
    };
