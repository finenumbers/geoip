import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BROWSE_SEARCH,
  coerceBrowseSearchJsonParam,
  normalizeBrowseSearch,
  validateBrowseQuery,
} from './table-query-state.js';

describe('coerceBrowseSearchJsonParam', () => {
  it('stringifies parsed filter arrays from the router', () => {
    const parsed = [{ field: 'country_iso_code', op: 'eq', value: 'RU' }];
    expect(coerceBrowseSearchJsonParam(parsed, DEFAULT_BROWSE_SEARCH.filters)).toBe(
      JSON.stringify(parsed),
    );
  });

  it('keeps JSON strings unchanged', () => {
    const filters = JSON.stringify([{ field: 'country_iso_code', op: 'eq', value: 'RU' }]);
    expect(coerceBrowseSearchJsonParam(filters, DEFAULT_BROWSE_SEARCH.filters)).toBe(filters);
  });
});

describe('validateBrowseQuery', () => {
  it('accepts valid filters and normalizes ISO country code', () => {
    const filters = JSON.stringify([{ field: 'country_iso_code', op: 'eq', value: ' ru ' }]);
    const result = validateBrowseQuery('city', DEFAULT_BROWSE_SEARCH.sort, filters);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.filtersJson)).toEqual([
        { field: 'country_iso_code', op: 'eq', value: 'RU' },
      ]);
    }
  });

  it('rejects invalid prefix_len filter', () => {
    const filters = JSON.stringify([{ field: 'prefix_len', op: 'eq', value: 999 }]);
    const result = validateBrowseQuery('city', DEFAULT_BROWSE_SEARCH.sort, filters);
    expect(result.ok).toBe(false);
  });

  it('strips city_name filter on country table during normalization', () => {
    const filters = JSON.stringify([{ field: 'city_name', op: 'contains', value: 'Mos' }]);
    const normalized = normalizeBrowseSearch('country', DEFAULT_BROWSE_SEARCH.sort, filters);
    expect(normalized.changed).toBe(true);
    expect(JSON.parse(normalized.filtersJson)).toEqual([]);
  });
});
