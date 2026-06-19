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
  }
}
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { cn } from '@/lib/utils';

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  isLoading?: boolean;
  totalRows?: number;
}

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
  totalRows,
}: DataTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

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
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 8,
  });

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 text-sm text-muted border-b border-border">
        {isLoading ? 'Загрузка...' : `Показано ${data.length} из ${totalRows ?? data.length}`}
      </div>
      <div ref={parentRef} className="h-[600px] overflow-auto">
        {headerGroup && (
          <div className="sticky top-0 z-20 overflow-visible bg-card border-b border-border">
            <div
              className="grid text-sm font-medium border-b border-border"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {headerGroup.headers.map((header) => (
                <button
                  key={`title-${header.id}`}
                  type="button"
                  className="text-left px-3 py-2 hover:bg-accent truncate"
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                </button>
              ))}
            </div>
            <div
              className="grid overflow-visible text-sm"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {headerGroup.headers.map((header) => (
                <div
                  key={`filter-${header.id}`}
                  className="relative overflow-visible px-2 py-1.5 min-w-0"
                >
                  {header.column.columnDef.meta?.headerFilter ?? null}
                </div>
              ))}
            </div>
          </div>
        )}
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
                className={cn(
                  'grid border-b border-border text-sm hover:bg-accent/50',
                )}
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
                  <div key={cell.id} className="px-3 py-2 truncate" title={formatCell(cell.getValue())}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
