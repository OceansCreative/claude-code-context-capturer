import { dispatchPageParser } from './parsers/dispatcher';
import { parseSelection } from './parsers/selection';
import type { RuntimeMessage, CapturedContext } from '@/shared/types';

/**
 * Content script entry. Listens for messages from the background service worker
 * and runs the appropriate parser, returning the captured context.
 */
chrome.runtime.onMessage.addListener(
  (
    message: RuntimeMessage,
    _sender,
    sendResponse: (response: RuntimeMessage) => void
  ) => {
    try {
      if (message.type === 'CAPTURE_PAGE') {
        const ctx: CapturedContext = dispatchPageParser();
        sendResponse({ type: 'CAPTURE_RESULT', payload: ctx });
        return true;
      }
      if (message.type === 'CAPTURE_SELECTION') {
        const ctx = parseSelection();
        if (ctx) {
          sendResponse({ type: 'CAPTURE_RESULT', payload: ctx });
        } else {
          sendResponse({
            type: 'CAPTURE_ERROR',
            error: 'No text is selected on the page.',
          });
        }
        return true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendResponse({ type: 'CAPTURE_ERROR', error: message });
      return true;
    }
    return false;
  }
);
