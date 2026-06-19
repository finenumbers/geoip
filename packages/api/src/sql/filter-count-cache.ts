import type { FilterClause } from '@geoip/shared';
import { normalizeCountryIsoCode } from '@geoip/shared';
import { query } from '../db/client.js';
import { logger } from '../config/logger.js';

export type FilterCountCache = {
  city: Record<string, Record<string, number>>;
  country: Record<string, Record<string, number>>;
};

const CACHEABLE_FIELDS = ['country_iso_code'] as const;
type CacheableField = (typeof CACHEABLE_FIELDS)[number];

const EMPTY_CACHE: FilterCountCache = { city: {}, country: {} };

async function buildFieldCounts(
  view: 'mv_city_blocks_analytics' | 'mv_country_blocks_analytics',
  field: CacheableField,
): Promise<Record<string, number>> {
  const result = await query<{ value: string; count: number }>(
    `SELECT ${field} AS value, COUNT(*)::int AS count
     FROM ${view}
     WHERE ${field} IS NOT NULL
     GROUP BY ${field}`,
  );

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.value] = row.count;
  }
  return counts;
}

export async function buildFilterCountCache(): Promise<FilterCountCache> {
  const cache: FilterCountCache = { city: {}, country: {} };

  for (const field of CACHEABLE_FIELDS) {
    cache.city[field] = await buildFieldCounts('mv_city_blocks_analytics', field);
    cache.country[field] = await buildFieldCounts('mv_country_blocks_analytics', field);
  }

  logger.info(
    {
      cityCountries: Object.keys(cache.city.country_iso_code ?? {}).length,
      countryCountries: Object.keys(cache.country.country_iso_code ?? {}).length,
    },
    'Filter count cache built',
  );

  return cache;
}

export function isFilterCountCacheEmpty(cache: FilterCountCache | null | undefined): boolean {
  if (!cache) return true;
  return (
    Object.keys(cache.city.country_iso_code ?? {}).length === 0 &&
    Object.keys(cache.country.country_iso_code ?? {}).length === 0
  );
}

function readCachedValue(
  cache: FilterCountCache,
  tableType: 'city' | 'country',
  field: CacheableField,
  value: string,
): number | null {
  const count = cache[tableType][field]?.[value];
  return count != null ? count : null;
}

/**
 * Resolve total row count from precomputed cache when filters map to a single cacheable equality/in clause.
 */
export function resolveCachedFilterCount(
  tableType: 'city' | 'country',
  filters: FilterClause[],
  cache: FilterCountCache | null | undefined,
): number | null {
  if (!cache || isFilterCountCacheEmpty(cache)) return null;
  if (filters.length !== 1) return null;

  const filter = filters[0];
  if (!filter || !CACHEABLE_FIELDS.includes(filter.field as CacheableField)) return null;

  const field = filter.field as CacheableField;

  if (filter.op === 'eq' && filter.value != null && filter.value !== '') {
    return readCachedValue(cache, tableType, field, normalizeCountryIsoCode(filter.value));
  }

  if (filter.op === 'in' && Array.isArray(filter.value) && filter.value.length > 0) {
    let total = 0;
    let matched = 0;
    for (const raw of filter.value) {
      const value = normalizeCountryIsoCode(raw);
      const count = readCachedValue(cache, tableType, field, value);
      if (count == null) return null;
      total += count;
      matched++;
    }
    return matched === filter.value.length ? total : null;
  }

  return null;
}

export function parseFilterCountCache(raw: unknown): FilterCountCache {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CACHE };

  const input = raw as FilterCountCache;
  return {
    city: input.city ?? {},
    country: input.country ?? {},
  };
}
