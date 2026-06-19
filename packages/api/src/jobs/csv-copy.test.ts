import { describe, it, expect } from 'vitest';
import { matchCsvFile } from './csv-copy.js';

describe('matchCsvFile', () => {
  it('maps city block files', () => {
    expect(matchCsvFile('RU-GeoIP-City-Blocks-IPv4.csv')).toEqual({
      target: 'stg_geo_city_blocks',
      kind: 'RU-GeoIP-City-Blocks-IPv4',
    });
  });

  it('maps ru location files', () => {
    expect(matchCsvFile('RU-GeoIP-City-Locations-ru.csv')).toEqual({
      target: 'stg_geo_city_locations',
      kind: 'RU-GeoIP-City-Locations-ru',
    });
  });

  it('returns null for english locations', () => {
    expect(matchCsvFile('RU-GeoIP-City-Locations-en.csv')).toBeNull();
  });
});
