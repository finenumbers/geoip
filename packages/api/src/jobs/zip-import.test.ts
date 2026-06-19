import { describe, it, expect } from 'vitest';
import { isSkippableZipEntry } from './zip-import.js';

describe('isSkippableZipEntry', () => {
  it('skips english location files', () => {
    expect(isSkippableZipEntry('RU-GeoIP-City-Locations-en.csv')).toBe(true);
    expect(isSkippableZipEntry('nested/RU-GeoIP-Country-Locations-en.csv')).toBe(true);
  });

  it('does not skip data files', () => {
    expect(isSkippableZipEntry('RU-GeoIP-City-Blocks-IPv4.csv')).toBe(false);
    expect(isSkippableZipEntry('RU-GeoIP-City-Locations-ru.csv')).toBe(false);
  });
});
