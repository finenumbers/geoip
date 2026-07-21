import { tableQuerySchema } from '@geoip/shared';
import type { FilterClause, SortClause } from '@geoip/shared';
import { query } from '../db/client.js';
import {
  buildCcMismatchFacetQuery,
  buildCcMismatchTableQuery,
} from '../sql/cc-mismatch-table-query.js';
import { validateTableQueryLimits } from './query-limits.js';

const ALLOWED_FILTERS = new Set([
  'network',
  'grchc_cc',
  'rir_cc',
  'registry',
  'range_text',
  'asn',
  'asn_org',
]);
const ALLOWED_SORT = new Set([
  'network',
  'grchc_cc',
  'rir_cc',
  'registry',
  'range_text',
  'asn',
  'asn_org',
  'id',
]);
const FACET_FIELDS = new Set(['grchc_cc', 'rir_cc', 'registry']);

function supportsCcMismatchKeyset(sort: SortClause[]): boolean {
  if (sort.length === 0) return true;
  return sort.length === 1 && ALLOWED_SORT.has(sort[0]?.field ?? '');
}

function mapRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    countryBlockId: Number(row.country_block_id),
    network: String(row.network),
    grchcCc: String(row.grchc_cc),
    rirCc: String(row.rir_cc),
    registry: (row.registry as string | null) ?? null,
    rangeText: (row.range_text as string | null) ?? null,
    asn: row.asn != null ? Number(row.asn) : null,
    asnOrg: (row.asn_org as string | null) ?? null,
    rebuiltAt: row.rebuilt_at instanceof Date ? row.rebuilt_at.toISOString() : String(row.rebuilt_at),
  };
}

function getSortCursorValue(
  row: ReturnType<typeof mapRow>,
  sort: SortClause[],
): string | undefined {
  const primary = sort[0];
  if (!primary) return row.network;
  switch (primary.field) {
    case 'grchc_cc':
      return row.grchcCc;
    case 'rir_cc':
      return row.rirCc;
    case 'registry':
      return row.registry ?? '';
    case 'range_text':
      return row.rangeText ?? '';
    case 'asn':
      return row.asn != null ? String(row.asn) : '';
    case 'asn_org':
      return row.asnOrg ?? '';
    case 'id':
      return String(row.id);
    default:
      return row.network;
  }
}

function sanitizeFilters(filters: FilterClause[]): FilterClause[] {
  return filters.filter((f) => ALLOWED_FILTERS.has(f.field));
}

function sanitizeSort(sort: SortClause[]): SortClause[] {
  return sort.filter((s) => ALLOWED_SORT.has(s.field));
}

export async function getCcMismatchState() {
  const result = await query<{
    status: string;
    row_count: string;
    rebuilt_at: Date | null;
    duration_ms: string | null;
    last_error: string | null;
  }>(
    `SELECT status, row_count::text, rebuilt_at, duration_ms::text, last_error
     FROM geo_rir_cc_mismatch_state WHERE id = 1`,
  );
  const row = result.rows[0];
  if (!row) {
    return {
      status: 'never' as const,
      rowCount: 0,
      rebuiltAt: null,
      durationMs: null,
      lastError: null,
    };
  }
  return {
    status: row.status as 'never' | 'running' | 'ready' | 'failed',
    rowCount: Number(row.row_count),
    rebuiltAt: row.rebuilt_at?.toISOString() ?? null,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    lastError: row.last_error,
  };
}

export async function queryCcMismatchTable(rawQuery: Record<string, unknown>) {
  const parsed = tableQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  const filters = sanitizeFilters(parsed.data.filters);
  const sort = sanitizeSort(parsed.data.sort);
  const { page, pageSize, afterId, afterSortValue } = parsed.data;
  const keysetSort = sort.length ? sort : [{ field: 'network' as const, dir: 'asc' as const }];
  const useKeyset = supportsCcMismatchKeyset(keysetSort) && afterId != null;
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
  const built = buildCcMismatchTableQuery({
    filters,
    sort: keysetSort,
    limit: pageSize,
    offset,
    afterId: useKeyset ? afterId : undefined,
    afterSortValue: useKeyset ? afterSortValue : undefined,
  });

  const start = Date.now();
  const [dataResult, countResult, state] = await Promise.all([
    query<Record<string, unknown>>(built.sql, built.params),
    query<{ count: string }>(built.countSql, built.countParams),
    getCcMismatchState(),
  ]);
  const totalRows = Number(countResult.rows[0]?.count ?? 0);
  const rows = dataResult.rows.map(mapRow);
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
      datasetDate: state.rebuiltAt,
      mvRefreshedAt: state.rebuiltAt,
      queryMs: Date.now() - start,
      countSource: 'exact' as const,
      browseView: 'geo_rir_cc_mismatches',
      paginationMode: supportsCcMismatchKeyset(keysetSort) ? ('keyset' as const) : ('offset' as const),
      nextCursor:
        lastRow != null && supportsCcMismatchKeyset(keysetSort)
          ? {
              afterId: lastRow.id,
              afterSortValue: getSortCursorValue(lastRow, keysetSort),
            }
          : null,
      rebuildStatus: state.status,
      rebuiltAt: state.rebuiltAt,
      rebuildDurationMs: state.durationMs,
      rebuildError: state.lastError,
    },
  };
}

export async function getCcMismatchFacetValues(
  field: string,
  search: string,
  limit: number,
  contextFilters: FilterClause[],
) {
  if (!FACET_FIELDS.has(field)) {
    return { error: `Unsupported facet field: ${field}` };
  }
  try {
    const built = buildCcMismatchFacetQuery(field, search, limit, sanitizeFilters(contextFilters));
    const result = await query<{ value: string; count: number }>(built.sql, built.params);
    return {
      items: result.rows.map((r) => ({ value: r.value, count: Number(r.count) })),
      meta: { source: 'index' as const },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
