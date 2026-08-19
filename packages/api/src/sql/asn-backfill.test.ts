import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isAsnMappingReady: vi.fn(),
  markAsnMappingReady: vi.fn(),
  populateBlockAsnMappings: vi.fn(),
  getRunningImport: vi.fn(),
  isImportLockFree: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../sql/asn-mapping-status.js', () => ({
  isAsnMappingReady: mocks.isAsnMappingReady,
  markAsnMappingReady: mocks.markAsnMappingReady,
}));

vi.mock('../sql/asn-mapping.js', () => ({
  populateBlockAsnMappings: mocks.populateBlockAsnMappings,
}));

vi.mock('../repositories/dataset-repository.js', () => ({
  getRunningImport: mocks.getRunningImport,
}));

vi.mock('../jobs/import-lock.js', () => ({
  isImportLockFree: mocks.isImportLockFree,
}));

import { ensureAsnMappingsInBackground } from '../sql/asn-backfill.js';

describe('ensureAsnMappingsInBackground guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAsnMappingReady.mockResolvedValue(false);
    mocks.getRunningImport.mockResolvedValue(null);
    mocks.isImportLockFree.mockResolvedValue(true);
    mocks.populateBlockAsnMappings.mockResolvedValue({ city: 1, country: 1 });
  });

  it('skips when import is running', async () => {
    mocks.getRunningImport.mockResolvedValue({ id: 'run-1' });

    await ensureAsnMappingsInBackground({
      info: mocks.info,
      debug: mocks.debug,
      error: mocks.error,
    } as never);

    expect(mocks.populateBlockAsnMappings).not.toHaveBeenCalled();
    expect(mocks.debug).toHaveBeenCalled();
  });

  it('skips when import lock is held', async () => {
    mocks.isImportLockFree.mockResolvedValue(false);

    await ensureAsnMappingsInBackground({
      info: mocks.info,
      debug: mocks.debug,
      error: mocks.error,
    } as never);

    expect(mocks.populateBlockAsnMappings).not.toHaveBeenCalled();
  });

  it('starts populate when idle', async () => {
    await ensureAsnMappingsInBackground({
      info: mocks.info,
      debug: mocks.debug,
      error: mocks.error,
    } as never);

    await vi.waitFor(() => {
      expect(mocks.populateBlockAsnMappings).toHaveBeenCalled();
    });
  });
});
