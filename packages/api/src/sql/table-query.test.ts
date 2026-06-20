import { describe, it, expect } from 'vitest';
import {
  buildBrowseContextWhere,
  buildTableQuery,
  canUseCachedCount,
  resolvePaginationMode,
  resolveSortOverrideHint,
  resolveTableSortHint,
} from './table-query.js';

describe('buildTableQuery', () => {
  it('builds city table query with pagination and ASN mapping join', () => {
    const { sql, countSql, params, useCachedCount } = buildTableQuery('city', {
      page: 2,
      pageSize: 50,
      sort: [],
      filters: [],
    });
    expect(sql).toContain('mv_city_blocks_analytics');
    expect(sql).not.toContain('geo_asn_blocks');
    expect(sql).toContain('timezone');
    expect(sql).toContain('LIMIT');
    expect(sql).toContain('OFFSET');
    expect(countSql).toBeNull();
    expect(useCachedCount).toBe(true);
    expect(params).toEqual([50, 50]);
  });

  it('applies filters with whitelist fields', () => {
    const { sql, countParams, countSql } = buildTableQuery('city', {
      page: 1,
      pageSize: 25,
      sort: [],
      filters: [
        { field: 'country_iso_code', op: 'eq', value: 'RU' },
        { field: 'invalid_field', op: 'eq', value: 'x' },
      ],
    });
    expect(sql).toContain('mv_city_blocks_ru');
    expect(sql).not.toMatch(/WHERE[\s\S]*v\.country_iso_code\s*=/);
    expect(countSql).toContain('COUNT');
    expect(countParams).toEqual([]);
  });

  it('uses keyset pagination when cursor is provided', () => {
    const { sql, params } = buildTableQuery('city', {
      page: 2,
      pageSize: 50,
      sort: [],
      filters: [],
      afterId: 11,
      afterNetwork: '1.0.1.0/24',
    });
    expect(sql).toContain('(v.network, v.id) >');
    expect(sql).not.toContain('OFFSET');
    expect(params).toEqual(['1.0.1.0/24', 11, 50]);
  });

  it('applies sort whitelist', () => {
    const { sql } = buildTableQuery('country', {
      page: 1,
      pageSize: 10,
      sort: [
        { field: 'country_name', dir: 'desc' },
        { field: 'bad_field', dir: 'asc' },
      ],
      filters: [],
    });
    expect(sql).toContain('country_name DESC');
    expect(sql).not.toContain('bad_field');
  });

  it('filters ASN via geo_asn_blocks join', () => {
    const { sql, countSql, countParams, skipExactCount } = buildTableQuery('city', {
      page: 1,
      pageSize: 25,
      sort: [],
      filters: [{ field: 'asn', op: 'startsWith', value: '13238' }],
    });
    expect(sql).toContain('geo_asn_blocks ab');
    expect(sql).toContain('DISTINCT ON (v.id)');
    expect(sql).toContain('masklen(ab.network) DESC');
    expect(sql).toContain('ORDER BY v.network ASC, v.id ASC');
    expect(sql).not.toMatch(/ORDER BY[\s\S]*cb\.id/);
    expect(sql).toContain('autonomous_system_number::text ILIKE');
    expect(countSql).toBeNull();
    expect(skipExactCount).toBe(true);
    expect(countParams).toEqual(['13238%']);
  });

  it('sorts by network when ASN filter uses live geo_asn_blocks join', () => {
    const { sql } = buildTableQuery('city', {
      page: 1,
      pageSize: 25,
      sort: [{ field: 'network', dir: 'desc' }],
      filters: [{ field: 'asn', op: 'eq', value: 13238 }],
    });
    expect(sql).toContain('DISTINCT ON (v.id)');
    expect(sql).toContain('ORDER BY v.network DESC, v.id ASC');
    expect(sql).not.toMatch(/ORDER BY[\s\S]*cb\.id/);
  });

  it('applies keyset pagination on deduplicated live ASN join', () => {
    const { sql, params } = buildTableQuery('city', {
      page: 2,
      pageSize: 25,
      sort: [{ field: 'network', dir: 'asc' }],
      filters: [{ field: 'asn', op: 'eq', value: 13238 }],
      afterId: 42,
      afterNetwork: '1.0.0.0/24',
    });
    expect(sql).toContain('DISTINCT ON (v.id)');
    expect(sql).toContain('(v.network, v.id) >');
    expect(sql).not.toContain('OFFSET');
    expect(params).toEqual([13238, '1.0.0.0/24', 42, 25]);
  });

  it('filters ASN via precomputed mapping when enabled', () => {
    const { sql, countSql } = buildTableQuery(
      'city',
      {
        page: 1,
        pageSize: 25,
        sort: [],
        filters: [{ field: 'asn', op: 'eq', value: 13238 }],
        usePrecomputedAsnFilter: true,
      },
    );
    expect(sql).toContain('geo_city_block_asn ba');
    expect(sql).not.toContain('geo_asn_blocks');
    expect(sql).toContain('ba.asn =');
    expect(countSql).toBeNull();
    expect(sql).not.toContain('cb.id');
  });

  it('uses rank-based sort for country_name DESC on city table', () => {
    const { sql } = buildTableQuery('city', {
      page: 1,
      pageSize: 50,
      sort: [{ field: 'country_name', dir: 'desc' }],
      filters: [],
    });
    expect(sql).toContain('country_name_rank ASC');
    expect(sql).not.toContain('country_name DESC');
  });

  it('uses sort keyset pagination for country_name sort via rank', () => {
    const { sql, params } = buildTableQuery('city', {
      page: 2,
      pageSize: 50,
      sort: [{ field: 'country_name', dir: 'desc' }],
      filters: [],
      afterId: 100,
      afterSortValue: '12',
    });
    expect(sql).toContain('country_name_rank');
    expect(sql).not.toContain('OFFSET');
    expect(params).toEqual([12, 100, 50]);
  });

  it('rewrites country_name sort to network on RU partial MV', () => {
    const { sql } = buildTableQuery('city', {
      page: 1,
      pageSize: 50,
      sort: [{ field: 'country_name', dir: 'desc' }],
      filters: [{ field: 'country_iso_code', op: 'eq', value: 'RU' }],
    });
    expect(sql).toContain('mv_city_blocks_ru');
    expect(sql).toContain('ORDER BY v.network DESC');
    expect(sql).not.toMatch(/ORDER BY[\s\S]*country_name_rank/);
  });

  it('detects cached count eligibility', () => {
    expect(canUseCachedCount([])).toBe(true);
    expect(canUseCachedCount([{ field: 'country_iso_code', op: 'eq', value: 'RU' }])).toBe(false);
  });

  it('does not flag sort hint when rank columns are used on full city table', () => {
    expect(
      resolveTableSortHint('city', [{ field: 'country_name', dir: 'desc' }], []),
    ).toBeNull();
    expect(
      resolveTableSortHint(
        'city',
        [{ field: 'country_name', dir: 'desc' }],
        [{ field: 'country_iso_code', op: 'eq', value: 'RU' }],
      ),
    ).toBeNull();
  });

  it('resolves pagination mode from cursor presence', () => {
    expect(resolvePaginationMode([{ field: 'network', dir: 'asc' }], 2, 1, '1.0.0.0/8')).toBe('keyset');
    expect(resolvePaginationMode([{ field: 'network', dir: 'asc' }], 2)).toBe('offset');
    expect(resolvePaginationMode([{ field: 'asn', dir: 'asc' }], 5, 1, '1.0.0.0/8')).toBe('offset');
  });

  it('buildBrowseContextWhere uses RU partial view for city RU filter', () => {
    const params: unknown[] = [];
    const ctx = buildBrowseContextWhere('city', [
      { field: 'country_iso_code', op: 'eq', value: 'RU' },
      { field: 'city_name', op: 'contains', value: 'Mos' },
    ], params);
    expect(ctx.view).toBe('mv_city_blocks_ru');
    expect(ctx.ruPartial).toBe(true);
    expect(ctx.whereSql).toContain('city_name');
    expect(ctx.whereSql).not.toContain('country_iso_code');
    expect(params).toEqual(['%Mos%']);
  });

  it('buildBrowseContextWhere uses RU partial view for country_iso_code in [RU]', () => {
    const params: unknown[] = [];
    const ctx = buildBrowseContextWhere('city', [
      { field: 'country_iso_code', op: 'in', value: ['RU'] },
      { field: 'city_name', op: 'contains', value: 'Mos' },
    ], params);
    expect(ctx.view).toBe('mv_city_blocks_ru');
    expect(ctx.ruPartial).toBe(true);
    expect(ctx.whereSql).toContain('city_name');
    expect(ctx.whereSql).not.toContain('country_iso_code');
    expect(params).toEqual(['%Mos%']);
  });

  it('table and facet context share the same view for RU city filter', () => {
    const filters = [{ field: 'country_iso_code', op: 'eq', value: 'RU' }];
    const tableParams: unknown[] = [];
    const facetParams: unknown[] = [];
    const tableCtx = buildBrowseContextWhere('city', filters, tableParams);
    const facetCtx = buildBrowseContextWhere('city', filters, facetParams);
    expect(tableCtx.view).toBe(facetCtx.view);
    expect(tableCtx.view).toBe('mv_city_blocks_ru');
  });

  it('detects RU partial country_name sort override hint', () => {
    const filters = [{ field: 'country_iso_code', op: 'eq', value: 'RU' }];
    const sort = [{ field: 'country_name', dir: 'desc' }];
    expect(resolveSortOverrideHint('city', sort, filters)).toBe('ru_partial_network');
    expect(resolveSortOverrideHint('city', sort, [])).toBeNull();
  });

  it('uses keyset pagination for prefix_len on page 2', () => {
    const { sql, params } = buildTableQuery('city', {
      page: 2,
      pageSize: 50,
      sort: [{ field: 'prefix_len', dir: 'desc' }],
      filters: [],
      afterId: 100,
      afterSortValue: '24',
    });
    expect(sql).toContain('prefix_len');
    expect(sql).not.toContain('OFFSET');
    expect(sql).toContain('(v.prefix_len, v.id)');
    expect(params[0]).toBe(24);
  });
});
