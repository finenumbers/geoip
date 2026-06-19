/** Precomputed DENSE_RANK columns on city MVs for fast top-N sort. */

export const RANK_SORT_FIELDS = new Set(['country_name', 'city_name']);

export function usesRankSortField(field: string): boolean {
  return RANK_SORT_FIELDS.has(field);
}

export function rankColumn(field: string, alias: string): string {
  if (field === 'country_name') return `${alias}.country_name_rank`;
  if (field === 'city_name') return `${alias}.city_name_rank`;
  throw new Error(`No rank column for field ${field}`);
}

export function buildRankSortOrder(
  field: string,
  dir: 'asc' | 'desc',
  alias: string,
): string[] {
  const rank = rankColumn(field, alias);
  if (field === 'country_name') {
    return dir === 'desc' ? [`${rank} ASC`, `${alias}.id ASC`] : [`${rank} DESC`, `${alias}.id ASC`];
  }
  return dir === 'asc' ? [`${rank} ASC`, `${alias}.id ASC`] : [`${rank} DESC`, `${alias}.id ASC`];
}

export function buildRankKeysetClause(
  field: string,
  dir: 'asc' | 'desc',
  afterRank: number,
  afterId: number,
  params: unknown[],
  alias: string,
): string {
  const rank = rankColumn(field, alias);
  params.push(afterRank, afterId);
  const rankParam = params.length - 1;
  const idParam = params.length;

  if (field === 'country_name') {
    const op = dir === 'desc' ? '>' : '<';
    return `(${rank}, ${alias}.id) ${op} ($${rankParam}::int, $${idParam})`;
  }

  const op = dir === 'asc' ? '>' : '<';
  return `(${rank}, ${alias}.id) ${op} ($${rankParam}::int, $${idParam})`;
}

export function rankCursorField(field: string): 'countryNameRank' | 'cityNameRank' {
  return field === 'country_name' ? 'countryNameRank' : 'cityNameRank';
}
