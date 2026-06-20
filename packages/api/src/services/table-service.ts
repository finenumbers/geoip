import {
  tableQuerySchema,
  tableSeekRequestSchema,
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
import { buildTableQuery, getFilterMetadataFields, getFilterMetadataSource, resolvePaginationMode, resolveTableSortHint, resolveSortOverrideHint } from '../sql/table-query.js';
import { resolveBrowseView } from '../sql/mv-view-resolver.js';
import { resolveCachedFilterCount } from '../sql/filter-count-cache.js';
import { getDatasetState } from '../repositories/dataset-repository.js';
import {
  buildFilterMetadataCacheKey,
  buildStringFieldMetadata,
  FILTER_METADATA_VALUE_LIMIT,
  getCachedFilterMetadata,
  setCachedFilterMetadata,
} from './filter-metadata-cache.js';
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
  const keysetEnabled = supportsKeysetPagination(sort);
  const usesKeyset =
    keysetEnabled && afterId != null && afterNetwork != null;
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
  const cachedTotal =
    tableType === 'city' ? state.cityRowCount : state.countryRowCount;

  const cachedFilterTotal = resolveCachedFilterCount(
    tableType,
    filters,
    state.filterCountCache,
  );

  const countPromise =
    !useCachedCount && countSql && cachedFilterTotal == null
      ? query<{ count: number }>(countSql, countParams)
      : null;

  const dataResult = await query<Record<string, unknown>>(sql, params);

  let totalRows = cachedTotal;
  let countSource: 'cached' | 'exact' | 'estimated' = useCachedCount ? 'cached' : 'exact';

  if (cachedFilterTotal != null) {
    totalRows = cachedFilterTotal;
    countSource = 'cached';
  } else if (countPromise) {
    const countResult = await countPromise;
    totalRows = countResult.rows[0]?.count ?? 0;
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
        lastRow != null && keysetEnabled
          ? {
              afterId: lastRow.id,
              afterNetwork: lastRow.network,
              afterSortValue: getSortCursorValue(lastRow, sort),
            }
          : null,
    },
  };
}

async function fetchDistinctFieldValues(
  tableType: 'city' | 'country',
  field: string,
): Promise<(string | number)[]> {
  const view = tableType === 'city' ? 'mv_city_blocks_analytics' : 'mv_country_blocks_analytics';
  const source = getFilterMetadataSource(tableType, field);
  const result = await query<{ value: string | number | null }>(
    `SELECT DISTINCT ${source} AS value
     FROM ${view} v
     ${field === 'asn' ? `LEFT JOIN ${tableType === 'city' ? 'geo_city_block_asn' : 'geo_country_block_asn'} ba ON ba.${tableType === 'city' ? 'city_block_id' : 'country_block_id'} = v.id` : ''}
     WHERE ${source} IS NOT NULL
     ORDER BY ${source}
     LIMIT ${FILTER_METADATA_VALUE_LIMIT}`,
  );
  return result.rows
    .map((r) => r.value)
    .filter((v): v is string | number => v !== null);
}

export async function getFilterMetadata(tableType: 'city' | 'country') {
  const state = await getDatasetState();
  const cacheKey = buildFilterMetadataCacheKey(
    tableType,
    state.datasetDate,
    state.datasetFingerprint,
    state.mvRefreshedAt,
  );
  const cached = getCachedFilterMetadata(cacheKey);
  if (cached) return cached;

  const fields: Record<string, { type: 'string' | 'number'; distinctValues?: (string | number)[] }> = {};
  const fieldNames = getFilterMetadataFields(tableType);

  for (const field of fieldNames) {
    const type = field === 'asn' ? 'number' : 'string';
    if (type === 'string') {
      const fromCache = buildStringFieldMetadata(
        field,
        tableType,
        state.facetCountCache,
        state.filterCountCache,
      );
      if (fromCache) {
        fields[field] = fromCache;
        continue;
      }
    }

    fields[field] = {
      type,
      distinctValues: await fetchDistinctFieldValues(tableType, field),
    };
  }

  const payload = { fields };
  setCachedFilterMetadata(cacheKey, payload);
  return payload;
}

type TableCursor = {
  afterId: number;
  afterNetwork: string;
  afterSortValue?: string;
} | null;

function findBestCursorStart(
  stack: TableCursor[],
  targetPage: number,
): { startPage: number; cursor: TableCursor } {
  if (targetPage <= 1) {
    return { startPage: 1, cursor: null };
  }
  for (let p = targetPage - 1; p >= 1; p--) {
    const cursor = stack[p - 1] ?? null;
    if (cursor != null) {
      return { startPage: p, cursor };
    }
  }
  return { startPage: 1, cursor: null };
}

export async function seekTablePage(
  tableType: 'city' | 'country',
  rawBody: Record<string, unknown>,
) {
  const parsed = tableSeekRequestSchema.safeParse(rawBody);
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

  const { targetPage, pageSize, sort, cursorStack: clientStack } = parsed.data;
  const filters = normalizeFiltersForQuery(parsed.data.filters);

  if (targetPage <= 1) {
    return {
      cursor: null as TableCursor,
      cursorStack: [null] as TableCursor[],
      seekMs: 0,
      pagesWalked: 0,
      startPage: 1,
    };
  }

  if (!supportsKeysetPagination(sort)) {
    return {
      error: {
        formErrors: [],
        fieldErrors: {
          sort: ['Keyset seek requires a single supported sort column'],
        },
      },
    };
  }

  const start = Date.now();
  const inputStack = clientStack?.length ? [...clientStack] : [null];
  const { startPage, cursor: startCursor } = findBestCursorStart(inputStack, targetPage);
  const nextStack = [...inputStack];
  while (nextStack.length < targetPage) nextStack.push(null);

  let walkPage = startPage;
  let walkCursor: TableCursor = startPage === 1 ? null : startCursor;
  let pagesWalked = 0;

  while (walkPage < targetPage) {
    const pageResult = await queryTable(tableType, {
      page: walkPage,
      pageSize,
      sort,
      filters,
      afterId: walkCursor?.afterId,
      afterNetwork: walkCursor?.afterNetwork,
      afterSortValue: walkCursor?.afterSortValue,
    });
    if ('error' in pageResult) {
      return pageResult;
    }

    const next = pageResult.meta?.nextCursor;
    if (!next) break;

    const cursor: TableCursor = {
      afterId: next.afterId,
      afterNetwork: next.afterNetwork ?? '',
      afterSortValue: next.afterSortValue,
    };
    nextStack[walkPage] = cursor;
    walkCursor = cursor;
    walkPage++;
    pagesWalked++;
  }

  const landingCursor = targetPage === 1 ? null : nextStack[targetPage - 1] ?? null;

  return {
    cursor: landingCursor,
    cursorStack: nextStack,
    seekMs: Date.now() - start,
    pagesWalked,
    startPage,
  };
}
