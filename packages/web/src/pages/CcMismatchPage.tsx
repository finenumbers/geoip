import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { type ColumnDef, type SortingState } from '@tanstack/react-table';
import { api } from '@/lib/api';
import { ui } from '@/lib/ui-strings';
import { DataTable } from '@/components/DataTable';
import { ColumnTextFilter } from '@/components/ColumnTextFilter';
import { formatDateTime } from '@/lib/format-datetime';
import {
  getTextFilterValue,
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
  rebuiltAt: string;
};

const COLUMN_API_FIELDS: Record<string, string> = {
  network: 'network',
  grchcCc: 'grchc_cc',
  rirCc: 'rir_cc',
  registry: 'registry',
  rangeText: 'range_text',
};

type PageParam = {
  page: number;
  afterId?: number;
  afterSortValue?: string;
};

export function CcMismatchPage() {
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
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 5_000 : 60_000),
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
    ],
    [filters, applyTextFilter, clearTextFilter],
  );

  const loadMore = useCallback(() => {
    if (rowCapReached) return;
    if (tableQuery.hasNextPage && !tableQuery.isFetchingNextPage) {
      void tableQuery.fetchNextPage();
    }
  }, [rowCapReached, tableQuery]);

  const status = stateQuery.data?.status ?? 'never';
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
      <div className="shrink-0">
        <h1 className="text-lg font-semibold">{ui.ccMismatch.title}</h1>
        <p className="mt-1 text-sm text-muted">{ui.ccMismatch.hint}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            {ui.ccMismatch.rowCount}:{' '}
            <span className="font-medium text-foreground">
              {(stateQuery.data?.rowCount ?? totalRows).toLocaleString('ru')}
            </span>
          </span>
          <span>
            {ui.ccMismatch.rebuiltAt}:{' '}
            <span className="font-medium text-foreground">
              {formatDateTime(stateQuery.data?.rebuiltAt)}
            </span>
          </span>
        </div>
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
