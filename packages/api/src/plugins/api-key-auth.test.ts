import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerApiKeyAuth } from './api-key-auth.js';

vi.mock('../config/env.js', () => ({
  loadEnv: vi.fn(() => ({
    API_KEY: 'test-secret-key',
    API_AUTH_ENABLED: true,
  })),
}));

describe('api-key-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function buildTestApp() {
    const app = Fastify();
    await registerApiKeyAuth(app);
    app.get('/protected', { preHandler: [app.verifyApiKeyIfEnabled] }, async () => ({ ok: true }));
    app.get('/always', { preHandler: [app.verifyApiKey] }, async () => ({ ok: true }));
    await app.ready();
    return app;
  }

  it('rejects missing key on always-protected routes', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/always' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('accepts valid key on always-protected routes', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/always',
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects missing key when API auth is enabled', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
