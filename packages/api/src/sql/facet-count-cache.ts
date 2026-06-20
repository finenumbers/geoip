import type { FilterClause } from '@geoip/shared';
import { normalizeCountryIsoCode } from '@geoip/shared';
import { query } from '../db/client.js';
import { logger } from '../config/logger.js';
import { sortFacetItemsBySearch } from './facet-search-utils.js';

export type FacetField =
  | 'city_name'
  | 'country_name'
  | 'subdivision_1_name'
  | 'asn_org';

export type FacetCountCache = {
  city: Record<string, Partial<Record<FacetField, Record<string, number>>>>;
  country: Record<string, Partial<Record<FacetField, Record<string, number>>>>;
};

const CITY_FACET_FIELDS: FacetField[] = ['city_name', 'country_name', 'subdivision_1_name', 'asn_org'];
const COUNTRY_FACET_FIELDS: FacetField[] = ['country_name', 'subdivision_1_name', 'asn_org'];

const EMPTY_CACHE: FacetCountCache = { city: {}, country: {} };

async function buildCountryScopedFacets(
  view: 'mv_city_blocks_analytics' | 'mv_country_blocks_analytics',
  field: FacetField,
): Promise<Record<string, Record<string, number>>> {
  const result = await query<{ country: string; value: string; count: number }>(
    `SELECT country_iso_code AS country, ${field} AS value, COUNT(*)::int AS count
     FROM ${view}
     WHERE country_iso_code IS NOT NULL AND ${field} IS NOT NULL
     GROUP BY country_iso_code, ${field}`,
  );

  const byCountry: Record<string, Record<string, number>> = {};
  for (const row of result.rows) {
    const bucket = byCountry[row.country] ?? {};
    bucket[row.value] = row.count;
    byCountry[row.country] = bucket;
  }
  return byCountry;
}

function mergeFieldIntoCache(
  target: Record<string, Partial<Record<FacetField, Record<string, number>>>>,
  field: FacetField,
  byCountry: Record<string, Record<string, number>>,
): void {
  for (const [country, values] of Object.entries(byCountry)) {
    target[country] ??= {};
    target[country][field] = values;
  }
}

async function buildCountryScopedAsnOrgFacets(
  view: 'mv_city_blocks_analytics' | 'mv_country_blocks_analytics',
  mappingTable: 'geo_city_block_asn' | 'geo_country_block_asn',
  idColumn: 'city_block_id' | 'country_block_id',
): Promise<Record<string, Record<string, number>>> {
  const result = await query<{ country: string; value: string; count: number }>(
    `SELECT v.country_iso_code AS country, ba.asn_org AS value, COUNT(*)::int AS count
     FROM ${view} v
     JOIN ${mappingTable} ba ON ba.${idColumn} = v.id
     WHERE v.country_iso_code IS NOT NULL AND ba.asn_org IS NOT NULL
     GROUP BY v.country_iso_code, ba.asn_org`,
  );

  const byCountry: Record<string, Record<string, number>> = {};
  for (const row of result.rows) {
    const bucket = byCountry[row.country] ?? {};
    bucket[row.value] = row.count;
    byCountry[row.country] = bucket;
  }
  return byCountry;
}

export async function buildNonAsnFacetCountCache(): Promise<FacetCountCache> {
  const cache: FacetCountCache = { city: {}, country: {} };

  for (const field of CITY_FACET_FIELDS) {
    if (field === 'asn_org') continue;
    const byCountry = await buildCountryScopedFacets('mv_city_blocks_analytics', field);
    mergeFieldIntoCache(cache.city, field, byCountry);
  }

  for (const field of COUNTRY_FACET_FIELDS) {
    if (field === 'asn_org') continue;
    const byCountry = await buildCountryScopedFacets('mv_country_blocks_analytics', field);
    mergeFieldIntoCache(cache.country, field, byCountry);
  }

  return cache;
}

export async function buildAsnOrgFacetCountCache(): Promise<FacetCountCache> {
  const cache: FacetCountCache = { city: {}, country: {} };

  mergeFieldIntoCache(
    cache.city,
    'asn_org',
    await buildCountryScopedAsnOrgFacets(
      'mv_city_blocks_analytics',
      'geo_city_block_asn',
      'city_block_id',
    ),
  );
  mergeFieldIntoCache(
    cache.country,
    'asn_org',
    await buildCountryScopedAsnOrgFacets(
      'mv_country_blocks_analytics',
      'geo_country_block_asn',
      'country_block_id',
    ),
  );

  return cache;
}

export function mergeFacetCountCaches(base: FacetCountCache, asnOrg: FacetCountCache): FacetCountCache {
  const merged: FacetCountCache = {
    city: { ...base.city },
    country: { ...base.country },
  };

  for (const [country, fields] of Object.entries(asnOrg.city)) {
    merged.city[country] ??= {};
    if (fields.asn_org) merged.city[country].asn_org = fields.asn_org;
  }
  for (const [country, fields] of Object.entries(asnOrg.country)) {
    merged.country[country] ??= {};
    if (fields.asn_org) merged.country[country].asn_org = fields.asn_org;
  }

  return merged;
}

export async function buildFacetCountCache(): Promise<FacetCountCache> {
  const [base, asnOrg] = await Promise.all([
    buildNonAsnFacetCountCache(),
    buildAsnOrgFacetCountCache(),
  ]);
  const cache = mergeFacetCountCaches(base, asnOrg);

  logger.info(
    {
      cityCountries: Object.keys(cache.city).length,
      countryCountries: Object.keys(cache.country).length,
    },
    'Facet count cache built',
  );

  return cache;
}

export function isFacetCountCacheEmpty(cache: FacetCountCache | null | undefined): boolean {
  if (!cache) return true;
  return Object.keys(cache.city).length === 0 && Object.keys(cache.country).length === 0;
}

/** Non-empty cache missing asn_org (e.g. built before asn_org facet support). */
export function isFacetCountCacheIncomplete(cache: FacetCountCache | null | undefined): boolean {
  if (!cache || isFacetCountCacheEmpty(cache)) return false;

  for (const fields of Object.values(cache.city)) {
    if (fields.city_name && !fields.asn_org) return true;
  }
  for (const fields of Object.values(cache.country)) {
    if (fields.country_name && !fields.asn_org) return true;
  }
  return false;
}

function resolveCountryIsoContext(contextFilters: FilterClause[]): string | null {
  if (contextFilters.length !== 1) return null;
  const filter = contextFilters[0];
  if (!filter || filter.field !== 'country_iso_code') return null;
  if (filter.op === 'eq' && filter.value != null && filter.value !== '') {
    return normalizeCountryIsoCode(filter.value);
  }
  if (filter.op === 'in' && Array.isArray(filter.value) && filter.value.length === 1) {
    const value = filter.value[0];
    if (value != null && value !== '') return normalizeCountryIsoCode(value);
  }
  return null;
}

function mergeGlobalFacetValues(
  tableType: 'city' | 'country',
  field: FacetField,
  cache: FacetCountCache,
  search: string,
  limit: number,
): Array<{ value: string; count: number }> {
  const merged = new Map<string, number>();
  for (const countryBuckets of Object.values(cache[tableType])) {
    const fieldValues = countryBuckets[field];
    if (!fieldValues) continue;
    for (const [value, count] of Object.entries(fieldValues)) {
      merged.set(value, (merged.get(value) ?? 0) + count);
    }
  }

  if (merged.size === 0) return [];

  const needle = search.trim().toLowerCase();
  return sortFacetItemsBySearch(
    [...merged.entries()]
      .filter(([value]) => (needle ? value.toLowerCase().includes(needle) : true))
      .map(([value, count]) => ({ value, count })),
    search,
    limit,
  );
}

export function resolveCachedFacetValues(
  tableType: 'city' | 'country',
  field: string,
  contextFilters: FilterClause[],
  search: string,
  limit: number,
  cache: FacetCountCache | null | undefined,
): Array<{ value: string; count: number }> | null {
  if (!cache || isFacetCountCacheEmpty(cache)) return null;

  const facetField = field as FacetField;
  const allowedFields = tableType === 'city' ? CITY_FACET_FIELDS : COUNTRY_FACET_FIELDS;
  if (!allowedFields.includes(facetField)) return null;

  if (contextFilters.length === 0) {
    const items = mergeGlobalFacetValues(tableType, facetField, cache, search, limit);
    return items.length > 0 ? items : null;
  }

  const countryIso = resolveCountryIsoContext(contextFilters);
  if (!countryIso) return null;

  const values = cache[tableType][countryIso]?.[facetField];
  if (!values) return null;

  const needle = search.trim().toLowerCase();
  const items = sortFacetItemsBySearch(
    Object.entries(values)
      .filter(([value]) => (needle ? value.toLowerCase().includes(needle) : true))
      .map(([value, count]) => ({ value, count })),
    search,
    limit,
  );

  return items;
}

export function parseFacetCountCache(raw: unknown): FacetCountCache {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CACHE };
  const input = raw as FacetCountCache;
  return {
    city: input.city ?? {},
    country: input.country ?? {},
  };
}
