import { canHandleGitHub, parseGitHub } from './github';
import { canHandleStackOverflow, parseStackOverflow } from './stackoverflow';
import { canHandleZenn, parseZenn } from './zenn';
import { canHandleQiita, parseQiita } from './qiita';
import { canHandleMdn, parseMdn } from './mdn';
import { canHandleClaudeAi, parseClaudeAi } from './claude-ai';
import { canHandleYoutube, parseYoutube } from './youtube';
import { canHandleReddit, parseReddit } from './reddit';
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
  if (canHandleYoutube()) return parseYoutube(options);
  // Reddit only claims /r/<sub>/comments/<id> paths, so it's as specific as
  // the claude-ai/youtube checks above — listing pages fall through to generic.
  if (canHandleReddit()) return parseReddit(options);
  if (canHandleGitHub()) return parseGitHub();
  if (canHandleStackOverflow()) return parseStackOverflow();
  if (canHandleZenn()) return parseZenn();
  if (canHandleQiita()) return parseQiita();
  if (canHandleMdn()) return parseMdn();
  return parseGenericPage();
}
