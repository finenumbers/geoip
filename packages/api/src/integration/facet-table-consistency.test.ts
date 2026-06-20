import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { closeDb } from '../db/client.js';

const runIntegration = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!runIntegration)('facet vs table consistency', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await migrate();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('facet city_name counts sum does not exceed table total for RU context', async () => {
    const filters = JSON.stringify([{ field: 'country_iso_code', op: 'eq', value: 'RU' }]);
    const tableRes = await app.inject({
      method: 'GET',
      url: `/api/v1/table/city?page=1&pageSize=5&sort=[]&filters=${encodeURIComponent(filters)}`,
    });
    expect(tableRes.statusCode).toBe(200);
    const table = tableRes.json() as {
      pagination: { totalRows: number };
      meta: { browseView?: string };
    };
    expect(table.meta.browseView).toBe('mv_city_blocks_ru');

    const facetRes = await app.inject({
      method: 'GET',
      url: `/api/v1/table/metadata/facet?tableType=city&field=city_name&limit=100&contextFilters=${encodeURIComponent(filters)}`,
    });
    expect(facetRes.statusCode).toBe(200);
    const facet = facetRes.json() as { items: Array<{ value: string; count: number }> };
    const facetSum = facet.items.reduce((sum, item) => sum + item.count, 0);
    expect(facetSum).toBeGreaterThan(0);
    expect(facetSum).toBeLessThanOrEqual(table.pagination.totalRows);
  });

  it('uses RU partial MV for country_iso_code in [RU]', async () => {
    const filters = JSON.stringify([{ field: 'country_iso_code', op: 'in', value: ['RU'] }]);
    const tableRes = await app.inject({
      method: 'GET',
      url: `/api/v1/table/city?page=1&pageSize=5&sort=[]&filters=${encodeURIComponent(filters)}`,
    });
    expect(tableRes.statusCode).toBe(200);
    const table = tableRes.json() as { meta: { browseView?: string } };
    expect(table.meta.browseView).toBe('mv_city_blocks_ru');
  });

  it('table returns sortOverrideHint when sorting country_name on RU partial MV', async () => {
    const filters = JSON.stringify([{ field: 'country_iso_code', op: 'eq', value: 'RU' }]);
    const sort = JSON.stringify([{ field: 'country_name', dir: 'desc' }]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/table/city?page=1&pageSize=5&sort=${encodeURIComponent(sort)}&filters=${encodeURIComponent(filters)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { meta: { sortOverrideHint?: string | null } };
    expect(body.meta.sortOverrideHint).toBe('ru_partial_network');
  });

  it('facet counts stay within table total when ASN filter is in context', async () => {
    const contextFilters = JSON.stringify([
      { field: 'country_iso_code', op: 'eq', value: 'RU' },
      { field: 'asn', op: 'startsWith', value: '123' },
    ]);

    const tableRes = await app.inject({
      method: 'GET',
      url: `/api/v1/table/city?page=1&pageSize=50&sort=[]&filters=${encodeURIComponent(contextFilters)}`,
    });
    expect(tableRes.statusCode).toBe(200);
    const table = tableRes.json() as {
      pagination: { totalRows: number };
      rows: unknown[];
      meta?: { countSource?: string };
    };

    const facetRes = await app.inject({
      method: 'GET',
      url: `/api/v1/table/metadata/facet?tableType=city&field=city_name&limit=200&contextFilters=${encodeURIComponent(contextFilters)}`,
    });
    expect(facetRes.statusCode).toBe(200);
    const facet = facetRes.json() as {
      items: Array<{ value: string; count: number }>;
      meta?: { source?: string; sampledRows?: number };
    };

    if (table.rows.length === 0) {
      expect(facet.items).toEqual([]);
      return;
    }

    const facetSum = facet.items.reduce((sum, item) => sum + item.count, 0);
    expect(facetSum).toBeGreaterThan(0);

    if (facet.meta?.source === 'sample') {
      expect(facet.meta.sampledRows).toBeGreaterThan(0);
      expect(facetSum).toBeLessThanOrEqual(facet.meta.sampledRows ?? facetSum);
    } else if (table.meta?.countSource !== 'estimated') {
      expect(facetSum).toBeLessThanOrEqual(table.pagination.totalRows);
    }
  }, 30_000);
});
