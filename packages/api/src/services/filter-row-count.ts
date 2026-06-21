import type { FilterClause, SortClause } from '@geoip/shared';
import { query } from '../db/client.js';
import { buildTableQuery, hasAsnBlocksFilter } from '../sql/table-query.js';
import { resolveCachedFilterCount, type FilterCountCache } from '../sql/filter-count-cache.js';
import { getDatasetState } from '../repositories/dataset-repository.js';
import { isAsnMappingReady } from '../sql/asn-mapping-status.js';

export type FilteredRowCountSource = 'cached' | 'exact';

type RowCountState = {
  cityRowCount: number;
  countryRowCount: number;
  filterCountCache: FilterCountCache;
};

export function resolveImmediateFilteredRowCount(
  tableType: 'city' | 'country',
  filters: FilterClause[],
  useCachedCount: boolean,
  state: RowCountState,
): { totalRows: number; countSource: FilteredRowCountSource } | null {
  const cachedTotal = tableType === 'city' ? state.cityRowCount : state.countryRowCount;
  if (useCachedCount) {
    return { totalRows: cachedTotal, countSource: 'cached' };
  }

  const cachedFilterTotal = resolveCachedFilterCount(tableType, filters, state.filterCountCache);
  if (cachedFilterTotal != null) {
    return { totalRows: cachedFilterTotal, countSource: 'cached' };
  }

  return null;
}

export async function queryExactFilteredRowCount(
  countSql: string,
  countParams: unknown[],
): Promise<number> {
  const countResult = await query<{ count: number }>(countSql, countParams);
  return countResult.rows[0]?.count ?? 0;
}

/** Same counting rules as table browse — exact COUNT(*) when possible, not EXPLAIN estimates. */
export async function resolveFilteredRowCount(
  tableType: 'city' | 'country',
  filters: FilterClause[],
  sort: SortClause[],
): Promise<number | null> {
  const usePrecomputedAsnFilter = await isAsnMappingReady();
  const { countSql, countParams, useCachedCount, skipExactCount } = buildTableQuery(tableType, {
    page: 1,
    pageSize: 1,
    sort,
    filters,
    usePrecomputedAsnFilter,
  });

  const state = await getDatasetState();
  const immediate = resolveImmediateFilteredRowCount(tableType, filters, useCachedCount, state);
  if (immediate) {
    return immediate.totalRows;
  }

  if (skipExactCount || !countSql) {
    return hasAsnBlocksFilter(filters) ? null : 0;
  }

  return queryExactFilteredRowCount(countSql, countParams);
}
