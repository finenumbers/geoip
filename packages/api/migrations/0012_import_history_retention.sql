-- Dashboard volume fields on dataset_state + one-time import history retention (keep 10).

ALTER TABLE dataset_state
  ADD COLUMN IF NOT EXISTS dataset_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS asn_blocks_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS city_locations_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS country_locations_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ru_city_blocks_count BIGINT NOT NULL DEFAULT 0;

-- Prune import_runs beyond the 10 most recent, protecting active import and in-progress runs.
WITH active AS (
  SELECT active_import_run_id AS id FROM dataset_state WHERE id = 1
),
running AS (
  SELECT id FROM import_runs
  WHERE status IN ('queued', 'running', 'validating', 'swapping', 'refreshing_mv')
),
ranked AS (
  SELECT id FROM import_runs
  ORDER BY COALESCE(finished_at, started_at) DESC NULLS LAST
  LIMIT 10
),
keep_ids AS (
  SELECT id FROM ranked
  UNION
  SELECT id FROM active WHERE id IS NOT NULL
  UNION
  SELECT id FROM running
)
DELETE FROM import_runs
WHERE id NOT IN (SELECT id FROM keep_ids);
