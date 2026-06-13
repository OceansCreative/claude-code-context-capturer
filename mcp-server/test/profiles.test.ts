import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, parseEnabledTools } from '../src/profiles.js';

describe('parseEnabledTools', () => {
  it('returns the full set when env var is unset', () => {
    const { tools, warnings } = parseEnabledTools(undefined);
    expect(tools).toEqual(ALL_TOOLS);
    expect(warnings).toEqual([]);
  });

  it('returns the full set for empty string and whitespace', () => {
    expect(parseEnabledTools('').tools).toEqual(ALL_TOOLS);
    expect(parseEnabledTools('   ').tools).toEqual(ALL_TOOLS);
  });

  it('resolves the minimal profile to just get_context', () => {
    const { tools } = parseEnabledTools('minimal');
    expect(tools).toEqual(['get_context']);
  });

  it('resolves the lean profile to get_context + list_contexts', () => {
    const { tools } = parseEnabledTools('lean');
    expect(tools).toEqual(['get_context', 'list_contexts']);
  });

  it('resolves the search profile to get_context + search_contexts', () => {
    const { tools } = parseEnabledTools('search');
    expect(tools).toEqual(['get_context', 'search_contexts']);
  });

  it('resolves the discover profile to fetch + both discovery tools', () => {
    const { tools } = parseEnabledTools('discover');
    expect(tools).toEqual(['get_context', 'list_contexts', 'search_contexts']);
  });

  it('resolves "full" and "default" to the same as undefined', () => {
    expect(parseEnabledTools('full').tools).toEqual(ALL_TOOLS);
    expect(parseEnabledTools('default').tools).toEqual(ALL_TOOLS);
  });

  it('is case-insensitive for profile names', () => {
    expect(parseEnabledTools('LEAN').tools).toEqual(['get_context', 'list_contexts']);
    expect(parseEnabledTools('Discover').tools).toEqual([
      'get_context',
      'list_contexts',
      'search_contexts',
    ]);
  });

  it('parses a comma-separated list', () => {
    const { tools } = parseEnabledTools('get_context,search_contexts');
    expect(tools).toEqual(['get_context', 'search_contexts']);
  });

  it('tolerates whitespace and dedupes in a list', () => {
    const { tools } = parseEnabledTools('  get_context , list_contexts , get_context ');
    expect(tools).toEqual(['get_context', 'list_contexts']);
  });

  it('warns about and ignores unknown tools in a list', () => {
    const { tools, warnings } = parseEnabledTools('get_context,banana,stats_contexts');
    expect(tools).toEqual(['get_context', 'stats_contexts']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('banana');
  });

  it('falls back to the full set if every entry in the list is invalid', () => {
    const { tools, warnings } = parseEnabledTools('apple,banana');
    expect(tools).toEqual(ALL_TOOLS);
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });
});
