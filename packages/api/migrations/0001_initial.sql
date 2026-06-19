-- GeoIP Analytics initial schema

CREATE TYPE import_status AS ENUM (
  'queued', 'running', 'validating', 'swapping', 'refreshing_mv', 'succeeded', 'failed'
);
CREATE TYPE import_trigger AS ENUM ('manual', 'cron', 'api');
CREATE TYPE step_status AS ENUM ('pending', 'running', 'succeeded', 'failed');
CREATE TYPE mv_status AS ENUM ('ready', 'refreshing', 'unavailable');
CREATE TYPE export_status AS ENUM ('queued', 'running', 'succeeded', 'failed');
CREATE TYPE export_table_type AS ENUM ('city', 'country');

-- Production location tables
CREATE TABLE geo_city_locations (
  geoname_id BIGINT PRIMARY KEY,
  locale_code TEXT NOT NULL CHECK (locale_code = 'ru'),
  continent_code TEXT,
  continent_name TEXT,
  country_iso_code TEXT,
  country_name TEXT,
  subdivision_1_iso_code TEXT,
  subdivision_1_name TEXT,
  subdivision_2_iso_code TEXT,
  subdivision_2_name TEXT,
  city_name TEXT,
  metro_code TEXT,
  timezone TEXT,
  is_in_european_union BOOLEAN
);

CREATE TABLE geo_country_locations (
  geoname_id BIGINT PRIMARY KEY,
  locale_code TEXT NOT NULL CHECK (locale_code = 'ru'),
  continent_code TEXT,
  continent_name TEXT,
  country_iso_code TEXT,
  country_name TEXT,
  subdivision_1_iso_code TEXT,
  subdivision_1_name TEXT,
  subdivision_2_iso_code TEXT,
  subdivision_2_name TEXT,
  city_name TEXT,
  metro_code TEXT,
  timezone TEXT,
  is_in_european_union BOOLEAN
);

-- Production block tables
CREATE TABLE geo_city_blocks (
  id BIGSERIAL PRIMARY KEY,
  network CIDR NOT NULL UNIQUE,
  ip_family SMALLINT NOT NULL CHECK (ip_family IN (4, 6)),
  geoname_id BIGINT NOT NULL REFERENCES geo_city_locations(geoname_id),
  registered_country_geoname_id BIGINT,
  represented_country_geoname_id BIGINT,
  postal_code TEXT,
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  accuracy_radius INTEGER
);

CREATE TABLE geo_country_blocks (
  id BIGSERIAL PRIMARY KEY,
  network CIDR NOT NULL UNIQUE,
  ip_family SMALLINT NOT NULL CHECK (ip_family IN (4, 6)),
  geoname_id BIGINT NOT NULL REFERENCES geo_country_locations(geoname_id),
  registered_country_geoname_id BIGINT,
  represented_country_geoname_id BIGINT
);

CREATE TABLE geo_asn_blocks (
  id BIGSERIAL PRIMARY KEY,
  network CIDR NOT NULL UNIQUE,
  ip_family SMALLINT NOT NULL CHECK (ip_family IN (4, 6)),
  autonomous_system_number INTEGER NOT NULL,
  autonomous_system_organization TEXT
);

-- Staging tables (no FK for speed)
CREATE TABLE stg_geo_city_locations (LIKE geo_city_locations INCLUDING ALL);
ALTER TABLE stg_geo_city_locations DROP CONSTRAINT IF EXISTS geo_city_locations_locale_code_check;
ALTER TABLE stg_geo_city_locations ADD CHECK (locale_code = 'ru');

CREATE TABLE stg_geo_country_locations (LIKE geo_country_locations INCLUDING ALL);
ALTER TABLE stg_geo_country_locations DROP CONSTRAINT IF EXISTS geo_country_locations_locale_code_check;
ALTER TABLE stg_geo_country_locations ADD CHECK (locale_code = 'ru');

CREATE TABLE stg_geo_city_blocks (
  id BIGSERIAL PRIMARY KEY,
  network CIDR NOT NULL,
  ip_family SMALLINT NOT NULL,
  geoname_id BIGINT NOT NULL,
  registered_country_geoname_id BIGINT,
  represented_country_geoname_id BIGINT,
  postal_code TEXT,
  latitude NUMERIC(9, 6),
  longitude NUMERIC(9, 6),
  accuracy_radius INTEGER
);

CREATE TABLE stg_geo_country_blocks (
  id BIGSERIAL PRIMARY KEY,
  network CIDR NOT NULL,
  ip_family SMALLINT NOT NULL,
  geoname_id BIGINT NOT NULL,
  registered_country_geoname_id BIGINT,
  represented_country_geoname_id BIGINT
);

CREATE TABLE stg_geo_asn_blocks (
  id BIGSERIAL PRIMARY KEY,
  network CIDR NOT NULL,
  ip_family SMALLINT NOT NULL,
  autonomous_system_number INTEGER NOT NULL,
  autonomous_system_organization TEXT
);

-- Import metadata
CREATE TABLE import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_date DATE,
  status import_status NOT NULL DEFAULT 'queued',
  triggered_by import_trigger NOT NULL DEFAULT 'api',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  rows_city_blocks INTEGER NOT NULL DEFAULT 0,
  rows_country_blocks INTEGER NOT NULL DEFAULT 0,
  rows_asn_blocks INTEGER NOT NULL DEFAULT 0,
  rows_rejected INTEGER NOT NULL DEFAULT 0,
  source_file_manifest JSONB,
  reject_report JSONB
);

CREATE TABLE import_run_steps (
  id SERIAL PRIMARY KEY,
  import_run_id UUID NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status step_status NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  rows INTEGER,
  message TEXT
);

CREATE TABLE dataset_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_import_run_id UUID REFERENCES import_runs(id),
  dataset_date DATE,
  activated_at TIMESTAMPTZ,
  mv_status mv_status NOT NULL DEFAULT 'unavailable',
  mv_refreshed_at TIMESTAMPTZ
);

INSERT INTO dataset_state (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status export_status NOT NULL DEFAULT 'queued',
  table_type export_table_type NOT NULL,
  filters JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  download_path TEXT,
  error_message TEXT,
  row_count INTEGER
);

-- SP-GiST indexes for CIDR lookup
CREATE INDEX geo_city_blocks_network_spgist ON geo_city_blocks USING spgist (network);
CREATE INDEX geo_country_blocks_network_spgist ON geo_country_blocks USING spgist (network);
CREATE INDEX geo_asn_blocks_network_spgist ON geo_asn_blocks USING spgist (network);

CREATE INDEX stg_geo_city_blocks_network_idx ON stg_geo_city_blocks (network);
CREATE INDEX stg_geo_country_blocks_network_idx ON stg_geo_country_blocks (network);
CREATE INDEX stg_geo_asn_blocks_network_idx ON stg_geo_asn_blocks (network);

CREATE INDEX import_runs_status_idx ON import_runs (status);
CREATE INDEX import_runs_started_at_idx ON import_runs (started_at DESC);
CREATE INDEX import_run_steps_run_id_idx ON import_run_steps (import_run_id);

-- Materialized views for analytics
CREATE MATERIALIZED VIEW mv_city_blocks_analytics AS
SELECT
  cb.id,
  cb.network::text AS network,
  family(cb.network) AS ip_family,
  masklen(cb.network) AS prefix_len,
  cb.geoname_id,
  cl.continent_name,
  cl.country_iso_code,
  cl.country_name,
  cl.subdivision_1_name,
  cl.subdivision_2_name,
  cl.city_name,
  cl.timezone,
  cb.latitude,
  cb.longitude,
  cb.accuracy_radius,
  cb.postal_code,
  asn.asn,
  asn.asn_org
FROM geo_city_blocks cb
LEFT JOIN geo_city_locations cl ON cl.geoname_id = cb.geoname_id
LEFT JOIN LATERAL (
  SELECT
    ab.autonomous_system_number AS asn,
    ab.autonomous_system_organization AS asn_org
  FROM geo_asn_blocks ab
  WHERE cb.network && ab.network
  ORDER BY masklen(ab.network) DESC
  LIMIT 1
) asn ON true
WITH NO DATA;

CREATE MATERIALIZED VIEW mv_country_blocks_analytics AS
SELECT
  cb.id,
  cb.network::text AS network,
  family(cb.network) AS ip_family,
  masklen(cb.network) AS prefix_len,
  cb.geoname_id,
  cl.continent_name,
  cl.country_iso_code,
  cl.country_name,
  cl.subdivision_1_name,
  cl.subdivision_2_name,
  asn.asn,
  asn.asn_org
FROM geo_country_blocks cb
LEFT JOIN geo_country_locations cl ON cl.geoname_id = cb.geoname_id
LEFT JOIN LATERAL (
  SELECT
    ab.autonomous_system_number AS asn,
    ab.autonomous_system_organization AS asn_org
  FROM geo_asn_blocks ab
  WHERE cb.network && ab.network
  ORDER BY masklen(ab.network) DESC
  LIMIT 1
) asn ON true
WITH NO DATA;

CREATE UNIQUE INDEX mv_city_blocks_analytics_id_idx ON mv_city_blocks_analytics (id);
CREATE INDEX mv_city_blocks_analytics_country_idx ON mv_city_blocks_analytics (country_iso_code);
CREATE INDEX mv_city_blocks_analytics_city_idx ON mv_city_blocks_analytics (city_name);
CREATE INDEX mv_city_blocks_analytics_asn_idx ON mv_city_blocks_analytics (asn);
CREATE INDEX mv_city_blocks_analytics_prefix_len_idx ON mv_city_blocks_analytics (prefix_len);

CREATE UNIQUE INDEX mv_country_blocks_analytics_id_idx ON mv_country_blocks_analytics (id);
CREATE INDEX mv_country_blocks_analytics_country_idx ON mv_country_blocks_analytics (country_iso_code);
CREATE INDEX mv_country_blocks_analytics_asn_idx ON mv_country_blocks_analytics (asn);
