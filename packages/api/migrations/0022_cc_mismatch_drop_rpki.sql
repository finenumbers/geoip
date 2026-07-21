-- Remove RPKI adoption plane; add full GRChC≠RIR CC mismatch materialization.

DROP TABLE IF EXISTS rir_rpki_adoption;

CREATE TABLE IF NOT EXISTS geo_rir_cc_mismatches (
  id BIGSERIAL PRIMARY KEY,
  country_block_id BIGINT NOT NULL,
  network CIDR NOT NULL,
  grchc_cc TEXT NOT NULL,
  rir_cc TEXT NOT NULL,
  registry TEXT,
  range_text TEXT,
  rebuilt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS geo_rir_cc_mismatches_network_idx ON geo_rir_cc_mismatches (network);
CREATE INDEX IF NOT EXISTS geo_rir_cc_mismatches_grchc_cc_idx ON geo_rir_cc_mismatches (grchc_cc);
CREATE INDEX IF NOT EXISTS geo_rir_cc_mismatches_rir_cc_idx ON geo_rir_cc_mismatches (rir_cc);
CREATE INDEX IF NOT EXISTS geo_rir_cc_mismatches_registry_idx ON geo_rir_cc_mismatches (registry);
CREATE INDEX IF NOT EXISTS geo_rir_cc_mismatches_grchc_rir_idx ON geo_rir_cc_mismatches (grchc_cc, rir_cc);

CREATE TABLE IF NOT EXISTS geo_rir_cc_mismatch_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'never',
  row_count BIGINT NOT NULL DEFAULT 0,
  rebuilt_at TIMESTAMPTZ,
  duration_ms BIGINT,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO geo_rir_cc_mismatch_state (id, status)
VALUES (1, 'never')
ON CONFLICT (id) DO NOTHING;
