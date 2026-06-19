import { describe, it, expect } from 'vitest';
import { buildRankSortOrder, usesRankSortField } from './sort-rank.js';

describe('sort-rank', () => {
  it('maps country_name DESC to rank ASC', () => {
    expect(buildRankSortOrder('country_name', 'desc', 'v')).toEqual([
      'v.country_name_rank ASC',
      'v.id ASC',
    ]);
  });

  it('maps city_name ASC to rank ASC', () => {
    expect(buildRankSortOrder('city_name', 'asc', 'v')).toEqual([
      'v.city_name_rank ASC',
      'v.id ASC',
    ]);
  });

  it('detects rank-eligible fields', () => {
    expect(usesRankSortField('country_name')).toBe(true);
    expect(usesRankSortField('network')).toBe(false);
  });
});
