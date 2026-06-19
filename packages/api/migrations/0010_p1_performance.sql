-- P1: composite sort indexes for index-only top-N on browse/export paths.
CREATE INDEX IF NOT EXISTS mv_city_blocks_ru_country_name_id_idx
  ON mv_city_blocks_ru (country_name DESC NULLS LAST, id ASC);

CREATE INDEX IF NOT EXISTS mv_city_blocks_ru_city_name_id_idx
  ON mv_city_blocks_ru (city_name ASC NULLS LAST, id ASC);

CREATE INDEX IF NOT EXISTS mv_city_blocks_analytics_country_name_id_idx
  ON mv_city_blocks_analytics (country_name DESC NULLS LAST, id ASC);

CREATE INDEX IF NOT EXISTS mv_city_blocks_analytics_city_name_id_idx
  ON mv_city_blocks_analytics (city_name ASC NULLS LAST, id ASC);

-- P1: ASN browse filter via geo_*_block_asn (re-add after Tier 3 drop).
CREATE INDEX IF NOT EXISTS geo_city_block_asn_asn_idx ON geo_city_block_asn (asn);
CREATE INDEX IF NOT EXISTS geo_country_block_asn_asn_idx ON geo_country_block_asn (asn);

-- P1: invalidate stale partial caches when schema changes.
ALTER TABLE dataset_state
  ADD COLUMN IF NOT EXISTS cache_version INTEGER NOT NULL DEFAULT 1;
