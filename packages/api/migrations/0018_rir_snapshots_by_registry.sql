-- Per-registry snapshot dates for header dataset menu

ALTER TABLE rir_dataset_state
  ADD COLUMN IF NOT EXISTS snapshots_by_registry JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE rir_dataset_state s
SET snapshots_by_registry = COALESCE(agg.payload, '{}'::jsonb)
FROM (
  SELECT COALESCE(
    jsonb_object_agg(registry, snapshot_date),
    '{}'::jsonb
  ) AS payload
  FROM (
    SELECT registry, MAX(snapshot_date)::text AS snapshot_date
    FROM rir_delegations
    GROUP BY registry
  ) t
) agg
WHERE s.id = 1
  AND s.snapshots_by_registry = '{}'::jsonb;
