import { describe, expect, it } from 'vitest';
import {
  buildFilterMetadataCacheKey,
  buildStringFieldMetadata,
  distinctIsoCodes,
  getCachedFilterMetadata,
  invalidateFilterMetadataCache,
  setCachedFilterMetadata,
  topFacetValues,
} from './filter-metadata-cache.js';

describe('filter-metadata-cache', () => {
  it('builds stable cache keys from dataset identity', () => {
    expect(buildFilterMetadataCacheKey('city', '2026-06-19', 'abc', '2026-06-19T00:00:00.000Z')).toBe(
      'city:2026-06-19:abc:2026-06-19T00:00:00.000Z',
    );
  });

  it('merges facet counts across countries by total count', () => {
    const values = topFacetValues(
      {
        city: {
          RU: { country_name: { Russia: 100, Belarus: 1 } },
          BY: { country_name: { Belarus: 50 } },
        },
        country: {},
      },
      'city',
      'country_name',
      10,
    );
    expect(values[0]).toBe('Russia');
    expect(values).toContain('Belarus');
  });

  it('reads ISO codes from filter count cache', () => {
    const values = distinctIsoCodes(
      {
        city: { country_iso_code: { RU: 1, US: 2, DE: 3 } },
        country: { country_iso_code: {} },
      },
      'city',
      100,
    );
    expect(values).toEqual(['DE', 'RU', 'US']);
  });

  it('builds country_name metadata from facet cache', () => {
    const meta = buildStringFieldMetadata(
      'country_name',
      'city',
      {
        city: { RU: { country_name: { Russia: 10 } } },
        country: {},
      },
      { city: { country_iso_code: {} }, country: { country_iso_code: {} } },
    );
    expect(meta).toEqual({ type: 'string', distinctValues: ['Russia'] });
  });

  it('stores and retrieves in-memory metadata cache', () => {
    invalidateFilterMetadataCache();
    const key = 'city:2026-06-19::';
    const payload = { fields: { country_name: { type: 'string' as const, distinctValues: ['RU'] } } };
    setCachedFilterMetadata(key, payload);
    expect(getCachedFilterMetadata(key)).toEqual(payload);
    expect(getCachedFilterMetadata('other')).toBeNull();
  });
});
