import type { BufferEntry } from './buffer-storage';
import type { OutputMode } from './types';

/**
 * Pure presentation logic for the popup's recent-captures list.
 *
 * Kept free of React, chrome.* and i18n so it unit-tests cleanly in happy-dom.
 * The popup supplies `now` (and the active UI locale) at render time; these
 * functions never read the clock or the environment themselves, so their
 * output is fully deterministic.
 */

/** A capture shaped for a single popup row. */
export interface CaptureRow {
  id: string;
  url: string;
  /** The capture title, trimmed (may be empty — the view supplies a fallback). */
  title: string;
  /** Human-friendly origin derived from the URL host, e.g. "claude.ai". */
  source: string;
  /** Localized relative time, e.g. "5 minutes ago" / "5 分前". */
  relativeTime: string;
}

/**
 * The newest `limit` entries. The buffer is stored newest-first (appendToBuffer
 * prepends), so this is a clamped head slice. A non-positive or non-finite
 * limit yields an empty list.
 */
export function selectRecentCaptures(
  entries: BufferEntry[],
  limit: number
): BufferEntry[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return entries.slice(0, Math.floor(limit));
}

/**
 * A short, human-friendly source label derived from the capture URL's host
 * (leading `www.` stripped). Returns '' when the URL can't be parsed — the
 * view simply omits the source in that case. Derived at display time so it
 * also works for entries buffered before this feature shipped.
 */
export function captureSourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

interface Division {
  amount: number;
  unit: Intl.RelativeTimeFormatUnit;
}

// Largest-unit-that-fits ladder for Intl.RelativeTimeFormat.
const DIVISIONS: Division[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

/**
 * Localized relative time between an ISO timestamp and `now` (epoch ms).
 * Past timestamps read "5 minutes ago"; 0 reads "now". Returns '' for an
 * unparseable timestamp. `locale` is the active UI language (undefined = the
 * runtime default).
 */
export function formatRelativeTime(
  iso: string,
  now: number,
  locale?: string
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let duration = (then - now) / 1000; // seconds; negative for the past
  for (const { amount, unit } of DIVISIONS) {
    if (Math.abs(duration) < amount) {
      return rtf.format(Math.round(duration), unit);
    }
    duration /= amount;
  }
  // Unreachable: the last division's amount is Infinity.
  return rtf.format(Math.round(duration), 'year');
}

/** Shape one buffer entry into a popup row. */
export function formatCaptureRow(
  entry: BufferEntry,
  now: number,
  locale?: string
): CaptureRow {
  return {
    id: entry.id,
    url: entry.url,
    title: entry.title.trim(),
    source: captureSourceLabel(entry.url),
    relativeTime: formatRelativeTime(entry.capturedAt, now, locale),
  };
}

/**
 * Whether the given output mode routes captures into the in-extension buffer.
 * Mirrors the service worker's delivery branch; the popup uses it to decide
 * whether to nudge clipboard/claude-md/mcp-only users that buffer mode feeds
 * this list.
 */
export function outputModeIncludesBuffer(mode: OutputMode): boolean {
  return mode === 'append-buffer' || mode === 'both';
}
