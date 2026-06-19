import type { FilterClause } from '@geoip/shared';
import { isAllowedFacetField } from '@geoip/shared';
import { query } from '../db/client.js';
import { batchLookupAsn, loadPrecomputedAsn } from '../sql/asn-enrichment.js';
import { isAsnMappingReady } from '../sql/asn-mapping-status.js';
import {
  buildAsnBlocksJoin,
  buildBrowseContextWhere,
  buildTableQuery,
  hasAsnBlocksFilter,
} from '../sql/table-query.js';
import { resolveCachedFacetValues } from '../sql/facet-count-cache.js';
import { getDatasetState } from '../repositories/dataset-repository.js';
import { buildFacetSearchOrderSql, sortFacetItemsBySearch } from '../sql/facet-search-utils.js';

const ASN_CONTEXT_PAGE_SIZE = 200;
const ASN_CONTEXT_SCAN_CAP = 5_000;
/** Wall-clock budget for ASN-context facet sampling (C3). */
const FACET_ASN_CONTEXT_BUDGET_MS = 3_000;

type FacetMeta = {
  timedOut?: boolean;
  sampledRows?: number;
  source?: 'cache' | 'index' | 'sample';
};

type FacetResult = {
  items: Array<{ value: string; count: number }>;
  meta?: FacetMeta;
};

function getPrecomputedAsnJoin(tableType: 'city' | 'country'): {
  joinSql: string;
  orgColumn: string;
} {
  if (tableType === 'city') {
    return {
      joinSql: 'JOIN geo_city_block_asn ba ON ba.city_block_id = v.id',
      orgColumn: 'ba.asn_org',
    };
  }
  return {
    joinSql: 'JOIN geo_country_block_asn ba ON ba.country_block_id = v.id',
    orgColumn: 'ba.asn_org',
  };
}

function getLiveAsnOrgJoin(tableType: 'city' | 'country'): {
  joinSql: string;
  orgColumn: string;
} {
  return {
    joinSql: buildAsnBlocksJoin([], [], tableType, 'v').joinSql,
    orgColumn: 'ab.autonomous_system_organization',
  };
}

function resolveAsnOrgFacetJoin(
  tableType: 'city' | 'country',
  contextFilters: FilterClause[],
  params: unknown[],
  usePrecomputedAsnFilter: boolean,
): {
  view: string;
  joinSql: string;
  orgColumn: string;
  whereSql: string;
} {
  const ctx = buildBrowseContextWhere(tableType, contextFilters, params, {
    alias: 'v',
    usePrecomputedAsnFilter,
  });

  if (usePrecomputedAsnFilter) {
    const precomputed = getPrecomputedAsnJoin(tableType);
    return {
      view: ctx.view,
      joinSql: ctx.useAsnBlocksJoin ? ctx.joinSql : precomputed.joinSql,
      orgColumn: precomputed.orgColumn,
      whereSql: ctx.whereSql,
    };
  }

  const live = getLiveAsnOrgJoin(tableType);
  return {
    view: ctx.view,
    joinSql: ctx.useAsnBlocksJoin ? ctx.joinSql : live.joinSql,
    orgColumn: live.orgColumn,
    whereSql: ctx.whereSql,
  };
}

async function appendAsnOrgFromRows(
  tableType: 'city' | 'country',
  rows: Array<Record<string, unknown>>,
  sampled: Array<{ value: string | null }>,
  usePrecomputedAsnFilter: boolean,
): Promise<void> {
  if (usePrecomputedAsnFilter && rows.some((row) => row.asn_org !== undefined)) {
    for (const row of rows) {
      sampled.push({ value: row.asn_org != null ? String(row.asn_org) : null });
    }
    return;
  }

  const ids = rows.map((row) => Number(row.id));
  const precomputed = usePrecomputedAsnFilter ? await loadPrecomputedAsn(tableType, ids) : new Map();
  for (const row of rows) {
    const cached = precomputed.get(Number(row.id));
    if (cached) {
      sampled.push({ value: cached.asnOrg });
      continue;
    }
    const lookedUp = await batchLookupAsn([String(row.network)]);
    sampled.push({ value: lookedUp.get(String(row.network))?.asnOrg ?? null });
  }
}

function aggregateFacetRows(
  rows: Array<{ value: string | null }>,
  limit: number,
): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.value) continue;
    counts.set(row.value, (counts.get(row.value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ru'))
    .slice(0, limit);
}

async function getMvFacetWithAsnContext(
  tableType: 'city' | 'country',
  field: string,
  search: string,
  limit: number,
  contextFilters: FilterClause[],
): Promise<FacetResult> {
  const scanFilters = contextFilters.filter((f) => f.field !== field);
  if (search.trim()) {
    scanFilters.push({ field, op: 'contains', value: search.trim() });
  }

  const sampled: Array<{ value: string | null }> = [];
  let page = 1;
  let scanned = 0;
  const started = Date.now();
  let timedOut = false;

  const usePrecomputedAsnFilter = await isAsnMappingReady();

  while (scanned < ASN_CONTEXT_SCAN_CAP) {
    if (Date.now() - started > FACET_ASN_CONTEXT_BUDGET_MS) {
      timedOut = true;
      break;
    }

    const { sql, params } = buildTableQuery(tableType, {
      page,
      pageSize: ASN_CONTEXT_PAGE_SIZE,
      sort: [],
      filters: scanFilters,
      usePrecomputedAsnFilter,
    });

    const result = await query<Record<string, unknown>>(sql, params);
    if (result.rows.length === 0) break;

    if (field === 'asn_org') {
      await appendAsnOrgFromRows(tableType, result.rows, sampled, usePrecomputedAsnFilter);
    } else {
      for (const row of result.rows) {
        sampled.push({ value: row[field] != null ? String(row[field]) : null });
      }
    }

    scanned += result.rows.length;
    if (result.rows.length < ASN_CONTEXT_PAGE_SIZE) break;
    page++;
  }

  return {
    items: sortFacetItemsBySearch(aggregateFacetRows(sampled, limit * 3), search, limit),
    meta: {
      source: 'sample',
      sampledRows: scanned,
      ...(timedOut ? { timedOut: true } : {}),
    },
  };
}

async function getAsnOrgFacetFromBlocks(
  search: string,
  limit: number,
): Promise<FacetResult> {
  const params: unknown[] = [];
  let searchClause = '';

  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    searchClause = `AND autonomous_system_organization ILIKE $${params.length}`;
  }

  const orderClause = buildFacetSearchOrderSql(search, 'autonomous_system_organization', params);
  params.push(limit);
  const limitIdx = params.length;

  const result = await query<{ value: string; count: number }>(
    `SELECT autonomous_system_organization AS value, COUNT(*)::int AS count
     FROM geo_asn_blocks
     WHERE autonomous_system_organization IS NOT NULL
     ${searchClause}
     GROUP BY autonomous_system_organization
     ${orderClause}
     LIMIT $${limitIdx}`,
    params,
  );

  return {
    items: result.rows.map((row) => ({
      value: row.value,
      count: row.count,
    })),
    meta: { source: 'index' },
  };
}

async function getAsnOrgFacetWithContext(
  tableType: 'city' | 'country',
  search: string,
  limit: number,
  contextFilters: FilterClause[],
): Promise<FacetResult> {
  if (hasAsnBlocksFilter(contextFilters)) {
    return getMvFacetWithAsnContext(tableType, 'asn_org', search, limit, contextFilters);
  }

  const usePrecomputedAsnFilter = await isAsnMappingReady();
  const params: unknown[] = [];
  const { view, joinSql, orgColumn, whereSql } = resolveAsnOrgFacetJoin(
    tableType,
    contextFilters,
    params,
    usePrecomputedAsnFilter,
  );

  let searchClause = '';
  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    searchClause = `${orgColumn} ILIKE $${params.length}`;
  }

  const whereParts = [`${orgColumn} IS NOT NULL`];
  if (whereSql) whereParts.push(whereSql);
  if (searchClause) whereParts.push(searchClause);

  const orderClause = buildFacetSearchOrderSql(search, orgColumn, params);
  params.push(limit);
  const limitIdx = params.length;

  const result = await query<{ value: string; count: number }>(
    `SELECT ${orgColumn} AS value, COUNT(*)::int AS count
     FROM ${view} v
     ${joinSql}
     WHERE ${whereParts.join(' AND ')}
     GROUP BY ${orgColumn}
     ${orderClause}
     LIMIT $${limitIdx}`,
    params,
  );

  return {
    items: result.rows.map((row) => ({
      value: row.value,
      count: row.count,
    })),
    meta: { source: 'index' },
  };
}

export async function getFacetValues(
  tableType: 'city' | 'country',
  field: string,
  search: string,
  limit = 50,
  contextFilters: FilterClause[] = [],
): Promise<FacetResult> {
  if (!isAllowedFacetField(tableType, field)) {
    throw new Error(`Unknown facet field "${field}" for ${tableType} table`);
  }

  if (field === 'asn_org') {
    const scopedContext = contextFilters.filter((f) => f.field !== 'asn_org');
    if (scopedContext.length === 0) {
      return getAsnOrgFacetFromBlocks(search, limit);
    }

    const state = await getDatasetState();
    const cached = resolveCachedFacetValues(
      tableType,
      'asn_org',
      scopedContext,
      search,
      limit,
      state.facetCountCache,
    );
    if (cached) {
      return { items: cached, meta: { source: 'cache' } };
    }

    return getAsnOrgFacetWithContext(tableType, search, limit, scopedContext);
  }

  const scopedContext = contextFilters.filter((f) => f.field !== field);
  if (hasAsnBlocksFilter(scopedContext)) {
    return getMvFacetWithAsnContext(tableType, field, search, limit, scopedContext);
  }

  const state = await getDatasetState();
  const cached = resolveCachedFacetValues(
    tableType,
    field,
    scopedContext,
    search,
    limit,
    state.facetCountCache,
  );
  if (cached) {
    return { items: cached, meta: { source: 'cache' } };
  }

  const usePrecomputedAsnFilter = await isAsnMappingReady();
  const params: unknown[] = [];
  const { view, whereSql } = buildBrowseContextWhere(tableType, scopedContext, params, {
    alias: 'v',
    usePrecomputedAsnFilter,
  });
  const facetColumn = `v.${field}`;
  const valueExpr = `${facetColumn}::text`;

  let searchClause = '';
  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    searchClause = `${facetColumn}::text ILIKE $${params.length}`;
  }

  const whereParts = [`v.${field} IS NOT NULL`];
  if (whereSql) whereParts.push(whereSql);
  if (searchClause) whereParts.push(searchClause);

  const orderClause = buildFacetSearchOrderSql(search, valueExpr, params);
  params.push(limit);
  const limitIdx = params.length;

  const result = await query<{ value: string; count: number }>(
    `SELECT ${valueExpr} AS value, COUNT(*)::int AS count
     FROM ${view} v
     WHERE ${whereParts.join(' AND ')}
     GROUP BY ${field}
     ${orderClause}
     LIMIT $${limitIdx}`,
    params,
  );

  return {
    items: result.rows.map((row) => ({
      value: row.value,
      count: row.count,
    })),
    meta: { source: 'index' },
  };
}
