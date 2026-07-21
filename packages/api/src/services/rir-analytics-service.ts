import { query } from '../db/client.js';

/**
 * Sampled geo CC ≠ RIR CC mismatches (country blocks vs covering RIR CIDR).
 * Full-table join is too expensive; we scan a bounded sample of country blocks.
 */
export async function getGeoRirCcMismatch(limit = 20): Promise<{
  mismatchCount: number;
  sampleSize: number;
  sampled: true;
  sample: Array<{
    network: string;
    geoCc: string | null;
    rirCc: string | null;
    registry: string | null;
    rangeText: string | null;
  }>;
}> {
  const sampleWindow = 10_000;
  const result = await query<{
    network: string;
    geo_cc: string | null;
    rir_cc: string | null;
    registry: string | null;
    range_text: string | null;
  }>(
    `WITH sample AS (
       SELECT cb.id, cb.network, cl.country_iso_code
       FROM geo_country_blocks cb
       JOIN geo_country_locations cl ON cl.geoname_id = cb.geoname_id
       WHERE cl.country_iso_code IS NOT NULL
       ORDER BY cb.id
       LIMIT $1
     ),
     matched AS (
       SELECT
         s.network::text AS network,
         s.country_iso_code AS geo_cc,
         rir.cc AS rir_cc,
         rir.registry,
         rir.range_text
       FROM sample s
       JOIN LATERAL (
         SELECT r.cc, r.registry, r.range_text
         FROM rir_delegations r
         WHERE r.resource_type IN ('ipv4', 'ipv6')
           AND r.network IS NOT NULL
           AND r.network >>= s.network
         ORDER BY masklen(r.network) DESC
         LIMIT 1
       ) rir ON true
       WHERE rir.cc IS NOT NULL
         AND upper(s.country_iso_code) IS DISTINCT FROM upper(rir.cc)
     )
     SELECT * FROM matched
     ORDER BY network
     LIMIT $2`,
    [sampleWindow, limit],
  );

  const countRes = await query<{ count: string }>(
    `WITH sample AS (
       SELECT cb.id, cb.network, cl.country_iso_code
       FROM geo_country_blocks cb
       JOIN geo_country_locations cl ON cl.geoname_id = cb.geoname_id
       WHERE cl.country_iso_code IS NOT NULL
       ORDER BY cb.id
       LIMIT $1
     )
     SELECT COUNT(*)::text AS count
     FROM sample s
     JOIN LATERAL (
       SELECT r.cc
       FROM rir_delegations r
       WHERE r.resource_type IN ('ipv4', 'ipv6')
         AND r.network IS NOT NULL
         AND r.network >>= s.network
       ORDER BY masklen(r.network) DESC
       LIMIT 1
     ) rir ON true
     WHERE rir.cc IS NOT NULL
       AND upper(s.country_iso_code) IS DISTINCT FROM upper(rir.cc)`,
    [sampleWindow],
  );

  return {
    mismatchCount: Number(countRes.rows[0]?.count ?? 0),
    sampleSize: sampleWindow,
    sampled: true,
    sample: result.rows.map((row) => ({
      network: row.network,
      geoCc: row.geo_cc,
      rirCc: row.rir_cc,
      registry: row.registry,
      rangeText: row.range_text,
    })),
  };
}

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

export async function listRirRpkiAdoption(limit = 100) {
  const result = await query<{
    id: string;
    source_file: string;
    economy: string | null;
    registry: string | null;
    metric: string;
    value: string | null;
    snapshot_date: string | null;
    imported_at: Date;
  }>(
    `SELECT id::text, source_file, economy, registry, metric, value::text,
            snapshot_date::text, imported_at
     FROM rir_rpki_adoption
     ORDER BY imported_at DESC, id DESC
     LIMIT $1`,
    [limit],
  );
  return {
    items: result.rows.map((row) => ({
      id: Number(row.id),
      sourceFile: row.source_file,
      economy: row.economy,
      registry: row.registry,
      metric: row.metric,
      value: row.value,
      snapshotDate: row.snapshot_date,
      importedAt: row.imported_at.toISOString(),
    })),
  };
}
