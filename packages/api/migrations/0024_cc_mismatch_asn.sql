-- Enrich GRChC≠RIR CC mismatches with GRChC ASN mapping; force rebuild on next API start.

ALTER TABLE geo_rir_cc_mismatches
  ADD COLUMN IF NOT EXISTS asn INTEGER,
  ADD COLUMN IF NOT EXISTS asn_org TEXT;

CREATE INDEX IF NOT EXISTS geo_rir_cc_mismatches_asn_idx ON geo_rir_cc_mismatches (asn);
CREATE INDEX IF NOT EXISTS geo_rir_cc_mismatches_asn_org_idx ON geo_rir_cc_mismatches (asn_org);

UPDATE geo_rir_cc_mismatch_state
SET status = 'never', updated_at = NOW()
WHERE id = 1;
