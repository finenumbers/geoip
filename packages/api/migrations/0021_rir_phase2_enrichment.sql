-- RIR phase 2: history, transfers, RDAP/PeeringDB cache, RPKI adoption aggregates

CREATE TABLE IF NOT EXISTS rir_snapshot_history (
  id BIGSERIAL PRIMARY KEY,
  import_run_id UUID REFERENCES rir_import_runs(id) ON DELETE SET NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_snapshot_date DATE,
  row_count BIGINT NOT NULL DEFAULT 0,
  rows_by_registry JSONB NOT NULL DEFAULT '{}'::jsonb,
  rows_by_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshots_by_registry JSONB NOT NULL DEFAULT '{}'::jsonb,
  ipv4_address_count NUMERIC(50, 0) NOT NULL DEFAULT 0,
  table_size_bytes BIGINT
);

CREATE INDEX IF NOT EXISTS rir_snapshot_history_captured_at_idx
  ON rir_snapshot_history (captured_at DESC);

CREATE TABLE IF NOT EXISTS rir_rdap_cache (
  cache_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('rdap_ip', 'rdap_asn', 'rdap_entity', 'peeringdb_asn')),
  registry TEXT,
  resource_ref TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS rir_rdap_cache_expires_at_idx ON rir_rdap_cache (expires_at);

CREATE TABLE IF NOT EXISTS rir_transfers (
  id BIGSERIAL PRIMARY KEY,
  source_rir TEXT NOT NULL,
  transfer_id TEXT,
  resource_type TEXT,
  resource_range TEXT NOT NULL,
  from_org TEXT,
  to_org TEXT,
  transferred_at DATE,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_rir, transfer_id, resource_range)
);

CREATE INDEX IF NOT EXISTS rir_transfers_transferred_at_idx ON rir_transfers (transferred_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS rir_transfers_resource_range_idx ON rir_transfers (resource_range);

CREATE TABLE IF NOT EXISTS rir_rpki_adoption (
  id BIGSERIAL PRIMARY KEY,
  source_file TEXT NOT NULL,
  economy TEXT,
  registry TEXT,
  metric TEXT NOT NULL,
  value NUMERIC,
  snapshot_date DATE,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rir_rpki_adoption_imported_at_idx ON rir_rpki_adoption (imported_at DESC);
CREATE INDEX IF NOT EXISTS rir_rpki_adoption_registry_idx ON rir_rpki_adoption (registry);
