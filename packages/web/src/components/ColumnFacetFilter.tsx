import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import type { FilterClause } from '@geoip/shared';
import { cn } from '@/lib/utils';
import { ui } from '@/lib/ui-strings';
import { api } from '@/lib/api';

interface FacetItem {
  value: string;
  count: number;
}

interface ColumnFacetFilterProps {
  label: string;
  field: string;
  tableType?: 'city' | 'country' | 'rir' | 'asn' | 'cc-mismatch';
  selectedValues: string[];
  onChange: (values: string[]) => void;
  onClear: () => void;
  contextFilters?: FilterClause[];
  searchRequired?: boolean;
  /** Max facet values returned by API (default 100). */
  resultLimit?: number;
  /** When set, only these facet values are shown (e.g. ipv4/ipv6 on RIR IP). */
  allowedValues?: string[];
  compact?: boolean;
  className?: string;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
}

function formatCount(count: number): string {
  return count.toLocaleString('ru-RU');
}

function selectionLabel(count: number): string {
  if (count === 0) return '';
  if (count === 1) return '1 выбрано';
  return `${count} выбрано`;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function ColumnFacetFilter({
  label,
  field,
  tableType = 'city',
  selectedValues,
  onChange,
  onClear,
  contextFilters = [],
  searchRequired = false,
  resultLimit = 100,
  allowedValues,
  compact = false,
  className,
}: ColumnFacetFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<DropdownPosition>({ top: 0, left: 0, width: 320 });
  const debouncedSearch = useDebouncedValue(search, 300);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['facet', tableType, field, debouncedSearch, contextFilters],
    queryFn: async ({ signal }) => {
      if (tableType === 'cc-mismatch') {
        return api.ccMismatchFacet(field, debouncedSearch, resultLimit, contextFilters, signal);
      }
      return api.facetValues(
        tableType,
        field,
        debouncedSearch,
        resultLimit,
        contextFilters,
        signal,
      );
    },
    enabled: open && (!searchRequired || debouncedSearch.trim().length >= 2),
    staleTime: 60_000,
  });

  const items = (data?.items ?? []).filter(
    (item) => !allowedValues || allowedValues.includes(item.value),
  );
  const facetMeta = data?.meta;

  const updatePosition = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 320),
    });
  };

  const toggleOpen = () => {
    if (!open) {
      updatePosition();
      setOpen(true);
      return;
    }
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleReposition = () => updatePosition();

    document.addEventListener('mousedown', handleClick);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [open]);

  const selectedSet = new Set(selectedValues);
  const hasSelection = selectedValues.length > 0;

  const toggleValue = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(selectedValues.filter((v) => v !== value));
      return;
    }
    onChange([...selectedValues, value]);
  };

  const dropdown = open
    ? createPortal(
        <div
          ref={panelRef}
          className="rounded-lg border border-border bg-card shadow-xl"
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            width: position.width,
            zIndex: 9999,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="p-2 border-b border-border">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Поиск ${label}...`}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              autoFocus
            />
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {searchRequired && debouncedSearch.trim().length < 2 ? (
              <div className="px-3 py-2 text-sm text-muted">Введите минимум 2 символа для поиска</div>
            ) : isError ? (
              <div className="px-3 py-2 text-sm text-red-600">Не удалось загрузить значения</div>
            ) : isLoading || isFetching ? (
              <div className="px-3 py-2 text-sm text-muted">Загрузка...</div>
            ) : items.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted">Ничего не найдено</div>
            ) : (
              items.map((item) => {
                const checked = selectedSet.has(item.value);
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-primary/10',
                      checked && 'bg-primary/15',
                    )}
                    onClick={() => toggleValue(item.value)}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs',
                        checked
                          ? 'border-primary bg-primary text-white'
                          : 'border-border bg-background text-transparent',
                      )}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.value}</span>
                    <span className="shrink-0 text-muted tabular-nums">
                      ({facetMeta?.source === 'sample' ? '~' : ''}
                      {formatCount(item.count)})
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {!debouncedSearch && items.length >= resultLimit && (
            <div className="border-t border-border px-3 py-2 text-xs text-muted">
              Показаны топ-{resultLimit}. Уточните поиск, чтобы найти остальные.
            </div>
          )}

          {facetMeta?.source === 'sample' && (
            <div className="border-t border-border px-3 py-2 text-xs text-sky-900">
              {ui.browse.facetSampleBanner}
              {facetMeta.sampledRows != null
                ? ` (${facetMeta.sampledRows.toLocaleString('ru-RU')} строк).`
                : ''}
            </div>
          )}

          {facetMeta?.timedOut && (
            <div className="border-t border-border px-3 py-2 text-xs text-amber-800">
              {ui.browse.facetSampleTimedOut}
            </div>
          )}

          {hasSelection && (
            <div className="border-t border-border p-2">
              <button
                type="button"
                className="w-full rounded-md px-3 py-1.5 text-left text-sm text-primary hover:bg-accent"
                onClick={() => {
                  onClear();
                  setSearch('');
                }}
              >
                Очистить «{label}»
              </button>
            </div>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={rootRef} className={cn('relative min-w-0', compact ? 'w-full' : 'min-w-[220px]', className)}>
      <div
        className={cn(
          'flex items-center gap-1 rounded-md border bg-card text-sm',
          hasSelection ? 'border-primary/50' : 'border-border',
        )}
      >
        <button
          type="button"
          className={cn(
            'flex min-w-0 flex-1 items-center justify-between gap-2 text-left',
            compact ? 'px-2 py-1.5' : 'px-3 py-2',
          )}
          onClick={(e) => {
            e.stopPropagation();
            toggleOpen();
          }}
        >
          <span
            className={cn(
              'truncate',
              hasSelection ? 'text-foreground' : 'font-bold text-muted',
            )}
          >
            {hasSelection ? selectionLabel(selectedValues.length) : label}
          </span>
          <span className="shrink-0 text-muted text-xs">↕</span>
        </button>
        {hasSelection && (
          <button
            type="button"
            className="mr-2 shrink-0 rounded p-1 text-muted hover:bg-accent hover:text-foreground"
            aria-label={`Очистить ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            ×
          </button>
        )}
      </div>
      {dropdown}
    </div>
  );
}
