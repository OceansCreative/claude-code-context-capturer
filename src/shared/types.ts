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
  /**
   * Code/document artifacts detected in this capture (currently claude.ai
   * only). In `mcp-store` output mode these are written as one file each, so
   * `get_context` can return a single artifact's code directly. Other output
   * modes ignore this (the artifacts are already rendered inside `body`).
   */
  artifacts?: CapturedArtifact[];
  /**
   * When this context IS a single extracted artifact (one file per artifact),
   * the slug of the parent capture it came from. Surfaced in frontmatter as
   * `artifact_of` so the conversation it belongs to is discoverable.
   */
  artifactOf?: string;
}

/** A single code or document artifact extracted from a capture. */
export interface CapturedArtifact {
  /** Stable artifact id from the source, when available. */
  id?: string;
  /** Human title, e.g. "Auth middleware". */
  title?: string;
  /** Fence language hint, e.g. "ts", "python", "markdown". */
  language?: string;
  /** The artifact body (raw code/document text). */
  content: string;
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
  /**
   * claude.ai capture: extract only artifacts (code/documents Claude wrote),
   * dropping the surrounding conversation. Ideal for pulling "the code from
   * that chat" into a project without the brainstorming noise.
   */
  claudeAiArtifactsOnly: boolean;
  /**
   * claude.ai capture: keep only the last N messages of the conversation
   * (0 = the whole thing). Trims long planning threads down to the part that
   * matters before it lands in your context.
   */
  claudeAiMaxMessages: number;
}

/**
 * Capture-time options forwarded from the service worker to the content-script
 * parsers. A small, parser-relevant subset of UserOptions — the parser runs in
 * the page and shouldn't reach into chrome.storage itself.
 */
export interface CaptureOptions {
  claudeAiArtifactsOnly?: boolean;
  claudeAiMaxMessages?: number;
}

/** Where the captured Markdown should go. */
export type OutputMode =
  /** Copy to system clipboard. */
  | 'clipboard'
  /** Append to a hidden CLAUDE.md-style buffer in chrome.storage. */
  | 'append-buffer'
  /** Append to the user-linked CLAUDE.md file on disk. */
  | 'claude-md'
  /**
   * Write each capture as a standalone Markdown file into the linked MCP
   * contexts directory, where the companion MCP server exposes it to Claude
   * Code on demand (without bloating CLAUDE.md).
   */
  | 'mcp-store'
  /** Clipboard + buffer. */
  | 'both';

export const DEFAULT_OPTIONS: UserOptions = {
  includeFrontmatter: true,
  includeSourceFooter: true,
  wrapInCodeBlock: false,
  maxBodyLength: 0,
  defaultMode: 'clipboard',
  locale: 'en',
  claudeAiArtifactsOnly: false,
  claudeAiMaxMessages: 0,
};

/** Messages exchanged between background and content scripts. */
export type RuntimeMessage =
  | { type: 'CAPTURE_PAGE'; options?: CaptureOptions }
  | { type: 'CAPTURE_SELECTION'; options?: CaptureOptions }
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
 *
 * The offscreen document hosts both File System Access writes (CLAUDE.md
 * append) AND clipboard writes. Clipboard via offscreen is required because
 * MV3 service workers can't use navigator.clipboard, and chrome.scripting
 * injection into the active tab silently fails when the popup steals focus.
 */
export type OffscreenMessage =
  | {
      target: 'offscreen';
      type: 'APPEND_TO_CLAUDE_MD';
      /** Which route's handle to write into. */
      routeId: string;
      /** Pre-rendered Markdown body (frontmatter + body + footer). */
      content: string;
      /** Heading prefix line, e.g. `## 2026-04-30 22:35 — <title>`. */
      heading: string;
    }
  | {
      target: 'offscreen';
      type: 'WRITE_TO_MCP_STORE';
      /** Filename (without directory), e.g. `2026-05-31-auth-plan-1a2b3c.md`. */
      fileName: string;
      /** Full file contents (frontmatter + body + footer). */
      content: string;
    }
  | {
      target: 'offscreen';
      type: 'WRITE_TO_CLIPBOARD';
      /** Text to place on the system clipboard. */
      content: string;
    }
  | {
      target: 'offscreen';
      /**
       * Readiness probe. The offscreen document responds with `{ ok: true }`
       * once its onMessage listener is registered. Lets the SW avoid the
       * race where chrome.offscreen.createDocument resolves before the
       * offscreen module's listener is wired up.
       */
      type: 'PING';
    };

/** Result returned from the offscreen document for file-append operations. */
export type OffscreenAppendResult =
  | { ok: true; fileName: string }
  | {
      ok: false;
      reason: 'no-handle' | 'permission-denied' | 'write-failed' | 'no-route';
      message: string;
    };

/** Result returned from the offscreen document for MCP-store writes. */
export type OffscreenMcpStoreResult =
  | { ok: true; fileName: string }
  | {
      ok: false;
      reason: 'no-handle' | 'permission-denied' | 'write-failed';
      message: string;
    };

/** Result returned from the offscreen document for clipboard writes. */
export type OffscreenClipboardResult =
  | { ok: true }
  | { ok: false; reason: 'clipboard-failed'; message: string };

/**
 * Generic offscreen response — the union of all offscreen-handled message
 * results. Callers narrow by which message they sent.
 */
export type OffscreenResult =
  | OffscreenAppendResult
  | OffscreenMcpStoreResult
  | OffscreenClipboardResult;
