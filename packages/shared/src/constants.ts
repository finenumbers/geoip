export const IMPORT_LOCK_KEY = 0x47454f4950; // 'GEOIP'

/** Daily dataset import schedule — fixed, not editable in Admin. */
export const FIXED_IMPORT_CRON = '0 10 * * *';
export const FIXED_IMPORT_TIMEZONE = 'Europe/Moscow';
export const DEFAULT_DISPLAY_TIMEZONE = 'Europe/Moscow';

/** IANA timezones offered in Admin → Общие. */
export const DISPLAY_TIMEZONE_OPTIONS = [
  { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { value: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { value: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
  { value: 'Asia/Kamchatka', label: 'Камчатка (UTC+12)' },
  { value: 'UTC', label: 'UTC' },
] as const;

/** API error code when export row count exceeds configured maxRows. */
export const EXPORT_ROW_LIMIT_CODE = 'export_row_limit_exceeded';

/** Base CSV filename (no extension) → staging table for COPY. IPv4/IPv6 share one target. */
export const CSV_IMPORT_FILE_MAP = {
  'RU-GeoIP-City-Blocks-IPv4': 'stg_geo_city_blocks',
  'RU-GeoIP-City-Blocks-IPv6': 'stg_geo_city_blocks',
  'RU-GeoIP-Country-Blocks-IPv4': 'stg_geo_country_blocks',
  'RU-GeoIP-Country-Blocks-IPv6': 'stg_geo_country_blocks',
  'RU-GeoIP-ASN-Blocks-IPv4': 'stg_geo_asn_blocks',
  'RU-GeoIP-ASN-Blocks-IPv6': 'stg_geo_asn_blocks',
  'RU-GeoIP-City-Locations-ru': 'stg_geo_city_locations',
  'RU-GeoIP-Country-Locations-ru': 'stg_geo_country_locations',
} as const;

export type CsvImportStagingTable =
  (typeof CSV_IMPORT_FILE_MAP)[keyof typeof CSV_IMPORT_FILE_MAP];

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
  'asn',
  'asn_org',
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
