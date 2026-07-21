-- Drop unused RIR snapshot history and transfer feeds; keep only current delegated snapshot.

DROP TABLE IF EXISTS rir_transfers;
DROP TABLE IF EXISTS rir_snapshot_history;
