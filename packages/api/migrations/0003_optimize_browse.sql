-- Browse optimizations: precomputed ASN mappings, MV indexes, row count cache.

CREATE TABLE geo_city_block_asn (
  city_block_id BIGINT PRIMARY KEY REFERENCES geo_city_blocks(id) ON DELETE CASCADE,
  asn INTEGER,
  asn_org TEXT
);

CREATE TABLE geo_country_block_asn (
  country_block_id BIGINT PRIMARY KEY REFERENCES geo_country_blocks(id) ON DELETE CASCADE,
  asn INTEGER,
  asn_org TEXT
);

CREATE INDEX geo_city_block_asn_asn_idx ON geo_city_block_asn (asn);
CREATE INDEX geo_country_block_asn_asn_idx ON geo_country_block_asn (asn);

ALTER TABLE dataset_state
  ADD COLUMN IF NOT EXISTS city_row_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS country_row_count BIGINT NOT NULL DEFAULT 0;

-- Drop dead ASN index on MV (asn column is always NULL in simplified MV).
DROP INDEX IF EXISTS mv_city_blocks_analytics_asn_idx;
DROP INDEX IF EXISTS mv_country_blocks_analytics_asn_idx;

-- Indexes for default sort and common filter + sort pattern.
CREATE INDEX mv_city_blocks_analytics_network_idx
  ON mv_city_blocks_analytics (network);

CREATE INDEX mv_city_blocks_analytics_country_network_idx
  ON mv_city_blocks_analytics (country_iso_code, network);

CREATE INDEX mv_country_blocks_analytics_network_idx
  ON mv_country_blocks_analytics (network);

CREATE INDEX mv_country_blocks_analytics_country_network_idx
  ON mv_country_blocks_analytics (country_iso_code, network);

-- Seed cached counts from current MV sizes.
UPDATE dataset_state
SET
  city_row_count = (SELECT COUNT(*)::bigint FROM mv_city_blocks_analytics),
  country_row_count = (SELECT COUNT(*)::bigint FROM mv_country_blocks_analytics)
WHERE id = 1;
