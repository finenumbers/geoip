import { query } from '../db/client.js';

export async function listRirSnapshotHistory(limit = 20) {
  const result = await query<{
    id: string;
    import_run_id: string | null;
    captured_at: Date;
    last_snapshot_date: string | null;
    row_count: string;
    rows_by_registry: Record<string, number>;
    rows_by_status: Record<string, number>;
    snapshots_by_registry: Record<string, string>;
    ipv4_address_count: string;
    table_size_bytes: string | null;
  }>(
    `SELECT id, import_run_id, captured_at, last_snapshot_date::text,
            row_count::text, rows_by_registry, rows_by_status, snapshots_by_registry,
            ipv4_address_count::text, table_size_bytes::text
     FROM rir_snapshot_history
     ORDER BY captured_at DESC
     LIMIT $1`,
    [limit],
  );
  return {
    items: result.rows.map((row) => ({
      id: Number(row.id),
      importRunId: row.import_run_id,
      capturedAt: row.captured_at.toISOString(),
      lastSnapshotDate: row.last_snapshot_date,
      rowCount: Number(row.row_count),
      rowsByRegistry: row.rows_by_registry ?? {},
      rowsByStatus: row.rows_by_status ?? {},
      snapshotsByRegistry: row.snapshots_by_registry ?? {},
      ipv4AddressCount: row.ipv4_address_count ?? '0',
      tableSizeBytes: row.table_size_bytes != null ? Number(row.table_size_bytes) : null,
    })),
  };
}

export async function listRirTransfers(limit = 50) {
  const result = await query<{
    id: string;
    source_rir: string;
    transfer_id: string | null;
    resource_type: string | null;
    resource_range: string;
    from_org: string | null;
    to_org: string | null;
    transferred_at: string | null;
  }>(
    `SELECT id::text, source_rir, transfer_id, resource_type, resource_range,
            from_org, to_org, transferred_at::text
     FROM rir_transfers
     ORDER BY transferred_at DESC NULLS LAST, id DESC
     LIMIT $1`,
    [limit],
  );
  return {
    items: result.rows.map((row) => ({
      id: Number(row.id),
      sourceRir: row.source_rir,
      transferId: row.transfer_id,
      resourceType: row.resource_type,
      resourceRange: row.resource_range,
      fromOrg: row.from_org,
      toOrg: row.to_org,
      transferredAt: row.transferred_at,
    })),
  };
}
