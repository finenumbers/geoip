export const IMPORT_LOCK_KEY = 0x47454f4950; // 'GEOIP'

export const CSV_FILES = {
  city: {
    blocksIpv4: 'RU-GeoIP-City-Blocks-IPv4.csv',
    blocksIpv6: 'RU-GeoIP-City-Blocks-IPv6.csv',
    locationsRu: 'RU-GeoIP-City-Locations-ru.csv',
  },
  country: {
    blocksIpv4: 'RU-GeoIP-Country-Blocks-IPv4.csv',
    blocksIpv6: 'RU-GeoIP-Country-Blocks-IPv6.csv',
    locationsRu: 'RU-GeoIP-Country-Locations-ru.csv',
  },
  asn: {
    blocksIpv4: 'RU-GeoIP-ASN-Blocks-IPv4.csv',
    blocksIpv6: 'RU-GeoIP-ASN-Blocks-IPv6.csv',
  },
} as const;

export const ZIP_PATTERNS = {
  city: /^RU-GeoIP-City-CSV_(\d{8})\.zip$/,
  country: /^RU-GeoIP-Country-CSV_(\d{8})\.zip$/,
  asn: /^RU-GeoIP-ASN-CSV_(\d{8})\.zip$/,
} as const;

export const CITY_TABLE_SORT_FIELDS = [
  'network',
  'prefix_len',
  'country_iso_code',
  'country_name',
  'city_name',
  'subdivision_1_name',
  'asn',
  'asn_org',
  'latitude',
  'longitude',
] as const;

export const COUNTRY_TABLE_SORT_FIELDS = [
  'network',
  'prefix_len',
  'country_iso_code',
  'country_name',
  'subdivision_1_name',
  'asn',
] as const;

export const FILTER_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'startsWith',
  'in',
  'gte',
  'lte',
  'between',
  'isNull',
  'isNotNull',
] as const;
