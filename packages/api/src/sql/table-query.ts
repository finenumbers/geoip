import type { FilterClause, SortClause } from '@geoip/shared';
import { getTableProfile, supportsKeysetPagination } from '@geoip/shared';
import { resolveBrowseView } from './mv-view-resolver.js';
import {
  buildRankKeysetClause,
  buildRankSortOrder,
  rankCursorField,
  usesRankSortField,
} from './sort-rank.js';

type TableType = 'city' | 'country';

export interface TableQueryOptions {
  page: number;
  pageSize: number;
  sort: SortClause[];
  filters: FilterClause[];
  afterId?: number;
  afterNetwork?: string;
  afterSortValue?: string;
  /** When true and ASN mapping is populated, filter via geo_*_block_asn instead of live blocks. */
  usePrecomputedAsnFilter?: boolean;
}

export { supportsKeysetPagination } from '@geoip/shared';

const CITY_ASN_TABLE = 'geo_city_block_asn';
const COUNTRY_ASN_TABLE = 'geo_country_block_asn';

const CITY_INNER_COLUMNS = `
  id,
  network,
  prefix_len,
  country_iso_code,
  country_name,
  city_name,
  subdivision_1_name,
  timezone,
  country_name_rank,
  city_name_rank`;

const COUNTRY_INNER_COLUMNS = `
  id,
  network,
  prefix_len,
  country_iso_code,
  country_name,
  subdivision_1_name`;

function getViewName(tableType: TableType): string {
  return tableType === 'city' ? 'mv_city_blocks_analytics' : 'mv_country_blocks_analytics';
}

function resolveViewAndFilters(
  tableType: TableType,
  filters: FilterClause[],
): { view: string; filters: FilterClause[]; ruPartial: boolean } {
  const resolved = resolveBrowseView(tableType, filters);
  return { view: resolved.view, filters: resolved.filters, ruPartial: resolved.ruPartial };
}

function getAsnTable(tableType: TableType): string {
  return tableType === 'city' ? CITY_ASN_TABLE : COUNTRY_ASN_TABLE;
}

function getAsnJoinColumn(tableType: TableType): string {
  return tableType === 'city' ? 'city_block_id' : 'country_block_id';
}

function getAllowedFields(tableType: TableType): Set<string> {
  return new Set(getTableProfile(tableType).filterFields);
}

function getAllowedSortFields(tableType: TableType): Set<string> {
  return new Set(getTableProfile(tableType).sortFields);
}

function getInnerColumns(tableType: TableType): string {
  return tableType === 'city' ? CITY_INNER_COLUMNS : COUNTRY_INNER_COLUMNS;
}

function getAliasedInnerColumns(tableType: TableType, alias: string): string {
  return getInnerColumns(tableType)
    .split(',')
    .map((column) => `${alias}.${column.trim()}`)
    .join(',\n        ');
}

function columnRef(field: string, alias: string, tableType: TableType): string {
  if (field === 'asn') return 'ba.asn';
  if (field === 'asn_org') return 'ba.asn_org';
  return alias ? `${alias}.${field}` : field;
}

function getBlocksTable(tableType: TableType): string {
  return tableType === 'city' ? 'geo_city_blocks' : 'geo_country_blocks';
}

export function getAsnBlocksFromClause(tableType: TableType, alias: string): string {
  const blocksTable = getBlocksTable(tableType);
  const view = getViewName(tableType);
  return `FROM geo_asn_blocks ab JOIN ${blocksTable} cb ON ab.network >>= cb.network JOIN ${view} ${alias} ON ${alias}.id = cb.id`;
}

export function hasAsnBlocksFilter(filters: FilterClause[]): boolean {
  return filters.some((f) => f.field === 'asn' || f.field === 'asn_org');
}

function buildAsnFilterPredicates(
  filters: FilterClause[],
  params: unknown[],
  asnColumn: string,
  orgColumn: string,
): { asnWhereParts: string[]; remainingFilters: FilterClause[] } {
  const asnWhereParts: string[] = [];
  const remainingFilters: FilterClause[] = [];

  for (const filter of filters) {
    if (filter.field === 'asn') {
      switch (filter.op) {
        case 'eq':
          params.push(filter.value);
          asnWhereParts.push(`${asnColumn} = $${params.length}`);
          break;
        case 'neq':
          params.push(filter.value);
          asnWhereParts.push(`${asnColumn} != $${params.length}`);
          break;
        case 'in': {
          const values = Array.isArray(filter.value) ? filter.value : [filter.value];
          const placeholders = values.map((v) => {
            params.push(v);
            return `$${params.length}`;
          });
          asnWhereParts.push(`${asnColumn} IN (${placeholders.join(', ')})`);
          break;
        }
        case 'startsWith':
          params.push(`${String(filter.value ?? '')}%`);
          asnWhereParts.push(`${asnColumn}::text ILIKE $${params.length}`);
          break;
        case 'contains':
          params.push(`%${String(filter.value ?? '')}%`);
          asnWhereParts.push(`${asnColumn}::text ILIKE $${params.length}`);
          break;
        default:
          break;
      }
      continue;
    }

    if (filter.field === 'asn_org') {
      switch (filter.op) {
        case 'eq':
          params.push(filter.value);
          asnWhereParts.push(`${orgColumn} = $${params.length}`);
          break;
        case 'contains':
          params.push(`%${String(filter.value ?? '')}%`);
          asnWhereParts.push(`${orgColumn} ILIKE $${params.length}`);
          break;
        case 'startsWith':
          params.push(`${String(filter.value ?? '')}%`);
          asnWhereParts.push(`${orgColumn} ILIKE $${params.length}`);
          break;
        case 'in': {
          const values = Array.isArray(filter.value) ? filter.value : [filter.value];
          const placeholders = values.map((v) => {
            params.push(v);
            return `$${params.length}`;
          });
          asnWhereParts.push(`${orgColumn} IN (${placeholders.join(', ')})`);
          break;
        }
        default:
          break;
      }
      continue;
    }

    remainingFilters.push(filter);
  }

  return { asnWhereParts, remainingFilters };
}

export function buildAsnBlocksJoin(
  filters: FilterClause[],
  params: unknown[],
  tableType: TableType,
  alias: string,
): {
  joinSql: string;
  asnWhereParts: string[];
  remainingFilters: FilterClause[];
  precomputed: boolean;
} {
  const blocksTable = getBlocksTable(tableType);
  const joinSql = `JOIN ${blocksTable} cb ON cb.id = ${alias}.id JOIN geo_asn_blocks ab ON ab.network >>= cb.network`;
  const { asnWhereParts, remainingFilters } = buildAsnFilterPredicates(
    filters,
    params,
    'ab.autonomous_system_number',
    'ab.autonomous_system_organization',
  );

  return { joinSql, asnWhereParts, remainingFilters, precomputed: false };
}

export function buildPrecomputedAsnJoin(
  filters: FilterClause[],
  params: unknown[],
  tableType: TableType,
  alias: string,
): {
  joinSql: string;
  asnWhereParts: string[];
  remainingFilters: FilterClause[];
  precomputed: boolean;
} {
  const asnTable = getAsnTable(tableType);
  const asnJoinColumn = getAsnJoinColumn(tableType);
  const joinSql = `JOIN ${asnTable} ba ON ba.${asnJoinColumn} = ${alias}.id`;
  const { asnWhereParts, remainingFilters } = buildAsnFilterPredicates(
    filters,
    params,
    'ba.asn',
    'ba.asn_org',
  );

  return { joinSql, asnWhereParts, remainingFilters, precomputed: true };
}

function buildFilterClause(
  filter: FilterClause,
  params: unknown[],
  allowed: Set<string>,
  alias: string,
  tableType: TableType,
): string | null {
  if (!allowed.has(filter.field)) return null;
  if (filter.field === 'asn' || filter.field === 'asn_org') return null;

  const col = columnRef(filter.field, alias, tableType);
  const idx = () => {
    params.push(filter.value);
    return `$${params.length}`;
  };

  switch (filter.op) {
    case 'eq':
      return `${col} = ${idx()}`;
    case 'neq':
      return `${col} != ${idx()}`;
    case 'contains':
      params.push(`%${String(filter.value ?? '')}%`);
      return `${col}::text ILIKE $${params.length}`;
    case 'startsWith':
      params.push(`${String(filter.value ?? '')}%`);
      return `${col}::text ILIKE $${params.length}`;
    case 'in': {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      const placeholders = values.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `${col} IN (${placeholders.join(', ')})`;
    }
    case 'gte':
      return `${col} >= ${idx()}`;
    case 'lte':
      return `${col} <= ${idx()}`;
    case 'between': {
      const values = Array.isArray(filter.value) ? filter.value : [];
      if (values.length < 2) return null;
      params.push(values[0], values[1]);
      return `${col} BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    case 'isNull':
      return `${col} IS NULL`;
    case 'isNotNull':
      return `${col} IS NOT NULL`;
    default:
      return null;
  }
}

function normalizeSortForView(
  tableType: TableType,
  sort: SortClause[],
  filters: FilterClause[],
): { sort: SortClause[]; ruPartial: boolean } {
  if (tableType !== 'city') {
    return { sort, ruPartial: false };
  }
  const { ruPartial } = resolveBrowseView(tableType, filters);
  if (ruPartial && sort.length === 1 && sort[0]?.field === 'country_name') {
    return { sort: [{ field: 'network', dir: sort[0].dir }], ruPartial: true };
  }
  return { sort, ruPartial };
}

function buildOrderBy(
  sort: SortClause[],
  tableType: TableType,
  alias = '',
  ruPartial = false,
): string {
  const allowed = getAllowedSortFields(tableType);
  const clauses: string[] = [];

  for (const s of sort.filter((entry) => allowed.has(entry.field))) {
    if (
      tableType === 'city' &&
      !ruPartial &&
      usesRankSortField(s.field)
    ) {
      clauses.push(...buildRankSortOrder(s.field, s.dir, alias || 'v'));
      continue;
    }
    const field = alias ? columnRef(s.field, alias, tableType) : s.field;
    clauses.push(`${field} ${s.dir === 'desc' ? 'DESC' : 'ASC'}`);
  }

  if (clauses.length === 0) {
    return alias ? `${alias}.network ASC, ${alias}.id ASC` : 'network ASC, id ASC';
  }

  const hasId = clauses.some((c) => c.includes('.id ') || c.startsWith('id '));
  if (!hasId) {
    clauses.push(alias ? `${alias}.id ASC` : 'id ASC');
  }
  return clauses.join(', ');
}

export const SLOW_FULL_SCAN_SORT_FIELDS = new Set(['country_name', 'city_name']);

/** Warn UI when sorting low-cardinality fields on the full city MV (~20M rows). */
export function resolveTableSortHint(
  tableType: TableType,
  sort: SortClause[],
  filters: FilterClause[],
): 'slow_full_scan' | null {
  if (tableType !== 'city') return null;
  if (sort.length !== 1) return null;
  const field = sort[0]?.field;
  if (!field || !SLOW_FULL_SCAN_SORT_FIELDS.has(field)) return null;
  const { ruPartial } = resolveBrowseView(tableType, filters);
  if (ruPartial) return null;
  if (usesRankSortField(field)) return null;
  return 'slow_full_scan';
}

export function resolvePaginationMode(
  sort: SortClause[],
  page: number,
  afterId?: number,
  afterNetwork?: string,
  afterSortValue?: string,
): 'keyset' | 'offset' {
  const hasKeysetCursor =
    afterId != null &&
    (usesNetworkKeysetSort(sort)
      ? afterNetwork != null
      : afterSortValue != null || afterNetwork != null);
  return supportsKeysetPagination(sort) && hasKeysetCursor && page > 1 ? 'keyset' : 'offset';
}

function usesNetworkKeysetSort(sort: SortClause[]): boolean {
  return sort.length === 0 || (sort.length === 1 && sort[0]?.field === 'network');
}

function buildKeysetClause(
  afterId: number,
  afterNetwork: string,
  params: unknown[],
  alias: string,
): string {
  params.push(afterNetwork, afterId);
  return `(${alias}.network, ${alias}.id) > ($${params.length - 1}, $${params.length})`;
}

function buildSortKeysetClause(
  sort: SortClause[],
  afterId: number,
  afterSortValue: string,
  params: unknown[],
  alias: string,
  tableType: TableType,
  ruPartial: boolean,
): string {
  const primary = sort[0];
  if (!primary) {
    return buildKeysetClause(afterId, afterSortValue, params, alias);
  }

  if (
    tableType === 'city' &&
    !ruPartial &&
    usesRankSortField(primary.field)
  ) {
    return buildRankKeysetClause(
      primary.field,
      primary.dir,
      Number(afterSortValue),
      afterId,
      params,
      alias,
    );
  }

  if (primary.field === 'prefix_len') {
    params.push(Number(afterSortValue), afterId);
    const comparator = primary.dir === 'desc' ? '<' : '>';
    return `(${alias}.prefix_len, ${alias}.id) ${comparator} ($${params.length - 1}, $${params.length})`;
  }

  const column = `${alias}.${primary.field}`;
  params.push(afterSortValue, afterId);
  const comparator = primary.dir === 'desc' ? '<' : '>';
  return `(COALESCE(${column}::text, ''), ${alias}.id) ${comparator} (COALESCE($${params.length - 1}::text, ''), $${params.length})`;
}

function buildKeysetWhereParts(
  effectiveSort: SortClause[],
  useKeyset: boolean,
  afterId: number | undefined,
  afterNetwork: string | undefined,
  afterSortValue: string | undefined,
  params: unknown[],
  alias: string,
  tableType: TableType,
  ruPartial: boolean,
): string[] {
  if (!useKeyset || afterId == null) return [];

  if (usesNetworkKeysetSort(effectiveSort) && afterNetwork != null) {
    return [buildKeysetClause(afterId, afterNetwork, params, alias)];
  }

  const cursorValue = afterSortValue ?? afterNetwork ?? '';
  return [
    buildSortKeysetClause(
      effectiveSort,
      afterId,
      cursorValue,
      params,
      alias,
      tableType,
      ruPartial,
    ),
  ];
}

function buildLiveAsnBlocksQuerySql(
  tableType: TableType,
  alias: string,
  innerWhere: string,
  outerWhere: string,
  orderBy: string,
  paginationSql: string,
): string {
  return `
    SELECT *
    FROM (
      SELECT DISTINCT ON (${alias}.id)
        ${getAliasedInnerColumns(tableType, alias)}
      ${getAsnBlocksFromClause(tableType, alias)}
      ${innerWhere}
      ORDER BY ${alias}.id, masklen(ab.network) DESC
    ) ${alias}
    ${outerWhere}
    ORDER BY ${orderBy}
    ${paginationSql}
  `;
}

function buildWhereClauses(
  filters: FilterClause[],
  params: unknown[],
  allowed: Set<string>,
  alias: string,
  tableType: TableType,
): string[] {
  const parts: string[] = [];
  for (const filter of filters) {
    const clause = buildFilterClause(filter, params, allowed, alias, tableType);
    if (clause) parts.push(clause);
  }
  return parts;
}

function needsAsnJoin(filters: FilterClause[], sort: SortClause[]): boolean {
  return sort.some((s) => s.field === 'asn' || s.field === 'asn_org');
}

export function resolveSortOverrideHint(
  tableType: TableType,
  sort: SortClause[],
  filters: FilterClause[],
): 'ru_partial_network' | null {
  if (tableType !== 'city' || sort.length !== 1) return null;
  if (sort[0]?.field !== 'country_name') return null;
  const { ruPartial } = resolveBrowseView(tableType, filters);
  return ruPartial ? 'ru_partial_network' : null;
}

export interface BrowseContextWhereOptions {
  alias?: string;
  /** Omit these filter fields from the WHERE clause (facet: current field). */
  excludeFields?: string[];
  /** When ASN filters present, use geo_*_block_asn join (default true). */
  usePrecomputedAsnFilter?: boolean;
}

export interface BrowseContextWhereResult {
  view: string;
  ruPartial: boolean;
  effectiveFilters: FilterClause[];
  whereParts: string[];
  joinSql: string;
  whereSql: string;
  useAsnBlocksJoin: boolean;
  asnJoinPrecomputed: boolean;
}

/** Shared MV view + WHERE builder for table browse and facet context queries. */
export function buildBrowseContextWhere(
  tableType: TableType,
  filters: FilterClause[],
  params: unknown[],
  options: BrowseContextWhereOptions = {},
): BrowseContextWhereResult {
  const alias = options.alias ?? 'v';
  const { view, filters: effectiveFilters, ruPartial } = resolveViewAndFilters(
    tableType,
    filters,
  );
  const allowed = getAllowedFields(tableType);

  const exclude = new Set(options.excludeFields ?? []);
  const scopedFilters = exclude.size > 0
    ? filters.filter((f) => !exclude.has(f.field))
    : filters;

  const useAsnBlocksJoin = hasAsnBlocksFilter(scopedFilters);
  let joinSql = '';
  const whereParts: string[] = [];
  let mvFilters: FilterClause[];

  if (useAsnBlocksJoin) {
    const preferPrecomputed = options.usePrecomputedAsnFilter === true;
    const asnJoin = preferPrecomputed
      ? buildPrecomputedAsnJoin(scopedFilters, params, tableType, alias)
      : buildAsnBlocksJoin(scopedFilters, params, tableType, alias);
    joinSql = asnJoin.joinSql;
    whereParts.push(...asnJoin.asnWhereParts);
    mvFilters = asnJoin.remainingFilters;
  } else {
    mvFilters = exclude.size > 0
      ? effectiveFilters.filter((f) => !exclude.has(f.field))
      : effectiveFilters;
  }

  whereParts.push(...buildWhereClauses(mvFilters, params, allowed, alias, tableType));

  return {
    view,
    ruPartial,
    effectiveFilters,
    whereParts,
    joinSql,
    whereSql: whereParts.join(' AND '),
    useAsnBlocksJoin,
    asnJoinPrecomputed: useAsnBlocksJoin && options.usePrecomputedAsnFilter === true,
  };
}

export function canUseCachedCount(filters: FilterClause[]): boolean {
  return filters.length === 0;
}

export function buildTableQuery(
  tableType: TableType,
  options: TableQueryOptions,
): {
  sql: string;
  countSql: string | null;
  params: unknown[];
  countParams: unknown[];
  useCachedCount: boolean;
  skipExactCount: boolean;
} {
  const { page, pageSize, sort, filters, afterId, afterNetwork, afterSortValue, usePrecomputedAsnFilter } =
    options;
  const { sort: effectiveSort, ruPartial } = normalizeSortForView(tableType, sort, filters);
  const asnTable = getAsnTable(tableType);
  const asnJoinColumn = getAsnJoinColumn(tableType);
  const alias = 'v';
  const useCachedCount = canUseCachedCount(filters);
  const hasKeysetCursor =
    afterId != null &&
    (usesNetworkKeysetSort(effectiveSort)
      ? afterNetwork != null
      : afterSortValue != null || afterNetwork != null);
  const useKeyset = supportsKeysetPagination(effectiveSort) && hasKeysetCursor && page > 1;
  const asnInQuery = needsAsnJoin(filters, effectiveSort);
  const useAsnBlocksJoin = hasAsnBlocksFilter(filters);

  const dataParams: unknown[] = [];
  const dataCtx = buildBrowseContextWhere(tableType, filters, dataParams, {
    alias,
    usePrecomputedAsnFilter,
  });
  const view = dataCtx.view;
  const orderBy = buildOrderBy(effectiveSort, tableType, alias, ruPartial);
  const useLiveAsnBlocksJoin = useAsnBlocksJoin && !dataCtx.asnJoinPrecomputed;
  const keysetWhereParts = buildKeysetWhereParts(
    effectiveSort,
    useKeyset,
    afterId,
    afterNetwork,
    afterSortValue,
    dataParams,
    alias,
    tableType,
    ruPartial,
  );
  const filterWhereParts = [...dataCtx.whereParts];
  const whereParts = useLiveAsnBlocksJoin
    ? keysetWhereParts
    : [...filterWhereParts, ...keysetWhereParts];
  const offset = useKeyset ? 0 : (page - 1) * pageSize;

  const innerWhere =
    useLiveAsnBlocksJoin && filterWhereParts.length > 0
      ? `WHERE ${filterWhereParts.join(' AND ')}`
      : '';
  const where = !useLiveAsnBlocksJoin && whereParts.length > 0
    ? `WHERE ${whereParts.join(' AND ')}`
    : useLiveAsnBlocksJoin && whereParts.length > 0
      ? `WHERE ${whereParts.join(' AND ')}`
      : '';

  const countParams: unknown[] = [];
  const countWhereParts = useCachedCount
    ? []
    : buildBrowseContextWhere(tableType, filters, countParams, {
        alias,
        usePrecomputedAsnFilter,
      }).whereParts;
  const countWhere =
    countWhereParts.length > 0 ? `WHERE ${countWhereParts.join(' AND ')}` : '';

  const countSql = useCachedCount || useAsnBlocksJoin
    ? null
    : asnInQuery
      ? `
    SELECT COUNT(*)::int AS count
    FROM ${view} ${alias}
    LEFT JOIN ${asnTable} ba ON ba.${asnJoinColumn} = ${alias}.id
    ${countWhere}
  `
      : `
    SELECT COUNT(*)::int AS count
    FROM ${view} ${alias}
    ${countWhere}
  `;

  const params = [...dataParams, pageSize];
  if (!useKeyset) params.push(offset);
  const limitIdx = params.length - (useKeyset ? 0 : 1);
  const offsetIdx = params.length;
  const paginationSql = useKeyset
    ? `LIMIT $${limitIdx}`
    : `LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

  let sql: string;

  if (asnInQuery) {
    sql = `
      SELECT
        ${alias}.id,
        ${alias}.network,
        ${alias}.prefix_len,
        ${alias}.country_iso_code,
        ${alias}.country_name,
        ${tableType === 'city' ? `${alias}.city_name, ${alias}.subdivision_1_name, ${alias}.timezone,` : `${alias}.subdivision_1_name,`}
        ba.asn,
        ba.asn_org
      FROM ${view} ${alias}
      LEFT JOIN ${asnTable} ba ON ba.${asnJoinColumn} = ${alias}.id
      ${where}
      ORDER BY ${orderBy}
      ${paginationSql}
    `;
  } else if (useAsnBlocksJoin && dataCtx.joinSql) {
    if (dataCtx.asnJoinPrecomputed) {
      sql = `
      SELECT
        ${alias}.id,
        ${alias}.network,
        ${alias}.prefix_len,
        ${alias}.country_iso_code,
        ${alias}.country_name,
        ${tableType === 'city' ? `${alias}.city_name, ${alias}.subdivision_1_name, ${alias}.timezone,` : `${alias}.subdivision_1_name,`}
        ba.asn,
        ba.asn_org
      FROM ${view} ${alias}
      ${dataCtx.joinSql}
      ${where}
      ORDER BY ${orderBy}
      ${paginationSql}
    `;
    } else {
      sql = buildLiveAsnBlocksQuerySql(
        tableType,
        alias,
        innerWhere,
        where,
        orderBy,
        paginationSql,
      );
    }
  } else {
    sql = `
      SELECT ${getInnerColumns(tableType)}
      FROM ${view} ${alias}
      ${where}
      ORDER BY ${orderBy}
      ${paginationSql}
    `;
  }

  return { sql, countSql, params, countParams, useCachedCount, skipExactCount: useAsnBlocksJoin };
}
