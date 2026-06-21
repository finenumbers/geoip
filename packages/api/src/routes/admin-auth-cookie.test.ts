import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { registerAdminAuthRoutes } from './admin.js';
import { resetAdminAuthRateLimitForTests } from '../utils/admin-auth-rate-limit.js';

vi.mock('../config/runtime-config.js', () => ({
  loadRuntimeConfig: () => ({
    secrets: { admin: { sessionSecret: 'test-session-secret-32chars!!' } },
  }),
  toAdminConfigResponse: vi.fn(),
}));

vi.mock('../services/admin-config-service.js', () => ({
  isAdminSetupComplete: () => true,
  verifyAdminCredentials: (username: string, password: string) =>
    username === 'admin' && password === 'secret',
  completeAdminSetup: vi.fn(),
  AdminConfigError: class AdminConfigError extends Error {},
}));

function parseSetCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return header ?? '';
}

describe('admin login session cookie', () => {
  afterEach(() => {
    resetAdminAuthRateLimitForTests();
  });

  it('omits Secure flag over plain HTTP (Portainer :8080)', async () => {
    const app = Fastify({ trustProxy: true });
    app.decorate('requireAdminSession', async () => {});
    await app.register(cookie);
    await registerAdminAuthRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: { username: 'admin', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const cookieHeader = parseSetCookie(res.headers['set-cookie']);
    expect(cookieHeader).toContain('geoip_admin_session=');
    expect(cookieHeader).not.toMatch(/;\s*Secure/i);
    await app.close();
  });

  it('sets Secure flag when X-Forwarded-Proto is https', async () => {
    const app = Fastify({ trustProxy: true });
    app.decorate('requireAdminSession', async () => {});
    await app.register(cookie);
    await registerAdminAuthRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      headers: { 'x-forwarded-proto': 'https' },
      payload: { username: 'admin', password: 'secret' },
    });

    expect(res.statusCode).toBe(200);
    const cookieHeader = parseSetCookie(res.headers['set-cookie']);
    expect(cookieHeader).toMatch(/;\s*Secure/i);
    await app.close();
  });
});
