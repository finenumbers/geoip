import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFreshSecrets } from '@geoip/shared';
import { buildSetupChecklist } from './setup-checklist.js';
import { resetBootstrapEnvCache } from '../config/bootstrap-env.js';
import {
  loadRuntimeConfig,
  persistRuntimeConfig,
  resetRuntimeConfigCache,
  ensureGeneratedMasterKeyForTests,
} from '../config/runtime-config.js';
import { hashAdminPassword } from './admin-password.js';

vi.mock('../repositories/dataset-repository.js', () => ({
  getDatasetState: vi.fn(),
}));

vi.mock('../sql/recreate-materialized-views.js', () => ({
  materializedViewsExist: vi.fn(),
}));

import { getDatasetState } from '../repositories/dataset-repository.js';
import { materializedViewsExist } from '../sql/recreate-materialized-views.js';

const mockGetDatasetState = vi.mocked(getDatasetState);
const mockMaterializedViewsExist = vi.mocked(materializedViewsExist);

describe('setup-checklist', () => {
  let configDir: string;
  const masterKey = ensureGeneratedMasterKeyForTests();

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'geoip-checklist-'));
    vi.stubEnv('DATABASE_URL', 'postgresql://geoip:geoip@localhost:5433/geoip');
    vi.stubEnv('CONFIG_DATA_DIR', configDir);
    vi.stubEnv('CONFIG_MASTER_KEY', masterKey);
    resetBootstrapEnvCache();
    resetRuntimeConfigCache();
    mockGetDatasetState.mockResolvedValue({
      datasetDate: null,
      mvStatus: 'unavailable',
      cityRowCount: 0,
      countryRowCount: 0,
      mvRefreshedAt: null,
    });
    mockMaterializedViewsExist.mockResolvedValue(false);
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    resetBootstrapEnvCache();
    resetRuntimeConfigCache();
    vi.clearAllMocks();
  });

  it('reports incomplete checklist on fresh install', async () => {
    loadRuntimeConfig();
    const checklist = await buildSetupChecklist();
    expect(checklist.blockingReady).toBe(false);
    expect(checklist.steps.find((s) => s.id === 'adminAccount')?.done).toBe(false);
    expect(checklist.steps.find((s) => s.id === 'grchcCredentials')?.done).toBe(false);
    expect(checklist.steps.find((s) => s.id === 'datasetImported')?.done).toBe(false);
  });

  it('marks admin and grchc done when configured', async () => {
    const config = loadRuntimeConfig();
    persistRuntimeConfig(config.settings, {
      ...createFreshSecrets(),
      geoipLk: { email: 'user@example.com', password: 'secret' },
      admin: {
        username: 'admin',
        passwordHash: hashAdminPassword('password'),
        sessionSecret: config.secrets.admin.sessionSecret,
      },
      api: config.secrets.api,
      integrations: config.secrets.integrations,
    });

    const checklist = await buildSetupChecklist();
    expect(checklist.steps.find((s) => s.id === 'adminAccount')?.done).toBe(true);
    expect(checklist.steps.find((s) => s.id === 'grchcCredentials')?.done).toBe(true);
    expect(checklist.blockingReady).toBe(false);
  });

  it('marks blockingReady when dataset is imported', async () => {
    const config = loadRuntimeConfig();
    persistRuntimeConfig(config.settings, {
      ...createFreshSecrets(),
      geoipLk: { email: 'user@example.com', password: 'secret' },
      admin: {
        username: 'admin',
        passwordHash: hashAdminPassword('password'),
        sessionSecret: config.secrets.admin.sessionSecret,
      },
      api: config.secrets.api,
      integrations: config.secrets.integrations,
    });
    mockGetDatasetState.mockResolvedValue({
      datasetDate: '2026-06-20',
      mvStatus: 'ready',
      cityRowCount: 100,
      countryRowCount: 10,
      mvRefreshedAt: new Date().toISOString(),
    });
    mockMaterializedViewsExist.mockResolvedValue(true);

    const checklist = await buildSetupChecklist();
    expect(checklist.steps.find((s) => s.id === 'datasetImported')?.done).toBe(true);
    expect(checklist.blockingReady).toBe(true);
  });
});
