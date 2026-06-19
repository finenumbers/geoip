-- Simplify MVs: remove expensive per-row ASN lateral join at refresh time.
-- ASN columns remain nullable; lookup still resolves ASN live.

DROP MATERIALIZED VIEW IF EXISTS mv_city_blocks_analytics;
DROP MATERIALIZED VIEW IF EXISTS mv_country_blocks_analytics;

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
  NULL::integer AS asn,
  NULL::text AS asn_org
FROM geo_city_blocks cb
LEFT JOIN geo_city_locations cl ON cl.geoname_id = cb.geoname_id;

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
  NULL::integer AS asn,
  NULL::text AS asn_org
FROM geo_country_blocks cb
LEFT JOIN geo_country_locations cl ON cl.geoname_id = cb.geoname_id;

CREATE UNIQUE INDEX mv_city_blocks_analytics_id_idx ON mv_city_blocks_analytics (id);
CREATE INDEX mv_city_blocks_analytics_country_idx ON mv_city_blocks_analytics (country_iso_code);
CREATE INDEX mv_city_blocks_analytics_city_idx ON mv_city_blocks_analytics (city_name);
CREATE INDEX mv_city_blocks_analytics_asn_idx ON mv_city_blocks_analytics (asn);
CREATE INDEX mv_city_blocks_analytics_prefix_len_idx ON mv_city_blocks_analytics (prefix_len);

CREATE UNIQUE INDEX mv_country_blocks_analytics_id_idx ON mv_country_blocks_analytics (id);
CREATE INDEX mv_country_blocks_analytics_country_idx ON mv_country_blocks_analytics (country_iso_code);
CREATE INDEX mv_country_blocks_analytics_asn_idx ON mv_country_blocks_analytics (asn);
