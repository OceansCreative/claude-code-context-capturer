import type { CapturedContext, UserOptions } from './types';

/**
 * Build a YAML frontmatter block from a captured context.
 *
 * The output looks like:
 * ---
 * url: https://example.com
 * title: Example Page
 * captured_at: 2026-04-30T12:00:00.000Z
 * parser: generic
 * ---
 */
export function buildFrontmatter(ctx: CapturedContext): string {
  const lines: string[] = ['---'];

  lines.push(`url: ${escapeYamlValue(ctx.url)}`);
  lines.push(`title: ${escapeYamlValue(ctx.title)}`);
  lines.push(`captured_at: ${ctx.capturedAt}`);
  lines.push(`parser: ${ctx.parser}`);

  if (ctx.author) {
    lines.push(`author: ${escapeYamlValue(ctx.author)}`);
  }
  if (ctx.publishedAt) {
    lines.push(`published_at: ${ctx.publishedAt}`);
  }
  if (ctx.tags && ctx.tags.length > 0) {
    const renderedTags = ctx.tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(', ');
    lines.push(`tags: [${renderedTags}]`);
  }
  if (ctx.fromSelection) {
    lines.push('source_type: selection');
  }

  lines.push('---', '');
  return lines.join('\n');
}

/** Build a footer that links back to the source URL. */
export function buildSourceFooter(ctx: CapturedContext, locale: UserOptions['locale']): string {
  if (locale === 'ja') {
    return `\n\n---\n\n*出典: [${escapeMd(ctx.title)}](${ctx.url})*\n`;
  }
  return `\n\n---\n\n*Source: [${escapeMd(ctx.title)}](${ctx.url})*\n`;
}

/**
 * Escape a value for inclusion in YAML.
 * - Wraps in double quotes if the value contains special characters.
 */
function escapeYamlValue(value: string): string {
  if (/[:#\n"'\\]|^\s|\s$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function escapeMd(value: string): string {
  return value.replace(/[[\]()]/g, (m) => `\\${m}`);
}
