-- Precomputed per-country row counts for O(1) filtered browse pagination.

ALTER TABLE dataset_state
  ADD COLUMN IF NOT EXISTS filter_count_cache JSONB NOT NULL DEFAULT '{}'::jsonb;
