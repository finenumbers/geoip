export const IMPORT_LOCK_KEY = 0x47454f4950; // 'GEOIP'
/** Advisory lock for RIR delegated import (independent of GRChC). */
export const RIR_IMPORT_LOCK_KEY = 0x52495249; // 'RIRI'

/** Daily dataset import schedule — fixed, not editable in Admin. */
export const FIXED_IMPORT_CRON = '0 10 * * *';
export const FIXED_IMPORT_TIMEZONE = 'Europe/Moscow';
export const DEFAULT_DISPLAY_TIMEZONE = 'Europe/Moscow';

/** Daily RIR delegated-extended import — fixed UTC, separate from GRChC. */
export const FIXED_RIR_IMPORT_CRON = '0 6 * * *';
export const FIXED_RIR_IMPORT_TIMEZONE = 'UTC';

/** Latest NRO/RIR delegated stats sources (HTTPS). */
export const RIR_DELEGATED_SOURCES = [
  {
    registry: 'ripencc',
    url: 'https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest',
    sourceFile: 'delegated-ripencc-extended-latest',
  },
  {
    registry: 'arin',
    url: 'https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest',
    sourceFile: 'delegated-arin-extended-latest',
  },
  {
    registry: 'apnic',
    url: 'https://ftp.apnic.net/stats/apnic/delegated-apnic-extended-latest',
    sourceFile: 'delegated-apnic-extended-latest',
  },
  {
    registry: 'lacnic',
    url: 'https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-extended-latest',
    sourceFile: 'delegated-lacnic-extended-latest',
  },
  {
    registry: 'afrinic',
    url: 'https://ftp.afrinic.net/stats/afrinic/delegated-afrinic-extended-latest',
    sourceFile: 'delegated-afrinic-extended-latest',
  },
  {
    registry: 'iana',
    url: 'https://ftp.apnic.net/stats/iana/delegated-iana-latest',
    sourceFile: 'delegated-iana-latest',
  },
] as const;

export type RirRegistryId = (typeof RIR_DELEGATED_SOURCES)[number]['registry'];

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

export const RIR_TABLE_SORT_FIELDS = [
  'registry',
  'range_text',
  'cc',
  'status',
  'allocated_at',
  'resource_type',
  'prefix_len',
  'opaque_id',
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
