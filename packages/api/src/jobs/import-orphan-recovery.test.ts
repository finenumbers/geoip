import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withImportLockIfFree: vi.fn(),
  invalidateDatasetStateCache: vi.fn(),
  invalidateReadyCache: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  query: mocks.query,
}));

vi.mock('./import-lock.js', () => ({
  withImportLockIfFree: mocks.withImportLockIfFree,
}));

vi.mock('../repositories/dataset-repository.js', () => ({
  invalidateDatasetStateCache: mocks.invalidateDatasetStateCache,
}));

vi.mock('../services/ready-cache.js', () => ({
  invalidateReadyCache: mocks.invalidateReadyCache,
}));

vi.mock('../config/logger.js', () => ({
  logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  recoverOrphanedGrchcImportsIfLockFree,
  resetStuckGrchcImports,
} from './import-orphan-recovery.js';

describe('recoverOrphanedGrchcImportsIfLockFree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not touch runs when lock is held', async () => {
    mocks.withImportLockIfFree.mockResolvedValue(null);

    const result = await recoverOrphanedGrchcImportsIfLockFree();

    expect(result).toEqual({ clearedIds: [], lockHeld: true });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('fails active runs while lock is held by probe', async () => {
    mocks.withImportLockIfFree.mockImplementation(async (fn: () => Promise<string[]>) => fn());
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 'run-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await recoverOrphanedGrchcImportsIfLockFree();

    expect(result).toEqual({ clearedIds: ['run-1'], lockHeld: false });
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([
      'WORKER_ORPHAN',
      'Import abandoned: advisory lock free (worker lost ownership)',
    ]);
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain("status IN ('running'");
    expect(mocks.invalidateReadyCache).toHaveBeenCalled();
  });
});

describe('resetStuckGrchcImports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails active and queued runs', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 'active-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'queued-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await resetStuckGrchcImports();

    expect(result).toEqual({ clearedRuns: 2 });
    expect(mocks.query.mock.calls[0]?.[1]?.[0]).toBe('manual_reset');
    expect(String(mocks.query.mock.calls[3]?.[0])).toContain("status = 'queued'");
    expect(mocks.invalidateReadyCache).toHaveBeenCalled();
  });
});
