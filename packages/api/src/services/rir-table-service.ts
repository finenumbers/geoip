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
import { buildRirTableQuery, buildRirFacetQuery } from '../sql/rir-table-query.js';
import { isRirDatasetReady } from '../repositories/rir-repository.js';
import { validateTableQueryLimits } from './query-limits.js';

function mapRirRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    registry: String(row.registry),
    cc: (row.cc as string | null) ?? null,
    resourceType: String(row.resource_type),
    rangeText: String(row.range_text),
    network: (row.network as string | null) ?? null,
    prefixLen: row.prefix_len != null ? Number(row.prefix_len) : null,
    status: String(row.status),
    allocatedAt: (row.allocated_at as string | null) ?? null,
    opaqueId: (row.opaque_id as string | null) ?? null,
    ipFamily: row.ip_family != null ? Number(row.ip_family) : null,
    startAsn: row.start_asn != null ? Number(row.start_asn) : null,
    asnCount: row.asn_count != null ? Number(row.asn_count) : null,
    hostCount: (row.host_count as string | null) ?? null,
    sourceFile: String(row.source_file),
    snapshotDate: String(row.snapshot_date),
  };
}

function getSortCursorValue(
  row: ReturnType<typeof mapRirRow>,
  sort: SortClause[],
): string | undefined {
  const primary = sort[0];
  if (!primary) return row.rangeText;
  switch (primary.field) {
    case 'registry':
      return row.registry;
    case 'range_text':
      return row.rangeText;
    case 'cc':
      return row.cc ?? '';
    case 'status':
      return row.status;
    case 'allocated_at':
      return row.allocatedAt ?? '';
    case 'resource_type':
      return row.resourceType;
    case 'prefix_len':
      return row.prefixLen != null ? String(row.prefixLen) : '';
    case 'opaque_id':
      return row.opaqueId ?? '';
    default:
      return row.rangeText;
  }
}

export async function queryRirTable(rawQuery: Record<string, unknown>) {
  const ready = await isRirDatasetReady();
  if (!ready) return { notReady: true as const };

  const parsed = tableQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  const profileCheck = validateTableQueryProfile(
    'rir',
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
  const built = buildRirTableQuery({
    filters,
    sort,
    limit: pageSize,
    offset,
    afterId: useKeyset ? afterId : undefined,
    afterSortValue: useKeyset ? afterSortValue : undefined,
  });

  const start = Date.now();
  const [dataResult, countResult] = await Promise.all([
    query<Record<string, unknown>>(built.sql, built.params),
    query<{ count: string }>(built.countSql, built.countParams),
  ]);
  const totalRows = Number(countResult.rows[0]?.count ?? 0);
  const rows = dataResult.rows.map(mapRirRow);
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
      datasetDate: lastRow?.snapshotDate ?? null,
      mvRefreshedAt: null,
      queryMs: Date.now() - start,
      countSource: 'exact' as const,
      sortHint: null,
      sortOverrideHint: null,
      paginationWarning: usesOffsetOnlySort(sort) ? ('offset_only' as const) : null,
      browseView: 'rir_delegations',
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

export async function getRirFacetValues(
  field: string,
  search: string,
  limit: number,
  contextFilters: FilterClause[],
) {
  const ready = await isRirDatasetReady();
  if (!ready) return { notReady: true as const };

  const filters = normalizeFiltersForQuery(contextFilters);
  const profileCheck = validateTableQueryProfile('rir', [], filters);
  if (!profileCheck.ok) {
    return { error: profileValidationToFieldErrors(profileCheck.issues) };
  }

  try {
    const built = buildRirFacetQuery(field, search, limit, filters);
    const result = await query<{ value: string; count: number }>(built.sql, built.params);
    return {
      items: result.rows.map((r) => ({ value: r.value, count: Number(r.count) })),
      meta: { source: 'index' as const },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
