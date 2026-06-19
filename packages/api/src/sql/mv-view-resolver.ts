import type { FilterClause } from '@geoip/shared';

type TableType = 'city' | 'country';

export interface ResolvedBrowseView {
  view: string;
  /** Filters with redundant country_iso_code=RU removed when using partial MV. */
  filters: FilterClause[];
  ruPartial: boolean;
}

function normalizeCountryCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/** True when filter scopes exclusively to RU (eq RU or in [RU]). */
function isRuCountryFilter(filter: FilterClause): boolean {
  if (filter.field !== 'country_iso_code') return false;

  if (filter.op === 'eq') {
    return normalizeCountryCode(filter.value) === 'RU';
  }

  if (filter.op === 'in') {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    if (values.length !== 1) return false;
    return normalizeCountryCode(values[0]) === 'RU';
  }

  return false;
}

/** True when query is scoped to RU city blocks (no conflicting country filters). */
export function isRuScopedCityQuery(filters: FilterClause[]): boolean {
  const countryFilters = filters.filter((f) => f.field === 'country_iso_code');
  if (countryFilters.length === 0) return false;

  const hasRu = countryFilters.some(isRuCountryFilter);
  if (!hasRu) return false;

  const hasConflictingCountry = countryFilters.some((f) => !isRuCountryFilter(f));
  return !hasConflictingCountry;
}

export function resolveBrowseView(
  tableType: TableType,
  filters: FilterClause[],
): ResolvedBrowseView {
  if (tableType !== 'city' || !isRuScopedCityQuery(filters)) {
    return {
      view:
        tableType === 'city' ? 'mv_city_blocks_analytics' : 'mv_country_blocks_analytics',
      filters,
      ruPartial: false,
    };
  }

  return {
    view: 'mv_city_blocks_ru',
    filters: filters.filter((f) => !isRuCountryFilter(f)),
    ruPartial: true,
  };
}
