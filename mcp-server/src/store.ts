/**
 * Capture store reader.
 *
 * The Claude Code Context Capturer browser extension writes each captured web
 * page or claude.ai conversation as a standalone Markdown file (with YAML
 * frontmatter) into a "contexts" directory the user picks. This module reads
 * that directory so the MCP server can expose the captures to Claude Code on
 * demand — without ever appending to (and bloating) CLAUDE.md.
 *
 * The format mirrors what the extension's frontmatter-builder produces:
 *
 *   ---
 *   url: https://github.com/owner/repo/issues/42
 *   title: "Bug: something is broken"
 *   captured_at: 2026-04-30T12:00:00.000Z
 *   parser: github
 *   author: alice
 *   tags: ["bug", "priority:high"]
 *   ---
 *
 *   # Bug: something is broken
 *   ...body...
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Parsed metadata + body for a single captured context file. */
export interface ContextEntry {
  /** Filename without extension — the stable id used by get/delete tools. */
  slug: string;
  /** Absolute path on disk. */
  filePath: string;
  /** Title from frontmatter, falling back to the slug. */
  title: string;
  /** Source URL, if present. */
  url?: string;
  /** Which extension parser produced it (github, claude-ai, generic, …). */
  parser?: string;
  /** Capture timestamp (ISO 8601), if present. */
  capturedAt?: string;
  /** Detected author/site, if present. */
  author?: string;
  /** Tags/labels, if present. */
  tags: string[];
  /** The Markdown body (everything after the frontmatter block). */
  body: string;
  /** The full file contents, frontmatter included. */
  raw: string;
  /** File size in bytes. */
  bytes: number;
}

/** A lightweight summary used by list/search (no body, to stay cheap). */
export interface ContextSummary {
  slug: string;
  title: string;
  url?: string;
  parser?: string;
  capturedAt?: string;
  author?: string;
  tags: string[];
  bytes: number;
}

export function toSummary(entry: ContextEntry): ContextSummary {
  return {
    slug: entry.slug,
    title: entry.title,
    url: entry.url,
    parser: entry.parser,
    capturedAt: entry.capturedAt,
    author: entry.author,
    tags: entry.tags,
    bytes: entry.bytes,
  };
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

/**
 * Resolve the contexts directory from (in priority order):
 *   1. an explicit argument
 *   2. the CCC_CONTEXTS_DIR environment variable
 *   3. the first non-flag CLI argument
 *   4. <cwd>/.ccc-contexts  (project-local default)
 *
 * Tilde (~) is expanded to the user's home directory.
 */
export function resolveContextsDir(explicit?: string): string {
  const fromCli = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const raw =
    explicit ||
    process.env.CCC_CONTEXTS_DIR ||
    fromCli ||
    path.join(process.cwd(), '.ccc-contexts');
  return expandHome(raw);
}

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(home, p.slice(1));
  }
  return path.resolve(p);
}

export class ContextStore {
  constructor(public readonly dir: string) {}

  /** True if the contexts directory exists and is a directory. */
  async exists(): Promise<boolean> {
    try {
      const stat = await fs.stat(this.dir);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /** Read and parse every Markdown file in the directory (non-recursive). */
  async readAll(): Promise<ContextEntry[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }

    const mdNames = names.filter((n) =>
      MARKDOWN_EXTENSIONS.has(path.extname(n).toLowerCase())
    );

    const entries = await Promise.all(
      mdNames.map((name) => this.readOne(name).catch(() => undefined))
    );

    return entries
      .filter((e): e is ContextEntry => e !== undefined)
      .sort(byCapturedAtDesc);
  }

  /** Read a single file by its name (with or without extension) or slug. */
  async readBySlug(slug: string): Promise<ContextEntry | undefined> {
    const candidates = [slug, `${slug}.md`, `${slug}.markdown`];
    for (const name of candidates) {
      try {
        const stat = await fs.stat(path.join(this.dir, name));
        if (stat.isFile()) return this.readOne(name);
      } catch {
        // try next candidate
      }
    }

    // Fuzzy fallback: case-insensitive slug match across the directory.
    const all = await this.readAll();
    const lower = slug.toLowerCase();
    return (
      all.find((e) => e.slug.toLowerCase() === lower) ??
      all.find((e) => e.slug.toLowerCase().includes(lower))
    );
  }

  /** Delete a capture by slug. Returns true if a file was removed. */
  async deleteBySlug(slug: string): Promise<boolean> {
    const entry = await this.readBySlug(slug);
    if (!entry) return false;
    await fs.rm(entry.filePath);
    return true;
  }

  private async readOne(name: string): Promise<ContextEntry> {
    const filePath = path.join(this.dir, name);
    const raw = await fs.readFile(filePath, 'utf8');
    const stat = await fs.stat(filePath);
    const slug = name.replace(/\.(md|markdown)$/i, '');
    return parseContextFile(slug, filePath, raw, stat.size);
  }
}

function byCapturedAtDesc(a: ContextEntry, b: ContextEntry): number {
  const ta = a.capturedAt ? Date.parse(a.capturedAt) : 0;
  const tb = b.capturedAt ? Date.parse(b.capturedAt) : 0;
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
}

/**
 * Parse a captured Markdown file into structured metadata + body.
 * Tolerant of files with no frontmatter (treats the whole file as body).
 */
export function parseContextFile(
  slug: string,
  filePath: string,
  raw: string,
  bytes: number
): ContextEntry {
  const { frontmatter, body } = splitFrontmatter(raw);

  const title =
    frontmatter.title ||
    firstHeading(body) ||
    slug;

  return {
    slug,
    filePath,
    title,
    url: frontmatter.url,
    parser: frontmatter.parser,
    capturedAt: frontmatter.captured_at,
    author: frontmatter.author,
    tags: parseTags(frontmatter.tags),
    body: body.trim(),
    raw,
    bytes,
  };
}

interface RawFrontmatter {
  [key: string]: string | undefined;
  title?: string;
  url?: string;
  parser?: string;
  captured_at?: string;
  author?: string;
  tags?: string;
}

/**
 * Split a `---`-delimited YAML frontmatter block from the body.
 * This is a deliberately small parser that understands the flat `key: value`
 * shape the extension emits — not a full YAML implementation.
 */
export function splitFrontmatter(raw: string): {
  frontmatter: RawFrontmatter;
  body: string;
} {
  const normalized = raw.replace(/^\uFEFF/, ''); // strip BOM
  if (!normalized.startsWith('---')) {
    return { frontmatter: {}, body: normalized };
  }

  // Find the closing delimiter on its own line.
  const lines = normalized.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { frontmatter: {}, body: normalized };
  }

  const fmLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join('\n');
  const frontmatter: RawFrontmatter = {};

  for (const line of fmLines) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    frontmatter[key] = unquote(m[2].trim());
  }

  return { frontmatter, body };
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return value;
}

/** Parse a `tags: ["a", "b"]` line into a string array. */
export function parseTags(rawTags?: string): string[] {
  if (!rawTags) return [];
  const trimmed = rawTags.trim();
  if (!trimmed) return [];

  // Bracketed list form: ["a", "b"] or [a, b]
  const inner = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;

  return inner
    .split(',')
    .map((t) => unquote(t.trim()))
    .filter((t) => t.length > 0);
}

function firstHeading(body: string): string | undefined {
  const m = body.match(/^#{1,6}\s+(.+)$/m);
  return m?.[1]?.trim();
}
