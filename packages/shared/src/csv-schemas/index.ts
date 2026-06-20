import { z } from 'zod';

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

export const cityBlockRowSchema = z.object({
  network: z.string(),
  geoname_id: z.string(),
  registered_country_geoname_id: z.string().optional(),
  represented_country_geoname_id: z.string().optional(),
  postal_code: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  accuracy_radius: z.string().optional(),
});

export const countryBlockRowSchema = z.object({
  network: z.string(),
  geoname_id: z.string(),
  registered_country_geoname_id: z.string().optional(),
  represented_country_geoname_id: z.string().optional(),
});

export const locationRowSchema = z.object({
  geoname_id: z.string(),
  locale_code: z.string(),
  continent_code: z.string().optional(),
  continent_name: z.string().optional(),
  country_iso_code: z.string().optional(),
  country_name: z.string().optional(),
  subdivision_1_iso_code: z.string().optional(),
  subdivision_1_name: z.string().optional(),
  subdivision_2_iso_code: z.string().optional(),
  subdivision_2_name: z.string().optional(),
  city_name: z.string().optional(),
  metro_code: z.string().optional(),
  time_zone: z.string().optional(),
  is_in_european_union: z.string().optional(),
});

export const asnBlockRowSchema = z.object({
  network: z.string(),
  autonomous_system_number: z.string(),
  autonomous_system_organization: z.string().optional(),
});

export type CityBlockCsvRow = z.infer<typeof cityBlockRowSchema>;
export type CountryBlockCsvRow = z.infer<typeof countryBlockRowSchema>;
export type LocationCsvRow = z.infer<typeof locationRowSchema>;
export type AsnBlockCsvRow = z.infer<typeof asnBlockRowSchema>;

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
