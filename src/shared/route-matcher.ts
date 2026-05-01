import type { ClaudeMdRoute } from './types';

/**
 * Test whether a URL matches a glob-style pattern.
 *
 * Supported syntax (intentionally minimal — users write these by hand):
 * - `*` matches any sequence of characters (including `/` and `.`)
 * - everything else is a literal substring match
 *
 * The pattern is matched against the FULL URL (anywhere in it), so
 * `github.com/anthropic` matches `https://github.com/anthropic/foo`.
 */
export function matchesPattern(url: string, pattern: string): boolean {
  if (!pattern) return false;
  // Escape regex metacharacters except `*`, then turn `*` into `.*`.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regexSrc = escaped.replace(/\*/g, '.*');
  return new RegExp(regexSrc).test(url);
}

/**
 * Pick the route that should receive a capture from `url`.
 *
 * Resolution order (first hit wins):
 *  1. Non-default routes whose pattern matches, in `routes` order.
 *  2. The single route flagged isDefault=true (catches non-matching URLs).
 *  3. undefined — caller must surface "no route configured" to the user.
 */
export function resolveRoute(
  url: string,
  routes: ClaudeMdRoute[]
): ClaudeMdRoute | undefined {
  for (const r of routes) {
    if (!r.isDefault && matchesPattern(url, r.pattern)) return r;
  }
  return routes.find((r) => r.isDefault);
}
