import { canHandleGitHub, parseGitHub } from './github';
import { canHandleStackOverflow, parseStackOverflow } from './stackoverflow';
import { canHandleZenn, parseZenn } from './zenn';
import { canHandleQiita, parseQiita } from './qiita';
import { canHandleMdn, parseMdn } from './mdn';
import { parseGenericPage } from './generic';
import type { CapturedContext } from '@/shared/types';

/**
 * Try each site-specific parser in priority order, falling back to generic.
 *
 * The order matters: more specific URL/host checks come first.
 */
export function dispatchPageParser(): CapturedContext {
  if (canHandleGitHub()) return parseGitHub();
  if (canHandleStackOverflow()) return parseStackOverflow();
  if (canHandleZenn()) return parseZenn();
  if (canHandleQiita()) return parseQiita();
  if (canHandleMdn()) return parseMdn();
  return parseGenericPage();
}
