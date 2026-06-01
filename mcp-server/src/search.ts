/**
 * Ranked substring search over captured contexts.
 *
 * Deliberately dependency-free: a small scoring function beats the competitor's
 * "first 3 matching lines" grep without pulling in a search engine. Matches in
 * the title/url/tags weigh more than body matches, and we return short snippets
 * with the query highlighted by context.
 */

import type { ContextEntry } from './store.js';

export interface SearchHit {
  slug: string;
  title: string;
  url?: string;
  parser?: string;
  capturedAt?: string;
  score: number;
  /** Up to a few short excerpts around the match. */
  snippets: string[];
}

export function searchContexts(
  entries: ContextEntry[],
  query: string,
  limit = 10
): SearchHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const hits: SearchHit[] = [];

  for (const entry of entries) {
    const haystackTitle = entry.title.toLowerCase();
    const haystackUrl = (entry.url ?? '').toLowerCase();
    const haystackTags = entry.tags.join(' ').toLowerCase();
    const haystackBody = entry.body.toLowerCase();

    let score = 0;
    let matchedTerms = 0;

    for (const term of terms) {
      let termMatched = false;
      if (haystackTitle.includes(term)) {
        score += 10;
        termMatched = true;
      }
      if (haystackTags.includes(term)) {
        score += 6;
        termMatched = true;
      }
      if (haystackUrl.includes(term)) {
        score += 4;
        termMatched = true;
      }
      const bodyCount = countOccurrences(haystackBody, term);
      if (bodyCount > 0) {
        score += Math.min(bodyCount, 5); // cap body weight
        termMatched = true;
      }
      if (termMatched) matchedTerms++;
    }

    if (matchedTerms === 0) continue;

    // Reward entries that match more of the distinct query terms.
    score += matchedTerms * 2;

    hits.push({
      slug: entry.slug,
      title: entry.title,
      url: entry.url,
      parser: entry.parser,
      capturedAt: entry.capturedAt,
      score,
      snippets: buildSnippets(entry.body, terms),
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function buildSnippets(body: string, terms: string[], max = 3): string[] {
  const lower = body.toLowerCase();
  const snippets: string[] = [];
  const seen = new Set<number>();

  for (const term of terms) {
    if (snippets.length >= max) break;
    const idx = lower.indexOf(term);
    if (idx === -1) continue;

    const start = Math.max(0, idx - 60);
    const end = Math.min(body.length, idx + term.length + 60);
    if (seen.has(start)) continue;
    seen.add(start);

    let snippet = body.slice(start, end).replace(/\s+/g, ' ').trim();
    if (start > 0) snippet = '…' + snippet;
    if (end < body.length) snippet = snippet + '…';
    snippets.push(snippet);
  }

  return snippets;
}
