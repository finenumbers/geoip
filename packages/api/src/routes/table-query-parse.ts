export type ParsedJsonArray =
  | { ok: true; value: unknown[] }
  | { ok: false; error: string; path: string };

export function parseJsonArrayParam(raw: unknown, paramName: string): ParsedJsonArray {
  if (raw == null || raw === '') {
    return { ok: true, value: [] };
  }

  if (Array.isArray(raw)) {
    return { ok: true, value: raw };
  }

  if (typeof raw !== 'string') {
    return {
      ok: false,
      error: `Invalid ${paramName} parameter`,
      path: paramName,
    };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        error: `Invalid ${paramName} JSON: expected array`,
        path: paramName,
      };
    }
    return { ok: true, value: parsed };
  } catch {
    return {
      ok: false,
      error: `Invalid ${paramName} JSON`,
      path: paramName,
    };
  }
}

export type ParsedTableQueryInput =
  | {
      ok: true;
      page: unknown;
      pageSize: unknown;
      sort: unknown[];
      filters: unknown[];
      afterId: unknown;
      afterNetwork: unknown;
      afterSortValue: unknown;
    }
  | { ok: false; error: string; path: string };

export function parseTableQueryInput(query: Record<string, unknown>): ParsedTableQueryInput {
  const sortParsed = parseJsonArrayParam(query.sort, 'sort');
  if (!sortParsed.ok) return sortParsed;

  const filtersParsed = parseJsonArrayParam(query.filters, 'filters');
  if (!filtersParsed.ok) return filtersParsed;

  return {
    ok: true,
    page: query.page,
    pageSize: query.pageSize,
    sort: sortParsed.value,
    filters: filtersParsed.value,
    afterId: query.afterId,
    afterNetwork: query.afterNetwork,
    afterSortValue: query.afterSortValue,
  };
}

export function defaultFacetField(tableType: 'city' | 'country'): string {
  return tableType === 'country' ? 'country_name' : 'city_name';
}
