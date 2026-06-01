import { describe, expect, it } from 'vitest';
import {
  parseContextFile,
  splitFrontmatter,
  parseTags,
} from '../src/store.js';
import { searchContexts } from '../src/search.js';
import type { ContextEntry } from '../src/store.js';

const SAMPLE = `---
url: https://github.com/owner/repo/issues/42
title: "Bug: something is broken"
captured_at: 2026-04-30T12:00:00.000Z
parser: github
author: alice
tags: ["bug", "priority:high"]
---

# Bug: something is broken

The thing crashes when I call \`foo()\`.
`;

describe('splitFrontmatter', () => {
  it('separates frontmatter from body', () => {
    const { frontmatter, body } = splitFrontmatter(SAMPLE);
    expect(frontmatter.url).toBe('https://github.com/owner/repo/issues/42');
    expect(frontmatter.title).toBe('Bug: something is broken');
    expect(frontmatter.parser).toBe('github');
    expect(body).toContain('# Bug: something is broken');
    expect(body).not.toContain('captured_at');
  });

  it('treats a file with no frontmatter as all body', () => {
    const { frontmatter, body } = splitFrontmatter('# Just a heading\n\ntext');
    expect(Object.keys(frontmatter)).toHaveLength(0);
    expect(body).toContain('Just a heading');
  });

  it('handles an unterminated frontmatter block gracefully', () => {
    const { frontmatter, body } = splitFrontmatter('---\nurl: x\nno closing');
    expect(Object.keys(frontmatter)).toHaveLength(0);
    expect(body).toContain('no closing');
  });
});

describe('parseTags', () => {
  it('parses a bracketed quoted list', () => {
    expect(parseTags('["bug", "priority:high"]')).toEqual(['bug', 'priority:high']);
  });
  it('parses an unbracketed list', () => {
    expect(parseTags('a, b, c')).toEqual(['a', 'b', 'c']);
  });
  it('returns empty for undefined/empty', () => {
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags('')).toEqual([]);
    expect(parseTags('[]')).toEqual([]);
  });
});

describe('parseContextFile', () => {
  it('produces a structured entry', () => {
    const entry = parseContextFile('issue-42', '/x/issue-42.md', SAMPLE, SAMPLE.length);
    expect(entry.slug).toBe('issue-42');
    expect(entry.title).toBe('Bug: something is broken');
    expect(entry.url).toBe('https://github.com/owner/repo/issues/42');
    expect(entry.parser).toBe('github');
    expect(entry.author).toBe('alice');
    expect(entry.tags).toEqual(['bug', 'priority:high']);
    expect(entry.body).toContain('crashes when I call');
  });

  it('falls back to first heading then slug for title', () => {
    const noTitle = '# Heading Title\n\nbody';
    const entry = parseContextFile('my-slug', '/x/my-slug.md', noTitle, noTitle.length);
    expect(entry.title).toBe('Heading Title');

    const bare = parseContextFile('bare-slug', '/x/bare-slug.md', 'plain text', 10);
    expect(bare.title).toBe('bare-slug');
  });
});

function entry(p: Partial<ContextEntry>): ContextEntry {
  return {
    slug: p.slug ?? 's',
    filePath: p.filePath ?? '/x/s.md',
    title: p.title ?? 'Title',
    url: p.url,
    parser: p.parser,
    capturedAt: p.capturedAt,
    author: p.author,
    tags: p.tags ?? [],
    body: p.body ?? '',
    raw: p.raw ?? '',
    bytes: p.bytes ?? 0,
  };
}

describe('searchContexts', () => {
  const entries = [
    entry({
      slug: 'react-hooks',
      title: 'React Hooks deep dive',
      url: 'https://react.dev/hooks',
      tags: ['react'],
      body: 'useEffect and useState explained with examples.',
    }),
    entry({
      slug: 'pg-indexes',
      title: 'Postgres indexing',
      body: 'B-tree indexes speed up queries. useState is not mentioned beyond this.',
    }),
    entry({
      slug: 'unrelated',
      title: 'Cooking pasta',
      body: 'Boil water, add salt.',
    }),
  ];

  it('ranks title matches above body matches', () => {
    const hits = searchContexts(entries, 'react');
    expect(hits[0].slug).toBe('react-hooks');
  });

  it('matches body text and returns snippets', () => {
    const hits = searchContexts(entries, 'useState');
    const slugs = hits.map((h) => h.slug);
    expect(slugs).toContain('react-hooks');
    expect(slugs).toContain('pg-indexes');
    expect(hits[0].snippets.length).toBeGreaterThan(0);
  });

  it('returns nothing for a non-matching query', () => {
    expect(searchContexts(entries, 'kubernetes')).toHaveLength(0);
  });

  it('respects the limit', () => {
    expect(searchContexts(entries, 'a', 1)).toHaveLength(1);
  });
});
