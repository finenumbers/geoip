import { describe, it, expect } from 'vitest';
import {
  isZipCacheMetaValid,
  datasetFingerprint,
  zipCachePaths,
  type ZipCacheMeta,
} from './dataset-zip-cache.js';
import type { DownloadLink } from './grchc-client.js';

const cityLink: DownloadLink = {
  type: 'city',
  date: '20260619',
  url: 'https://example/city.zip',
  filename: 'RU-GeoIP-City-CSV_20260619.zip',
  sizeBytes: 88_173_147,
};

describe('dataset zip cache', () => {
  it('validates cache meta against on-disk file size', () => {
    const meta: ZipCacheMeta = {
      type: 'city',
      date: '20260619',
      filename: cityLink.filename,
      sizeBytes: 88_173_147,
      downloadedAt: '2026-06-19T00:00:00.000Z',
    };
    expect(isZipCacheMetaValid(meta, cityLink, 88_173_147)).toBe(true);
    expect(isZipCacheMetaValid(meta, cityLink, 88_173_146)).toBe(false);
  });

  it('builds stable dataset fingerprint', () => {
    const links = {
      city: cityLink,
      country: { ...cityLink, type: 'country' as const, filename: 'country.zip', sizeBytes: 100 },
      asn: { ...cityLink, type: 'asn' as const, filename: 'asn.zip', sizeBytes: 200 },
    };
    expect(datasetFingerprint(links)).toHaveLength(16);
    expect(datasetFingerprint(links)).toBe(datasetFingerprint({ ...links }));
  });

  it('resolves cache paths under date directory', () => {
    expect(zipCachePaths('/tmp/geoip-import', cityLink).zipPath).toBe(
      '/tmp/geoip-import/zips/20260619/city.zip',
    );
  });
});
