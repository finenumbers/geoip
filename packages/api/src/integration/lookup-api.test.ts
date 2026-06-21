import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../config/env.js';
import { buildApp } from '../app.js';
import {
  getIntegrationApiKey,
  integrationApiHeaders,
  prepareIntegrationDb,
  runIntegration,
  teardownIntegrationDb,
} from './test-setup.js';

describe.skipIf(!runIntegration)('lookup API auth', () => {
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

  it('POST /api/v1/lookup rejects missing key when API auth is enabled', async () => {
    if (!loadEnv().API_AUTH_ENABLED) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lookup',
      payload: { ip: '8.8.8.8' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /api/v1/lookup accepts project API key when auth is enabled', async () => {
    if (!loadEnv().API_AUTH_ENABLED) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lookup',
      headers: { 'x-api-key': getIntegrationApiKey() },
      payload: { ip: '8.8.8.8', include: ['country'] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ip: string; meta: { queriedAt: string } };
    expect(body.ip).toBe('8.8.8.8');
    expect(body.meta.queriedAt).toBeTruthy();
  });

  it('POST /api/v1/lookup rejects invalid API key when auth is enabled', async () => {
    if (!loadEnv().API_AUTH_ENABLED) return;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lookup',
      headers: { 'x-api-key': 'invalid-key-value' },
      payload: { ip: '8.8.8.8' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /api/v1/lookup validates IP without MV readiness gate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/lookup',
      headers: integrationApiHeaders(),
      payload: { ip: 'not-an-ip' },
    });

    expect(res.statusCode).toBe(400);
  });
});
