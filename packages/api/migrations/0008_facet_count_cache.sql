-- Precomputed facet value counts per country for O(1) dropdown lookups.

ALTER TABLE dataset_state
  ADD COLUMN IF NOT EXISTS facet_count_cache JSONB NOT NULL DEFAULT '{}'::jsonb;
