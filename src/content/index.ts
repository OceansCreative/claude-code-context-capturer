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
    if (message.type === 'CAPTURE_PAGE') {
      void (async () => {
        try {
          const ctx: CapturedContext = await dispatchPageParser(message.options);
          sendResponse({ type: 'CAPTURE_RESULT', payload: ctx });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          sendResponse({ type: 'CAPTURE_ERROR', error: errMsg });
        }
      })();
      return true; // keep the message channel open for the async response
    }
    if (message.type === 'CAPTURE_SELECTION') {
      try {
        const ctx = parseSelection();
        if (ctx) {
          sendResponse({ type: 'CAPTURE_RESULT', payload: ctx });
        } else {
          sendResponse({
            type: 'CAPTURE_ERROR',
            error: 'No text is selected on the page.',
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        sendResponse({ type: 'CAPTURE_ERROR', error: errMsg });
      }
      return true;
    }
    return false;
  }
);
