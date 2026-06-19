import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRunningImport: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('../repositories/dataset-repository.js', () => ({
  getRunningImport: mocks.getRunningImport,
}));

vi.mock('../db/client.js', () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: mocks.insert,
      }),
    }),
  }),
}));

import { createImportRun } from './import-service.js';

describe('createImportRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns conflict when an import is already active', async () => {
    mocks.getRunningImport.mockResolvedValue({ id: 'running-id' });

    const result = await createImportRun('api');

    expect(result).toEqual({ conflict: true, importRunId: 'running-id' });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('queues a new import when none is active', async () => {
    mocks.getRunningImport.mockResolvedValue(null);
    mocks.insert.mockResolvedValue([{ id: 'new-id' }]);

    const result = await createImportRun('api');

    expect(result).toEqual({ conflict: false, importRunId: 'new-id' });
    expect(mocks.insert).toHaveBeenCalled();
  });
});
