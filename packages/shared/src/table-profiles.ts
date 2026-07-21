import type { FilterClause, SortClause } from './api-contracts/index.js';
import {
  CITY_TABLE_SORT_FIELDS,
  COUNTRY_TABLE_SORT_FIELDS,
  RIR_TABLE_SORT_FIELDS,
  ASN_TABLE_SORT_FIELDS,
  FILTER_OPERATORS,
} from './constants.js';

export type TableType = 'city' | 'country' | 'rir' | 'asn';

export type TableProfile = {
  filterFields: readonly string[];
  facetFields: readonly string[];
  sortFields: readonly string[];
  /** Columns that show the sort control in the browse header. */
  uiSortFields: readonly string[];
};

const CITY_TABLE_PROFILE: TableProfile = {
  filterFields: [
    'network',
    'prefix_len',
    'country_iso_code',
    'country_name',
    'city_name',
    'subdivision_1_name',
    'asn',
    'asn_org',
  ],
  facetFields: ['country_name', 'city_name', 'subdivision_1_name', 'asn_org'],
  sortFields: CITY_TABLE_SORT_FIELDS,
  uiSortFields: [
    'network',
    'country_iso_code',
    'country_name',
    'city_name',
    'subdivision_1_name',
  ],
};

const COUNTRY_TABLE_PROFILE: TableProfile = {
  filterFields: [
    'network',
    'prefix_len',
    'country_iso_code',
    'country_name',
    'asn',
    'asn_org',
  ],
  facetFields: ['country_name', 'asn_org'],
  sortFields: COUNTRY_TABLE_SORT_FIELDS,
  uiSortFields: ['network', 'country_iso_code', 'country_name'],
};

const RIR_TABLE_PROFILE: TableProfile = {
  filterFields: [
    'registry',
    'cc',
    'resource_type',
    'status',
    'range_text',
    'network',
    'prefix_len',
    'opaque_id',
    'allocated_at',
  ],
  facetFields: ['registry', 'status', 'resource_type', 'cc'],
  sortFields: RIR_TABLE_SORT_FIELDS,
  uiSortFields: [
    'registry',
    'range_text',
    'cc',
    'status',
    'allocated_at',
    'resource_type',
  ],
};

const ASN_TABLE_PROFILE: TableProfile = {
  filterFields: ['network', 'prefix_len', 'ip_family', 'asn', 'asn_org'],
  facetFields: ['asn_org', 'ip_family'],
  sortFields: ASN_TABLE_SORT_FIELDS,
  uiSortFields: ['network', 'asn', 'asn_org', 'ip_family'],
};

const TABLE_PROFILES: Record<TableType, TableProfile> = {
  city: CITY_TABLE_PROFILE,
  country: COUNTRY_TABLE_PROFILE,
  rir: RIR_TABLE_PROFILE,
  asn: ASN_TABLE_PROFILE,
};

export function getTableProfile(tableType: TableType): TableProfile {
  return TABLE_PROFILES[tableType];
}

export function isUiSortField(tableType: TableType, field: string): boolean {
  return getTableProfile(tableType).uiSortFields.includes(field);
}

export function isAllowedFacetField(tableType: TableType, field: string): boolean {
  return getTableProfile(tableType).facetFields.includes(field);
}

/** Sort fields that support keyset (cursor) pagination on browse. */
export const KEYSET_SORT_FIELDS = [
  'network',
  'prefix_len',
  'country_iso_code',
  'country_name',
  'city_name',
  'subdivision_1_name',
  'registry',
  'range_text',
  'cc',
  'status',
  'allocated_at',
  'resource_type',
] as const;

const KEYSET_SORT_SET = new Set<string>(KEYSET_SORT_FIELDS);

export function supportsKeysetPagination(sort: SortClause[]): boolean {
  if (sort.length === 0) return true;
  if (sort.length === 1 && KEYSET_SORT_SET.has(sort[0]?.field ?? '')) return true;
  return false;
}

/** True when active sort forces OFFSET pagination (asn, multi-sort, etc.). */
export function usesOffsetOnlySort(sort: SortClause[]): boolean {
  return sort.length > 0 && !supportsKeysetPagination(sort);
}

const FILTER_OPS = new Set<string>(FILTER_OPERATORS);

const ASN_FILTER_OPS = new Set(['eq', 'startsWith', 'in']);
const ASN_ORG_FILTER_OPS = new Set(['eq', 'contains', 'startsWith', 'in']);

export function normalizeCountryIsoCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function allowedOpsForFilterField(field: string): Set<string> {
  if (field === 'asn') return ASN_FILTER_OPS;
  if (field === 'asn_org') return ASN_ORG_FILTER_OPS;
  return FILTER_OPS;
}

function validateFilterValueIssues(
  filter: FilterClause,
  index: number,
): TableQueryValidationIssue[] {
  const issues: TableQueryValidationIssue[] = [];
  const valuePath = `filters[${index}].value`;

  if (filter.op === 'in') {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      issues.push({
        path: valuePath,
        message: 'Filter "in" requires a non-empty array',
      });
    }
  }

  if (filter.op === 'between') {
    const values = Array.isArray(filter.value) ? filter.value : [];
    if (values.length < 2) {
      issues.push({
        path: valuePath,
        message: 'Filter "between" requires two values',
      });
    }
  }

  if (
    filter.field === 'prefix_len' &&
    (filter.op === 'eq' || filter.op === 'gte' || filter.op === 'lte')
  ) {
    const num = Number(filter.value);
    if (Number.isNaN(num) || !Number.isInteger(num) || num < 0 || num > 128) {
      issues.push({
        path: valuePath,
        message: 'prefix_len must be an integer from 0 to 128',
      });
    }
  }

  if (filter.field === 'asn' && (filter.op === 'eq' || filter.op === 'startsWith')) {
    const digits = String(filter.value ?? '').trim();
    if (!/^\d+$/.test(digits)) {
      issues.push({
        path: valuePath,
        message: 'asn must contain only digits',
      });
    }
  }

  if (filter.field === 'asn' && filter.op === 'in') {
    const values = Array.isArray(filter.value) ? filter.value : [];
    if (values.some((value) => !/^\d+$/.test(String(value ?? '').trim()))) {
      issues.push({
        path: valuePath,
        message: 'asn in[] values must contain only digits',
      });
    }
  }

  if (filter.field === 'country_iso_code' && filter.op === 'eq' && filter.value != null) {
    const iso = normalizeCountryIsoCode(filter.value);
    if (iso.length !== 2) {
      issues.push({
        path: valuePath,
        message: 'country_iso_code must be a 2-letter ISO code',
      });
    }
  }

  return issues;
}

/** Uppercase country_iso_code filter values for consistent SQL and cache lookup. */
export function normalizeFiltersForQuery(filters: FilterClause[]): FilterClause[] {
  return filters.map((filter) => {
    if (filter.field !== 'country_iso_code') return filter;
    if (filter.op === 'eq' && filter.value != null && filter.value !== '') {
      return { ...filter, value: normalizeCountryIsoCode(filter.value) };
    }
    if (filter.op === 'in' && Array.isArray(filter.value)) {
      return {
        ...filter,
        value: filter.value.map((entry) => normalizeCountryIsoCode(entry)),
      };
    }
    return filter;
  });
}

export type TableQueryValidationIssue = {
  path: string;
  message: string;
};

export function sanitizeFiltersForTableType(
  tableType: TableType,
  filters: FilterClause[],
): FilterClause[] {
  const allowed = new Set(getTableProfile(tableType).filterFields);
  return filters.filter((f) => allowed.has(f.field));
}

export function sanitizeSortForTableType(
  tableType: TableType,
  sort: SortClause[],
): SortClause[] {
  const allowed = new Set(getTableProfile(tableType).sortFields);
  return sort.filter((s) => allowed.has(s.field));
}

export function validateTableQueryProfile(
  tableType: TableType,
  sort: SortClause[],
  filters: FilterClause[],
): { ok: true } | { ok: false; issues: TableQueryValidationIssue[] } {
  const profile = getTableProfile(tableType);
  const allowedFilters = new Set(profile.filterFields);
  const allowedSort = new Set(profile.sortFields);
  const issues: TableQueryValidationIssue[] = [];

  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i];
    if (!filter) continue;
    if (!allowedFilters.has(filter.field)) {
      issues.push({
        path: `filters[${i}].field`,
        message: `Unknown filter field "${filter.field}" for ${tableType} table`,
      });
    } else if (!FILTER_OPS.has(filter.op)) {
      issues.push({
        path: `filters[${i}].op`,
        message: `Unsupported operator "${filter.op}"`,
      });
    } else if (!allowedOpsForFilterField(filter.field).has(filter.op)) {
      issues.push({
        path: `filters[${i}].op`,
        message: `Operator "${filter.op}" is not supported for filter field "${filter.field}"`,
      });
    } else {
      issues.push(...validateFilterValueIssues(filter, i));
    }
  }

  for (let i = 0; i < sort.length; i++) {
    const clause = sort[i];
    if (!clause) continue;
    if (!allowedSort.has(clause.field)) {
      issues.push({
        path: `sort[${i}].field`,
        message: `Unknown sort field "${clause.field}" for ${tableType} table`,
      });
    }
    if (clause.dir !== 'asc' && clause.dir !== 'desc') {
      issues.push({
        path: `sort[${i}].dir`,
        message: `Sort direction must be asc or desc`,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true };
}

/** Client-side validation before applying a text filter. Returns error message or null. */
export function validateTextFilterValue(field: string, rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  if (field === 'prefix_len') {
    const num = Number(trimmed);
    if (Number.isNaN(num) || !Number.isInteger(num) || num < 0 || num > 128) {
      return 'Prefix: целое число от 0 до 128';
    }
  }

  if (field === 'asn') {
    if (!/^\d+$/.test(trimmed)) {
      return 'ASN: только цифры';
    }
  }

  if (field === 'country_iso_code') {
    const iso = normalizeCountryIsoCode(trimmed);
    if (iso.length !== 2) {
      return 'ISO код страны: 2 буквы';
    }
  }

  return null;
}

export function profileValidationToFieldErrors(
  issues: TableQueryValidationIssue[],
): { formErrors: string[]; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const bucket = fieldErrors[issue.path] ?? [];
    bucket.push(issue.message);
    fieldErrors[issue.path] = bucket;
  }
  return { formErrors: [], fieldErrors };
}
