import type { CapturedArtifact, CapturedContext } from './types';
import { buildContextSlug } from './slug';

/** One artifact rendered as a standalone store file (name + contents). */
export interface ArtifactFile {
  fileName: string;
  content: string;
}

/**
 * Split a capture's artifacts into one standalone store file each, so the MCP
 * server's `get_context` can return a single artifact's code directly.
 *
 * Each file carries YAML frontmatter (so list/search/stats/filtering keep
 * working) followed by exactly one fenced code block. The frontmatter records
 * `artifact_of` (the parent capture slug) and `artifact_title`/`parser:
 * claude-ai-artifact` so artifacts are filterable as their own source.
 */
export function buildArtifactFiles(ctx: CapturedContext): ArtifactFile[] {
  const artifacts = ctx.artifacts ?? [];
  if (artifacts.length === 0) return [];

  const parentSlug = buildContextSlug(ctx);
  const usedNames = new Set<string>();

  return artifacts.map((art, index) => {
    const fileName = uniqueArtifactFileName(parentSlug, art, index, usedNames);
    return { fileName, content: renderArtifactFile(ctx, art, parentSlug) };
  });
}

function uniqueArtifactFileName(
  parentSlug: string,
  art: CapturedArtifact,
  index: number,
  used: Set<string>
): string {
  const titlePart = slugifyTitle(art.title) || `artifact-${index + 1}`;
  // Keep artifact files grouped next to (but distinct from) the parent slug.
  const base = `${parentSlug}--${titlePart}`;
  // Guarantee uniqueness: if the base (or a numbered variant) is taken, keep
  // incrementing. A plain counter is collision-proof, unlike a hash suffix
  // that could itself collide and silently overwrite another artifact's file.
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${n}`;
    n++;
  }
  used.add(candidate);
  return `${candidate}.md`;
}

function renderArtifactFile(
  ctx: CapturedContext,
  art: CapturedArtifact,
  parentSlug: string
): string {
  const fence = art.language || '';
  const title = art.title || ctx.title;
  const lines: string[] = ['---'];
  lines.push(`title: ${yamlValue(title)}`);
  lines.push(`url: ${yamlValue(ctx.url)}`);
  lines.push(`captured_at: ${ctx.capturedAt}`);
  lines.push('parser: claude-ai-artifact');
  lines.push(`artifact_of: ${yamlValue(parentSlug)}`);
  if (art.language) lines.push(`language: ${yamlValue(art.language)}`);
  const tags = ['artifact'];
  if (art.language) tags.push(`lang:${art.language}`);
  lines.push(`tags: [${tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(', ')}]`);
  lines.push('---', '');
  lines.push('```' + fence);
  lines.push(art.content.replace(/\n+$/, ''));
  lines.push('```', '');
  return lines.join('\n');
}

function slugifyTitle(title?: string): string {
  if (!title) return '';
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function yamlValue(value: string): string {
  if (/[:#\n"'\\]|^\s|\s$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Given all filenames in the store directory, return those belonging to a
 * deduped capture identified by its stable `cleanupPrefix` (`ccc-<hash>`): the
 * main `<prefix>-<title>.md` and any derived `<prefix>-<title>--*.md` files.
 *
 * Matching by the stable prefix (not the full slug) means a re-capture whose
 * title changed still finds and replaces the prior version. Pure (no FS
 * access) so it's directly testable.
 */
export function slugFileNamesToRemove(
  names: string[],
  cleanupPrefix: string
): string[] {
  if (!cleanupPrefix) return [];
  // Match `<prefix>` followed by a slug boundary (`-` or `.`) so `ccc-ab12`
  // doesn't accidentally match `ccc-ab123...`.
  const re = new RegExp(`^${escapeRegExp(cleanupPrefix)}[-.]`);
  return names.filter((name) => re.test(name) && /\.(md|markdown)$/i.test(name));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
