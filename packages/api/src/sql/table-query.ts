import type { FilterClause, SortClause } from '@geoip/shared';
import {
  CITY_TABLE_SORT_FIELDS,
  COUNTRY_TABLE_SORT_FIELDS,
} from '@geoip/shared';
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

const CITY_FILTER_FIELDS = new Set([
  'network',
  'ip_family',
  'prefix_len',
  'country_iso_code',
  'country_name',
  'city_name',
  'subdivision_1_name',
  'subdivision_2_name',
  'asn',
  'asn_org',
  'postal_code',
  'timezone',
]);

const COUNTRY_FILTER_FIELDS = new Set([
  'network',
  'ip_family',
  'prefix_len',
  'country_iso_code',
  'country_name',
  'subdivision_1_name',
  'subdivision_2_name',
  'asn',
]);

const CITY_SORT_SET = new Set<string>(CITY_TABLE_SORT_FIELDS);
const COUNTRY_SORT_SET = new Set<string>(COUNTRY_TABLE_SORT_FIELDS);

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
): { view: string; filters: FilterClause[] } {
  const resolved = resolveBrowseView(tableType, filters);
  return { view: resolved.view, filters: resolved.filters };
}

function getAsnTable(tableType: TableType): string {
  return tableType === 'city' ? CITY_ASN_TABLE : COUNTRY_ASN_TABLE;
}

function getAsnJoinColumn(tableType: TableType): string {
  return tableType === 'city' ? 'city_block_id' : 'country_block_id';
}

function getAllowedFields(tableType: TableType): Set<string> {
  return tableType === 'city' ? CITY_FILTER_FIELDS : COUNTRY_FILTER_FIELDS;
}

function getAllowedSortFields(tableType: TableType): Set<string> {
  return tableType === 'city' ? CITY_SORT_SET : COUNTRY_SORT_SET;
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

const KEYSET_SORT_FIELDS = new Set([
  'network',
  'country_name',
  'city_name',
  'country_iso_code',
  'subdivision_1_name',
]);

export function supportsKeysetPagination(sort: SortClause[]): boolean {
  if (sort.length === 0) return true;
  if (sort.length === 1 && KEYSET_SORT_FIELDS.has(sort[0]?.field ?? '')) return true;
  return false;
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

  const column = `${alias}.${primary.field}`;
  params.push(afterSortValue, afterId);
  const comparator = primary.dir === 'desc' ? '<' : '>';
  return `(COALESCE(${column}::text, ''), ${alias}.id) ${comparator} (COALESCE($${params.length - 1}::text, ''), $${params.length})`;
}

function buildAsnBlocksOrderBy(
  sort: SortClause[],
  tableType: TableType,
  alias: string,
  ruPartial = false,
): string {
  if (sort.length === 0 || usesNetworkKeysetSort(sort)) {
    return 'cb.id ASC';
  }

  const onlyNetworkSort = sort.length === 1 && sort[0]?.field === 'network';
  if (onlyNetworkSort && sort[0]) {
    return `cb.id ${sort[0].dir === 'desc' ? 'DESC' : 'ASC'}`;
  }

  return `cb.id ASC, ${buildOrderBy(sort, tableType, alias, ruPartial)}`;
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

export function facetNeedsAsnJoin(tableType: TableType, field: string, _contextFilters: FilterClause[]): boolean {
  return field === 'asn' || field === 'asn_org';
}

export function buildFacetContextWhere(
  tableType: TableType,
  contextFilters: FilterClause[],
  params: unknown[],
  alias = 'v',
): string {
  const allowed = getAllowedFields(tableType);
  const parts = buildWhereClauses(contextFilters, params, allowed, alias, tableType);
  return parts.length > 0 ? parts.join(' AND ') : '';
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
  const { view, filters: effectiveFilters } = resolveViewAndFilters(tableType, filters);
  const { sort: effectiveSort, ruPartial } = normalizeSortForView(tableType, sort, filters);
  const asnTable = getAsnTable(tableType);
  const asnJoinColumn = getAsnJoinColumn(tableType);
  const allowed = getAllowedFields(tableType);
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
  const asnJoin = useAsnBlocksJoin
    ? usePrecomputedAsnFilter
      ? buildPrecomputedAsnJoin(filters, dataParams, tableType, alias)
      : buildAsnBlocksJoin(filters, dataParams, tableType, alias)
    : null;
  const dataFilters = asnJoin?.remainingFilters ?? effectiveFilters;
  const whereParts = buildWhereClauses(dataFilters, dataParams, allowed, alias, tableType);
  if (asnJoin) whereParts.push(...asnJoin.asnWhereParts);

  if (useKeyset && afterId != null) {
    if (usesNetworkKeysetSort(effectiveSort) && afterNetwork != null) {
      whereParts.push(buildKeysetClause(afterId, afterNetwork, dataParams, alias));
    } else {
      const cursorValue = afterSortValue ?? afterNetwork ?? '';
      whereParts.push(
        buildSortKeysetClause(
          effectiveSort,
          afterId,
          cursorValue,
          dataParams,
          alias,
          tableType,
          ruPartial,
        ),
      );
    }
  }

  const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const orderBy =
    asnJoin && !asnJoin.precomputed
      ? buildAsnBlocksOrderBy(effectiveSort, tableType, alias, ruPartial)
      : buildOrderBy(effectiveSort, tableType, alias, ruPartial);
  const offset = useKeyset ? 0 : (page - 1) * pageSize;

  const countParams: unknown[] = [];
  const countAsnJoin = useAsnBlocksJoin
    ? usePrecomputedAsnFilter
      ? buildPrecomputedAsnJoin(filters, countParams, tableType, alias)
      : buildAsnBlocksJoin(filters, countParams, tableType, alias)
    : null;
  const countFilters = countAsnJoin?.remainingFilters ?? effectiveFilters;
  const countWhereParts = useCachedCount
    ? []
    : buildWhereClauses(countFilters, countParams, allowed, alias, tableType);
  if (!useCachedCount && countAsnJoin) countWhereParts.push(...countAsnJoin.asnWhereParts);
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
  } else if (asnJoin) {
    if (asnJoin.precomputed) {
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
      ${asnJoin.joinSql}
      ${where}
      ORDER BY ${orderBy}
      ${paginationSql}
    `;
    } else {
      sql = `
      SELECT ${getAliasedInnerColumns(tableType, alias)}
      ${getAsnBlocksFromClause(tableType, alias)}
      ${where}
      ORDER BY ${orderBy}
      ${paginationSql}
    `;
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

export function getFilterMetadataFields(tableType: TableType): string[] {
  if (tableType === 'city') {
    return ['country_iso_code', 'country_name', 'city_name', 'subdivision_1_name', 'asn'];
  }
  return ['country_iso_code', 'country_name', 'subdivision_1_name', 'asn'];
}

export function getFilterMetadataSource(tableType: TableType, field: string): string {
  if (field === 'asn') {
    return `${getAsnTable(tableType)}.asn`;
  }
  return `${getViewName(tableType)}.${field}`;
}
