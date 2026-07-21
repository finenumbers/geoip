import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prepareIntegrationDb, runIntegration, teardownIntegrationDb } from './test-setup.js';

describe.skipIf(!runIntegration)('RIR table integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await prepareIntegrationDb();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await teardownIntegrationDb();
  });

  it('GET /api/v1/table/rir filters by registry=iana and status=reserved', async () => {
    const filters = encodeURIComponent(
      JSON.stringify([
        { field: 'registry', op: 'in', value: ['iana'] },
        { field: 'status', op: 'eq', value: 'reserved' },
      ]),
    );
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/table/rir?page=1&pageSize=20&sort=[]&filters=${filters}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rows: Array<{ registry: string; status: string; rangeText: string }>;
      pagination: { totalRows: number };
    };
    expect(body.pagination.totalRows).toBeGreaterThanOrEqual(1);
    expect(body.rows.every((r) => r.registry === 'iana' && r.status === 'reserved')).toBe(true);
    expect(body.rows.some((r) => r.rangeText === 'AS64512')).toBe(true);
  });

  it('GET /api/v1/table/metadata/facet?tableType=rir returns registry facets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/table/metadata/facet?tableType=rir&field=registry',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ value: string; count: number }> };
    expect(body.items.some((i) => i.value === 'iana')).toBe(true);
  });
});
