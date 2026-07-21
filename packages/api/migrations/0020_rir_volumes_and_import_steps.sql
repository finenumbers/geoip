ALTER TABLE rir_dataset_state
  ADD COLUMN IF NOT EXISTS ipv4_address_count NUMERIC(50, 0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS table_size_bytes BIGINT;

CREATE TABLE IF NOT EXISTS rir_import_run_steps (
  id SERIAL PRIMARY KEY,
  import_run_id UUID NOT NULL REFERENCES rir_import_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status step_status NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  rows INTEGER,
  message TEXT
);

CREATE INDEX IF NOT EXISTS rir_import_run_steps_run_id_idx ON rir_import_run_steps (import_run_id);
