import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { buildPostgresUrl, loadBootstrapEnv, resetBootstrapEnvCache } from './bootstrap-env.js';

describe('buildPostgresUrl', () => {
  it('encodes special characters in password', () => {
    const url = buildPostgresUrl('geoip', 'Test#Pass:123', 'pgbouncer', 6432, 'geoip');
    expect(url).toBe('postgresql://geoip:Test%23Pass%3A123@pgbouncer:6432/geoip');
  });

  it('keeps simple passwords unchanged aside from encoding', () => {
    const url = buildPostgresUrl('geoip', 'geoip', 'postgres', 5432, 'geoip');
    expect(url).toBe('postgresql://geoip:geoip@postgres:5432/geoip');
  });
});

describe('loadBootstrapEnv', () => {
  beforeEach(() => {
    resetBootstrapEnvCache();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    resetBootstrapEnvCache();
    vi.unstubAllEnvs();
  });

  it('builds encoded URLs from POSTGRES_* components', () => {
    vi.stubEnv('POSTGRES_USER', 'geoip');
    vi.stubEnv('POSTGRES_PASSWORD', 'Test#Pass');
    vi.stubEnv('POSTGRES_DB', 'geoip');
    vi.stubEnv('DATABASE_HOST', 'pgbouncer');
    vi.stubEnv('DATABASE_DIRECT_HOST', 'postgres');
    vi.stubEnv('NODE_ENV', 'production');

    const env = loadBootstrapEnv();
    expect(env.DATABASE_URL).toBe('postgresql://geoip:Test%23Pass@pgbouncer:6432/geoip');
    expect(env.DATABASE_DIRECT_URL).toBe('postgresql://geoip:Test%23Pass@postgres:5432/geoip');
  });
});
