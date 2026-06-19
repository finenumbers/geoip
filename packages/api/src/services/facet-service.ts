import type { FilterClause } from '@geoip/shared';
import { query } from '../db/client.js';
import { batchLookupAsn, loadPrecomputedAsn } from '../sql/asn-enrichment.js';
import {
  buildFacetContextWhere,
  buildTableQuery,
  hasAsnBlocksFilter,
} from '../sql/table-query.js';
import { resolveCachedFacetValues } from '../sql/facet-count-cache.js';
import { resolveBrowseView } from '../sql/mv-view-resolver.js';
import { getDatasetState } from '../repositories/dataset-repository.js';

const CITY_FACET_FIELDS = new Set([
  'country_name',
  'city_name',
  'subdivision_1_name',
  'asn_org',
]);

const COUNTRY_FACET_FIELDS = new Set(['country_name', 'subdivision_1_name']);

const FACET_VIEWS = {
  city: 'mv_city_blocks_analytics',
  country: 'mv_country_blocks_analytics',
} as const;

const ASN_CONTEXT_PAGE_SIZE = 200;
const ASN_CONTEXT_SCAN_CAP = 5_000;

function resolveFacetView(
  tableType: 'city' | 'country',
  contextFilters: FilterClause[],
): { view: string; filters: FilterClause[] } {
  if (tableType === 'city') {
    const resolved = resolveBrowseView('city', contextFilters);
    return { view: resolved.view, filters: resolved.filters };
  }
  return { view: FACET_VIEWS.country, filters: contextFilters };
}

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
): Promise<{ items: Array<{ value: string; count: number }> }> {
  const scanFilters = contextFilters.filter((f) => f.field !== field);
  if (search.trim()) {
    scanFilters.push({ field, op: 'contains', value: search.trim() });
  }

  const sampled: Array<{ value: string | null }> = [];
  let page = 1;
  let scanned = 0;

  while (scanned < ASN_CONTEXT_SCAN_CAP) {
    const { sql, params } = buildTableQuery(tableType, {
      page,
      pageSize: ASN_CONTEXT_PAGE_SIZE,
      sort: [],
      filters: scanFilters,
    });

    const result = await query<Record<string, unknown>>(sql, params);
    if (result.rows.length === 0) break;

    if (field === 'asn_org') {
      const ids = result.rows.map((row) => Number(row.id));
      const precomputed = await loadPrecomputedAsn(tableType, ids);
      for (const row of result.rows) {
        const cached = precomputed.get(Number(row.id));
        if (cached) {
          sampled.push({ value: cached.asnOrg });
          continue;
        }
        const lookedUp = await batchLookupAsn([String(row.network)]);
        sampled.push({ value: lookedUp.get(String(row.network))?.asnOrg ?? null });
      }
    } else {
      for (const row of result.rows) {
        sampled.push({ value: row[field] != null ? String(row[field]) : null });
      }
    }

    scanned += result.rows.length;
    if (result.rows.length < ASN_CONTEXT_PAGE_SIZE) break;
    page++;
  }

  return { items: aggregateFacetRows(sampled, limit) };
}

async function getAsnOrgFacetFromBlocks(
  search: string,
  limit: number,
): Promise<{ items: Array<{ value: string; count: number }> }> {
  const params: unknown[] = [];
  let searchClause = '';

  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    searchClause = `AND autonomous_system_organization ILIKE $${params.length}`;
  }

  params.push(limit);
  const limitIdx = params.length;

  const result = await query<{ value: string; count: number }>(
    `SELECT autonomous_system_organization AS value, COUNT(*)::int AS count
     FROM geo_asn_blocks
     WHERE autonomous_system_organization IS NOT NULL
     ${searchClause}
     GROUP BY autonomous_system_organization
     ORDER BY count DESC, value ASC
     LIMIT $${limitIdx}`,
    params,
  );

  return {
    items: result.rows.map((row) => ({
      value: row.value,
      count: row.count,
    })),
  };
}

async function getAsnOrgFacetWithContext(
  tableType: 'city' | 'country',
  search: string,
  limit: number,
  contextFilters: FilterClause[],
): Promise<{ items: Array<{ value: string; count: number }> }> {
  if (hasAsnBlocksFilter(contextFilters)) {
    return getMvFacetWithAsnContext(tableType, 'asn_org', search, limit, contextFilters);
  }

  const { view, filters: facetFilters } = resolveFacetView(tableType, contextFilters);
  const params: unknown[] = [];
  const contextWhere = buildFacetContextWhere(tableType, facetFilters, params, 'v');
  const { joinSql, orgColumn } = getPrecomputedAsnJoin(tableType);

  let searchClause = '';
  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    searchClause = `${orgColumn} ILIKE $${params.length}`;
  }

  params.push(limit);
  const limitIdx = params.length;

  const whereParts = [`${orgColumn} IS NOT NULL`];
  if (contextWhere) whereParts.push(contextWhere);
  if (searchClause) whereParts.push(searchClause);

  const result = await query<{ value: string; count: number }>(
    `SELECT ${orgColumn} AS value, COUNT(*)::int AS count
     FROM ${view} v
     ${joinSql}
     WHERE ${whereParts.join(' AND ')}
     GROUP BY ${orgColumn}
     ORDER BY count DESC, value ASC
     LIMIT $${limitIdx}`,
    params,
  );

  return {
    items: result.rows.map((row) => ({
      value: row.value,
      count: row.count,
    })),
  };
}

export async function getFacetValues(
  tableType: 'city' | 'country',
  field: string,
  search: string,
  limit = 50,
  contextFilters: FilterClause[] = [],
): Promise<{ items: Array<{ value: string; count: number }> }> {
  const allowed = tableType === 'city' ? CITY_FACET_FIELDS : COUNTRY_FACET_FIELDS;
  if (!allowed.has(field)) {
    return { items: [] };
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
      return { items: cached };
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
    return { items: cached };
  }

  const { view, filters: facetFilters } = resolveFacetView(tableType, scopedContext);
  const params: unknown[] = [];
  const contextWhere = buildFacetContextWhere(tableType, facetFilters, params, 'v');
  const facetColumn = `v.${field}`;
  const valueExpr = `${facetColumn}::text`;

  let searchClause = '';
  if (search.trim()) {
    params.push(`%${search.trim()}%`);
    searchClause = `${facetColumn}::text ILIKE $${params.length}`;
  }

  params.push(limit);
  const limitIdx = params.length;

  const whereParts = [`v.${field} IS NOT NULL`];
  if (contextWhere) whereParts.push(contextWhere);
  if (searchClause) whereParts.push(searchClause);

  const result = await query<{ value: string; count: number }>(
    `SELECT ${valueExpr} AS value, COUNT(*)::int AS count
     FROM ${view} v
     WHERE ${whereParts.join(' AND ')}
     GROUP BY ${field}
     ORDER BY count DESC, value ASC
     LIMIT $${limitIdx}`,
    params,
  );

  return {
    items: result.rows.map((row) => ({
      value: row.value,
      count: row.count,
    })),
  };
}
