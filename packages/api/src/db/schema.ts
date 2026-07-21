import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const importStatusEnum = pgEnum('import_status', [
  'queued',
  'running',
  'validating',
  'swapping',
  'refreshing_mv',
  'succeeded',
  'failed',
]);

export const importTriggerEnum = pgEnum('import_trigger', ['manual', 'cron', 'api']);

export const stepStatusEnum = pgEnum('step_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
]);

export const mvStatusEnum = pgEnum('mv_status', ['ready', 'refreshing', 'unavailable']);

export const exportStatusEnum = pgEnum('export_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
]);

export const exportTableTypeEnum = pgEnum('export_table_type', ['city', 'country', 'rir']);

export const rirImportStatusEnum = pgEnum('rir_import_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
]);

export const rirImportTriggerEnum = pgEnum('rir_import_trigger', ['manual', 'cron', 'api']);

export const rirDatasetStatusEnum = pgEnum('rir_dataset_status', [
  'ready',
  'importing',
  'failed',
  'unavailable',
]);

const locationColumns = {
  geonameId: bigint('geoname_id', { mode: 'number' }).primaryKey(),
  localeCode: text('locale_code').notNull(),
  continentCode: text('continent_code'),
  continentName: text('continent_name'),
  countryIsoCode: text('country_iso_code'),
  countryName: text('country_name'),
  subdivision1IsoCode: text('subdivision_1_iso_code'),
  subdivision1Name: text('subdivision_1_name'),
  subdivision2IsoCode: text('subdivision_2_iso_code'),
  subdivision2Name: text('subdivision_2_name'),
  cityName: text('city_name'),
  metroCode: text('metro_code'),
  timezone: text('timezone'),
  isInEuropeanUnion: boolean('is_in_european_union'),
};

export const geoCityLocations = pgTable('geo_city_locations', locationColumns);

export const geoCountryLocations = pgTable('geo_country_locations', {
  ...locationColumns,
});

const cityBlockColumns = {
  id: serial('id').primaryKey(),
  network: text('network').notNull().unique(),
  ipFamily: integer('ip_family').notNull(),
  geonameId: bigint('geoname_id', { mode: 'number' }).notNull(),
  registeredCountryGeonameId: bigint('registered_country_geoname_id', { mode: 'number' }),
  representedCountryGeonameId: bigint('represented_country_geoname_id', { mode: 'number' }),
  postalCode: text('postal_code'),
  latitude: numeric('latitude', { precision: 9, scale: 6 }),
  longitude: numeric('longitude', { precision: 9, scale: 6 }),
  accuracyRadius: integer('accuracy_radius'),
};

export const geoCityBlocks = pgTable('geo_city_blocks', cityBlockColumns);

export const geoCountryBlocks = pgTable('geo_country_blocks', {
  id: serial('id').primaryKey(),
  network: text('network').notNull().unique(),
  ipFamily: integer('ip_family').notNull(),
  geonameId: bigint('geoname_id', { mode: 'number' }).notNull(),
  registeredCountryGeonameId: bigint('registered_country_geoname_id', { mode: 'number' }),
  representedCountryGeonameId: bigint('represented_country_geoname_id', { mode: 'number' }),
});

export const geoAsnBlocks = pgTable('geo_asn_blocks', {
  id: serial('id').primaryKey(),
  network: text('network').notNull().unique(),
  ipFamily: integer('ip_family').notNull(),
  autonomousSystemNumber: integer('autonomous_system_number').notNull(),
  autonomousSystemOrganization: text('autonomous_system_organization'),
});

export const stgGeoCityLocations = pgTable('stg_geo_city_locations', locationColumns);
export const stgGeoCountryLocations = pgTable('stg_geo_country_locations', { ...locationColumns });
export const stgGeoCityBlocks = pgTable('stg_geo_city_blocks', cityBlockColumns);
export const stgGeoCountryBlocks = pgTable('stg_geo_country_blocks', {
  id: serial('id').primaryKey(),
  network: text('network').notNull(),
  ipFamily: integer('ip_family').notNull(),
  geonameId: bigint('geoname_id', { mode: 'number' }).notNull(),
  registeredCountryGeonameId: bigint('registered_country_geoname_id', { mode: 'number' }),
  representedCountryGeonameId: bigint('represented_country_geoname_id', { mode: 'number' }),
});
export const stgGeoAsnBlocks = pgTable('stg_geo_asn_blocks', {
  id: serial('id').primaryKey(),
  network: text('network').notNull(),
  ipFamily: integer('ip_family').notNull(),
  autonomousSystemNumber: integer('autonomous_system_number').notNull(),
  autonomousSystemOrganization: text('autonomous_system_organization'),
});

export const importRuns = pgTable('import_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  datasetDate: date('dataset_date'),
  status: importStatusEnum('status').notNull().default('queued'),
  triggeredBy: importTriggerEnum('triggered_by').notNull().default('api'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  rowsCityBlocks: integer('rows_city_blocks').default(0).notNull(),
  rowsCountryBlocks: integer('rows_country_blocks').default(0).notNull(),
  rowsAsnBlocks: integer('rows_asn_blocks').default(0).notNull(),
  rowsRejected: integer('rows_rejected').default(0).notNull(),
  sourceFileManifest: jsonb('source_file_manifest'),
  rejectReport: jsonb('reject_report'),
});

export const importRunSteps = pgTable('import_run_steps', {
  id: serial('id').primaryKey(),
  importRunId: uuid('import_run_id')
    .notNull()
    .references(() => importRuns.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: stepStatusEnum('status').notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  rows: integer('rows'),
  message: text('message'),
});

export const datasetState = pgTable('dataset_state', {
  id: integer('id').primaryKey().default(1),
  activeImportRunId: uuid('active_import_run_id').references(() => importRuns.id),
  datasetDate: date('dataset_date'),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  mvStatus: mvStatusEnum('mv_status').notNull().default('unavailable'),
  mvRefreshedAt: timestamp('mv_refreshed_at', { withTimezone: true }),
  cityRowCount: bigint('city_row_count', { mode: 'number' }).notNull().default(0),
  countryRowCount: bigint('country_row_count', { mode: 'number' }).notNull().default(0),
  datasetFingerprint: text('dataset_fingerprint'),
  asnBlocksCount: bigint('asn_blocks_count', { mode: 'number' }).notNull().default(0),
  cityLocationsCount: bigint('city_locations_count', { mode: 'number' }).notNull().default(0),
  countryLocationsCount: bigint('country_locations_count', { mode: 'number' }).notNull().default(0),
  ruCityBlocksCount: bigint('ru_city_blocks_count', { mode: 'number' }).notNull().default(0),
  ipv4AddressCount: numeric('ipv4_address_count', { precision: 50, scale: 0 }).notNull().default('0'),
  ipv6AddressCount: numeric('ipv6_address_count', { precision: 50, scale: 0 }).notNull().default('0'),
  filterCountCache: jsonb('filter_count_cache').notNull().default(sql`'{}'::jsonb`),
  facetCountCache: jsonb('facet_count_cache').notNull().default(sql`'{}'::jsonb`),
  cacheVersion: integer('cache_version').notNull().default(1),
});

export const exportJobs = pgTable('export_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: exportStatusEnum('status').notNull().default('queued'),
  tableType: exportTableTypeEnum('table_type').notNull(),
  filters: jsonb('filters').notNull().default(sql`'[]'::jsonb`),
  sort: jsonb('sort').notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  downloadPath: text('download_path'),
  errorMessage: text('error_message'),
  rowCount: integer('row_count'),
});

const rirDelegationColumns = {
  id: serial('id').primaryKey(),
  registry: text('registry').notNull(),
  cc: text('cc'),
  resourceType: text('resource_type').notNull(),
  startIp: text('start_ip'),
  endIp: text('end_ip'),
  network: text('network'),
  prefixLen: integer('prefix_len'),
  hostCount: numeric('host_count', { precision: 50, scale: 0 }),
  startAsn: bigint('start_asn', { mode: 'number' }),
  asnCount: integer('asn_count'),
  allocatedAt: date('allocated_at'),
  status: text('status').notNull(),
  opaqueId: text('opaque_id'),
  rangeText: text('range_text').notNull(),
  ipFamily: integer('ip_family'),
  sourceFile: text('source_file').notNull(),
  snapshotDate: date('snapshot_date').notNull(),
};

export const rirDelegations = pgTable('rir_delegations', rirDelegationColumns);
export const stgRirDelegations = pgTable('stg_rir_delegations', rirDelegationColumns);

export const rirImportRuns = pgTable('rir_import_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: rirImportStatusEnum('status').notNull().default('queued'),
  triggeredBy: rirImportTriggerEnum('triggered_by').notNull().default('api'),
  queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  rowCount: integer('row_count').default(0).notNull(),
  rowsByFile: jsonb('rows_by_file').notNull().default(sql`'{}'::jsonb`),
  snapshotDate: date('snapshot_date'),
});

export const rirDatasetState = pgTable('rir_dataset_state', {
  id: integer('id').primaryKey().default(1),
  status: rirDatasetStatusEnum('status').notNull().default('unavailable'),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastSnapshotDate: date('last_snapshot_date'),
  rowCount: bigint('row_count', { mode: 'number' }).notNull().default(0),
  rowsByRegistry: jsonb('rows_by_registry').notNull().default(sql`'{}'::jsonb`),
  rowsByStatus: jsonb('rows_by_status').notNull().default(sql`'{}'::jsonb`),
  lastError: text('last_error'),
  activeImportRunId: uuid('active_import_run_id').references(() => rirImportRuns.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
