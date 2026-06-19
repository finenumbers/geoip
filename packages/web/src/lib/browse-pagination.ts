export type BrowseCursor = {
  afterId: number;
  afterNetwork: string;
  afterSortValue?: string;
} | null;

export function cursorStackStorageKey(
  sortJson: string,
  filtersJson: string,
  pageSize: number,
): string {
  return `geoip:browse-cursor:${sortJson}:${filtersJson}:${pageSize}`;
}

export function loadCursorStack(key: string): BrowseCursor[] {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [null];
    const parsed = JSON.parse(raw) as BrowseCursor[];
    return parsed.length > 0 ? parsed : [null];
  } catch {
    return [null];
  }
}

export function saveCursorStack(key: string, stack: BrowseCursor[]): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(stack));
  } catch {
    // ignore quota errors
  }
}

/** Highest page index in stack with a known cursor (page 1 = index 0 null). */
export function findBestCursorStart(
  stack: BrowseCursor[],
  targetPage: number,
): { startPage: number; cursor: BrowseCursor } {
  if (targetPage <= 1) {
    return { startPage: 1, cursor: null };
  }
  for (let p = targetPage - 1; p >= 1; p--) {
    const cursor = stack[p - 1] ?? null;
    if (cursor != null) {
      return { startPage: p, cursor };
    }
  }
  return { startPage: 1, cursor: null };
}

export function buildBrowseQueryParams(
  page: number,
  pageSize: number,
  sortJson: string,
  filtersJson: string,
  cursor: BrowseCursor,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  params.set('sort', sortJson);
  params.set('filters', filtersJson);
  if (cursor) {
    params.set('afterId', String(cursor.afterId));
    params.set('afterNetwork', cursor.afterNetwork);
    if (cursor.afterSortValue != null) {
      params.set('afterSortValue', cursor.afterSortValue);
    }
  }
  return params;
}

export interface TableCityResponse {
  meta?: {
    nextCursor?: {
      afterId: number;
      afterNetwork?: string;
      afterSortValue?: string;
    } | null;
  };
}

export async function seekBrowsePage(
  targetPage: number,
  pageSize: number,
  sortJson: string,
  filtersJson: string,
  stack: BrowseCursor[],
  fetchPage: (params: URLSearchParams) => Promise<TableCityResponse>,
): Promise<{ stack: BrowseCursor[]; cursor: BrowseCursor }> {
  if (targetPage <= 1) {
    return { stack: [null], cursor: null };
  }

  const { startPage, cursor: startCursor } = findBestCursorStart(stack, targetPage);
  const nextStack = [...stack];
  while (nextStack.length < targetPage) nextStack.push(null);

  let walkPage = startPage;
  let walkCursor: BrowseCursor = startPage === 1 ? null : startCursor;

  while (walkPage < targetPage) {
    const params = buildBrowseQueryParams(
      walkPage,
      pageSize,
      sortJson,
      filtersJson,
      walkCursor,
    );
    const response = await fetchPage(params);
    const next = response.meta?.nextCursor;
    if (!next) break;
    const cursor: BrowseCursor = {
      afterId: next.afterId,
      afterNetwork: next.afterNetwork ?? '',
      afterSortValue: next.afterSortValue,
    };
    nextStack[walkPage] = cursor;
    walkCursor = cursor;
    walkPage++;
  }

  const landingCursor = targetPage === 1 ? null : nextStack[targetPage - 1] ?? null;
  return { stack: nextStack, cursor: landingCursor };
}
