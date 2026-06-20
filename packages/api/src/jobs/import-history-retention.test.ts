import { describe, expect, it, vi, beforeEach } from 'vitest';
import { pruneImportHistory, getImportHistoryLimit } from './import-history-retention.js';
import { query } from '../db/client.js';
import { getDatasetState, getRunningImport } from '../repositories/dataset-repository.js';

vi.mock('../db/client.js', () => ({
  query: vi.fn(),
}));

vi.mock('../repositories/dataset-repository.js', () => ({
  getDatasetState: vi.fn(),
  getRunningImport: vi.fn(),
}));

vi.mock('../config/env.js', () => ({
  loadEnv: vi.fn(() => ({ IMPORT_HISTORY_LIMIT: 10 })),
}));

describe('pruneImportHistory', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
    vi.mocked(getDatasetState).mockReset();
    vi.mocked(getRunningImport).mockReset();
  });

  it('deletes runs beyond limit while protecting active and running imports', async () => {
    vi.mocked(getDatasetState).mockResolvedValue({
      datasetDate: '2026-06-19',
      activatedAt: null,
      activeImportRunId: 'active-id',
      mvStatus: 'ready',
      mvRefreshedAt: null,
      datasetFingerprint: null,
      cityRowCount: 0,
      countryRowCount: 0,
      volumes: {
        cityBlocks: 0,
        countryBlocks: 0,
        asnBlocks: 0,
        cityLocations: 0,
        countryLocations: 0,
        ruCityBlocks: 0,
        ipv4Addresses: '0',
        ipv6Addresses: '0',
      },
      filterCountCache: { city: {}, country: {} },
      facetCountCache: { city: {}, country: {} },
    });
    vi.mocked(getRunningImport).mockResolvedValue({ id: 'running-id' } as never);
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ id: 'old-1' }, { id: 'old-2' }], rowCount: 2 } as never)
      .mockResolvedValueOnce({ rows: [{ count: 10 }] } as never);

    const result = await pruneImportHistory();

    expect(result).toEqual({ deletedCount: 2, keptCount: 10 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM import_runs'),
      [getImportHistoryLimit(), ['active-id', 'running-id']],
    );
  });

  it('passes empty protected list when no active or running import', async () => {
    vi.mocked(getDatasetState).mockResolvedValue({
      datasetDate: null,
      activatedAt: null,
      activeImportRunId: null,
      mvStatus: 'unavailable',
      mvRefreshedAt: null,
      datasetFingerprint: null,
      cityRowCount: 0,
      countryRowCount: 0,
      volumes: {
        cityBlocks: 0,
        countryBlocks: 0,
        asnBlocks: 0,
        cityLocations: 0,
        countryLocations: 0,
        ruCityBlocks: 0,
        ipv4Addresses: '0',
        ipv6Addresses: '0',
      },
      filterCountCache: { city: {}, country: {} },
      facetCountCache: { city: {}, country: {} },
    });
    vi.mocked(getRunningImport).mockResolvedValue(null);
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [{ count: 5 }] } as never);

    const result = await pruneImportHistory();

    expect(result).toEqual({ deletedCount: 0, keptCount: 5 });
    expect(query).toHaveBeenCalledWith(expect.any(String), [getImportHistoryLimit(), []]);
  });
});
