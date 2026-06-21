export const cityBlockCsvHeaders = [
  'network',
  'geoname_id',
  'registered_country_geoname_id',
  'represented_country_geoname_id',
  'is_anonymous_proxy',
  'is_satellite_provider',
  'is_anycast',
  'postal_code',
  'latitude',
  'longitude',
  'accuracy_radius',
] as const;

export const countryBlockCsvHeaders = [
  'network',
  'geoname_id',
  'registered_country_geoname_id',
  'represented_country_geoname_id',
  'is_anonymous_proxy',
  'is_satellite_provider',
  'is_anycast',
] as const;

export const cityLocationCsvHeaders = [
  'geoname_id',
  'locale_code',
  'continent_code',
  'continent_name',
  'country_iso_code',
  'country_name',
  'subdivision_1_iso_code',
  'subdivision_1_name',
  'subdivision_2_iso_code',
  'subdivision_2_name',
  'city_name',
  'metro_code',
  'time_zone',
  'is_in_european_union',
] as const;

export const countryLocationCsvHeaders = [
  'geoname_id',
  'locale_code',
  'continent_code',
  'continent_name',
  'country_iso_code',
  'country_name',
  'is_in_european_union',
] as const;

export const asnBlockCsvHeaders = [
  'network',
  'autonomous_system_number',
  'autonomous_system_organization',
] as const;

export function validateCsvHeaders(
  actual: string[],
  expected: readonly string[],
): { valid: boolean; missing: string[]; extra: string[] } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((h) => !actualSet.has(h));
  const extra = actual.filter((h) => !expectedSet.has(h));
  return { valid: missing.length === 0 && extra.length === 0, missing, extra };
}
