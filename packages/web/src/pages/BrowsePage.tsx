import { useMemo, useCallback, useState, useEffect, useRef, type ReactNode } from 'react';
import { Link, useSearch, useNavigate } from '@tanstack/react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef, type SortingState } from '@tanstack/react-table';
import type { TableBrowseRow, TableResponse } from '@geoip/shared';
import { isUiSortField, validateTextFilterValue, supportsKeysetPagination, usesOffsetOnlySort } from '@geoip/shared';
import { api } from '@/lib/api';
import { ui } from '@/lib/ui-strings';
import {
  useNormalizeBrowseSearch,
  parseSortJson,
  parseFiltersJson,
  validateBrowseQuery,
  mapBrowseIssuesToFilterFields,
  DEFAULT_BROWSE_SEARCH,
  defaultRirBrowseSearch,
  ensureRirResourceTypeFilter,
  type BrowsePath,
  type RirBrowseMode,
} from '@/lib/table-query-state';
import { DataTable } from '@/components/DataTable';
import { ColumnFacetFilter } from '@/components/ColumnFacetFilter';
import { ColumnTextFilter } from '@/components/ColumnTextFilter';
import { ActiveFiltersBar } from '@/components/ActiveFiltersBar';
import { QueryErrorNotice } from '@/components/QueryErrorNotice';
import { RirDetailModal } from '@/components/RirDetailModal';
import { cn } from '@/lib/utils';
import {
  expandFilterChips,
  getMultiFilterValues,
  getTextFilterValue,
  removeMultiFilterValue,
  setMultiFilter,
  setTextFilter,
  type TableFilter,
} from '@/lib/browse-filters';
import { useTableExport, formatExportRowLimitBlocked, isExportOverRowLimit } from '@/lib/use-table-export';

const INFINITE_PAGE_SIZE = 100;
const MAX_LOADED_ROWS = 5000;
/** Cap OFFSET pages when sort does not support keyset (asn, multi-sort). */
const MAX_OFFSET_SCROLL_PAGES = 10;

interface BrowseSearch {
  sort: string;
  filters: string;
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
  registry: 'registry',
  resourceType: 'resource_type',
  rangeText: 'range_text',
  cc: 'cc',
  status: 'status',
  allocatedAt: 'allocated_at',
  opaqueId: 'opaque_id',
  ipFamily: 'ip_family',
  hostCount: 'host_count',
  startAsn: 'start_asn',
  asnCount: 'asn_count',
};

const API_TO_COLUMN: Record<string, string> = Object.fromEntries(
  Object.entries(COLUMN_API_FIELDS).map(([columnId, apiField]) => [apiField, columnId]),
);

type TablePageParam = {
  page: number;
  afterId?: number;
  afterNetwork?: string;
  afterSortValue?: string;
};

async function fetchTableChunk(
  tableType: 'city' | 'country' | 'rir' | 'asn',
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
  tableType: 'city' | 'country' | 'rir' | 'asn';
  /** When tableType is rir: IP (ipv4/ipv6) vs ASN-only view. */
  rirMode?: RirBrowseMode;
}

function browsePathFor(
  tableType: BrowsePageProps['tableType'],
  rirMode?: RirBrowseMode,
): BrowsePath {
  if (tableType === 'country') return '/browse/country';
  if (tableType === 'rir') return rirMode === 'asn' ? '/browse/rir-asn' : '/browse/rir';
  if (tableType === 'asn') return '/browse/asn';
  return '/browse/city';
}

function defaultBrowseSearchFor(
  tableType: BrowsePageProps['tableType'],
  rirMode?: RirBrowseMode,
): { sort: string; filters: string } {
  if (tableType === 'rir' && rirMode) return defaultRirBrowseSearch(rirMode);
  return DEFAULT_BROWSE_SEARCH;
}

export function BrowsePage({ tableType, rirMode }: BrowsePageProps) {
  const search = useSearch({ strict: false }) as BrowseSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const browsePath = browsePathFor(tableType, rirMode);
  const defaultSearch = defaultBrowseSearchFor(tableType, rirMode);
  const sessionKey = `${tableType}:${rirMode ?? ''}`;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [selectedRirRow, setSelectedRirRow] = useState<TableBrowseRow | null>(null);
  /** Bumps on full reset so header filters drop local draft/validation state. */
  const [browseUiKey, setBrowseUiKey] = useState(0);
  /** Gates table fetch until city/country tab switch reset has applied default URL. */
  const [browseSessionReady, setBrowseSessionReady] = useState(true);
  const prevSessionKeyRef = useRef(sessionKey);
  const pendingTabResetRef = useRef(false);
  const datasetFingerprintRef = useRef<string | null | undefined>(undefined);

  const sortJson = search.sort ?? defaultSearch.sort;
  const filtersJson = search.filters ?? defaultSearch.filters;

  /** Reset browse state when switching tabs / RIR modes. */
  useEffect(() => {
    if (prevSessionKeyRef.current === sessionKey) return;
    prevSessionKeyRef.current = sessionKey;
    pendingTabResetRef.current = true;
    setBrowseSessionReady(false);
    setFieldErrors({});
    setBrowseUiKey((k) => k + 1);
    queryClient.removeQueries({ queryKey: ['table'] });
    void navigate({
      to: browsePath,
      search: defaultBrowseSearchFor(tableType, rirMode),
      replace: true,
    });
  }, [sessionKey, browsePath, navigate, queryClient, tableType, rirMode]);

  useEffect(() => {
    if (!pendingTabResetRef.current) {
      setBrowseSessionReady(true);
      return;
    }
    const isDefault = sortJson === defaultSearch.sort && filtersJson === defaultSearch.filters;
    if (isDefault) {
      pendingTabResetRef.current = false;
      setBrowseSessionReady(true);
    }
  }, [sortJson, filtersJson, defaultSearch.sort, defaultSearch.filters]);

  /** Ensure RIR mode always has locked resource_type in the URL. */
  useEffect(() => {
    if (tableType !== 'rir' || !rirMode || !browseSessionReady) return;
    const current = parseFiltersJson(filtersJson);
    const locked = ensureRirResourceTypeFilter(current, rirMode);
    if (JSON.stringify(current) === JSON.stringify(locked)) return;
    void navigate({
      to: browsePath,
      search: { sort: sortJson, filters: JSON.stringify(locked) },
      replace: true,
    });
  }, [tableType, rirMode, filtersJson, sortJson, browsePath, navigate, browseSessionReady]);

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

  const activeFilterChips = useMemo(() => {
    const chips = expandFilterChips(activeFilters);
    if (tableType === 'rir' && rirMode) {
      return chips.filter((chip) => chip.field !== 'resource_type');
    }
    return chips;
  }, [activeFilters, tableType, rirMode]);

  const browseValidation = useMemo(
    () => validateBrowseQuery(tableType, sortJson, filtersJson),
    [tableType, sortJson, filtersJson],
  );

  const { state: exportState, errorMessage: exportError, estimatedRows: exportEstimatedRows, startExport, isBusy: exportBusy } =
    useTableExport();

  const handleExportCsv = useCallback(() => {
    if (!browseValidation.ok) return;
    void startExport(tableType, activeFilters, activeSort);
  }, [activeFilters, activeSort, browseValidation.ok, startExport, tableType]);

  const exportStatusText = useMemo(() => {
    if (exportState === 'submitting' || exportState === 'polling') {
      if (exportEstimatedRows != null) {
        return `${ui.browse.exportInProgress} (~${exportEstimatedRows.toLocaleString('ru-RU')} строк)`;
      }
      return ui.browse.exportInProgress;
    }
    if (exportState === 'downloading') {
      return ui.browse.exportDownloading;
    }
    return null;
  }, [exportEstimatedRows, exportState]);

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
    queryKey: ['table', tableType, rirMode ?? '', 'infinite', sortJson, filtersJson],
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
  const exportMaxRows = dataset?.exportMaxRows ?? 5_000_000;
  const exportOverLimit = isExportOverRowLimit(totalRows, exportMaxRows);
  const exportLimitMessage = exportOverLimit
    ? formatExportRowLimitBlocked(totalRows, exportMaxRows)
    : null;
  const canExport =
    browseSessionReady &&
    browseValidation.ok &&
    Object.keys(fieldErrors).length === 0 &&
    !exportBusy &&
    !exportOverLimit;
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
      const locked =
        tableType === 'rir' && rirMode
          ? ensureRirResourceTypeFilter(nextFilters, rirMode)
          : nextFilters;
      commitBrowseSearch(sortJson, JSON.stringify(locked));
    },
    [commitBrowseSearch, sortJson, tableType, rirMode],
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
      if (tableType === 'rir' && rirMode && field === 'resource_type') return;
      if (removeValue != null) {
        applyFilters(removeMultiFilterValue(activeFilters, field, removeValue));
        return;
      }
      applyFilters(activeFilters.filter((f) => f.field !== field));
    },
    [activeFilters, applyFilters, tableType, rirMode],
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
      search: defaultBrowseSearchFor(tableType, rirMode),
      replace: true,
    });
  }, [browsePath, navigate, queryClient, tableType, rirMode]);

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
    if (tableType === 'asn') {
      return [
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
          accessorKey: 'ipFamily',
          header: ui.filters.ip_family,
          meta: columnMeta(
            'ip_family',
            <ColumnFacetFilter
              label={ui.filters.ip_family}
              field="ip_family"
              tableType="asn"
              selectedValues={getMultiFilterValues(activeFilters, 'ip_family')}
              contextFilters={facetContext('ip_family')}
              compact
              onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'ip_family', values))}
              onClear={() => applyFilters(setMultiFilter(activeFilters, 'ip_family', []))}
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
              tableType="asn"
              selectedValues={getMultiFilterValues(activeFilters, 'asn_org')}
              contextFilters={facetContext('asn_org')}
              compact
              resultLimit={200}
              onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'asn_org', values))}
              onClear={() => applyFilters(setMultiFilter(activeFilters, 'asn_org', []))}
            />,
          ),
        },
      ];
    }

    if (tableType === 'rir') {
      const rangeCol: ColumnDef<TableBrowseRow> = {
        accessorKey: 'rangeText',
        header: ui.filters.range_text,
        meta: columnMeta(
          'range_text',
          <ColumnTextFilter
            placeholder={ui.filters.range_text}
            value={getTextFilterValue(activeFilters, 'range_text')}
            onApply={(value) => applyTextFilter('range_text', value)}
            onClear={() => clearTextFilter('range_text')}
          />,
        ),
      };
      const sharedTail: ColumnDef<TableBrowseRow>[] = [
        {
          accessorKey: 'cc',
          header: ui.filters.cc,
          meta: columnMeta(
            'cc',
            <ColumnFacetFilter
              label={ui.filters.cc}
              field="cc"
              tableType="rir"
              selectedValues={getMultiFilterValues(activeFilters, 'cc')}
              contextFilters={facetContext('cc')}
              compact
              onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'cc', values))}
              onClear={() => applyFilters(setMultiFilter(activeFilters, 'cc', []))}
            />,
          ),
        },
        {
          accessorKey: 'status',
          header: ui.filters.status,
          meta: columnMeta(
            'status',
            <ColumnFacetFilter
              label={ui.filters.status}
              field="status"
              tableType="rir"
              selectedValues={getMultiFilterValues(activeFilters, 'status')}
              contextFilters={facetContext('status')}
              compact
              onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'status', values))}
              onClear={() => applyFilters(setMultiFilter(activeFilters, 'status', []))}
            />,
          ),
        },
        {
          accessorKey: 'allocatedAt',
          header: ui.filters.allocated_at,
          meta: columnMeta(
            'allocated_at',
            <ColumnTextFilter
              placeholder={ui.filters.allocated_at}
              value={getTextFilterValue(activeFilters, 'allocated_at')}
              onApply={(value) => applyTextFilter('allocated_at', value)}
              onClear={() => clearTextFilter('allocated_at')}
            />,
          ),
        },
        {
          accessorKey: 'opaqueId',
          header: ui.filters.opaque_id,
          meta: columnMeta(
            'opaque_id',
            <ColumnTextFilter
              placeholder={ui.filters.opaque_id}
              value={getTextFilterValue(activeFilters, 'opaque_id')}
              onApply={(value) => applyTextFilter('opaque_id', value)}
              onClear={() => clearTextFilter('opaque_id')}
            />,
          ),
        },
        {
          accessorKey: 'registry',
          header: ui.filters.registry,
          meta: columnMeta(
            'registry',
            <ColumnFacetFilter
              label={ui.filters.registry}
              field="registry"
              tableType="rir"
              selectedValues={getMultiFilterValues(activeFilters, 'registry')}
              contextFilters={facetContext('registry')}
              compact
              onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'registry', values))}
              onClear={() => applyFilters(setMultiFilter(activeFilters, 'registry', []))}
            />,
          ),
        },
      ];

      if (rirMode === 'asn') {
        return [
          rangeCol,
          {
            accessorKey: 'startAsn',
            header: ui.filters.start_asn,
            meta: columnMeta('start_asn', () => (
              <ColumnTextFilter
                placeholder={ui.filters.start_asn}
                inputMode="numeric"
                value={getTextFilterValue(activeFilters, 'start_asn')}
                error={fieldErrors.start_asn}
                validate={(v) => validateTextFilterValue('start_asn', v)}
                onValidationError={(msg) => setFieldError('start_asn', msg)}
                onApply={(value) => applyTextFilter('start_asn', value)}
                onClear={() => clearTextFilter('start_asn')}
              />
            )),
          },
          {
            accessorKey: 'asnCount',
            header: ui.filters.asn_count,
            meta: columnMeta('asn_count', () => (
              <ColumnTextFilter
                placeholder={ui.filters.asn_count}
                inputMode="numeric"
                value={getTextFilterValue(activeFilters, 'asn_count')}
                error={fieldErrors.asn_count}
                validate={(v) => validateTextFilterValue('asn_count', v)}
                onValidationError={(msg) => setFieldError('asn_count', msg)}
                onApply={(value) => applyTextFilter('asn_count', value)}
                onClear={() => clearTextFilter('asn_count')}
              />
            )),
          },
          ...sharedTail,
        ];
      }

      // RIR IP (ipv4/ipv6)
      return [
        rangeCol,
        {
          accessorKey: 'resourceType',
          header: ui.filters.resource_type,
          meta: columnMeta(
            'resource_type',
            <ColumnFacetFilter
              label={ui.filters.resource_type}
              field="resource_type"
              tableType="rir"
              selectedValues={getMultiFilterValues(activeFilters, 'resource_type')}
              contextFilters={facetContext('resource_type')}
              allowedValues={['ipv4', 'ipv6']}
              compact
              onChange={(values) => {
                const next = values.filter((v) => v === 'ipv4' || v === 'ipv6');
                applyFilters(
                  setMultiFilter(activeFilters, 'resource_type', next.length ? next : ['ipv4', 'ipv6']),
                );
              }}
              onClear={() =>
                applyFilters(setMultiFilter(activeFilters, 'resource_type', ['ipv4', 'ipv6']))
              }
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
          accessorKey: 'ipFamily',
          header: ui.filters.ip_family,
          meta: columnMeta(
            'ip_family',
            <ColumnFacetFilter
              label={ui.filters.ip_family}
              field="ip_family"
              tableType="rir"
              selectedValues={getMultiFilterValues(activeFilters, 'ip_family')}
              contextFilters={facetContext('ip_family')}
              compact
              onChange={(values) => applyFilters(setMultiFilter(activeFilters, 'ip_family', values))}
              onClear={() => applyFilters(setMultiFilter(activeFilters, 'ip_family', []))}
            />,
          ),
        },
        {
          accessorKey: 'hostCount',
          header: ui.filters.host_count,
          meta: columnMeta(
            'host_count',
            <ColumnTextFilter
              placeholder={ui.filters.host_count}
              value={getTextFilterValue(activeFilters, 'host_count')}
              onApply={(value) => applyTextFilter('host_count', value)}
              onClear={() => clearTextFilter('host_count')}
            />,
          ),
        },
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
        ...sharedTail,
      ];
    }

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
    ];

    const countryNameColumn: ColumnDef<TableBrowseRow> = {
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
    };

    const regionColumn: ColumnDef<TableBrowseRow> = {
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
    };

    if (tableType === 'city') {
      base.push(
        countryNameColumn,
        regionColumn,
        {
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
        },
      );
    } else {
      base.push(countryNameColumn);
    }

    base.push(
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
    rirMode,
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
          <Link
            to="/browse/asn"
            data-testid="browse-asn-tab"
            search={DEFAULT_BROWSE_SEARCH}
            className={cn(
              'rounded px-3 py-1 transition-colors',
              tableType === 'asn' ? 'bg-accent font-medium' : 'text-muted hover:text-foreground',
            )}
          >
            {ui.browse.asnTab}
          </Link>
          <Link
            to="/browse/rir"
            data-testid="browse-rir-ip-tab"
            search={defaultRirBrowseSearch('ip')}
            className={cn(
              'rounded px-3 py-1 transition-colors',
              tableType === 'rir' && rirMode === 'ip'
                ? 'bg-accent font-medium'
                : 'text-muted hover:text-foreground',
            )}
          >
            {ui.browse.rirIpTab}
          </Link>
          <Link
            to="/browse/rir-asn"
            data-testid="browse-rir-asn-tab"
            search={defaultRirBrowseSearch('asn')}
            className={cn(
              'rounded px-3 py-1 transition-colors',
              tableType === 'rir' && rirMode === 'asn'
                ? 'bg-accent font-medium'
                : 'text-muted hover:text-foreground',
            )}
          >
            {ui.browse.rirAsnTab}
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {exportStatusText && (
            <span className="text-sm text-muted" data-testid="browse-export-status">
              {exportStatusText}
            </span>
          )}
          {exportLimitMessage && exportState !== 'error' && (
            <span className="text-sm text-amber-800" data-testid="browse-export-limit-warning">
              {exportLimitMessage}
            </span>
          )}
          {exportState === 'error' && exportError && (
            <span className="text-sm text-red-700" data-testid="browse-export-error">
              {exportError}
            </span>
          )}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!canExport}
            title={exportLimitMessage ?? ui.browse.exportCsvHint}
            data-testid="browse-export-csv"
            className="rounded border border-border px-3 py-1 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ui.browse.exportCsv}
          </button>
          <button
            onClick={resetAll}
            className="rounded border border-border px-3 py-1 text-sm hover:bg-accent"
          >
            {ui.browse.resetFilters}
          </button>
        </div>
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
          onRowClick={tableType === 'rir' ? setSelectedRirRow : undefined}
        />
      </div>

      {tableType === 'rir' && (
        <RirDetailModal row={selectedRirRow} onClose={() => setSelectedRirRow(null)} />
      )}
    </div>
  );
}
