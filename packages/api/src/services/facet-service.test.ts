import { describe, expect, it } from 'vitest';
import {
  buildAsnBlocksJoin,
  buildBrowseContextWhere,
  buildPrecomputedAsnJoin,
} from '../sql/table-query.js';

/** Mirrors facet-service resolveAsnOrgFacetJoin (kept in sync for unit testing). */
function resolveAsnOrgFacetJoin(
  tableType: 'city' | 'country',
  contextFilters: Array<{ field: string; op: string; value: unknown }>,
  params: unknown[],
  usePrecomputedAsnFilter: boolean,
) {
  const ctx = buildBrowseContextWhere(tableType, contextFilters, params, {
    alias: 'v',
    usePrecomputedAsnFilter,
  });

  if (usePrecomputedAsnFilter) {
    const precomputed = buildPrecomputedAsnJoin([], params, tableType, 'v');
    return {
      view: ctx.view,
      joinSql: ctx.useAsnBlocksJoin ? ctx.joinSql : precomputed.joinSql,
      orgColumn: 'ba.asn_org',
      whereSql: ctx.whereSql,
      asnJoinPrecomputed: ctx.asnJoinPrecomputed,
    };
  }

  const live = buildAsnBlocksJoin([], params, tableType, 'v');
  return {
    view: ctx.view,
    joinSql: ctx.useAsnBlocksJoin ? ctx.joinSql : live.joinSql,
    orgColumn: 'ab.autonomous_system_organization',
    whereSql: ctx.whereSql,
    asnJoinPrecomputed: ctx.asnJoinPrecomputed,
  };
}

describe('facet ASN join alignment (Phase E2)', () => {
  it('uses precomputed mapping join for asn_org facet with country-only context', () => {
    const params: unknown[] = [];
    const resolved = resolveAsnOrgFacetJoin(
      'city',
      [{ field: 'country_iso_code', op: 'eq', value: 'RU' }],
      params,
      true,
    );

    expect(resolved.view).toBe('mv_city_blocks_ru');
    expect(resolved.joinSql).toContain('geo_city_block_asn');
    expect(resolved.orgColumn).toBe('ba.asn_org');
    expect(resolved.asnJoinPrecomputed).toBe(false);
  });

  it('uses precomputed ASN filter join when asn filter is in facet context', () => {
    const params: unknown[] = [];
    const resolved = resolveAsnOrgFacetJoin(
      'city',
      [{ field: 'asn', op: 'startsWith', value: '12389' }],
      params,
      true,
    );

    expect(resolved.joinSql).toContain('geo_city_block_asn');
    expect(resolved.asnJoinPrecomputed).toBe(true);
    expect(resolved.whereSql).toContain('ba.asn');
  });

  it('falls back to live geo_asn_blocks join when mapping is not ready', () => {
    const params: unknown[] = [];
    const resolved = resolveAsnOrgFacetJoin(
      'country',
      [{ field: 'country_iso_code', op: 'eq', value: 'US' }],
      params,
      false,
    );

    expect(resolved.joinSql).toContain('geo_asn_blocks ab');
    expect(resolved.orgColumn).toBe('ab.autonomous_system_organization');
    expect(resolved.asnJoinPrecomputed).toBe(false);
  });

  it('table and facet share precomputed ASN filter semantics', () => {
    const filters = [{ field: 'asn_org', op: 'contains', value: 'Rostelecom' }];
    const tableParams: unknown[] = [];
    const facetParams: unknown[] = [];

    const tableCtx = buildBrowseContextWhere('city', filters, tableParams, {
      alias: 'v',
      usePrecomputedAsnFilter: true,
    });
    const facetCtx = buildBrowseContextWhere('city', filters, facetParams, {
      alias: 'v',
      usePrecomputedAsnFilter: true,
    });

    expect(tableCtx.joinSql).toBe(facetCtx.joinSql);
    expect(tableCtx.whereSql).toBe(facetCtx.whereSql);
    expect(tableCtx.asnJoinPrecomputed).toBe(true);
    expect(facetCtx.asnJoinPrecomputed).toBe(true);
  });
});
