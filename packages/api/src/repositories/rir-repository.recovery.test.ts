import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());

vi.mock('../db/client.js', () => ({
  query: (...args: unknown[]) => query(...args),
}));

import {
  failOrphanedRunningRirImports,
  recoverStaleRirImportRuns,
  resetStuckRirImports,
} from './rir-repository.js';

describe('rir import recovery helpers', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('recoverStaleRirImportRuns uses 30m window and clears orphan importing state', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 2, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const n = await recoverStaleRirImportRuns(30);
    expect(n).toBe(2);
    expect(query.mock.calls[0]?.[1]).toEqual([
      '30',
      'RIR import abandoned after 30m without progress',
    ]);
    expect(String(query.mock.calls[0]?.[0])).toContain('queued_at');
    expect(String(query.mock.calls[1]?.[0])).toContain("status = 'importing'");
  });

  it('failOrphanedRunningRirImports marks running as orphan', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const n = await failOrphanedRunningRirImports();
    expect(n).toBe(1);
    expect(String(query.mock.calls[0]?.[0])).toContain("error_code = 'orphan'");
  });

  it('resetStuckRirImports clears queued and running', async () => {
    query
      .mockResolvedValueOnce({ rowCount: 3, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await resetStuckRirImports();
    expect(result.clearedRuns).toBe(3);
    expect(String(query.mock.calls[0]?.[0])).toContain('manual_reset');
  });
});
