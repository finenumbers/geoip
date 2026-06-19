import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../config/env.js', () => ({
  loadEnv: vi.fn(() => ({ EXPORT_RETENTION_DAYS: 7, EXPORT_RETENTION_LIMIT: 100 })),
}));

vi.mock('../db/client.js', () => ({
  query: vi.fn(),
}));

const { query } = await import('../db/client.js');
const { pruneExportHistory } = await import('./export-retention.js');

describe('pruneExportHistory', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('removes export files for deleted jobs', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({
        rows: [{ id: 'job-1', download_path: '/tmp/geoip-import/exports/missing.csv' }],
        rowCount: 1,
        command: 'DELETE',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [{ count: 2 }],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

    const result = await pruneExportHistory();
    expect(result.deletedCount).toBe(1);
    expect(result.keptCount).toBe(2);
    expect(result.filesRemoved).toBe(0);
  });
});
