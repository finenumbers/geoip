import {
  tableQuerySchema,
  validateTableQueryProfile,
  profileValidationToFieldErrors,
  normalizeFiltersForQuery,
  supportsKeysetPagination,
  usesOffsetOnlySort,
} from '@geoip/shared';
import { query } from '../db/client.js';
import { batchLookupAsn, loadPrecomputedAsn } from '../sql/asn-enrichment.js';
import { isAsnMappingReady } from '../sql/asn-mapping-status.js';
import { rankCursorField, usesRankSortField } from '../sql/sort-rank.js';
import { buildTableQuery, resolvePaginationMode, resolveTableSortHint, resolveSortOverrideHint } from '../sql/table-query.js';
import { resolveBrowseView } from '../sql/mv-view-resolver.js';
import { getDatasetState } from '../repositories/dataset-repository.js';
import {
  queryExactFilteredRowCount,
  resolveImmediateFilteredRowCount,
} from './filter-row-count.js';
import { validateTableQueryLimits } from './query-limits.js';
import type { SortClause } from '@geoip/shared';

const SORT_FIELD_ROW_KEYS: Record<string, string> = {
  network: 'network',
  country_name: 'countryName',
  city_name: 'cityName',
  country_iso_code: 'countryIsoCode',
  subdivision_1_name: 'subdivision1Name',
};

function getSortCursorValue(
  row: ReturnType<typeof mapCityRow> | ReturnType<typeof mapCountryRow>,
  sort: SortClause[],
): string | undefined {
  const primary = sort[0];
  if (!primary || primary.field === 'network') return row.network;
  if (primary.field === 'prefix_len') return String(row.prefixLen);
  if (usesRankSortField(primary.field) && 'countryNameRank' in row) {
    const key = rankCursorField(primary.field);
    const rank = row[key as keyof typeof row];
    return rank != null ? String(rank) : undefined;
  }
  const key = SORT_FIELD_ROW_KEYS[primary.field];
  if (!key) return undefined;
  const value = row[key as keyof typeof row];
  return value != null ? String(value) : '';
}

function mapCityRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    network: String(row.network),
    prefixLen: Number(row.prefix_len),
    countryIsoCode: row.country_iso_code as string | null,
    countryName: row.country_name as string | null,
    subdivision1Name: row.subdivision_1_name as string | null,
    cityName: row.city_name as string | null,
    timezone: row.timezone as string | null,
    asn: row.asn != null ? Number(row.asn) : null,
    asnOrg: row.asn_org as string | null,
    countryNameRank: row.country_name_rank != null ? Number(row.country_name_rank) : null,
    cityNameRank: row.city_name_rank != null ? Number(row.city_name_rank) : null,
  };
}

function mapCountryRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    network: String(row.network),
    prefixLen: Number(row.prefix_len),
    countryIsoCode: row.country_iso_code as string | null,
    countryName: row.country_name as string | null,
    subdivision1Name: row.subdivision_1_name as string | null,
    asn: row.asn != null ? Number(row.asn) : null,
    asnOrg: row.asn_org as string | null,
  };
}

async function enrichRowsWithAsn<T extends { id: number; network: string; asn: number | null; asnOrg: string | null }>(
  tableType: 'city' | 'country',
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;

  let precomputed = new Map<number, { asn: number | null; asnOrg: string | null }>();
  if (await isAsnMappingReady()) {
    precomputed = await loadPrecomputedAsn(
      tableType,
      rows.map((row) => row.id),
    );
  }

  const missingNetworks = rows
    .filter((row) => !precomputed.has(row.id))
    .map((row) => row.network);
  const lookedUp = await batchLookupAsn(missingNetworks);

  return rows.map((row) => {
    const cached = precomputed.get(row.id);
    if (cached) {
      return { ...row, asn: cached.asn, asnOrg: cached.asnOrg };
    }
    const live = lookedUp.get(row.network);
    return {
      ...row,
      asn: live?.asn ?? null,
      asnOrg: live?.asnOrg ?? null,
    };
  });
}

export async function queryTable(
  tableType: 'city' | 'country',
  rawQuery: Record<string, unknown>,
) {
  const parsed = tableQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  const profileCheck = validateTableQueryProfile(
    tableType,
    parsed.data.sort,
    parsed.data.filters,
  );
  if (!profileCheck.ok) {
    return { error: profileValidationToFieldErrors(profileCheck.issues) };
  }

  const { page, pageSize, sort, afterId, afterNetwork, afterSortValue } = parsed.data;
  const filters = normalizeFiltersForQuery(parsed.data.filters);
  const usesKeyset =
    resolvePaginationMode(sort, page, afterId, afterNetwork, afterSortValue) === 'keyset';
  const limitCheck = validateTableQueryLimits(page, pageSize, usesKeyset);
  if (!limitCheck.ok) {
    return {
      error: {
        formErrors: [],
        fieldErrors: { [limitCheck.path]: [limitCheck.message] },
      },
    };
  }

  const start = Date.now();
  const usePrecomputedAsnFilter = await isAsnMappingReady();
  const { sql, countSql, params, countParams, useCachedCount, skipExactCount } = buildTableQuery(
    tableType,
    { page, pageSize, sort, filters, afterId, afterNetwork, afterSortValue, usePrecomputedAsnFilter },
  );

  const state = await getDatasetState();

  const immediateCount = resolveImmediateFilteredRowCount(
    tableType,
    filters,
    useCachedCount,
    state,
  );

  const countPromise =
    !immediateCount && countSql && !skipExactCount
      ? queryExactFilteredRowCount(countSql, countParams)
      : null;

  const dataResult = await query<Record<string, unknown>>(sql, params);

  let totalRows = immediateCount?.totalRows ?? 0;
  let countSource: 'cached' | 'exact' | 'estimated' = immediateCount?.countSource ?? 'exact';

  if (countPromise) {
    totalRows = await countPromise;
  }

  const mapper = tableType === 'city' ? mapCityRow : mapCountryRow;
  const needsAsnEnrichment =
    !filters.some((f) => f.field === 'asn' || f.field === 'asn_org') &&
    !sort.some((s) => s.field === 'asn' || s.field === 'asn_org');
  let rows = dataResult.rows.map(mapper);
  if (needsAsnEnrichment || skipExactCount) {
    rows = await enrichRowsWithAsn(tableType, rows);
  }

  if (skipExactCount) {
    totalRows =
      rows.length < pageSize
        ? (page - 1) * pageSize + rows.length
        : page * pageSize + 1;
  }

  const lastRow = rows[rows.length - 1];
  const sortHint = resolveTableSortHint(tableType, sort, filters);
  const sortOverrideHint = resolveSortOverrideHint(tableType, sort, filters);
  const paginationWarning = usesOffsetOnlySort(sort) ? ('offset_only' as const) : null;
  const browseView = resolveBrowseView(tableType, filters).view;
  const paginationMode = resolvePaginationMode(sort, page, afterId, afterNetwork, afterSortValue);

  return {
    rows,
    pagination: {
      page,
      pageSize,
      totalRows,
      totalPages: Math.ceil(totalRows / pageSize),
    },
    meta: {
      datasetDate: state.datasetDate,
      mvRefreshedAt: state.mvRefreshedAt,
      queryMs: Date.now() - start,
      countSource: skipExactCount
        ? 'estimated' as const
        : countSource,
      sortHint,
      sortOverrideHint,
      paginationWarning,
      browseView,
      paginationMode,
      nextCursor:
        lastRow != null && supportsKeysetPagination(sort)
          ? {
              afterId: lastRow.id,
              afterNetwork: lastRow.network,
              afterSortValue: getSortCursorValue(lastRow, sort),
            }
          : null,
    },
  };
}
