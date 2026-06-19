import { describe, expect, it } from 'vitest';
import {
  datasetVolumesNeedBackfill,
  parseFingerprintFromDiscoverMessage,
} from './dataset-volumes-backfill.js';

describe('parseFingerprintFromDiscoverMessage', () => {
  it('parses fingerprint from discover_date step message', () => {
    expect(parseFingerprintFromDiscoverMessage('date=20260619 fp=27a5040b65ea3cdd')).toBe(
      '27a5040b65ea3cdd',
    );
  });

  it('returns null for missing message', () => {
    expect(parseFingerprintFromDiscoverMessage(null)).toBeNull();
  });
});

describe('datasetVolumesNeedBackfill', () => {
  const readyState = {
    mvStatus: 'ready',
    cityRowCount: 100,
    asnBlocksCount: 1,
    cityLocationsCount: 1,
    countryLocationsCount: 1,
    ruCityBlocksCount: 1,
    datasetFingerprint: 'abc',
    ipv4AddressCount: '1000',
  };

  it('returns false when dataset is not ready', () => {
    expect(
      datasetVolumesNeedBackfill({ ...readyState, mvStatus: 'unavailable', cityRowCount: 0 }),
    ).toBe(false);
  });

  it('returns true when volume fields are zero on active dataset', () => {
    expect(
      datasetVolumesNeedBackfill({
        ...readyState,
        asnBlocksCount: 0,
        cityLocationsCount: 0,
        datasetFingerprint: null,
      }),
    ).toBe(true);
  });

  it('returns false when all volume fields are populated', () => {
    expect(datasetVolumesNeedBackfill(readyState)).toBe(false);
  });
});
