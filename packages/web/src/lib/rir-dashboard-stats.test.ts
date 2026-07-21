import { describe, expect, it } from 'vitest';
import type { RirDatasetStateResponse } from '@geoip/shared';
import { ianaSlice, rirRegistriesSlice } from './rir-dashboard-stats.js';

const sample: RirDatasetStateResponse = {
  status: 'ready',
  lastSuccessAt: '2026-07-21T06:00:00.000Z',
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
  rowsByStatus: { allocated: 80, reserved: 20 },
  lastError: null,
};

describe('rir-dashboard-stats', () => {
  it('sums five RIRs without IANA', () => {
    const slice = rirRegistriesSlice(sample);
    expect(slice.rowCount).toBe(90);
    expect(slice.rowsByRegistry.iana).toBeUndefined();
    expect(slice.loaded).toBe(true);
  });

  it('isolates IANA count', () => {
    const slice = ianaSlice(sample);
    expect(slice.rowCount).toBe(10);
    expect(slice.loaded).toBe(true);
  });

  it('marks empty snapshot as not loaded', () => {
    expect(rirRegistriesSlice(undefined).loaded).toBe(false);
    expect(ianaSlice({ ...sample, status: 'unavailable', rowsByRegistry: {} }).loaded).toBe(false);
  });
});
