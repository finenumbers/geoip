-- Tier 3 storage: drop unused ASN indexes, audit composite MV index, add RU partial MV.

DROP INDEX IF EXISTS geo_city_block_asn_asn_idx;
DROP INDEX IF EXISTS geo_country_block_asn_asn_idx;

-- Composite (country, network) redundant with country_idx + network_idx on full MV;
-- RU-scoped browse uses mv_city_blocks_ru instead.
DROP INDEX IF EXISTS mv_city_blocks_analytics_country_network_idx;
DROP INDEX IF EXISTS mv_country_blocks_analytics_country_network_idx;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_city_blocks_ru AS
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
  NULL::integer AS asn,
  NULL::text AS asn_org
FROM geo_city_blocks cb
LEFT JOIN geo_city_locations cl ON cl.geoname_id = cb.geoname_id
WHERE cl.country_iso_code = 'RU';

CREATE UNIQUE INDEX IF NOT EXISTS mv_city_blocks_ru_id_idx ON mv_city_blocks_ru (id);
CREATE INDEX IF NOT EXISTS mv_city_blocks_ru_network_idx ON mv_city_blocks_ru (network);
CREATE INDEX IF NOT EXISTS mv_city_blocks_ru_country_name_idx ON mv_city_blocks_ru (country_name);
CREATE INDEX IF NOT EXISTS mv_city_blocks_ru_city_name_idx ON mv_city_blocks_ru (city_name);
