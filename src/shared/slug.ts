import type { CapturedContext } from './types';

/**
 * Build a stable, filesystem-safe slug for a captured context. Used as the
 * filename (`<slug>.md`) in the MCP contexts directory, and as the `slug`
 * identifier the MCP server's get/delete tools accept.
 *
 * Shape: `<date>-<title-or-host>-<short-hash>` so files sort chronologically,
 * stay human-readable, and never collide (the hash disambiguates same-title
 * captures).
 */
export function buildContextSlug(ctx: CapturedContext): string {
  const date = (ctx.capturedAt || new Date().toISOString()).slice(0, 10); // YYYY-MM-DD
  const base = slugify(ctx.title) || slugify(hostOf(ctx.url)) || 'capture';
  const hash = shortHash(`${ctx.url}\n${ctx.capturedAt}`);
  return `${date}-${truncate(base, 60)}-${hash}`;
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

/** Small deterministic hash (djb2) rendered as base36, 6 chars. */
export function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  // >>> 0 coerces to unsigned 32-bit before base36.
  return (h >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}
