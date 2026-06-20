import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prepareIntegrationDb, runIntegration, teardownIntegrationDb } from './test-setup.js';

describe.skipIf(!runIntegration)('keyset pagination (Phase C)', () => {
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

  it('page 2 with cursor uses keyset mode', async () => {
    const p1 = await app.inject({
      method: 'GET',
      url: '/api/v1/table/city?page=1&pageSize=1&sort=[]&filters=[]',
    });
    expect(p1.statusCode).toBe(200);
    const body1 = p1.json() as {
      meta: { nextCursor?: { afterId: number; afterNetwork?: string } | null; paginationMode?: string };
    };
    const cursor = body1.meta.nextCursor;
    expect(cursor).toBeTruthy();
    if (!cursor) return;

    const p2 = await app.inject({
      method: 'GET',
      url: `/api/v1/table/city?page=2&pageSize=1&sort=[]&filters=[]&afterId=${cursor.afterId}&afterNetwork=${encodeURIComponent(cursor.afterNetwork ?? '')}`,
    });
    expect(p2.statusCode).toBe(200);
    const body2 = p2.json() as { meta: { paginationMode?: string } };
    expect(body2.meta.paginationMode).toBe('keyset');
  });

  it('asn sort reports offset_only warning', async () => {
    const sort = encodeURIComponent(JSON.stringify([{ field: 'asn', dir: 'asc' }]));
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/table/city?page=1&pageSize=5&sort=${sort}&filters=[]`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { meta: { paginationWarning?: string | null } };
    expect(body.meta.paginationWarning).toBe('offset_only');
  }, 30_000);
});
