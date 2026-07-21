-- ASN block sizes in NRO delegated files can exceed signed int32
-- (e.g. value 4199595619 for large IANA reserved ranges).

ALTER TABLE rir_delegations
  ALTER COLUMN asn_count TYPE BIGINT;

ALTER TABLE stg_rir_delegations
  ALTER COLUMN asn_count TYPE BIGINT;
