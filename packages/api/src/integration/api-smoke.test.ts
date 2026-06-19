import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { closeDb } from '../db/client.js';

const runIntegration = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!runIntegration)('API integration smoke', () => {
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

  it('GET /api/v1/health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /api/v1/ready returns structured checks', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; checks: Record<string, boolean> };
    expect(['ready', 'degraded', 'not_ready']).toContain(body.status);
    expect(body.checks).toHaveProperty('database');
  });

  it('GET /api/v1/table/city returns paginated payload', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/table/city?page=1&pageSize=5&sort=[]&filters=[]',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: unknown[]; pagination: { page: number } };
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.pagination.page).toBe(1);
  });

  it('GET /api/v1/table/city rejects unknown filter field with 422', async () => {
    const filters = encodeURIComponent(
      JSON.stringify([{ field: 'invalid_field', op: 'eq', value: 'x' }]),
    );
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/table/city?page=1&pageSize=5&sort=[]&filters=${filters}`,
    });
    expect(res.statusCode).toBe(422);
  });

  it('POST /api/v1/lookup validates IP input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lookup',
      payload: { ip: 'not-an-ip' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/v1/table/metadata/facet rejects unknown field with 422', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/table/metadata/facet?tableType=city&field=invalid_field',
    });
    expect(res.statusCode).toBe(422);
  });
});
