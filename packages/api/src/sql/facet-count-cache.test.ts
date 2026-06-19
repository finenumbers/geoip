import { describe, it, expect } from 'vitest';
import {
  isFacetCountCacheIncomplete,
  mergeFacetCountCaches,
  resolveCachedFacetValues,
} from './facet-count-cache.js';

const sampleCache = {
  city: {
    RU: {
      city_name: { Москва: 1000, 'Санкт-Петербург': 500 },
      country_name: { 'Российская Федерация': 1500 },
    },
  },
  country: {},
};

describe('resolveCachedFacetValues', () => {
  it('returns cached facet values for single country context', () => {
    const items = resolveCachedFacetValues(
      'city',
      'city_name',
      [{ field: 'country_iso_code', op: 'eq', value: 'RU' }],
      '',
      10,
      sampleCache,
    );
    expect(items).toEqual([
      { value: 'Москва', count: 1000 },
      { value: 'Санкт-Петербург', count: 500 },
    ]);
  });

  it('applies search filter in memory', () => {
    const items = resolveCachedFacetValues(
      'city',
      'city_name',
      [{ field: 'country_iso_code', op: 'eq', value: 'RU' }],
      'моск',
      10,
      sampleCache,
    );
    expect(items).toEqual([{ value: 'Москва', count: 1000 }]);
  });

  it('returns null for unsupported context', () => {
    expect(
      resolveCachedFacetValues(
        'city',
        'city_name',
        [
          { field: 'country_iso_code', op: 'eq', value: 'RU' },
          { field: 'city_name', op: 'eq', value: 'Moscow' },
        ],
        '',
        10,
        sampleCache,
      ),
    ).toBeNull();
  });
});

describe('mergeFacetCountCaches', () => {
  it('merges asn_org into base cache', () => {
    const merged = mergeFacetCountCaches(
      { city: { RU: { city_name: { Moscow: 1 } } }, country: {} },
      { city: { RU: { asn_org: { Org: 2 } } }, country: {} },
    );
    expect(merged.city.RU?.city_name).toEqual({ Moscow: 1 });
    expect(merged.city.RU?.asn_org).toEqual({ Org: 2 });
  });
});

describe('isFacetCountCacheIncomplete', () => {
  it('detects missing asn_org when city_name present', () => {
    expect(
      isFacetCountCacheIncomplete({
        city: { RU: { city_name: { Moscow: 1 } } },
        country: {},
      }),
    ).toBe(true);
  });

  it('returns false for complete cache', () => {
    expect(
      isFacetCountCacheIncomplete({
        city: { RU: { city_name: { Moscow: 1 }, asn_org: { Org: 1 } } },
        country: {},
      }),
    ).toBe(false);
  });
});
