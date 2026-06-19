import { describe, expect, it } from 'vitest';
import {
  defaultFacetField,
  parseJsonArrayParam,
  parseTableQueryInput,
} from './table-query-parse.js';

describe('parseJsonArrayParam', () => {
  it('returns empty array for missing param', () => {
    expect(parseJsonArrayParam(undefined, 'sort')).toEqual({ ok: true, value: [] });
  });

  it('parses valid JSON array string', () => {
    expect(parseJsonArrayParam('[{"field":"network","dir":"asc"}]', 'sort')).toEqual({
      ok: true,
      value: [{ field: 'network', dir: 'asc' }],
    });
  });

  it('rejects malformed JSON with 422-style error', () => {
    expect(parseJsonArrayParam('{bad json', 'filters')).toEqual({
      ok: false,
      error: 'Invalid filters JSON',
      path: 'filters',
    });
  });

  it('rejects non-array JSON', () => {
    expect(parseJsonArrayParam('{"field":"network"}', 'sort')).toEqual({
      ok: false,
      error: 'Invalid sort JSON: expected array',
      path: 'sort',
    });
  });
});

describe('parseTableQueryInput', () => {
  it('parses sort and filters together', () => {
    const parsed = parseTableQueryInput({
      page: '1',
      pageSize: '50',
      sort: '[]',
      filters: '[]',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.sort).toEqual([]);
    expect(parsed.filters).toEqual([]);
  });

  it('fails when sort JSON is invalid', () => {
    const parsed = parseTableQueryInput({ sort: 'not-json' });
    expect(parsed.ok).toBe(false);
  });
});

describe('defaultFacetField', () => {
  it('uses city_name for city and country_name for country', () => {
    expect(defaultFacetField('city')).toBe('city_name');
    expect(defaultFacetField('country')).toBe('country_name');
  });
});
