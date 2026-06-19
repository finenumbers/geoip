import { describe, it, expect } from 'vitest';
import { resolveCachedFilterCount } from './filter-count-cache.js';

const sampleCache = {
  city: {
    country_iso_code: { RU: 10_556_198, US: 1_234 },
  },
  country: {
    country_iso_code: { RU: 500_000, US: 100 },
  },
};

describe('resolveCachedFilterCount', () => {
  it('returns cached count for single country_iso_code eq filter', () => {
    expect(
      resolveCachedFilterCount('city', [{ field: 'country_iso_code', op: 'eq', value: 'RU' }], sampleCache),
    ).toBe(10_556_198);
  });

  it('matches lowercase country_iso_code via uppercase cache key', () => {
    expect(
      resolveCachedFilterCount('city', [{ field: 'country_iso_code', op: 'eq', value: 'ru' }], sampleCache),
    ).toBe(10_556_198);
  });

  it('sums cached counts for in filter', () => {
    expect(
      resolveCachedFilterCount(
        'city',
        [{ field: 'country_iso_code', op: 'in', value: ['RU', 'US'] }],
        sampleCache,
      ),
    ).toBe(10_556_198 + 1_234);
  });

  it('returns null for unsupported filters', () => {
    expect(
      resolveCachedFilterCount('city', [{ field: 'city_name', op: 'eq', value: 'Moscow' }], sampleCache),
    ).toBeNull();
    expect(
      resolveCachedFilterCount(
        'city',
        [
          { field: 'country_iso_code', op: 'eq', value: 'RU' },
          { field: 'city_name', op: 'eq', value: 'Moscow' },
        ],
        sampleCache,
      ),
    ).toBeNull();
  });
});
