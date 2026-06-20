import { useMemo, useCallback, useState, useEffect, useRef, type ReactNode } from 'react';
import { Link, useSearch, useNavigate } from '@tanstack/react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, type SortingState } from '@tanstack/react-table';
import type { FilterClause, TableBrowseRow, TableResponse } from '@geoip/shared';
import { isUiSortField, validateTextFilterValue, supportsKeysetPagination, usesOffsetOnlySort, normalizeCountryIsoCode } from '@geoip/shared';
import { api } from '@/lib/api';
import { ui } from '@/lib/ui-strings';
import {
  useNormalizeBrowseSearch,
  parseSortJson,
  parseFiltersJson,
  validateBrowseQuery,
  mapBrowseIssuesToFilterFields,
  DEFAULT_BROWSE_SEARCH,
} from '@/lib/table-query-state';
import { DataTable } from '@/components/DataTable';
import { ColumnFacetFilter } from '@/components/ColumnFacetFilter';
import { ColumnTextFilter } from '@/components/ColumnTextFilter';
import { ActiveFiltersBar } from '@/components/ActiveFiltersBar';
import { QueryErrorNotice } from '@/components/QueryErrorNotice';
import { cn } from '@/lib/utils';

const INFINITE_PAGE_SIZE = 100;
const MAX_LOADED_ROWS = 5000;
/** Cap OFFSET pages when sort does not support keyset (asn, multi-sort). */
const MAX_OFFSET_SCROLL_PAGES = 10;

interface BrowseSearch {
  sort: string;
  filters: string;
}

type TableFilter = FilterClause;

type TablePageParam = {
  page: number;
  afterId?: number;
  afterNetwork?: string;
  afterSortValue?: string;
};

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
    return [...rest, { field, op: 'eq', value: num }];
  }

  if (field === 'asn') {
    return [...rest, { field, op: 'startsWith', value: trimmed }];
  }

  if (field === 'network') {
    return [...rest, { field, op: 'startsWith', value: trimmed }];
  }

  if (field === 'country_iso_code') {
    return [...rest, { field, op: 'eq', value: normalizeCountryIsoCode(trimmed) }];
  }

  return [...rest, { field, op: 'eq', value: trimmed }];
}

function expandFilterChips(filters: TableFilter[]) {
  const chips: Array<{
    id: string;
    field: string;
    label: string;
    displayValue: string;
    removeValue?: string;
  }> = [];

  for (const filter of filters) {
    const label = ui.filters[filter.field as keyof typeof ui.filters] ?? filter.field;
    if (filter.op === 'in' && Array.isArray(filter.value)) {
      for (const value of filter.value) {
        const text = String(value);
        chips.push({
          id: `${filter.field}:${text}`,
          field: filter.field,
          label,
          displayValue: text,
          removeValue: text,
        });
      }
      continue;
    }
    chips.push({
      id: filter.field,
      field: filter.field,
      label,
      displayValue: formatFilterDisplayValue(filter),
    });
  }

  return chips;
}

function removeMultiFilterValue(filters: TableFilter[], field: string, value: string): TableFilter[] {
  return filters.flatMap((filter) => {
    if (filter.field !== field) return [filter];
    if (filter.op === 'in' && Array.isArray(filter.value)) {
      const next = filter.value.filter((entry) => String(entry) !== value);
      if (next.length === 0) return [];
      if (next.length === 1) return [{ field, op: 'eq' as const, value: next[0] }];
      return [{ field, op: 'in' as const, value: next }];
    }
    if (filter.op === 'eq' && String(filter.value) === value) return [];
    return [filter];
  });
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

async function fetchTableChunk(
  tableType: 'city' | 'country',
  pageParam: TablePageParam | undefined,
  sortJson: string,
  filtersJson: string,
  signal?: AbortSignal,
): Promise<TableResponse> {
  const params = new URLSearchParams();
  params.set('pageSize', String(INFINITE_PAGE_SIZE));
  params.set('sort', sortJson);
  params.set('filters', filtersJson);
  params.set('page', String(pageParam?.page ?? 1));
  if (pageParam?.afterId != null) params.set('afterId', String(pageParam.afterId));
  if (pageParam?.afterNetwork != null) params.set('afterNetwork', pageParam.afterNetwork);
  if (pageParam?.afterSortValue != null) params.set('afterSortValue', pageParam.afterSortValue);
  return api.table(tableType, params, signal);
}

interface BrowsePageProps {
  tableType: 'city' | 'country';
}

export function BrowsePage({ tableType }: BrowsePageProps) {
  const search = useSearch({ strict: false }) as BrowseSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const browsePath = tableType === 'city' ? '/browse/city' : '/browse/country';
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** Bumps on full reset so header filters drop local draft/validation state. */
  const [browseUiKey, setBrowseUiKey] = useState(0);
  /** Gates table fetch until city/country tab switch reset has applied default URL. */
  const [browseSessionReady, setBrowseSessionReady] = useState(true);
  const prevTableTypeRef = useRef(tableType);
  const pendingTabResetRef = useRef(false);
  const datasetFingerprintRef = useRef<string | null | undefined>(undefined);

  const sortJson = search.sort ?? DEFAULT_BROWSE_SEARCH.sort;
  const filtersJson = search.filters ?? DEFAULT_BROWSE_SEARCH.filters;

  /** Reset browse state only when switching city ↔ country tabs. */
  useEffect(() => {
    if (prevTableTypeRef.current === tableType) return;
    prevTableTypeRef.current = tableType;
    pendingTabResetRef.current = true;
    setBrowseSessionReady(false);
    setFieldErrors({});
    setBrowseUiKey((k) => k + 1);
    queryClient.removeQueries({ queryKey: ['table'] });
    void navigate({
      to: browsePath,
      search: DEFAULT_BROWSE_SEARCH,
      replace: true,
    });
  }, [tableType, browsePath, navigate, queryClient]);

  useEffect(() => {
    if (!pendingTabResetRef.current) {
      setBrowseSessionReady(true);
      return;
    }
    const isDefault =
      sortJson === DEFAULT_BROWSE_SEARCH.sort && filtersJson === DEFAULT_BROWSE_SEARCH.filters;
    if (isDefault) {
      pendingTabResetRef.current = false;
      setBrowseSessionReady(true);
    }
  }, [sortJson, filtersJson]);

  const { data: dataset } = useQuery({
    queryKey: ['dataset'],
    queryFn: api.dataset,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const fingerprint = dataset?.datasetFingerprint ?? null;
    if (datasetFingerprintRef.current === undefined) {
      datasetFingerprintRef.current = fingerprint;
      return;
    }
    if (fingerprint != null && datasetFingerprintRef.current !== fingerprint) {
      queryClient.invalidateQueries({ queryKey: ['table'] });
      queryClient.invalidateQueries({ queryKey: ['facet'] });
    }
    datasetFingerprintRef.current = fingerprint;
  }, [dataset?.datasetFingerprint, queryClient]);

  useNormalizeBrowseSearch(tableType, browsePath, sortJson, filtersJson, (opts) => {
    void navigate(opts);
  });

  const activeFilters = useMemo(() => parseFiltersJson(filtersJson), [filtersJson]);
  const activeSort = useMemo(() => parseSortJson(sortJson), [sortJson]);
  const keysetCapableSort = useMemo(() => supportsKeysetPagination(activeSort), [activeSort]);
  const offsetOnlySort = useMemo(() => usesOffsetOnlySort(activeSort), [activeSort]);

  const activeFilterChips = useMemo(() => expandFilterChips(activeFilters), [activeFilters]);

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

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey: ['table', tableType, 'infinite', sortJson, filtersJson],
    queryFn: ({ pageParam, signal }) =>
      fetchTableChunk(tableType, pageParam, sortJson, filtersJson, signal),
    initialPageParam: undefined as TablePageParam | undefined,
    enabled: browseSessionReady,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.rows.length, 0);
      if (loaded >= MAX_LOADED_ROWS) return undefined;
      if (loaded >= lastPage.pagination.totalRows) return undefined;
      if (lastPage.rows.length < INFINITE_PAGE_SIZE) return undefined;

      const nextPage = lastPage.pagination.page + 1;
      const cursor = lastPage.meta.nextCursor;

      if (cursor) {
        return {
          page: nextPage,
          afterId: cursor.afterId,
          afterNetwork: cursor.afterNetwork,
          afterSortValue: cursor.afterSortValue,
        };
      }

      if (keysetCapableSort) {
        return undefined;
      }

      if (offsetOnlySort && lastPage.pagination.page >= MAX_OFFSET_SCROLL_PAGES) {
        return undefined;
      }

      return { page: nextPage };
    },
    staleTime: 30_000,
  });

  const rows = useMemo(() => data?.pages.flatMap((page) => page.rows) ?? [], [data]);
  const rowCapReached = rows.length >= MAX_LOADED_ROWS;
  const effectiveHasMore = Boolean(hasNextPage) && !rowCapReached;
  const totalRows = data?.pages[0]?.pagination.totalRows ?? 0;
  const countSource =
    data?.pages && data.pages.length > 0
      ? (data.pages[data.pages.length - 1]?.meta.countSource ?? 'exact')
      : 'exact';
  const lastPageMeta = data?.pages[data.pages.length - 1]?.meta;

  const commitBrowseSearch = useCallback(
    (nextSortJson: string, nextFiltersJson: string) => {
      const validated = validateBrowseQuery(tableType, nextSortJson, nextFiltersJson);
      if (!validated.ok) {
        setFieldErrors(mapBrowseIssuesToFilterFields(nextFiltersJson, validated.issues));
        return false;
      }
      setFieldErrors({});
      void navigate({
        to: browsePath,
        search: {
          sort: validated.sortJson,
          filters: validated.filtersJson,
        },
      });
      return true;
    },
    [browsePath, navigate, tableType],
  );

  const applyFilters = useCallback(
    (nextFilters: TableFilter[]) => {
      commitBrowseSearch(sortJson, JSON.stringify(nextFilters));
    },
    [commitBrowseSearch, sortJson],
  );

  const setFieldError = useCallback((field: string, message: string | undefined) => {
    setFieldErrors((prev) => {
      if (!message) {
        if (!(field in prev)) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return { ...prev, [field]: message };
    });
  }, []);

  const applyTextFilter = useCallback(
    (field: string, value: string) => {
      const err = validateTextFilterValue(field, value);
      if (err) {
        setFieldError(field, err);
        return;
      }
      setFieldError(field, undefined);
      applyFilters(setTextFilter(activeFilters, field, value));
    },
    [activeFilters, applyFilters, setFieldError],
  );

  const clearTextFilter = useCallback(
    (field: string) => {
      setFieldError(field, undefined);
      applyFilters(setTextFilter(activeFilters, field, ''));
    },
    [activeFilters, applyFilters, setFieldError],
  );

  const columnMeta = useCallback(
    (apiField: string, filter: ReactNode | (() => ReactNode)) => ({
      sortable: isUiSortField(tableType, apiField),
      ...(typeof filter === 'function'
        ? { renderHeaderFilter: filter }
        : { headerFilter: filter }),
    }),
    [tableType],
  );

  const removeFilter = useCallback(
    (field: string, removeValue?: string) => {
      if (removeValue != null) {
        applyFilters(removeMultiFilterValue(activeFilters, field, removeValue));
        return;
      }
      applyFilters(activeFilters.filter((f) => f.field !== field));
    },
    [activeFilters, applyFilters],
  );

  const handleSortingChange = (next: SortingState) => {
    const sort = next.map((s) => ({
      field: COLUMN_API_FIELDS[s.id] ?? s.id,
      dir: s.desc ? 'desc' : 'asc',
    }));
    commitBrowseSearch(JSON.stringify(sort), filtersJson);
  };

  const resetAll = useCallback(() => {
    setFieldErrors({});
    setBrowseUiKey((k) => k + 1);
    queryClient.removeQueries({ queryKey: ['table'] });
    void navigate({
      to: browsePath,
      search: DEFAULT_BROWSE_SEARCH,
      replace: true,
    });
  }, [browsePath, navigate, queryClient]);

  const loadMore = useCallback(() => {
    if (rowCapReached) return;
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, rowCapReached]);

  const showSlowSortBanner =
    lastPageMeta?.sortHint === 'slow_full_scan' ||
    (lastPageMeta?.queryMs != null &&
      lastPageMeta.queryMs > 500 &&
      sorting.some(
        (s) =>
          s.id === 'countryName' || (tableType === 'city' && s.id === 'cityName'),
      ));

  const showRuPartialSortBanner =
    tableType === 'city' && lastPageMeta?.sortOverrideHint === 'ru_partial_network';

  const showOffsetOnlyBanner = offsetOnlySort && lastPageMeta?.paginationWarning === 'offset_only';
  const showEstimatedCountBanner = countSource === 'estimated' && rows.length > 0;

  const facetContext = useCallback(
    (excludeField: string) => activeFilters.filter((f) => f.field !== excludeField),
    [activeFilters],
  );

  const columns = useMemo<ColumnDef<TableBrowseRow>[]>(() => {
    const base: ColumnDef<TableBrowseRow>[] = [
      {
        accessorKey: 'network',
        header: ui.filters.network,
        meta: columnMeta(
          'network',
          <ColumnTextFilter
            placeholder={ui.filters.network}
            value={getTextFilterValue(activeFilters, 'network')}
            onApply={(value) => applyTextFilter('network', value)}
            onClear={() => clearTextFilter('network')}
          />,
        ),
      },
      {
        accessorKey: 'prefixLen',
        header: ui.filters.prefix_len,
        meta: columnMeta('prefix_len', () => (
          <ColumnTextFilter
            placeholder={ui.filters.prefix_len}
            value={getTextFilterValue(activeFilters, 'prefix_len')}
            error={fieldErrors.prefix_len}
            validate={(v) => validateTextFilterValue('prefix_len', v)}
            onValidationError={(msg) => setFieldError('prefix_len', msg)}
            onApply={(value) => applyTextFilter('prefix_len', value)}
            onClear={() => clearTextFilter('prefix_len')}
          />
        )),
      },
      {
        accessorKey: 'countryIsoCode',
        header: ui.filters.country_iso_code,
        meta: columnMeta(
          'country_iso_code',
          <ColumnTextFilter
            placeholder="ISO"
            value={getTextFilterValue(activeFilters, 'country_iso_code')}
            onApply={(value) => applyTextFilter('country_iso_code', value)}
            onClear={() => clearTextFilter('country_iso_code')}
          />,
        ),
      },
      {
        accessorKey: 'countryName',
        header: ui.filters.country_name,
        meta: columnMeta(
          'country_name',
          <ColumnFacetFilter
            label={ui.filters.country_name}
            field="country_name"
            tableType={tableType}
            selectedValues={getMultiFilterValues(activeFilters, 'country_name')}
            contextFilters={facetContext('country_name')}
            compact
            onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'country_name', values))}
            onClear={() => applyFilters(setMultiFilter(activeFilters, 'country_name', []))}
          />,
        ),
      },
    ];

    if (tableType === 'city') {
      base.push({
        accessorKey: 'cityName',
        header: ui.filters.city_name,
        meta: columnMeta(
          'city_name',
          <ColumnFacetFilter
            label={ui.filters.city_name}
            field="city_name"
            tableType={tableType}
            selectedValues={getMultiFilterValues(activeFilters, 'city_name')}
            contextFilters={facetContext('city_name')}
            compact
            onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'city_name', values))}
            onClear={() => applyFilters(setMultiFilter(activeFilters, 'city_name', []))}
          />,
        ),
      });
    }

    base.push(
      {
        accessorKey: 'subdivision1Name',
        header: ui.filters.subdivision_1_name,
        meta: columnMeta(
          'subdivision_1_name',
          <ColumnFacetFilter
            label={ui.filters.subdivision_1_name}
            field="subdivision_1_name"
            tableType={tableType}
            selectedValues={getMultiFilterValues(activeFilters, 'subdivision_1_name')}
            contextFilters={facetContext('subdivision_1_name')}
            compact
            onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'subdivision_1_name', values))}
            onClear={() => applyFilters(setMultiFilter(activeFilters, 'subdivision_1_name', []))}
          />,
        ),
      },
      {
        accessorKey: 'asn',
        header: ui.filters.asn,
        meta: columnMeta('asn', () => (
          <ColumnTextFilter
            placeholder={ui.filters.asn}
            inputMode="numeric"
            value={getTextFilterValue(activeFilters, 'asn')}
            error={fieldErrors.asn}
            validate={(v) => validateTextFilterValue('asn', v)}
            onValidationError={(msg) => setFieldError('asn', msg)}
            onApply={(value) => applyTextFilter('asn', value)}
            onClear={() => clearTextFilter('asn')}
          />
        )),
      },
      {
        accessorKey: 'asnOrg',
        header: ui.filters.asn_org,
        meta: columnMeta(
          'asn_org',
          <ColumnFacetFilter
            label={ui.filters.asn_org}
            field="asn_org"
            tableType={tableType}
            selectedValues={getMultiFilterValues(activeFilters, 'asn_org')}
            contextFilters={facetContext('asn_org')}
            compact
            resultLimit={200}
            onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'asn_org', values))}
            onClear={() => applyFilters(setMultiFilter(activeFilters, 'asn_org', []))}
          />,
        ),
      },
    );

    return base;
  }, [
    activeFilters,
    applyFilters,
    applyTextFilter,
    clearTextFilter,
    columnMeta,
    facetContext,
    fieldErrors,
    setFieldError,
    tableType,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border p-1 text-sm">
          <Link
            to="/browse/city"
            data-testid="browse-city-tab"
            search={DEFAULT_BROWSE_SEARCH}
            className={cn(
              'rounded px-3 py-1 transition-colors',
              tableType === 'city' ? 'bg-accent font-medium' : 'text-muted hover:text-foreground',
            )}
          >
            {ui.browse.cityTab}
          </Link>
          <Link
            to="/browse/country"
            data-testid="browse-country-tab"
            search={DEFAULT_BROWSE_SEARCH}
            className={cn(
              'rounded px-3 py-1 transition-colors',
              tableType === 'country' ? 'bg-accent font-medium' : 'text-muted hover:text-foreground',
            )}
          >
            {ui.browse.countryTab}
          </Link>
        </div>
        <button
          onClick={resetAll}
          className="rounded border border-border px-3 py-1 text-sm hover:bg-accent"
        >
          {ui.browse.resetFilters}
        </button>
      </div>

      {isError && (
        <div className="shrink-0">
          <QueryErrorNotice error={error} />
        </div>
      )}

      {showSlowSortBanner && (
        <div className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
          {tableType === 'city' ? ui.browse.slowSortBanner : ui.browse.slowSortBannerCountry}
        </div>
      )}

      {showRuPartialSortBanner && (
        <div className="shrink-0 rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-900">
          {ui.browse.ruPartialSortOverrideBanner}
        </div>
      )}

      {showOffsetOnlyBanner && (
        <div className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
          {ui.browse.offsetOnlySortBanner}
        </div>
      )}

      {showEstimatedCountBanner && (
        <div className="shrink-0 rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-900">
          {ui.browse.estimatedCountBanner}
        </div>
      )}

      {fieldErrors._sort && (
        <div className="shrink-0 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-800">
          {fieldErrors._sort}
        </div>
      )}

      {fieldErrors._form && (
        <div className="shrink-0 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-800">
          {fieldErrors._form}
        </div>
      )}

      {Object.keys(fieldErrors).length > 0 && (
        <div className="shrink-0 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-800">
          {Object.entries(fieldErrors)
            .filter(([field]) => !field.startsWith('_'))
            .map(([field, message]) => (
            <p key={field}>
              {ui.filters[field as keyof typeof ui.filters] ?? field}: {message}
            </p>
          ))}
        </div>
      )}

      {activeFilterChips.length > 0 && (
        <div className="shrink-0">
          <ActiveFiltersBar filters={activeFilterChips} onRemove={removeFilter} />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col" data-testid="browse-data-table">
        <DataTable
          key={browseUiKey}
          columns={columns}
          data={rows}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          isLoading={!browseSessionReady || isLoading || (isFetching && rows.length === 0)}
          emptyMessage={isError ? undefined : ui.browse.noResultsFound}
          fillHeight
          loadedCount={rows.length}
          totalRows={totalRows}
          countSource={countSource}
          maxLoadedRows={MAX_LOADED_ROWS}
          rowCapReached={rowCapReached}
          hasMore={effectiveHasMore}
          isLoadingMore={isFetchingNextPage}
          onLoadMore={loadMore}
          onNearEnd={loadMore}
          scrollResetKey={`${sortJson}|${filtersJson}`}
        />
      </div>
    </div>
  );
}
