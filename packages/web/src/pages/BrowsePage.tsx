import { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef, type SortingState } from '@tanstack/react-table';
import { api } from '@/lib/api';
import {
  cursorStackStorageKey,
  loadCursorStack,
  saveCursorStack,
  seekBrowsePage,
  type TableCityResponse,
} from '@/lib/browse-pagination';
import {
  needsDeepPageBootstrap,
  shouldWarnOffsetPageJump,
} from '@/lib/browse-sort-hints';
import { DataTable } from '@/components/DataTable';
import { ColumnFacetFilter } from '@/components/ColumnFacetFilter';
import { ColumnTextFilter } from '@/components/ColumnTextFilter';
import { ActiveFiltersBar } from '@/components/ActiveFiltersBar';

interface BrowseSearch {
  page: number;
  pageSize: number;
  sort: string;
  filters: string;
  afterId: number | undefined;
  afterNetwork: string | undefined;
  afterSortValue: string | undefined;
}

const KEYSET_SORT_FIELDS = new Set([
  'network',
  'country_name',
  'city_name',
  'country_iso_code',
  'subdivision_1_name',
]);

function supportsBrowseKeyset(sortJson: string): boolean {
  try {
    const parsed = JSON.parse(sortJson) as Array<{ field: string }>;
    if (parsed.length === 0) return true;
    if (parsed.length === 1) return KEYSET_SORT_FIELDS.has(parsed[0]?.field ?? '');
    return false;
  } catch {
    return true;
  }
}

interface TableFilter {
  field: string;
  op: string;
  value?: string | number | boolean | Array<string | number>;
}

interface TableRow {
  id: number;
  network: string;
  countryIsoCode: string | null;
  countryName: string | null;
  cityName: string | null;
  subdivision1Name: string | null;
  asn: number | null;
  asnOrg: string | null;
  prefixLen: number;
}

const COLUMN_API_FIELDS: Record<string, string> = {
  network: 'network',
  prefixLen: 'prefix_len',
  countryIsoCode: 'country_iso_code',
  countryName: 'country_name',
  cityName: 'city_name',
  subdivision1Name: 'subdivision_1_name',
  asn: 'asn',
  asnOrg: 'asn_org',
};

const API_TO_COLUMN: Record<string, string> = Object.fromEntries(
  Object.entries(COLUMN_API_FIELDS).map(([columnId, apiField]) => [apiField, columnId]),
);

const FILTER_LABELS: Record<string, string> = {
  network: 'Network',
  prefix_len: 'Prefix',
  country_iso_code: 'Country ISO',
  country_name: 'Country',
  city_name: 'Населенный пункт',
  subdivision_1_name: 'Region',
  asn: 'ASN',
  asn_org: 'ASN Org',
};

function parseFilters(filtersJson: string): TableFilter[] {
  try {
    return JSON.parse(filtersJson) as TableFilter[];
  } catch {
    return [];
  }
}

function getMultiFilterValues(filters: TableFilter[], field: string): string[] {
  const multi = filters.find((f) => f.field === field && f.op === 'in');
  if (multi && Array.isArray(multi.value)) {
    return multi.value.map(String);
  }
  const single = filters.find((f) => f.field === field && f.op === 'eq');
  if (single?.value != null && single.value !== '') {
    return [String(single.value)];
  }
  return [];
}

function getTextFilterValue(filters: TableFilter[], field: string): string {
  const match = filters.find(
    (f) =>
      f.field === field &&
      (f.op === 'eq' || f.op === 'startsWith' || f.op === 'contains'),
  );
  if (match?.value != null) return String(match.value);

  const inMatch = filters.find((f) => f.field === field && f.op === 'in');
  if (inMatch && Array.isArray(inMatch.value) && inMatch.value.length === 1) {
    return String(inMatch.value[0]);
  }

  return '';
}

function setMultiFilter(filters: TableFilter[], field: string, values: string[]): TableFilter[] {
  const rest = filters.filter((f) => f.field !== field);
  if (values.length === 0) return rest;
  return [...rest, { field, op: 'in', value: values }];
}

function setTextFilter(filters: TableFilter[], field: string, value: string): TableFilter[] {
  if (!value.trim()) {
    return filters.filter((f) => f.field !== field);
  }

  const trimmed = value.trim();
  const rest = filters.filter((f) => f.field !== field);

  if (field === 'prefix_len') {
    const num = Number(trimmed);
    if (Number.isNaN(num)) return filters;
    return [...rest, { field, op: 'eq', value: num }];
  }

  if (field === 'asn') {
    if (!/^\d+$/.test(trimmed)) return filters;
    return [...rest, { field, op: 'startsWith', value: trimmed }];
  }

  if (field === 'network') {
    return [...rest, { field, op: 'startsWith', value: trimmed }];
  }

  return [...rest, { field, op: 'eq', value: trimmed }];
}

function formatFilterDisplayValue(filter: TableFilter): string {
  if (Array.isArray(filter.value)) {
    if (filter.value.length === 1) return String(filter.value[0]);
    if (filter.value.length === 2) {
      return `${filter.value[0]}, ${filter.value[1]}`;
    }
    return `${filter.value[0]}, ${filter.value[1]} +${filter.value.length - 2}`;
  }
  return String(filter.value ?? '');
}

export function BrowsePage() {
  const search = useSearch({ strict: false }) as BrowseSearch;
  const navigate = useNavigate();
  const cursorStack = useRef<Array<{ afterId: number; afterNetwork: string; afterSortValue?: string } | null>>([null]);
  const [seeking, setSeeking] = useState(false);
  const [pageInput, setPageInput] = useState('');

  const page = search.page ?? 1;
  const pageSize = search.pageSize ?? 50;
  const sortJson = search.sort ?? '[]';
  const filtersJson = search.filters ?? '[]';
  const [bootstrapping, setBootstrapping] = useState(() =>
    needsDeepPageBootstrap(page, sortJson, search.afterId, supportsBrowseKeyset),
  );
  const deepBootstrapStarted = useRef(false);

  const stackKey = useMemo(
    () => cursorStackStorageKey(sortJson, filtersJson, pageSize),
    [sortJson, filtersJson, pageSize],
  );

  useEffect(() => {
    cursorStack.current = loadCursorStack(stackKey);
  }, [stackKey]);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  const activeFilters = useMemo(() => parseFilters(filtersJson), [filtersJson]);

  const activeFilterChips = useMemo(
    () =>
      activeFilters.map((filter) => ({
        field: filter.field,
        label: FILTER_LABELS[filter.field] ?? filter.field,
        displayValue: formatFilterDisplayValue(filter),
      })),
    [activeFilters],
  );

  const sorting: SortingState = useMemo(() => {
    try {
      const parsed = JSON.parse(sortJson) as Array<{ field: string; dir: string }>;
      return parsed.map((s) => ({
        id: API_TO_COLUMN[s.field] ?? s.field,
        desc: s.dir === 'desc',
      }));
    } catch {
      return [];
    }
  }, [sortJson]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    params.set('sort', sortJson);
    params.set('filters', filtersJson);
    if (search.afterId != null) params.set('afterId', String(search.afterId));
    if (search.afterNetwork != null) params.set('afterNetwork', search.afterNetwork);
    if (search.afterSortValue != null) params.set('afterSortValue', search.afterSortValue);
    return params;
  }, [page, pageSize, sortJson, filtersJson, search.afterId, search.afterNetwork, search.afterSortValue]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['table', 'city', page, pageSize, sortJson, filtersJson, search.afterId, search.afterNetwork, search.afterSortValue],
    queryFn: () => api.tableCity(queryParams),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    enabled: !bootstrapping,
  });

  const response = data as {
    rows: TableRow[];
    pagination: { totalRows: number; totalPages: number; page: number };
    meta: {
      queryMs: number;
      countSource?: 'cached' | 'exact' | 'estimated';
      sortHint?: 'slow_full_scan' | null;
      paginationMode?: 'keyset' | 'offset';
      nextCursor?: { afterId: number; afterNetwork?: string; afterSortValue?: string } | null;
    };
  } | undefined;

  const updateSearch = useCallback(
    (updates: Partial<BrowseSearch>) => {
      void navigate({
        to: '/browse/city',
        search: (prev) => {
          const next: BrowseSearch = {
            page: prev.page ?? 1,
            pageSize: prev.pageSize ?? 50,
            sort: prev.sort ?? '[]',
            filters: prev.filters ?? '[]',
            afterId: undefined,
            afterNetwork: undefined,
            afterSortValue: undefined,
            ...updates,
          };
          if ('page' in updates || 'filters' in updates || 'sort' in updates || 'pageSize' in updates) {
            if (!('afterId' in updates)) next.afterId = undefined;
            if (!('afterNetwork' in updates)) next.afterNetwork = undefined;
            if (!('afterSortValue' in updates)) next.afterSortValue = undefined;
          }
          return next;
        },
      });
    },
    [navigate],
  );

  const applyFilters = useCallback(
    (nextFilters: TableFilter[]) => {
      cursorStack.current = [null];
      saveCursorStack(stackKey, cursorStack.current);
      updateSearch({ filters: JSON.stringify(nextFilters), page: 1 });
    },
    [updateSearch, stackKey],
  );

  const removeFilter = useCallback(
    (field: string) => {
      applyFilters(activeFilters.filter((f) => f.field !== field));
    },
    [activeFilters, applyFilters],
  );

  const handleSortingChange = (next: SortingState) => {
    const sort = next.map((s) => ({
      field: COLUMN_API_FIELDS[s.id] ?? s.id,
      dir: s.desc ? 'desc' : 'asc',
    }));
    cursorStack.current = [null];
    saveCursorStack(stackKey, cursorStack.current);
    updateSearch({ sort: JSON.stringify(sort), page: 1 });
  };

  const resetAll = useCallback(() => {
    cursorStack.current = [null];
    saveCursorStack(stackKey, cursorStack.current);
    updateSearch({ filters: '[]', sort: '[]', page: 1, afterId: undefined, afterNetwork: undefined, afterSortValue: undefined });
  }, [updateSearch, stackKey]);

  const goToPage = useCallback(
    async (targetPage: number) => {
      const totalPages = response?.pagination.totalPages ?? 1;
      const clamped = Math.max(1, Math.min(targetPage, totalPages));
      if (clamped === page) return;

      if (clamped === 1) {
        cursorStack.current = [null];
        saveCursorStack(stackKey, cursorStack.current);
        updateSearch({
          page: 1,
          afterId: undefined,
          afterNetwork: undefined,
          afterSortValue: undefined,
        });
        return;
      }

      if (!supportsBrowseKeyset(sortJson)) {
        if (shouldWarnOffsetPageJump(clamped, sortJson, supportsBrowseKeyset)) {
          const proceed = window.confirm(
            'Переход на глубокую страницу без keyset-пагинации может занять несколько секунд. Продолжить?',
          );
          if (!proceed) return;
        }
        updateSearch({ page: clamped });
        return;
      }

      setSeeking(true);
      try {
        const { stack, cursor } = await seekBrowsePage(
          clamped,
          pageSize,
          sortJson,
          filtersJson,
          cursorStack.current,
          (params) => api.tableCity(params) as Promise<TableCityResponse>,
        );
        cursorStack.current = stack;
        saveCursorStack(stackKey, stack);
        updateSearch({
          page: clamped,
          afterId: cursor?.afterId,
          afterNetwork: cursor?.afterNetwork,
          afterSortValue: cursor?.afterSortValue,
        });
      } finally {
        setSeeking(false);
      }
    },
    [page, pageSize, sortJson, filtersJson, stackKey, updateSearch, response?.pagination.totalPages],
  );

  useEffect(() => {
    if (!bootstrapping || deepBootstrapStarted.current) return;
    deepBootstrapStarted.current = true;
    void (async () => {
      setSeeking(true);
      try {
        const { stack, cursor } = await seekBrowsePage(
          page,
          pageSize,
          sortJson,
          filtersJson,
          cursorStack.current,
          (params) => api.tableCity(params) as Promise<TableCityResponse>,
        );
        cursorStack.current = stack;
        saveCursorStack(stackKey, stack);
        updateSearch({
          page,
          afterId: cursor?.afterId,
          afterNetwork: cursor?.afterNetwork,
          afterSortValue: cursor?.afterSortValue,
        });
      } finally {
        setSeeking(false);
        setBootstrapping(false);
      }
    })();
  }, [bootstrapping, page, pageSize, sortJson, filtersJson, stackKey, updateSearch]);

  const showSlowSortBanner =
    response?.meta?.sortHint === 'slow_full_scan' ||
    (response?.meta?.queryMs != null &&
      response.meta.queryMs > 500 &&
      sorting.some((s) => s.id === 'countryName' || s.id === 'cityName'));

  const facetContext = useCallback(
    (excludeField: string) => activeFilters.filter((f) => f.field !== excludeField),
    [activeFilters],
  );

  const columns = useMemo<ColumnDef<TableRow>[]>(
    () => [
      {
        accessorKey: 'network',
        header: 'Network',
        meta: {
          headerFilter: (
            <ColumnTextFilter
              placeholder="Network"
              value={getTextFilterValue(activeFilters, 'network')}
              onApply={(value) => applyFilters(setTextFilter(activeFilters, 'network', value))}
              onClear={() => applyFilters(setTextFilter(activeFilters, 'network', ''))}
            />
          ),
        },
      },
      {
        accessorKey: 'prefixLen',
        header: 'Prefix',
        meta: {
          headerFilter: (
            <ColumnTextFilter
              placeholder="Prefix"
              value={getTextFilterValue(activeFilters, 'prefix_len')}
              onApply={(value) => applyFilters(setTextFilter(activeFilters, 'prefix_len', value))}
              onClear={() => applyFilters(setTextFilter(activeFilters, 'prefix_len', ''))}
            />
          ),
        },
      },
      {
        accessorKey: 'countryIsoCode',
        header: 'Country ISO',
        meta: {
          headerFilter: (
            <ColumnTextFilter
              placeholder="ISO"
              value={getTextFilterValue(activeFilters, 'country_iso_code')}
              onApply={(value) => applyFilters(setTextFilter(activeFilters, 'country_iso_code', value))}
              onClear={() => applyFilters(setTextFilter(activeFilters, 'country_iso_code', ''))}
            />
          ),
        },
      },
      {
        accessorKey: 'countryName',
        header: 'Country',
        meta: {
          headerFilter: (
            <ColumnFacetFilter
              label="Country"
              field="country_name"
              selectedValues={getMultiFilterValues(activeFilters, 'country_name')}
              contextFilters={facetContext('country_name')}
              compact
              onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'country_name', values))}
              onClear={() => applyFilters(setMultiFilter(activeFilters, 'country_name', []))}
            />
          ),
        },
      },
      {
        accessorKey: 'cityName',
        header: 'Населенный пункт',
        meta: {
          headerFilter: (
            <ColumnFacetFilter
              label="Населенный пункт"
              field="city_name"
              selectedValues={getMultiFilterValues(activeFilters, 'city_name')}
              contextFilters={facetContext('city_name')}
              compact
              onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'city_name', values))}
              onClear={() => applyFilters(setMultiFilter(activeFilters, 'city_name', []))}
            />
          ),
        },
      },
      {
        accessorKey: 'subdivision1Name',
        header: 'Region',
        meta: {
          headerFilter: (
            <ColumnFacetFilter
              label="Region"
              field="subdivision_1_name"
              selectedValues={getMultiFilterValues(activeFilters, 'subdivision_1_name')}
              contextFilters={facetContext('subdivision_1_name')}
              compact
              onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'subdivision_1_name', values))}
              onClear={() => applyFilters(setMultiFilter(activeFilters, 'subdivision_1_name', []))}
            />
          ),
        },
      },
      {
        accessorKey: 'asn',
        header: 'ASN',
        meta: {
          headerFilter: (
            <ColumnTextFilter
              placeholder="ASN"
              inputMode="numeric"
              value={getTextFilterValue(activeFilters, 'asn')}
              onApply={(value) => applyFilters(setTextFilter(activeFilters, 'asn', value))}
              onClear={() => applyFilters(setTextFilter(activeFilters, 'asn', ''))}
            />
          ),
        },
      },
      {
        accessorKey: 'asnOrg',
        header: 'ASN Org',
        meta: {
          headerFilter: (
            <ColumnFacetFilter
              label="ASN Org"
              field="asn_org"
              selectedValues={getMultiFilterValues(activeFilters, 'asn_org')}
              contextFilters={facetContext('asn_org')}
              compact
              onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'asn_org', values))}
              onClear={() => applyFilters(setMultiFilter(activeFilters, 'asn_org', []))}
            />
          ),
        },
      },
    ],
    [activeFilters, applyFilters, facetContext],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">City Blocks</h2>
        {response?.meta && (
          <span className="text-sm text-muted">
            Query: {response.meta.queryMs}ms
            {response.meta.countSource === 'cached' ? ' · count cached' : ''}
            {response.meta.paginationMode === 'keyset' ? ' · keyset' : ''}
          </span>
        )}
      </div>

      {showSlowSortBanner && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          Сортировка по стране или городу на полной таблице (~20M строк) может занимать несколько секунд.
          Добавьте фильтр <strong>Country ISO = RU</strong> для ускорения до миллисекунд.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <ActiveFiltersBar filters={activeFilterChips} onRemove={removeFilter} />
        <button
          onClick={resetAll}
          className="px-3 py-1 text-sm border border-border rounded hover:bg-accent"
        >
          Сбросить фильтры
        </button>
      </div>

      <DataTable
        columns={columns}
        data={response?.rows ?? []}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        isLoading={isLoading || isFetching || seeking || bootstrapping}
        totalRows={response?.pagination.totalRows}
      />

      <div className="flex items-center gap-3">
        <button
          disabled={page <= 1}
          onClick={() => {
            const prevPage = page - 1;
            const prevCursor = cursorStack.current[prevPage - 1] ?? undefined;
            cursorStack.current = cursorStack.current.slice(0, prevPage);
            saveCursorStack(stackKey, cursorStack.current);
            if (prevCursor) {
              updateSearch({
                page: prevPage,
                afterId: prevCursor.afterId,
                afterNetwork: prevCursor.afterNetwork,
                afterSortValue: prevCursor.afterSortValue,
              });
            } else {
              updateSearch({ page: prevPage });
            }
          }}
          className="px-3 py-1 border border-border rounded disabled:opacity-50"
        >
          Назад
        </button>
        <span className="text-sm">
          Стр. {page} / {response?.pagination.totalPages ?? 1}
        </span>
        <form
          className="flex items-center gap-1 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const target = Number(pageInput);
            if (!Number.isFinite(target)) return;
            void goToPage(target);
          }}
        >
          <input
            type="number"
            min={1}
            max={response?.pagination.totalPages ?? 1}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            placeholder="#"
            className="w-16 px-2 py-1 bg-card border border-border rounded"
            disabled={seeking}
          />
          <button
            type="submit"
            disabled={seeking}
            className="px-2 py-1 border border-border rounded disabled:opacity-50"
          >
            Перейти
          </button>
        </form>
        <button
          disabled={page >= (response?.pagination.totalPages ?? 1)}
          onClick={() => {
            const nextCursor = response?.meta?.nextCursor;
            if (nextCursor && supportsBrowseKeyset(sortJson)) {
              cursorStack.current[page] = {
                afterId: nextCursor.afterId,
                afterNetwork: nextCursor.afterNetwork ?? '',
                afterSortValue: nextCursor.afterSortValue,
              };
              saveCursorStack(stackKey, cursorStack.current);
              updateSearch({
                page: page + 1,
                afterId: nextCursor.afterId,
                afterNetwork: nextCursor.afterNetwork,
                afterSortValue: nextCursor.afterSortValue,
              });
            } else {
              updateSearch({ page: page + 1 });
            }
          }}
          className="px-3 py-1 border border-border rounded disabled:opacity-50"
        >
          Вперёд
        </button>
        <select
          value={pageSize}
          onChange={(e) => {
            cursorStack.current = [null];
            saveCursorStack(stackKey, cursorStack.current);
            updateSearch({ pageSize: Number(e.target.value), page: 1 });
          }}
          className="px-2 py-1 bg-card border border-border rounded text-sm"
        >
          {[25, 50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n} / стр.
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
