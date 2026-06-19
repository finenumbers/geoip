import { describe, it, expect } from 'vitest';
import { isDatasetStateCacheUsable } from './dataset-repository.js';

const snapshot = {
  datasetDate: '2026-06-19',
  activatedAt: null,
  activeImportRunId: null,
  mvStatus: 'refreshing' as const,
  mvRefreshedAt: null,
  cityRowCount: 0,
  countryRowCount: 0,
  filterCountCache: { city: {}, country: {} },
  facetCountCache: { city: {}, country: {} },
};

describe('isDatasetStateCacheUsable', () => {
  it('rejects cache while mvStatus is refreshing', () => {
    const now = Date.now();
    expect(
      isDatasetStateCacheUsable({ data: snapshot, at: now - 1000 }, now, 60_000),
    ).toBe(false);
  });

  it('accepts fresh ready cache', () => {
    const now = Date.now();
    expect(
      isDatasetStateCacheUsable(
        { data: { ...snapshot, mvStatus: 'ready' }, at: now - 1000 },
        now,
        60_000,
      ),
    ).toBe(true);
  });

  it('rejects expired cache', () => {
    const now = Date.now();
    expect(
      isDatasetStateCacheUsable(
        { data: { ...snapshot, mvStatus: 'ready' }, at: now - 61_000 },
        now,
        60_000,
      ),
    ).toBe(false);
  });
});
