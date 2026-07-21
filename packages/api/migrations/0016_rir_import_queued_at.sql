-- Track when RIR import was queued so stale recovery can age queued runs.
ALTER TABLE rir_import_runs
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;

UPDATE rir_import_runs
SET queued_at = COALESCE(started_at, finished_at, NOW())
WHERE queued_at IS NULL;

ALTER TABLE rir_import_runs
  ALTER COLUMN queued_at SET DEFAULT NOW();

ALTER TABLE rir_import_runs
  ALTER COLUMN queued_at SET NOT NULL;
