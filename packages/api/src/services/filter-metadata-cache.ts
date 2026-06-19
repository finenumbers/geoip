import type { FacetCountCache, FacetField } from '../sql/facet-count-cache.js';
import type { FilterCountCache } from '../sql/filter-count-cache.js';

export const FILTER_METADATA_TTL_MS = 60_000;
export const FILTER_METADATA_VALUE_LIMIT = 100;

const FACET_FIELDS = new Set<FacetField>([
  'city_name',
  'country_name',
  'subdivision_1_name',
]);

type FilterMetadataField = {
  type: 'string' | 'number';
  distinctValues?: (string | number)[];
};

export type FilterMetadataPayload = {
  fields: Record<string, FilterMetadataField>;
};

let metadataCache: {
  key: string;
  expiresAt: number;
  payload: FilterMetadataPayload;
} | null = null;

export function buildFilterMetadataCacheKey(
  tableType: 'city' | 'country',
  datasetDate: string | null,
  datasetFingerprint: string | null,
  mvRefreshedAt: string | null,
): string {
  return `${tableType}:${datasetDate ?? ''}:${datasetFingerprint ?? ''}:${mvRefreshedAt ?? ''}`;
}

export function invalidateFilterMetadataCache(): void {
  metadataCache = null;
}

export function getCachedFilterMetadata(key: string): FilterMetadataPayload | null {
  if (!metadataCache || metadataCache.key !== key) return null;
  if (metadataCache.expiresAt <= Date.now()) {
    metadataCache = null;
    return null;
  }
  return metadataCache.payload;
}

export function setCachedFilterMetadata(key: string, payload: FilterMetadataPayload): void {
  metadataCache = {
    key,
    expiresAt: Date.now() + FILTER_METADATA_TTL_MS,
    payload,
  };
}

export function topFacetValues(
  cache: FacetCountCache,
  tableType: 'city' | 'country',
  field: FacetField,
  limit: number,
): string[] {
  const byCountry = cache[tableType];
  const merged = new Map<string, number>();

  for (const countryFields of Object.values(byCountry)) {
    const values = countryFields[field];
    if (!values) continue;
    for (const [value, count] of Object.entries(values)) {
      merged.set(value, (merged.get(value) ?? 0) + count);
    }
  }

  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    .slice(0, limit)
    .map(([value]) => value);
}

export function distinctIsoCodes(
  filterCache: FilterCountCache,
  tableType: 'city' | 'country',
  limit: number,
): string[] {
  const counts = filterCache[tableType].country_iso_code ?? {};
  return Object.keys(counts)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}

export function buildStringFieldMetadata(
  field: string,
  tableType: 'city' | 'country',
  facetCache: FacetCountCache,
  filterCache: FilterCountCache,
): FilterMetadataField | null {
  if (field === 'country_iso_code') {
    const values = distinctIsoCodes(filterCache, tableType, FILTER_METADATA_VALUE_LIMIT);
    if (values.length > 0) {
      return { type: 'string', distinctValues: values };
    }
    return null;
  }

  if (FACET_FIELDS.has(field as FacetField)) {
    const values = topFacetValues(
      facetCache,
      tableType,
      field as FacetField,
      FILTER_METADATA_VALUE_LIMIT,
    );
    if (values.length > 0) {
      return { type: 'string', distinctValues: values };
    }
  }

  return null;
}
