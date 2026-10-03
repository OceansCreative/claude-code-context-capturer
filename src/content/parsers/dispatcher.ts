import { canHandleGitHub, parseGitHub } from './github';
import { canHandleGist, parseGist } from './gist';
import { canHandleStackOverflow, parseStackOverflow } from './stackoverflow';
import { canHandleZenn, parseZenn } from './zenn';
import { canHandleQiita, parseQiita } from './qiita';
import { canHandleMdn, parseMdn } from './mdn';
import { canHandleClaudeAi, parseClaudeAi } from './claude-ai';
import { canHandleChatGpt, parseChatGpt } from './chatgpt';
import { canHandleGemini, parseGemini } from './gemini';
import { canHandleYoutube, parseYoutube } from './youtube';
import { canHandleReddit, parseReddit } from './reddit';
import { canHandleHackerNews, parseHackerNews } from './hackernews';
import { canHandleX, parseX } from './x';
import { canHandleNotion, parseNotion } from './notion';
import { parseGenericPage } from './generic';
import type { CaptureOptions, CapturedContext } from '@/shared/types';

/**
 * Try each site-specific parser in priority order, falling back to generic.
 *
 * Async because claude.ai requires fetching its internal API; existing DOM-only
 * parsers are wrapped in Promise.resolve() so they remain trivial to extend.
 *
 * The order matters: more specific URL/host checks come first.
 */
export async function dispatchPageParser(
  options: CaptureOptions = {}
): Promise<CapturedContext> {
  if (canHandleClaudeAi()) return parseClaudeAi(options);
  // ChatGPT only claims chatgpt.com / chat.openai.com `/c/<id>` conversation
  // pages, so it's as specific as the claude-ai check above.
  if (canHandleChatGpt()) return parseChatGpt(options);
  // Gemini only claims gemini.google.com `/app/<id>` and `/share/<id>`
  // conversation pages, so it's as specific as the claude-ai/ChatGPT checks.
  if (canHandleGemini()) return parseGemini(options);
  if (canHandleYoutube()) return parseYoutube(options);
  // Reddit only claims /r/<sub>/comments/<id> paths, so it's as specific as
  // the claude-ai/youtube checks above — listing pages fall through to generic.
  if (canHandleReddit()) return parseReddit(options);
  if (canHandleHackerNews()) return parseHackerNews();
  // X/Twitter only claims /<user>/status/<id> paths — profile and timeline
  // pages fall through to generic.
  if (canHandleX()) return parseX();
  // Notion only claims URLs that carry a page id — the dashboard, login, and
  // workspace-root pages fall through to generic.
  if (canHandleNotion()) return parseNotion(options);
  // Gist lives on its own host (gist.github.com), separate from github.com —
  // a single-gist page with a `/<user>/<id>` path; the discover/home pages fall
  // through to generic.
  if (canHandleGist()) return parseGist();
  if (canHandleGitHub()) return parseGitHub();
  if (canHandleStackOverflow()) return parseStackOverflow();
  if (canHandleZenn()) return parseZenn();
  if (canHandleQiita()) return parseQiita();
  if (canHandleMdn()) return parseMdn();
  return parseGenericPage();
}
