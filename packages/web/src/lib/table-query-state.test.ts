import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BROWSE_SEARCH,
  normalizeBrowseSearch,
  validateBrowseQuery,
} from './table-query-state.js';

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
