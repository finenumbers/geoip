-- Parallel RIR delegated-extended data plane (independent of GRChC GeoIP)

CREATE TYPE rir_import_status AS ENUM (
  'queued', 'running', 'succeeded', 'failed'
);
CREATE TYPE rir_import_trigger AS ENUM ('manual', 'cron', 'api');
CREATE TYPE rir_dataset_status AS ENUM ('ready', 'importing', 'failed', 'unavailable');

ALTER TYPE export_table_type ADD VALUE IF NOT EXISTS 'rir';

CREATE TABLE rir_delegations (
  id BIGSERIAL PRIMARY KEY,
  registry TEXT NOT NULL,
  cc TEXT,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('ipv4', 'ipv6', 'asn')),
  start_ip INET,
  end_ip INET,
  network CIDR,
  prefix_len INTEGER,
  host_count NUMERIC(50, 0),
  start_asn BIGINT,
  asn_count INTEGER,
  allocated_at DATE,
  status TEXT NOT NULL CHECK (status IN ('available', 'allocated', 'assigned', 'reserved')),
  opaque_id TEXT,
  range_text TEXT NOT NULL,
  ip_family SMALLINT CHECK (ip_family IS NULL OR ip_family IN (4, 6)),
  source_file TEXT NOT NULL,
  snapshot_date DATE NOT NULL
);

CREATE TABLE stg_rir_delegations (LIKE rir_delegations INCLUDING DEFAULTS INCLUDING IDENTITY);

CREATE INDEX rir_delegations_registry_idx ON rir_delegations (registry);
CREATE INDEX rir_delegations_status_idx ON rir_delegations (status);
CREATE INDEX rir_delegations_resource_type_idx ON rir_delegations (resource_type);
CREATE INDEX rir_delegations_cc_idx ON rir_delegations (cc);
CREATE INDEX rir_delegations_start_ip_idx ON rir_delegations (start_ip);
CREATE INDEX rir_delegations_end_ip_idx ON rir_delegations (end_ip);
CREATE INDEX rir_delegations_range_text_idx ON rir_delegations (range_text);
CREATE INDEX rir_delegations_allocated_at_idx ON rir_delegations (allocated_at);
CREATE INDEX rir_delegations_network_spgist ON rir_delegations USING spgist (network)
  WHERE network IS NOT NULL;

CREATE TABLE rir_dataset_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status rir_dataset_status NOT NULL DEFAULT 'unavailable',
  last_success_at TIMESTAMPTZ,
  last_snapshot_date DATE,
  row_count BIGINT NOT NULL DEFAULT 0,
  rows_by_registry JSONB NOT NULL DEFAULT '{}'::jsonb,
  rows_by_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  active_import_run_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO rir_dataset_state (id) VALUES (1);

CREATE TABLE rir_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status rir_import_status NOT NULL DEFAULT 'queued',
  triggered_by rir_import_trigger NOT NULL DEFAULT 'api',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  rows_by_file JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot_date DATE
);

ALTER TABLE rir_dataset_state
  ADD CONSTRAINT rir_dataset_state_active_run_fk
  FOREIGN KEY (active_import_run_id) REFERENCES rir_import_runs(id);
