import {
  tableQuerySchema,
  validateTableQueryProfile,
  profileValidationToFieldErrors,
  normalizeFiltersForQuery,
  supportsKeysetPagination,
  usesOffsetOnlySort,
} from '@geoip/shared';
import type { FilterClause, SortClause } from '@geoip/shared';
import { query } from '../db/client.js';
import { buildAsnTableQuery, buildAsnFacetQuery } from '../sql/asn-table-query.js';
import { getDatasetState } from '../repositories/dataset-repository.js';
import { validateTableQueryLimits } from './query-limits.js';

function mapAsnRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    network: String(row.network),
    prefixLen: row.prefix_len != null ? Number(row.prefix_len) : null,
    ipFamily: row.ip_family != null ? Number(row.ip_family) : null,
    asn: row.asn != null ? Number(row.asn) : null,
    asnOrg: (row.asn_org as string | null) ?? null,
  };
}

function getSortCursorValue(
  row: ReturnType<typeof mapAsnRow>,
  sort: SortClause[],
): string | undefined {
  const primary = sort[0];
  if (!primary) return row.network;
  switch (primary.field) {
    case 'network':
      return row.network;
    case 'prefix_len':
      return row.prefixLen != null ? String(row.prefixLen) : '';
    case 'ip_family':
      return row.ipFamily != null ? String(row.ipFamily) : '';
    case 'asn':
      return row.asn != null ? String(row.asn) : '';
    case 'asn_org':
      return row.asnOrg ?? '';
    default:
      return row.network;
  }
}

export async function queryAsnTable(rawQuery: Record<string, unknown>) {
  const parsed = tableQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  const profileCheck = validateTableQueryProfile(
    'asn',
    parsed.data.sort,
    parsed.data.filters,
  );
  if (!profileCheck.ok) {
    return { error: profileValidationToFieldErrors(profileCheck.issues) };
  }

  const { page, pageSize, sort, afterId, afterSortValue } = parsed.data;
  const filters = normalizeFiltersForQuery(parsed.data.filters);
  const useKeyset =
    supportsKeysetPagination(sort) && (page > 1 || afterId != null) && afterId != null;
  const limitCheck = validateTableQueryLimits(page, pageSize, useKeyset || page === 1);
  if (!limitCheck.ok) {
    return {
      error: {
        formErrors: [],
        fieldErrors: { [limitCheck.path]: [limitCheck.message] },
      },
    };
  }

  const offset = useKeyset ? 0 : (page - 1) * pageSize;
  const built = buildAsnTableQuery({
    filters,
    sort,
    limit: pageSize,
    offset,
    afterId: useKeyset ? afterId : undefined,
    afterSortValue: useKeyset ? afterSortValue : undefined,
  });

  const start = Date.now();
  const [dataResult, countResult, state] = await Promise.all([
    query<Record<string, unknown>>(built.sql, built.params),
    query<{ count: string }>(built.countSql, built.countParams),
    getDatasetState(),
  ]);
  const totalRows = Number(countResult.rows[0]?.count ?? 0);
  const rows = dataResult.rows.map(mapAsnRow);
  const lastRow = rows[rows.length - 1];

  return {
    rows,
    pagination: {
      page,
      pageSize,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
    },
    meta: {
      datasetDate: state.datasetDate,
      mvRefreshedAt: null,
      queryMs: Date.now() - start,
      countSource: 'exact' as const,
      sortHint: null,
      sortOverrideHint: null,
      paginationWarning: usesOffsetOnlySort(sort) ? ('offset_only' as const) : null,
      browseView: 'geo_asn_blocks',
      paginationMode: supportsKeysetPagination(sort) ? ('keyset' as const) : ('offset' as const),
      nextCursor:
        lastRow != null && supportsKeysetPagination(sort)
          ? {
              afterId: lastRow.id,
              afterSortValue: getSortCursorValue(lastRow, sort),
            }
          : null,
    },
  };
}

export async function getAsnFacetValues(
  field: string,
  search: string,
  limit: number,
  contextFilters: FilterClause[],
) {
  const filters = normalizeFiltersForQuery(contextFilters);
  const profileCheck = validateTableQueryProfile('asn', [], filters);
  if (!profileCheck.ok) {
    return { error: profileValidationToFieldErrors(profileCheck.issues) };
  }

  try {
    const built = buildAsnFacetQuery(field, search, limit, filters);
    const result = await query<{ value: string; count: number }>(built.sql, built.params);
    return {
      items: result.rows.map((r) => ({ value: r.value, count: Number(r.count) })),
      meta: { source: 'index' as const },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
