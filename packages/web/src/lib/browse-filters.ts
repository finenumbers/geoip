import type { FilterClause } from '@geoip/shared';
import { normalizeCountryIsoCode } from '@geoip/shared';
import { ui } from '@/lib/ui-strings';

export type TableFilter = FilterClause;

export function getMultiFilterValues(filters: TableFilter[], field: string): string[] {
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

export function getTextFilterValue(filters: TableFilter[], field: string): string {
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

export function setMultiFilter(filters: TableFilter[], field: string, values: string[]): TableFilter[] {
  const rest = filters.filter((f) => f.field !== field);
  if (values.length === 0) return rest;
  return [...rest, { field, op: 'in', value: values }];
}

export function setTextFilter(filters: TableFilter[], field: string, value: string): TableFilter[] {
  if (!value.trim()) {
    return filters.filter((f) => f.field !== field);
  }

  const trimmed = value.trim();
  const rest = filters.filter((f) => f.field !== field);

  if (field === 'prefix_len' || field === 'start_asn' || field === 'asn_count') {
    const num = Number(trimmed);
    return [...rest, { field, op: 'eq', value: num }];
  }

  if (field === 'asn') {
    return [...rest, { field, op: 'startsWith', value: trimmed }];
  }

  if (field === 'host_count') {
    return [...rest, { field, op: 'eq', value: trimmed }];
  }

  if (field === 'network') {
    return [...rest, { field, op: 'startsWith', value: trimmed }];
  }

  if (field === 'country_iso_code') {
    return [...rest, { field, op: 'eq', value: normalizeCountryIsoCode(trimmed) }];
  }

  return [...rest, { field, op: 'eq', value: trimmed }];
}

export function formatFilterDisplayValue(filter: TableFilter): string {
  if (Array.isArray(filter.value)) {
    if (filter.value.length === 1) return String(filter.value[0]);
    if (filter.value.length === 2) {
      return `${filter.value[0]}, ${filter.value[1]}`;
    }
    return `${filter.value[0]}, ${filter.value[1]} +${filter.value.length - 2}`;
  }
  return String(filter.value ?? '');
}

export function expandFilterChips(filters: TableFilter[]) {
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

export function removeMultiFilterValue(
  filters: TableFilter[],
  field: string,
  value: string,
): TableFilter[] {
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
