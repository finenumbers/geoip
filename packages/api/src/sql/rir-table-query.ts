import type { FilterClause, SortClause } from '@geoip/shared';

export type RirBuiltQuery = {
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
    registry: 'registry',
    cc: 'cc',
    resource_type: 'resource_type',
    status: 'status',
    range_text: 'range_text',
    network: 'network::text',
    prefix_len: 'prefix_len',
    ip_family: 'ip_family',
    opaque_id: 'opaque_id',
    allocated_at: 'allocated_at::text',
    host_count: 'host_count::text',
    start_asn: 'start_asn',
    asn_count: 'asn_count',
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
    if (
      filter.field === 'ip_family' ||
      filter.field === 'prefix_len' ||
      filter.field === 'start_asn' ||
      filter.field === 'asn_count'
    ) {
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
  registry: 'registry',
  range_text: 'range_text',
  cc: 'cc',
  status: 'status',
  allocated_at: 'allocated_at',
  resource_type: 'resource_type',
  prefix_len: 'prefix_len',
  opaque_id: 'opaque_id',
};

export function buildRirTableQuery(options: {
  filters: FilterClause[];
  sort: SortClause[];
  limit: number;
  offset: number;
  afterId?: number;
  afterSortValue?: string;
}): RirBuiltQuery {
  const where: string[] = [];
  const params: unknown[] = [];

  for (const filter of options.filters) {
    appendFilter(filter, params, where);
  }

  const primarySort = options.sort[0];
  const sortField = primarySort ? (SORT_COLUMNS[primarySort.field] ?? 'range_text') : 'range_text';
  const sortDir = primarySort?.dir === 'desc' ? 'DESC' : 'ASC';
  const nulls = sortDir === 'DESC' ? 'NULLS LAST' : 'NULLS FIRST';

  if (options.afterId != null && primarySort && options.afterSortValue !== undefined) {
    params.push(options.afterSortValue, options.afterId);
    const op = sortDir === 'DESC' ? '<' : '>';
    where.push(
      `(${sortField}, id) ${op} ($${params.length - 1}::text, $${params.length}::bigint)`,
    );
  } else if (options.afterId != null && !primarySort) {
    params.push(options.afterId);
    where.push(`id > $${params.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countParams = [...params];
  // count should not include keyset cursor params that were appended for pagination only
  // Rebuild count without after* — use filter-only params
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
    SELECT id, registry, cc, resource_type, start_ip::text, end_ip::text, network::text,
           prefix_len, host_count::text, start_asn, asn_count, allocated_at::text,
           status, opaque_id, range_text, ip_family, source_file, snapshot_date::text
    FROM rir_delegations
    ${whereSql}
    ORDER BY ${sortField} ${sortDir} ${nulls}, id ASC
    LIMIT $${limitParam}${offsetSql}
  `;

  const countSql = `SELECT COUNT(*)::bigint AS count FROM rir_delegations ${countWhereSql}`;

  return { sql, params, countSql, countParams: countOnlyParams };
}

export function buildRirFacetQuery(
  field: string,
  search: string,
  limit: number,
  contextFilters: FilterClause[],
): { sql: string; params: unknown[] } {
  const allowed = new Set(['registry', 'status', 'resource_type', 'cc', 'ip_family']);
  if (!allowed.has(field)) {
    throw new Error(`Unsupported RIR facet field: ${field}`);
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
      FROM rir_delegations
      WHERE ${where.join(' AND ')}
      GROUP BY ${field}
      ORDER BY count DESC, value ASC
      LIMIT $${params.length}
    `,
    params,
  };
}
