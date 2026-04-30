import type { CapturedContext } from './types';

const BUFFER_KEY = 'ccc.buffer';

/** A single buffered capture, stored chronologically. */
export interface BufferEntry {
  id: string;
  capturedAt: string;
  url: string;
  title: string;
  markdown: string;
}

/** Read all buffered entries (newest first). */
export async function readBuffer(): Promise<BufferEntry[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([BUFFER_KEY], (result) => {
      const entries = (result[BUFFER_KEY] as BufferEntry[] | undefined) ?? [];
      resolve(entries);
    });
  });
}

/** Append a new capture to the buffer. Returns the new entry. */
export async function appendToBuffer(
  ctx: CapturedContext,
  markdown: string
): Promise<BufferEntry> {
  const entry: BufferEntry = {
    id: generateId(),
    capturedAt: ctx.capturedAt,
    url: ctx.url,
    title: ctx.title,
    markdown,
  };
  const existing = await readBuffer();
  const updated = [entry, ...existing];
  await writeBuffer(updated);
  return entry;
}

/** Remove a single entry by ID. */
export async function removeFromBuffer(id: string): Promise<void> {
  const existing = await readBuffer();
  const updated = existing.filter((e) => e.id !== id);
  await writeBuffer(updated);
}

/** Clear the entire buffer. */
export async function clearBuffer(): Promise<void> {
  await writeBuffer([]);
}

/** Export the buffer as a single Markdown document. */
export async function exportBufferAsMarkdown(): Promise<string> {
  const entries = await readBuffer();
  if (entries.length === 0) return '';

  // Reverse so the oldest comes first (chronological reading order).
  const ordered = [...entries].reverse();
  return ordered.map((e) => e.markdown).join('\n\n---\n\n');
}

async function writeBuffer(entries: BufferEntry[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [BUFFER_KEY]: entries }, () => resolve());
  });
}

function generateId(): string {
  // crypto.randomUUID is available in MV3 service workers.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
