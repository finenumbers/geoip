import type { FilterClause, SortClause } from '@geoip/shared';

export type CcMismatchBuiltQuery = {
  sql: string;
  params: unknown[];
  countSql: string;
  countParams: unknown[];
};

function appendFilter(
  filter: FilterClause,
  params: unknown[],
  clauses: string[],
): void {
  const fieldMap: Record<string, string> = {
    network: 'network::text',
    grchc_cc: 'grchc_cc',
    rir_cc: 'rir_cc',
    registry: 'registry',
    range_text: 'range_text',
  };
  const col = fieldMap[filter.field];
  if (!col) return;

  if (filter.op === 'isNull') {
    clauses.push(`${col} IS NULL`);
    return;
  }
  if (filter.op === 'isNotNull') {
    clauses.push(`${col} IS NOT NULL`);
    return;
  }
  if (filter.op === 'eq') {
    params.push(filter.value);
    clauses.push(`${col} = $${params.length}`);
    return;
  }
  if (filter.op === 'neq') {
    params.push(filter.value);
    clauses.push(`${col} IS DISTINCT FROM $${params.length}`);
    return;
  }
  if (filter.op === 'contains') {
    params.push(`%${String(filter.value ?? '')}%`);
    clauses.push(`${col}::text ILIKE $${params.length}`);
    return;
  }
  if (filter.op === 'startsWith') {
    params.push(`${String(filter.value ?? '')}%`);
    clauses.push(`${col}::text ILIKE $${params.length}`);
    return;
  }
  if (filter.op === 'in' && Array.isArray(filter.value)) {
    params.push(filter.value);
    clauses.push(`${col} = ANY($${params.length})`);
  }
}

const SORT_COLUMNS: Record<string, string> = {
  network: 'network::text',
  grchc_cc: 'grchc_cc',
  rir_cc: 'rir_cc',
  registry: 'registry',
  range_text: 'range_text',
  id: 'id',
};

export function buildCcMismatchTableQuery(options: {
  filters: FilterClause[];
  sort: SortClause[];
  limit: number;
  offset: number;
  afterId?: number;
  afterSortValue?: string;
}): CcMismatchBuiltQuery {
  const where: string[] = [];
  const params: unknown[] = [];

  for (const filter of options.filters) {
    appendFilter(filter, params, where);
  }

  const primarySort = options.sort[0];
  const sortField = primarySort ? (SORT_COLUMNS[primarySort.field] ?? 'network::text') : 'network::text';
  const sortDir = primarySort?.dir === 'desc' ? 'DESC' : 'ASC';
  const nulls = sortDir === 'DESC' ? 'NULLS LAST' : 'NULLS FIRST';

  if (options.afterId != null && options.afterSortValue !== undefined) {
    params.push(options.afterSortValue, options.afterId);
    const op = sortDir === 'DESC' ? '<' : '>';
    where.push(
      `(${sortField}, id) ${op} ($${params.length - 1}::text, $${params.length}::bigint)`,
    );
  } else if (options.afterId != null) {
    params.push(options.afterId);
    where.push(`id > $${params.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countWhere: string[] = [];
  const countOnlyParams: unknown[] = [];
  for (const filter of options.filters) {
    appendFilter(filter, countOnlyParams, countWhere);
  }
  const countWhereSql = countWhere.length > 0 ? `WHERE ${countWhere.join(' AND ')}` : '';

  params.push(options.limit);
  const limitParam = params.length;
  let offsetSql = '';
  if (options.afterId == null && options.offset > 0) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  const sql = `
    SELECT id, country_block_id, network::text, grchc_cc, rir_cc, registry, range_text,
           rebuilt_at
    FROM geo_rir_cc_mismatches
    ${whereSql}
    ORDER BY ${sortField} ${sortDir} ${nulls}, id ASC
    LIMIT $${limitParam}${offsetSql}
  `;

  const countSql = `SELECT COUNT(*)::bigint AS count FROM geo_rir_cc_mismatches ${countWhereSql}`;

  return { sql, params, countSql, countParams: countOnlyParams };
}

export function buildCcMismatchFacetQuery(
  field: string,
  search: string,
  limit: number,
  contextFilters: FilterClause[],
): { sql: string; params: unknown[] } {
  const allowed = new Set(['grchc_cc', 'rir_cc', 'registry']);
  if (!allowed.has(field)) {
    throw new Error(`Unsupported CC mismatch facet field: ${field}`);
  }

  const where: string[] = [`${field} IS NOT NULL`];
  const params: unknown[] = [];
  for (const filter of contextFilters) {
    if (filter.field === field) continue;
    appendFilter(filter, params, where);
  }
  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    where.push(`${field}::text ILIKE $${params.length}`);
  }
  params.push(limit);
  return {
    sql: `
      SELECT ${field}::text AS value, COUNT(*)::int AS count
      FROM geo_rir_cc_mismatches
      WHERE ${where.join(' AND ')}
      GROUP BY ${field}
      ORDER BY count DESC, value ASC
      LIMIT $${params.length}
    `,
    params,
  };
}
