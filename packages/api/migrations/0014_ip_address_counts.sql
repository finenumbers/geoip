-- Persist IPv4/IPv6 address-space totals (sum of host addresses per unique subnet).

ALTER TABLE dataset_state
  ADD COLUMN IF NOT EXISTS ipv4_address_count NUMERIC(50, 0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ipv6_address_count NUMERIC(50, 0) NOT NULL DEFAULT 0;

WITH all_networks AS (
  SELECT network::inet AS n FROM geo_city_blocks
  UNION
  SELECT network::inet FROM geo_country_blocks
  UNION
  SELECT network::inet FROM geo_asn_blocks
),
totals AS (
  SELECT
    COALESCE(SUM(POWER(2::numeric, 32 - masklen(n))) FILTER (WHERE family(n) = 4), 0) AS ipv4_total,
    COALESCE(SUM(POWER(2::numeric, 128 - masklen(n))) FILTER (WHERE family(n) = 6), 0) AS ipv6_total
  FROM all_networks
)
UPDATE dataset_state ds
SET
  ipv4_address_count = totals.ipv4_total,
  ipv6_address_count = totals.ipv6_total
FROM totals
WHERE ds.id = 1
  AND ds.city_row_count > 0;
