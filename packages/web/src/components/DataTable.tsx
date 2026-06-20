import type { ReactNode } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    headerFilter?: ReactNode;
    /** Prefer over headerFilter when filter UI depends on live React state. */
    renderHeaderFilter?: () => ReactNode;
    sortable?: boolean;
  }
}
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  isLoading?: boolean;
  fillHeight?: boolean;
  loadedCount?: number;
  totalRows?: number;
  countSource?: 'exact' | 'estimated' | 'cached';
  maxLoadedRows?: number;
  rowCapReached?: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  onNearEnd?: () => void;
  /** When changed, scroll body back to top (e.g. sort/filter change). */
  scrollResetKey?: string;
  emptyMessage?: string;
}

const ROW_HEIGHT = 40;

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

export function DataTable<T>({
  columns,
  data,
  sorting,
  onSortingChange,
  isLoading,
  fillHeight = false,
  loadedCount = 0,
  totalRows = 0,
  countSource = 'exact',
  maxLoadedRows,
  rowCapReached = false,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  onNearEnd,
  scrollResetKey,
  emptyMessage,
}: DataTableProps<T>) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const nearEndLock = useRef(false);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      onSortingChange(next);
    },
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
    defaultColumn: {
      cell: ({ getValue }) => formatCell(getValue()),
    },
  });

  const rows = table.getRowModel().rows;
  const headerGroup = table.getHeaderGroups()[0];
  const gridTemplate = `repeat(${headerGroup?.headers.length ?? 1}, minmax(120px, 1fr))`;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const requestMore = useCallback(() => {
    if (!onNearEnd || nearEndLock.current || isLoadingMore || !hasMore) return;
    nearEndLock.current = true;
    onNearEnd();
    window.setTimeout(() => {
      nearEndLock.current = false;
    }, 400);
  }, [onNearEnd, isLoadingMore, hasMore]);

  const ensureViewportFilled = useCallback(() => {
    const el = bodyRef.current;
    if (!el || isLoading) return;
    const needsMore = el.scrollHeight <= el.clientHeight + ROW_HEIGHT;
    if (needsMore) {
      requestMore();
    }
  }, [isLoading, requestMore]);

  const checkNearEnd = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < ROW_HEIGHT * 2) {
      requestMore();
    }
  }, [requestMore]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [scrollResetKey]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkNearEnd, { passive: true });
    return () => el.removeEventListener('scroll', checkNearEnd);
  }, [checkNearEnd]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      ensureViewportFilled();
      checkNearEnd();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data.length, ensureViewportFilled, checkNearEnd, isLoadingMore, hasMore]);

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-border bg-card',
        fillHeight && 'min-h-0 flex-1',
      )}
    >
      {headerGroup && (
        <div className="shrink-0 border-b border-border bg-card">
          <div className="grid overflow-visible text-sm" style={{ gridTemplateColumns: gridTemplate }}>
            {headerGroup.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              const sortable = header.column.columnDef.meta?.sortable === true;
              return (
                <div
                  key={header.id}
                  className="relative flex min-w-0 items-start gap-1 overflow-visible px-2 py-2"
                >
                  <div className="min-w-0 flex-1">
                    {header.column.columnDef.meta?.renderHeaderFilter?.() ??
                      header.column.columnDef.meta?.headerFilter ??
                      null}
                  </div>
                  {sortable && (
                    <button
                      type="button"
                      className={cn(
                        'shrink-0 rounded p-1 text-xs hover:bg-accent',
                        sorted ? 'text-foreground' : 'text-muted',
                      )}
                      title="Сортировка"
                      aria-label={`Сортировка ${String(header.column.columnDef.header ?? header.id)}`}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div
        ref={bodyRef}
        className={cn('min-h-0 overflow-auto', fillHeight ? 'flex-1' : 'h-[600px]')}
      >
        {isLoading && data.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">Загрузка...</div>
        ) : data.length === 0 && emptyMessage ? (
          <div className="px-4 py-6 text-sm text-muted">{emptyMessage}</div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: 'relative',
              width: '100%',
            }}
          >
            {virtualizer.getVirtualItems().map((vRow) => {
              const row = rows[vRow.index];
              if (!row) return null;
              return (
                <div
                  key={row.id}
                  className={cn('grid border-b border-border text-sm hover:bg-accent/50')}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${vRow.size}px`,
                    transform: `translateY(${vRow.start}px)`,
                    gridTemplateColumns: gridTemplate,
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <div
                      key={cell.id}
                      className="truncate px-3 py-2"
                      title={formatCell(cell.getValue())}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-card px-4 py-2 text-sm">
        <span className="text-muted">
          Загружено {loadedCount.toLocaleString('ru-RU')} из{' '}
          {countSource === 'estimated' ? '≈' : ''}
          {totalRows.toLocaleString('ru-RU')}
          {countSource === 'estimated' ? ' (оценка, ASN-фильтр)' : ''}
        </span>
        {rowCapReached ? (
          <span className="text-amber-800">
            Показаны первые {maxLoadedRows?.toLocaleString('ru') ?? '5 000'} строк. Уточните фильтры, чтобы
            сузить выборку.
          </span>
        ) : hasMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="text-primary hover:underline disabled:no-underline disabled:opacity-50"
          >
            {isLoadingMore ? 'Загрузка...' : 'Загрузить еще'}
          </button>
        ) : (
          <span className="text-muted">{loadedCount > 0 ? 'Все записи загружены' : ''}</span>
        )}
      </div>
    </div>
  );
}
