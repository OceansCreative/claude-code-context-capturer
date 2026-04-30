import type { CapturedContext } from './types';

/**
 * Build the `## 2026-04-30 22:35 — <title>` heading line that prefixes each
 * appended entry in CLAUDE.md.
 */
export function buildEntryHeading(ctx: CapturedContext, now: Date = new Date()): string {
  const stamp = formatStamp(now);
  const title = ctx.title?.trim() || ctx.url;
  return `## ${stamp} — ${title}`;
}

/**
 * Render the full block to append to CLAUDE.md: a leading separator
 * (so consecutive entries don't run together), the heading, then the
 * pre-rendered Markdown body.
 */
export function buildAppendBlock(heading: string, body: string): string {
  // Leading newlines guarantee a blank line before the new section even
  // if the existing file doesn't end with one. Trailing newline keeps the
  // file POSIX-friendly.
  return `\n\n${heading}\n\n${body.trim()}\n`;
}

function formatStamp(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
