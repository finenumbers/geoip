import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { prepareIntegrationDb, runIntegration, teardownIntegrationDb, getIntegrationApiKey } from './test-setup.js';

describe.skipIf(!runIntegration)('export and facet validation integration', () => {
  let app: FastifyInstance;
  let apiKey: string;

  beforeAll(async () => {
    await prepareIntegrationDb();
    app = await buildApp();
    await app.ready();
    apiKey = getIntegrationApiKey();
  });

  afterAll(async () => {
    await app.close();
    await teardownIntegrationDb();
  });

  it('POST /api/v1/exports/table rejects unsupported asn operator with 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exports/table',
      headers: { 'x-api-key': apiKey },
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

  it('@requiresDataset GET /api/v1/table/city normalizes lowercase country_iso_code filter', async () => {
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
