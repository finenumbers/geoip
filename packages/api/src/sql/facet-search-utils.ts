export type FacetItem = { value: string; count: number };

/** Prefer prefix matches, then higher counts, then alphabetical (ru). */
export function sortFacetItemsBySearch(
  items: FacetItem[],
  search: string,
  limit: number,
): FacetItem[] {
  const needle = search.trim().toLowerCase();
  return [...items]
    .sort((a, b) => {
      if (needle) {
        const aPrefix = a.value.toLowerCase().startsWith(needle) ? 0 : 1;
        const bPrefix = b.value.toLowerCase().startsWith(needle) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      }
      return b.count - a.count || a.value.localeCompare(b.value, 'ru');
    })
    .slice(0, limit);
}

/** SQL ORDER BY for grouped facet queries when user typed a search string. */
export function buildFacetSearchOrderSql(
  search: string,
  valueColumn: string,
  params: unknown[],
): string {
  const trimmed = search.trim();
  if (!trimmed) {
    return 'ORDER BY count DESC, value ASC';
  }
  params.push(`${trimmed}%`);
  const prefixIdx = params.length;
  return `ORDER BY CASE WHEN ${valueColumn} ILIKE $${prefixIdx} THEN 0 ELSE 1 END, count DESC, value ASC`;
}
