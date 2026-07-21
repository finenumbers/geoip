import type { FilterClause, SortClause } from '@geoip/shared';

export type AsnBuiltQuery = {
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
    prefix_len: 'masklen(network)',
    ip_family: 'ip_family',
    asn: 'autonomous_system_number',
    asn_org: 'autonomous_system_organization',
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
  const asNumber = (value: unknown): number | unknown => {
    if (filter.field === 'asn' || filter.field === 'ip_family' || filter.field === 'prefix_len') {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    return value;
  };

  if (filter.op === 'eq') {
    params.push(asNumber(filter.value));
    clauses.push(`${col} = $${params.length}`);
    return;
  }
  if (filter.op === 'neq') {
    params.push(asNumber(filter.value));
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
    params.push(filter.value.map((entry) => asNumber(entry)));
    clauses.push(`${col} = ANY($${params.length})`);
    return;
  }
  if (filter.op === 'gte') {
    params.push(asNumber(filter.value));
    clauses.push(`${col} >= $${params.length}`);
    return;
  }
  if (filter.op === 'lte') {
    params.push(asNumber(filter.value));
    clauses.push(`${col} <= $${params.length}`);
    return;
  }
  if (filter.op === 'between' && Array.isArray(filter.value) && filter.value.length >= 2) {
    params.push(asNumber(filter.value[0]), asNumber(filter.value[1]));
    clauses.push(`${col} BETWEEN $${params.length - 1} AND $${params.length}`);
  }
}

const SORT_COLUMNS: Record<string, string> = {
  network: 'network',
  prefix_len: 'masklen(network)',
  ip_family: 'ip_family',
  asn: 'autonomous_system_number',
  asn_org: 'autonomous_system_organization',
};

export function buildAsnTableQuery(options: {
  filters: FilterClause[];
  sort: SortClause[];
  limit: number;
  offset: number;
  afterId?: number;
  afterSortValue?: string;
}): AsnBuiltQuery {
  const where: string[] = [];
  const params: unknown[] = [];

  for (const filter of options.filters) {
    appendFilter(filter, params, where);
  }

  const primarySort = options.sort[0];
  const sortField = primarySort ? (SORT_COLUMNS[primarySort.field] ?? 'network') : 'network';
  const sortDir = primarySort?.dir === 'desc' ? 'DESC' : 'ASC';
  const nulls = sortDir === 'DESC' ? 'NULLS LAST' : 'NULLS FIRST';

  if (options.afterId != null && primarySort && options.afterSortValue !== undefined) {
    params.push(options.afterSortValue, options.afterId);
    const op = sortDir === 'DESC' ? '<' : '>';
    where.push(
      `(${sortField}::text, id) ${op} ($${params.length - 1}::text, $${params.length}::bigint)`,
    );
  } else if (options.afterId != null && !primarySort) {
    params.push(options.afterId);
    where.push(`id > $${params.length}`);
  }

  const countWhere: string[] = [];
  const countOnlyParams: unknown[] = [];
  for (const filter of options.filters) {
    appendFilter(filter, countOnlyParams, countWhere);
  }
  const countWhereSql = countWhere.length > 0 ? `WHERE ${countWhere.join(' AND ')}` : '';
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  params.push(options.limit);
  const limitParam = params.length;
  let offsetSql = '';
  if (options.afterId == null && options.offset > 0) {
    params.push(options.offset);
    offsetSql = ` OFFSET $${params.length}`;
  }

  const sql = `
    SELECT id, network::text, masklen(network) AS prefix_len, ip_family,
           autonomous_system_number AS asn, autonomous_system_organization AS asn_org
    FROM geo_asn_blocks
    ${whereSql}
    ORDER BY ${sortField} ${sortDir} ${nulls}, id ASC
    LIMIT $${limitParam}${offsetSql}
  `;

  const countSql = `SELECT COUNT(*)::bigint AS count FROM geo_asn_blocks ${countWhereSql}`;

  return { sql, params, countSql, countParams: countOnlyParams };
}

export function buildAsnFacetQuery(
  field: string,
  search: string,
  limit: number,
  contextFilters: FilterClause[],
): { sql: string; params: unknown[] } {
  const fieldMap: Record<string, string> = {
    asn_org: 'autonomous_system_organization',
    ip_family: 'ip_family',
  };
  const col = fieldMap[field];
  if (!col) {
    throw new Error(`Unsupported ASN facet field: ${field}`);
  }

  const where: string[] = [`${col} IS NOT NULL`];
  const params: unknown[] = [];
  for (const filter of contextFilters) {
    if (filter.field === field) continue;
    appendFilter(filter, params, where);
  }
  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    where.push(`${col}::text ILIKE $${params.length}`);
  }
  params.push(limit);
  return {
    sql: `
      SELECT ${col}::text AS value, COUNT(*)::int AS count
      FROM geo_asn_blocks
      WHERE ${where.join(' AND ')}
      GROUP BY ${col}
      ORDER BY count DESC, value ASC
      LIMIT $${params.length}
    `,
    params,
  };
}
