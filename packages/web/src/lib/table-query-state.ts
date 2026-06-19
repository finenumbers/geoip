import { useEffect, useRef } from 'react';
import type { FilterClause, SortClause } from '@geoip/shared';
import {
  sanitizeFiltersForTableType,
  sanitizeSortForTableType,
} from '@geoip/shared';

/** Default browse URL search — no filters, default sort. */
export const DEFAULT_BROWSE_SEARCH = {
  sort: '[]',
  filters: '[]',
} as const;

export type BrowseSearchParams = {
  sort: string;
  filters: string;
};

export function parseFiltersJson(filtersJson: string): FilterClause[] {
  try {
    return JSON.parse(filtersJson) as FilterClause[];
  } catch {
    return [];
  }
}

export function parseSortJson(sortJson: string): SortClause[] {
  try {
    return JSON.parse(sortJson) as SortClause[];
  } catch {
    return [];
  }
}

export function normalizeBrowseSearch(
  tableType: 'city' | 'country',
  sortJson: string,
  filtersJson: string,
): { sortJson: string; filtersJson: string; changed: boolean } {
  const filters = sanitizeFiltersForTableType(tableType, parseFiltersJson(filtersJson));
  const sort = sanitizeSortForTableType(tableType, parseSortJson(sortJson));
  const nextFiltersJson = JSON.stringify(filters);
  const nextSortJson = JSON.stringify(sort);
  return {
    sortJson: nextSortJson,
    filtersJson: nextFiltersJson,
    changed: nextFiltersJson !== filtersJson || nextSortJson !== sortJson,
  };
}

/** Keeps browse URL aligned with the active table profile (city vs country). */
export function useNormalizeBrowseSearch(
  tableType: 'city' | 'country',
  browsePath: '/browse/city' | '/browse/country',
  sortJson: string,
  filtersJson: string,
  navigate: (opts: {
    to: '/browse/city' | '/browse/country';
    search: { sort: string; filters: string };
    replace?: boolean;
  }) => void,
): void {
  const ran = useRef(false);

  useEffect(() => {
    const normalized = normalizeBrowseSearch(tableType, sortJson, filtersJson);
    if (!normalized.changed) {
      ran.current = true;
      return;
    }
    navigate({
      to: browsePath,
      search: { sort: normalized.sortJson, filters: normalized.filtersJson },
      replace: !ran.current,
    });
    ran.current = true;
  }, [tableType, browsePath, sortJson, filtersJson, navigate]);
}
