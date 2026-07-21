import { describe, expect, it } from 'vitest';
import type { RirDatasetStateResponse } from '@geoip/shared';
import {
  ianaSlice,
  rirDatasetLoaded,
  rirRegistriesSlice,
  rirRegistryDetails,
} from './rir-dashboard-stats.js';

const sample: RirDatasetStateResponse = {
  status: 'ready',
  lastSuccessAt: '2026-07-20T01:00:00.000Z',
  lastSnapshotDate: '2026-07-20',
  rowCount: 100,
  rowsByRegistry: {
    ripencc: 40,
    arin: 20,
    apnic: 15,
    lacnic: 10,
    afrinic: 5,
    iana: 10,
  },
  rowsByStatus: { allocated: 80 },
  snapshotsByRegistry: {
    ripencc: '2026-07-20',
    arin: '2026-07-19',
    apnic: '2026-07-20',
    lacnic: '2026-07-18',
    afrinic: '2026-07-20',
    iana: '2026-07-20',
  },
  lastError: null,
};

describe('rir-dashboard-stats', () => {
  it('sums regional RIR rows excluding IANA', () => {
    const slice = rirRegistriesSlice(sample);
    expect(slice.rowCount).toBe(90);
    expect(slice.loaded).toBe(true);
  });

  it('isolates IANA rows', () => {
    const slice = ianaSlice(sample);
    expect(slice.rowCount).toBe(10);
    expect(slice.loaded).toBe(true);
  });

  it('lists all six registries with snapshot dates', () => {
    const details = rirRegistryDetails(sample);
    expect(details).toHaveLength(6);
    expect(details[0]).toMatchObject({
      id: 'ripencc',
      label: 'RIPE NCC',
      rowCount: 40,
      snapshotDate: '2026-07-20',
    });
    expect(details[5]).toMatchObject({ id: 'iana', label: 'IANA', rowCount: 10 });
  });

  it('detects loaded dataset from total row count', () => {
    expect(rirDatasetLoaded(sample)).toBe(true);
    expect(rirDatasetLoaded(undefined)).toBe(false);
    expect(rirRegistriesSlice(undefined).loaded).toBe(false);
    expect(ianaSlice({ ...sample, status: 'unavailable', rowsByRegistry: {} }).loaded).toBe(false);
  });
});
