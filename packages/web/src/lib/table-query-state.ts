import { useEffect, useRef } from 'react';
import type { FilterClause, SortClause } from '@geoip/shared';
import {
  normalizeFiltersForQuery,
  sanitizeFiltersForTableType,
  sanitizeSortForTableType,
  validateTableQueryProfile,
  type TableQueryValidationIssue,
  type TableType,
} from '@geoip/shared';

/** Default browse URL search — no filters, default sort. */
export const DEFAULT_BROWSE_SEARCH = {
  sort: '[]',
  filters: '[]',
} as const;

/** TanStack Router may pass JSON search params as parsed objects — keep browse state as JSON strings. */
export function coerceBrowseSearchJsonParam(value: unknown, fallback: string): string {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

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
  tableType: TableType,
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

export type BrowseQueryValidationResult =
  | { ok: true; sortJson: string; filtersJson: string }
  | { ok: false; issues: TableQueryValidationIssue[] };

/** Sanitize profile fields, normalize ISO codes, validate ops/values before URL update. */
export function validateBrowseQuery(
  tableType: TableType,
  sortJson: string,
  filtersJson: string,
): BrowseQueryValidationResult {
  const normalized = normalizeBrowseSearch(tableType, sortJson, filtersJson);
  const sort = parseSortJson(normalized.sortJson);
  const filters = normalizeFiltersForQuery(parseFiltersJson(normalized.filtersJson));
  const validation = validateTableQueryProfile(tableType, sort, filters);
  if (!validation.ok) {
    return validation;
  }
  return {
    ok: true,
    sortJson: JSON.stringify(sort),
    filtersJson: JSON.stringify(filters),
  };
}

/** Maps validation issues to filter field names when possible. */
export function mapBrowseIssuesToFilterFields(
  filtersJson: string,
  issues: TableQueryValidationIssue[],
): Record<string, string> {
  const filters = parseFiltersJson(filtersJson);
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const indexMatch = issue.path.match(/^filters\[(\d+)\]/);
    if (indexMatch) {
      const filter = filters[Number(indexMatch[1])];
      if (filter?.field) {
        fieldErrors[filter.field] = issue.message;
        continue;
      }
    }
    if (issue.path.startsWith('sort[')) {
      fieldErrors._sort = issue.message;
      continue;
    }
    fieldErrors._form = issue.message;
  }
  return fieldErrors;
}

/** Keeps browse URL aligned with the active table profile (city / country / rir). */
export function useNormalizeBrowseSearch(
  tableType: TableType,
  browsePath: '/browse/city' | '/browse/country' | '/browse/rir',
  sortJson: string,
  filtersJson: string,
  navigate: (opts: {
    to: '/browse/city' | '/browse/country' | '/browse/rir';
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
