import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadRuntimeConfig,
  resetRuntimeConfigCache,
  toAdminConfigResponse,
  persistRuntimeConfig,
} from './runtime-config.js';
import { resetBootstrapEnvCache } from './bootstrap-env.js';
import { ensureGeneratedMasterKeyForTests } from './runtime-config.js';

describe('runtime-config', () => {
  let configDir: string;
  const masterKey = ensureGeneratedMasterKeyForTests();

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'geoip-config-'));
    vi.stubEnv('DATABASE_URL', 'postgresql://geoip:geoip@localhost:5433/geoip');
    vi.stubEnv('CONFIG_DATA_DIR', configDir);
    vi.stubEnv('CONFIG_MASTER_KEY', masterKey);
    resetBootstrapEnvCache();
    resetRuntimeConfigCache();
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    resetBootstrapEnvCache();
    resetRuntimeConfigCache();
  });

  it('creates fresh config on first boot without env secrets', () => {
    const config = loadRuntimeConfig();
    expect(config.secrets.geoipLk.email).toBe('');
    expect(config.secrets.geoipLk.password).toBe('');
    expect(config.secrets.api.importApiKey.length).toBeGreaterThanOrEqual(64);
    expect(config.secrets.api.apiKey).toBe('');
    expect(config.meta.migratedFromEnv).toBe(false);

    const response = toAdminConfigResponse(config);
    expect(response.secrets.geoipLk.password.hasValue).toBe(false);
    expect(response.meta.setupComplete).toBe(false);
  });

  it('applies production profile on first boot', () => {
    vi.stubEnv('NODE_ENV', 'production');
    resetBootstrapEnvCache();
    resetRuntimeConfigCache();
    const config = loadRuntimeConfig();
    expect(config.settings.api.authEnabled).toBe(true);
    expect(config.settings.logging.accessLogEnabled).toBe(true);
  });

  it('persists patches and enforces fixed import schedule', () => {
    loadRuntimeConfig();
    const updated = persistRuntimeConfig(
      {
        ...loadRuntimeConfig().settings,
        import: { ...loadRuntimeConfig().settings.import, cron: '0 8 * * *' },
      },
      loadRuntimeConfig().secrets,
    );
    expect(updated.settings.import.cron).toBe('0 10 * * *');
    resetRuntimeConfigCache();
    expect(loadRuntimeConfig().settings.import.cron).toBe('0 10 * * *');
  });

  it('rejects partial config store', () => {
    writeFileSync(join(configDir, 'settings.json'), '{}');
    expect(() => loadRuntimeConfig()).toThrow(/Config store incomplete/);
  });

  it('persists ensureApiKeys backfill after restart', () => {
    const config = loadRuntimeConfig();
    const importKey = config.secrets.api.importApiKey;
    expect(importKey.length).toBeGreaterThanOrEqual(64);
    resetRuntimeConfigCache();
    const reloaded = loadRuntimeConfig();
    expect(reloaded.secrets.api.importApiKey).toBe(importKey);
  });
});
