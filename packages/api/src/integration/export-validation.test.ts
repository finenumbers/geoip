import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { migrate } from '../db/migrate.js';
import { closeDb } from '../db/client.js';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const API_KEY = process.env.IMPORT_API_KEY ?? 'ci-test-api-key-12345';

describe.skipIf(!runIntegration)('export and facet validation integration', () => {
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

  it('POST /api/v1/exports/table rejects unsupported asn operator with 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exports/table',
      headers: { 'x-api-key': API_KEY },
      payload: {
        tableType: 'city',
        filters: [{ field: 'asn', op: 'contains', value: '123' }],
        sort: [],
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('GET /api/v1/table/metadata/facet rejects unknown field with 422', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/table/metadata/facet?tableType=city&field=not_a_field',
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { details?: { fieldErrors?: Record<string, string[]> } };
    expect(body.details?.fieldErrors?.field?.[0]).toMatch(/Unknown facet field/);
  });

  it('GET /api/v1/table/city normalizes lowercase country_iso_code filter', async () => {
    const filters = encodeURIComponent(
      JSON.stringify([{ field: 'country_iso_code', op: 'eq', value: 'ru' }]),
    );
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/table/city?page=1&pageSize=3&sort=[]&filters=${filters}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ countryIsoCode: string | null }> };
    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) {
      expect(row.countryIsoCode).toBe('RU');
    }
  });
});
