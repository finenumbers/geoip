import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, type SortingState } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { ui } from '@/lib/ui-strings';
import { DataTable } from '@/components/DataTable';
import { ColumnTextFilter } from '@/components/ColumnTextFilter';
import { ColumnFacetFilter } from '@/components/ColumnFacetFilter';
import { formatDateTime } from '@/lib/format-datetime';
import {
  getMultiFilterValues,
  getTextFilterValue,
  setMultiFilter,
  setTextFilter,
  type TableFilter,
} from '@/lib/browse-filters';

const PAGE_SIZE = 100;
const MAX_LOADED_ROWS = 5000;

type CcMismatchRow = {
  id: number;
  countryBlockId: number;
  network: string;
  grchcCc: string;
  rirCc: string;
  registry: string | null;
  rangeText: string | null;
  asn: number | null;
  asnOrg: string | null;
  rebuiltAt: string;
};

const COLUMN_API_FIELDS: Record<string, string> = {
  network: 'network',
  rangeText: 'range_text',
  asn: 'asn',
  asnOrg: 'asn_org',
  grchcCc: 'grchc_cc',
  rirCc: 'rir_cc',
  registry: 'registry',
};

type PageParam = {
  page: number;
  afterId?: number;
  afterSortValue?: string;
};

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms} мс`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} с`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min} мин ${rem} с` : `${min} мин`;
}

export function CcMismatchPage() {
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filters, setFilters] = useState<TableFilter[]>([]);

  const sortJson = useMemo(
    () =>
      JSON.stringify(
        sorting.map((s) => ({
          field: COLUMN_API_FIELDS[s.id] ?? s.id,
          dir: s.desc ? 'desc' : 'asc',
        })),
      ),
    [sorting],
  );
  const filtersJson = useMemo(() => JSON.stringify(filters), [filters]);

  const stateQuery = useQuery({
    queryKey: ['cc-mismatch-state'],
    queryFn: api.ccMismatchState,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === 'running' || s === 'never') return 5_000;
      return 60_000;
    },
  });

  const tableQuery = useInfiniteQuery({
    queryKey: ['cc-mismatch-table', sortJson, filtersJson],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set('pageSize', String(PAGE_SIZE));
      params.set('sort', sortJson);
      params.set('filters', filtersJson);
      params.set('page', String(pageParam?.page ?? 1));
      if (pageParam?.afterId != null) params.set('afterId', String(pageParam.afterId));
      if (pageParam?.afterSortValue != null) {
        params.set('afterSortValue', pageParam.afterSortValue);
      }
      return api.ccMismatchTable(params, signal);
    },
    initialPageParam: undefined as PageParam | undefined,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.rows.length, 0);
      if (loaded >= MAX_LOADED_ROWS) return undefined;
      if (loaded >= lastPage.pagination.totalRows) return undefined;
      if (lastPage.rows.length < PAGE_SIZE) return undefined;
      const cursor = lastPage.meta.nextCursor;
      if (cursor) {
        return {
          page: lastPage.pagination.page + 1,
          afterId: cursor.afterId,
          afterSortValue: cursor.afterSortValue,
        };
      }
      if (lastPage.meta.paginationMode === 'keyset') return undefined;
      return { page: lastPage.pagination.page + 1 };
    },
    staleTime: 30_000,
  });

  const rows = useMemo(
    () => tableQuery.data?.pages.flatMap((page) => page.rows) ?? [],
    [tableQuery.data],
  );
  const totalRows = tableQuery.data?.pages[0]?.pagination.totalRows ?? 0;
  const rowCapReached = rows.length >= MAX_LOADED_ROWS;
  const hasMore = Boolean(tableQuery.hasNextPage) && !rowCapReached;

  const applyTextFilter = useCallback((field: string, value: string) => {
    setFilters((prev) => setTextFilter(prev, field, value));
  }, []);

  const clearTextFilter = useCallback((field: string) => {
    setFilters((prev) => setTextFilter(prev, field, ''));
  }, []);

  const facetContext = useCallback(
    (excludeField: string) => filters.filter((f) => f.field !== excludeField),
    [filters],
  );

  const columns = useMemo<ColumnDef<CcMismatchRow>[]>(
    () => [
      {
        accessorKey: 'network',
        header: ui.ccMismatch.network,
        meta: {
          sortable: true,
          headerFilter: (
            <ColumnTextFilter
              placeholder={ui.ccMismatch.network}
              value={getTextFilterValue(filters, 'network')}
              onApply={(value) => applyTextFilter('network', value)}
              onClear={() => clearTextFilter('network')}
            />
          ),
        },
      },
      {
        accessorKey: 'rangeText',
        header: ui.ccMismatch.rangeText,
        meta: {
          sortable: true,
          headerFilter: (
            <ColumnTextFilter
              placeholder={ui.ccMismatch.rangeText}
              value={getTextFilterValue(filters, 'range_text')}
              onApply={(value) => applyTextFilter('range_text', value)}
              onClear={() => clearTextFilter('range_text')}
            />
          ),
        },
      },
      {
        accessorKey: 'asn',
        header: ui.ccMismatch.asn,
        cell: ({ getValue }) => {
          const v = getValue<number | null>();
          return v != null ? String(v) : '—';
        },
        meta: {
          sortable: true,
          headerFilter: (
            <ColumnTextFilter
              placeholder={ui.ccMismatch.asn}
              value={getTextFilterValue(filters, 'asn')}
              onApply={(value) => applyTextFilter('asn', value)}
              onClear={() => clearTextFilter('asn')}
            />
          ),
        },
      },
      {
        accessorKey: 'asnOrg',
        header: ui.ccMismatch.asnOrg,
        cell: ({ getValue }) => getValue<string | null>() ?? '—',
        meta: {
          sortable: true,
          headerFilter: (
            <ColumnFacetFilter
              label={ui.ccMismatch.asnOrg}
              field="asn_org"
              tableType="cc-mismatch"
              selectedValues={getMultiFilterValues(filters, 'asn_org')}
              contextFilters={facetContext('asn_org')}
              compact
              onChange={(values) => setFilters((prev) => setMultiFilter(prev, 'asn_org', values))}
              onClear={() => setFilters((prev) => setMultiFilter(prev, 'asn_org', []))}
            />
          ),
        },
      },
      {
        accessorKey: 'grchcCc',
        header: ui.ccMismatch.grchcCc,
        meta: {
          sortable: true,
          headerFilter: (
            <ColumnTextFilter
              placeholder={ui.ccMismatch.grchcCc}
              value={getTextFilterValue(filters, 'grchc_cc')}
              onApply={(value) => applyTextFilter('grchc_cc', value)}
              onClear={() => clearTextFilter('grchc_cc')}
            />
          ),
        },
      },
      {
        accessorKey: 'rirCc',
        header: ui.ccMismatch.rirCc,
        meta: {
          sortable: true,
          headerFilter: (
            <ColumnTextFilter
              placeholder={ui.ccMismatch.rirCc}
              value={getTextFilterValue(filters, 'rir_cc')}
              onApply={(value) => applyTextFilter('rir_cc', value)}
              onClear={() => clearTextFilter('rir_cc')}
            />
          ),
        },
      },
      {
        accessorKey: 'registry',
        header: ui.ccMismatch.registry,
        meta: {
          sortable: true,
          headerFilter: (
            <ColumnTextFilter
              placeholder={ui.ccMismatch.registry}
              value={getTextFilterValue(filters, 'registry')}
              onApply={(value) => applyTextFilter('registry', value)}
              onClear={() => clearTextFilter('registry')}
            />
          ),
        },
      },
    ],
    [filters, applyTextFilter, clearTextFilter, facetContext],
  );

  const loadMore = useCallback(() => {
    if (rowCapReached) return;
    if (tableQuery.hasNextPage && !tableQuery.isFetchingNextPage) {
      void tableQuery.fetchNextPage();
    }
  }, [rowCapReached, tableQuery]);

  const status = stateQuery.data?.status ?? 'never';

  useEffect(() => {
    if (status === 'ready') {
      void queryClient.invalidateQueries({ queryKey: ['cc-mismatch-table'] });
    }
  }, [status, queryClient]);

  const showStatusBanner = status !== 'ready';
  const statusLabel =
    status === 'running'
      ? ui.ccMismatch.statusRunning
      : status === 'failed'
        ? ui.ccMismatch.statusFailed
        : ui.ccMismatch.statusNever;

  const statusBannerClass =
    status === 'running'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-900'
      : status === 'failed'
        ? 'border-red-500/40 bg-red-500/10 text-red-900'
        : 'border-border bg-muted/40 text-foreground';

  const emptyMessage = (() => {
    if (status === 'never') return ui.ccMismatch.emptyNever;
    if (status === 'running') return ui.ccMismatch.emptyRunning;
    if (status === 'failed') {
      return stateQuery.data?.lastError
        ? `${ui.ccMismatch.emptyFailed} ${stateQuery.data.lastError}`
        : ui.ccMismatch.emptyFailed;
    }
    if (rows.length === 0 && !tableQuery.isLoading) return ui.ccMismatch.emptyReady;
    return undefined;
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 space-y-2">
        <div>
          <h1 className="text-lg font-semibold">{ui.ccMismatch.title}</h1>
          <p className="mt-1 text-sm text-muted">{ui.ccMismatch.hint}</p>
        </div>

        {showStatusBanner && (
          <div
            className={cn('rounded border px-3 py-2 text-sm', statusBannerClass)}
            data-testid="cc-mismatch-status"
          >
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span>
                {ui.ccMismatch.statusLabel}:{' '}
                <span className="font-medium">{statusLabel}</span>
              </span>
              <span>
                {ui.ccMismatch.rowCount}:{' '}
                <span className="font-medium">
                  {(stateQuery.data?.rowCount ?? totalRows).toLocaleString('ru')}
                </span>
              </span>
              <span>
                {ui.ccMismatch.rebuiltAt}:{' '}
                <span className="font-medium">{formatDateTime(stateQuery.data?.rebuiltAt)}</span>
              </span>
              {status === 'failed' && (
                <span>
                  {ui.ccMismatch.durationMs}:{' '}
                  <span className="font-medium">
                    {formatDurationMs(stateQuery.data?.durationMs)}
                  </span>
                </span>
              )}
            </div>
            {status === 'never' && (
              <p className="mt-1 text-muted">{ui.ccMismatch.statusNeverHint}</p>
            )}
            {status === 'running' && (
              <p className="mt-1">{ui.ccMismatch.statusRunningHint}</p>
            )}
            {status === 'failed' && (
              <p className="mt-1">
                {ui.ccMismatch.statusFailedHint}{' '}
                {stateQuery.data?.lastError ?? '—'}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col" data-testid="cc-mismatch-table">
        <DataTable
          columns={columns}
          data={rows}
          sorting={sorting}
          onSortingChange={setSorting}
          isLoading={tableQuery.isLoading || (tableQuery.isFetching && rows.length === 0)}
          emptyMessage={emptyMessage}
          fillHeight
          loadedCount={rows.length}
          totalRows={totalRows}
          maxLoadedRows={MAX_LOADED_ROWS}
          rowCapReached={rowCapReached}
          hasMore={hasMore}
          isLoadingMore={tableQuery.isFetchingNextPage}
          onLoadMore={loadMore}
          onNearEnd={loadMore}
          scrollResetKey={`${sortJson}|${filtersJson}`}
        />
      </div>
    </div>
  );
}
