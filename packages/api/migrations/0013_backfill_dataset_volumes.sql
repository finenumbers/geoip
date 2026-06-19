-- One-time backfill of dashboard volume fields for an already-active dataset.

UPDATE dataset_state ds
SET
  asn_blocks_count = (SELECT COUNT(*)::bigint FROM geo_asn_blocks),
  city_locations_count = (SELECT COUNT(*)::bigint FROM geo_city_locations),
  country_locations_count = (SELECT COUNT(*)::bigint FROM geo_country_locations),
  ru_city_blocks_count = (
    SELECT COUNT(*)::bigint
    FROM geo_city_blocks cb
    JOIN geo_city_locations cl ON cl.geoname_id = cb.geoname_id
    WHERE cl.country_iso_code = 'RU'
  ),
  dataset_fingerprint = COALESCE(
    ds.dataset_fingerprint,
    (
      SELECT NULLIF(substring(s.message FROM 'fp=([^ ]+)'), '')
      FROM import_run_steps s
      WHERE s.import_run_id = ds.active_import_run_id
        AND s.name = 'discover_date'
      ORDER BY s.id
      LIMIT 1
    )
  )
WHERE ds.id = 1
  AND ds.city_row_count > 0;
