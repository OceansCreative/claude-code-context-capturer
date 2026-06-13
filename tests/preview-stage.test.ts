import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  stageCapture,
  loadStagedCapture,
  removeStagedCapture,
} from '@/shared/preview-stage';
import type { CapturedContext, UserOptions } from '@/shared/types';

const sampleCtx: CapturedContext = {
  url: 'https://example.com/post',
  title: 'Sample',
  body: '# body',
  capturedAt: '2026-06-13T00:00:00.000Z',
  parser: 'generic',
  fromSelection: false,
};

const sampleOptions: UserOptions = {
  includeFrontmatter: true,
  includeSourceFooter: true,
  wrapInCodeBlock: false,
  maxBodyLength: 0,
  defaultMode: 'clipboard',
  locale: 'en',
  claudeAiArtifactsOnly: false,
  claudeAiMaxMessages: 0,
  previewBeforeWrite: true,
};

describe('preview-stage', () => {
  // In-memory mock of chrome.storage.session.
  let memory: Record<string, unknown> = {};
  const sessionApi = {
    get: vi.fn(async (key: string) => ({ [key]: memory[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      memory = { ...memory, ...items };
    }),
    remove: vi.fn(async (key: string) => {
      delete memory[key];
    }),
  };

  beforeEach(() => {
    memory = {};
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { session: sessionApi },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stageCapture writes a record under a unique id and roundtrips', async () => {
    const id1 = await stageCapture(sampleCtx, '# rendered', sampleOptions, 42);
    const id2 = await stageCapture(sampleCtx, '# rendered', sampleOptions, 42);

    expect(id1).not.toEqual(id2);

    const a = await loadStagedCapture(id1);
    const b = await loadStagedCapture(id2);
    expect(a?.id).toBe(id1);
    expect(b?.id).toBe(id2);
    expect(a?.finalMarkdown).toBe('# rendered');
    expect(a?.payload.url).toBe(sampleCtx.url);
    expect(a?.options.previewBeforeWrite).toBe(true);
    expect(a?.tabId).toBe(42);
  });

  it('loadStagedCapture returns undefined for an unknown id', async () => {
    const missing = await loadStagedCapture('nope');
    expect(missing).toBeUndefined();
  });

  it('removeStagedCapture deletes the record', async () => {
    const id = await stageCapture(sampleCtx, '# x', sampleOptions, 1);
    await removeStagedCapture(id);
    expect(await loadStagedCapture(id)).toBeUndefined();
  });

  it('stamps stagedAt as a valid ISO date', async () => {
    const id = await stageCapture(sampleCtx, '# x', sampleOptions, 1);
    const staged = await loadStagedCapture(id);
    expect(staged?.stagedAt).toBeDefined();
    expect(Number.isNaN(Date.parse(staged!.stagedAt))).toBe(false);
  });
});
