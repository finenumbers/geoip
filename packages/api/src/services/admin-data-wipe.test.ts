import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../config/env.js', () => ({
  loadEnv: vi.fn(() => ({
    IMPORT_DOWNLOAD_DIR: '/tmp/geoip-import-wipe-test',
    EXPORT_DIR: '/tmp/geoip-export-wipe-test',
  })),
}));

const clientQuery = vi.fn(async () => ({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] }));

vi.mock('../db/client.js', () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] })),
  withDirectPoolClient: vi.fn(async (fn: (client: { query: typeof clientQuery }) => Promise<unknown>) =>
    fn({ query: clientQuery }),
  ),
}));

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('../jobs/import-lock.js', () => ({
  releaseOrphanedImportLock: vi.fn(async () => undefined),
}));

vi.mock('../jobs/rir-import-lock.js', () => ({
  releaseOrphanedRirImportLock: vi.fn(async () => undefined),
}));

vi.mock('../repositories/dataset-repository.js', () => ({
  invalidateDatasetStateCache: vi.fn(),
}));

vi.mock('../sql/recreate-materialized-views.js', () => ({
  recreateMaterializedViewsFromProduction: vi.fn(async () => undefined),
}));

vi.mock('../sql/asn-mapping-status.js', () => ({
  invalidateAsnMappingCache: vi.fn(),
}));

vi.mock('./ready-cache.js', () => ({
  invalidateReadyCache: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      rm: vi.fn(async () => undefined),
    },
    unlinkSync: vi.fn(),
    existsSync: vi.fn(() => false),
  };
});

const { query, withDirectPoolClient } = await import('../db/client.js');
const { wipeAllDatasets } = await import('./admin-data-wipe.js');
const { recreateMaterializedViewsFromProduction } = await import('../sql/recreate-materialized-views.js');
const { invalidateDatasetStateCache } = await import('../repositories/dataset-repository.js');
const { invalidateReadyCache } = await import('./ready-cache.js');
const { invalidateAsnMappingCache } = await import('../sql/asn-mapping-status.js');

describe('wipeAllDatasets', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    clientQuery.mockReset();
    vi.mocked(withDirectPoolClient).mockClear();
    vi.mocked(query).mockResolvedValue({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
    clientQuery.mockResolvedValue({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
  });

  it('truncates datasets, clears history, and invalidates caches', async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, download_path FROM export_jobs')) {
        return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
      }
      if (sql.includes('DELETE FROM import_runs')) {
        return { rows: [], rowCount: 3, command: 'DELETE', oid: 0, fields: [] };
      }
      if (sql.includes('DELETE FROM rir_import_runs')) {
        return { rows: [], rowCount: 2, command: 'DELETE', oid: 0, fields: [] };
      }
      if (sql.includes('DELETE FROM export_jobs')) {
        return { rows: [], rowCount: 1, command: 'DELETE', oid: 0, fields: [] };
      }
      return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
    });

    const result = await wipeAllDatasets();

    expect(result).toEqual({
      ok: true,
      grchcImportRunsDeleted: 3,
      rirImportRunsDeleted: 2,
      exportJobsDeleted: 1,
      exportFilesRemoved: 0,
      zipCacheCleared: true,
    });
    expect(withDirectPoolClient).toHaveBeenCalled();
    expect(recreateMaterializedViewsFromProduction).toHaveBeenCalled();
    expect(invalidateDatasetStateCache).toHaveBeenCalled();
    expect(invalidateReadyCache).toHaveBeenCalled();
    expect(invalidateAsnMappingCache).toHaveBeenCalled();

    const heavySql = clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(heavySql.some((sql) => sql.includes('TRUNCATE') && sql.includes('geo_city_blocks'))).toBe(
      true,
    );
    expect(heavySql.some((sql) => sql.includes('TRUNCATE') && sql.includes('rir_delegations'))).toBe(
      true,
    );
    expect(
      heavySql.some((sql) => sql.includes('TRUNCATE') && sql.includes('geo_rir_cc_mismatches')),
    ).toBe(true);
    expect(heavySql.some((sql) => sql.includes('TRUNCATE') && sql.includes('rir_rdap_cache'))).toBe(
      true,
    );
    expect(
      heavySql.some(
        (sql) =>
          sql.includes('UPDATE geo_rir_cc_mismatch_state') && sql.includes("status = 'never'"),
      ),
    ).toBe(true);

    const sqlCalls = vi.mocked(query).mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls.some((sql) => sql.includes('UPDATE dataset_state'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE rir_dataset_state'))).toBe(true);
  });
});
