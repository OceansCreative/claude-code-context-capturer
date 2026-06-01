import type { CapturedContext } from './types';

/**
 * Build a stable, filesystem-safe slug for a captured context. Used as the
 * filename (`<slug>.md`) in the MCP contexts directory, and as the `slug`
 * identifier the MCP server's get/delete tools accept.
 *
 * Two shapes:
 *   - With a `dedupeKey` (e.g. a claude.ai conversation UUID): the slug leads
 *     with a STABLE hash of the dedupeKey — `ccc-<hash>-<title>`. The hash
 *     prefix is invariant across re-captures even if the conversation title
 *     changes, so the MCP store can find and overwrite the previous version by
 *     prefix ("no silos"). The title is appended only for readability.
 *   - Without one: `<date>-<title-or-host>-<hash(url+capturedAt)>`, unique per
 *     capture, so distinct pages/research never collide.
 */
export function buildContextSlug(ctx: CapturedContext): string {
  const base = slugify(ctx.title) || slugify(hostOf(ctx.url)) || 'capture';
  if (ctx.dedupeKey) {
    // Stable hash leads; title is cosmetic and may change between captures.
    return `${dedupePrefix(ctx.dedupeKey)}-${truncate(base, 50)}`;
  }
  const date = (ctx.capturedAt || new Date().toISOString()).slice(0, 10); // YYYY-MM-DD
  const hash = shortHash(`${ctx.url}\n${ctx.capturedAt}`);
  return `${date}-${truncate(base, 60)}-${hash}`;
}

/**
 * The stable filename prefix for a dedupeKey: `ccc-<hash>`. Re-capturing the
 * same subject yields the same prefix regardless of title, so the store can
 * remove the prior version's files by matching this prefix.
 */
export function dedupePrefix(dedupeKey: string): string {
  return `ccc-${shortHash(dedupeKey)}`;
}

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max).replace(/-+$/g, '');
}

/**
 * Small deterministic hash (djb2) rendered as base36.
 *
 * Returns the FULL 32-bit value in base36 (6–7 chars), padded to a minimum of
 * 6. We deliberately do NOT truncate: a `.slice(0, 6)` would discard a digit
 * for ~half the 32-bit range, both shrinking the space and skewing it — and
 * since this hash gates which files a re-capture deletes, a collision means
 * deleting an unrelated capture's files. Keeping the full value preserves the
 * entire 2^32 space.
 */
export function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  // >>> 0 coerces to unsigned 32-bit before base36.
  return (h >>> 0).toString(36).padStart(6, '0');
}
