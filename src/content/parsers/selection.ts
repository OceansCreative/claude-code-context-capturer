import { htmlToMarkdown } from '@/shared/markdown-converter';
import type { CapturedContext } from '@/shared/types';

/**
 * Capture only the user's current text selection, preserving formatting
 * (links, code, lists) by working on the cloned DocumentFragment.
 */
export function parseSelection(): CapturedContext | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  if (selection.toString().trim().length === 0) return null;

  // Build a fragment from all ranges so we don't lose multi-range selections.
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < selection.rangeCount; i++) {
    fragment.appendChild(selection.getRangeAt(i).cloneContents());
  }

  const wrapper = document.createElement('div');
  wrapper.appendChild(fragment);
  const markdown = htmlToMarkdown(wrapper.innerHTML);

  return {
    url: window.location.href,
    title: document.title,
    body: markdown,
    capturedAt: new Date().toISOString(),
    parser: 'selection',
    fromSelection: true,
  };
}
