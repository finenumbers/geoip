import { desc, eq } from 'drizzle-orm';
import { getDb, query } from '../db/client.js';
import { rirImportRunSteps, rirImportRuns } from '../db/schema.js';
import {
  ipv4CountLooksInflated,
  RIR_UNIQUE_IPV4_SQL,
} from '../sql/unique-ipv4-coverage.js';

export type RirDatasetState = {
  status: 'ready' | 'importing' | 'failed' | 'unavailable';
  lastSuccessAt: string | null;
  lastSnapshotDate: string | null;
  rowCount: number;
  rowsByRegistry: Record<string, number>;
  rowsByStatus: Record<string, number>;
  snapshotsByRegistry: Record<string, string>;
  lastError: string | null;
  activeImportRunId: string | null;
  tableSizeBytes: number | null;
  volumes: {
    totalRows: number;
    ipv4Addresses: string;
  };
};

export type RirImportRunRef = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
};

export type RirImportRun = {
  id: string;
  datasetDate: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  triggeredBy: 'manual' | 'cron' | 'api';
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  rowCount: number;
  steps?: Array<{
    name: string;
    status: 'pending' | 'running' | 'succeeded' | 'failed';
    durationMs: number | null;
    rows: number | null;
    message: string | null;
  }>;
};

function asRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const date = asDateOnly(v);
    if (date) out[k] = date;
    else if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

/** PG DATE / ISO timestamp → YYYY-MM-DD (same display shape as GRChC datasetDate). */
export function asDateOnly(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

async function loadSnapshotsByRegistry(stored: unknown): Promise<Record<string, string>> {
  const fromJson = asStringRecord(stored);
  if (Object.keys(fromJson).length > 0) return fromJson;

  const result = await query<{ registry: string; d: string }>(
    `SELECT registry, MAX(snapshot_date)::text AS d
     FROM rir_delegations
     GROUP BY registry`,
  );
  const out: Record<string, string> = {};
  for (const row of result.rows) {
    if (row.d) out[row.registry] = row.d;
  }
  if (Object.keys(out).length > 0) {
    await query(
      `UPDATE rir_dataset_state
       SET snapshots_by_registry = $1::jsonb, updated_at = NOW()
       WHERE id = 1`,
      [JSON.stringify(out)],
    );
  }
  return out;
}

/** Compute unique IPv4 coverage and table size for rir_delegations. */
export async function computeRirDatasetVolumes(): Promise<{
  ipv4Addresses: string;
  tableSizeBytes: number;
}> {
  const [ipv4Result, sizeResult] = await Promise.all([
    query<{ ipv4_addresses: string }>(RIR_UNIQUE_IPV4_SQL),
    query<{ size: string }>(
      `SELECT pg_total_relation_size('rir_delegations')::text AS size`,
    ),
  ]);
  return {
    ipv4Addresses: ipv4Result.rows[0]?.ipv4_addresses ?? '0',
    tableSizeBytes: Number(sizeResult.rows[0]?.size ?? 0) || 0,
  };
}

async function backfillRirVolumesIfNeeded(): Promise<{
  ipv4Addresses: string;
  tableSizeBytes: number;
}> {
  const volumes = await computeRirDatasetVolumes();
  await query(
    `UPDATE rir_dataset_state
     SET ipv4_address_count = $1::numeric,
         table_size_bytes = $2::bigint,
         updated_at = NOW()
     WHERE id = 1`,
    [volumes.ipv4Addresses, volumes.tableSizeBytes],
  );
  return volumes;
}

export async function getRirDatasetState(): Promise<RirDatasetState> {
  const result = await query<{
    status: RirDatasetState['status'];
    last_success_at: Date | null;
    last_snapshot_date: string | null;
    row_count: string | number;
    rows_by_registry: unknown;
    rows_by_status: unknown;
    snapshots_by_registry: unknown;
    last_error: string | null;
    active_import_run_id: string | null;
    ipv4_address_count: string | null;
    table_size_bytes: string | number | null;
  }>(`SELECT status,
            last_success_at,
            last_snapshot_date::text AS last_snapshot_date,
            row_count,
            rows_by_registry,
            rows_by_status,
            snapshots_by_registry,
            last_error,
            active_import_run_id,
            ipv4_address_count::text AS ipv4_address_count,
            table_size_bytes
     FROM rir_dataset_state WHERE id = 1`);

  const row = result.rows[0];
  if (!row) {
    return {
      status: 'unavailable',
      lastSuccessAt: null,
      lastSnapshotDate: null,
      rowCount: 0,
      rowsByRegistry: {},
      rowsByStatus: {},
      snapshotsByRegistry: {},
      lastError: null,
      activeImportRunId: null,
      tableSizeBytes: null,
      volumes: { totalRows: 0, ipv4Addresses: '0' },
    };
  }

  const rowCount = Number(row.row_count);
  let tableSizeBytes =
    row.table_size_bytes != null ? Number(row.table_size_bytes) : null;
  let ipv4Addresses = row.ipv4_address_count ?? '0';

  if (
    rowCount > 0 &&
    (tableSizeBytes == null || ipv4CountLooksInflated(ipv4Addresses))
  ) {
    const filled = await backfillRirVolumesIfNeeded();
    ipv4Addresses = filled.ipv4Addresses;
    tableSizeBytes = filled.tableSizeBytes;
  }

  return {
    status: row.status,
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
    lastSnapshotDate: asDateOnly(row.last_snapshot_date),
    rowCount,
    rowsByRegistry: asRecord(row.rows_by_registry),
    rowsByStatus: asRecord(row.rows_by_status),
    snapshotsByRegistry: await loadSnapshotsByRegistry(row.snapshots_by_registry),
    lastError: row.last_error,
    activeImportRunId: row.active_import_run_id,
    tableSizeBytes,
    volumes: {
      totalRows: rowCount,
      ipv4Addresses,
    },
  };
}

export async function isRirDatasetReady(): Promise<boolean> {
  const state = await getRirDatasetState();
  return state.status === 'ready' && state.rowCount > 0;
}

export async function listRirImportRuns(limit = 10): Promise<{ items: RirImportRun[] }> {
  const db = getDb();
  const capped = Math.min(Math.max(limit, 1), 100);
  const items = await db
    .select()
    .from(rirImportRuns)
    .orderBy(desc(rirImportRuns.startedAt), desc(rirImportRuns.queuedAt))
    .limit(capped);

  return {
    items: items.map((run) => ({
      id: run.id,
      datasetDate: asDateOnly(run.snapshotDate),
      status: run.status,
      triggeredBy: run.triggeredBy,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      rowCount: run.rowCount,
    })),
  };
}

export async function getRirImportRunById(id: string): Promise<RirImportRun | null> {
  const db = getDb();
  const [run] = await db.select().from(rirImportRuns).where(eq(rirImportRuns.id, id)).limit(1);
  if (!run) return null;

  const steps = await db
    .select()
    .from(rirImportRunSteps)
    .where(eq(rirImportRunSteps.importRunId, id))
    .orderBy(rirImportRunSteps.id);

  return {
    id: run.id,
    datasetDate: asDateOnly(run.snapshotDate),
    status: run.status,
    triggeredBy: run.triggeredBy,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    rowCount: run.rowCount,
    steps: steps.map((s) => ({
      name: s.name,
      status: s.status,
      durationMs: s.durationMs,
      rows: s.rows,
      message: s.message,
    })),
  };
}

export async function getBlockingRirImport(): Promise<RirImportRunRef | null> {
  const result = await query<{ id: string; status: RirImportRunRef['status'] }>(
    `SELECT id, status FROM rir_import_runs
     WHERE status IN ('queued', 'running')
     ORDER BY started_at NULLS LAST, id
     LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

export async function getRunningRirImport(): Promise<{ id: string } | null> {
  const blocking = await getBlockingRirImport();
  return blocking ? { id: blocking.id } : null;
}

export async function getQueuedRirImports(): Promise<{ id: string }[]> {
  const result = await query<{ id: string }>(
    `SELECT id FROM rir_import_runs
     WHERE status = 'queued'
     ORDER BY started_at NULLS LAST, id`,
  );
  return result.rows;
}

export async function createRirImportRun(
  triggeredBy: 'manual' | 'cron' | 'api',
): Promise<{ importRunId: string; conflict: boolean; status?: RirImportRunRef['status'] }> {
  const blocking = await getBlockingRirImport();
  if (blocking) {
    return { importRunId: blocking.id, conflict: true, status: blocking.status };
  }

  const result = await query<{ id: string }>(
    `INSERT INTO rir_import_runs (status, triggered_by)
     VALUES ('queued', $1)
     RETURNING id`,
    [triggeredBy],
  );
  return { importRunId: result.rows[0]!.id, conflict: false };
}

/** Fail stale queued/running runs. Call on every poll (default 30 minutes). */
export async function recoverStaleRirImportRuns(staleMinutes = 30): Promise<number> {
  const result = await query(
    `UPDATE rir_import_runs
     SET status = 'failed',
         finished_at = NOW(),
         error_code = 'stale',
         error_message = $2
     WHERE status IN ('queued', 'running')
       AND COALESCE(started_at, queued_at) < NOW() - make_interval(mins => $1::int)`,
    [staleMinutes, `RIR import abandoned after ${staleMinutes}m without progress`],
  );

  await query(
    `UPDATE rir_dataset_state
     SET status = CASE WHEN row_count > 0 THEN 'ready'::rir_dataset_status ELSE 'failed'::rir_dataset_status END,
         active_import_run_id = NULL,
         updated_at = NOW()
     WHERE status = 'importing'
       AND (
         active_import_run_id IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM rir_import_runs r
           WHERE r.id = rir_dataset_state.active_import_run_id
             AND r.status IN ('queued', 'running')
         )
       )`,
  );

  return result.rowCount ?? 0;
}

/**
 * Caller must hold the RIR advisory lock. Any DB `running` row is orphaned
 * (no live worker owns the lock).
 */
export async function failOrphanedRunningRirImports(): Promise<number> {
  const result = await query(
    `UPDATE rir_import_runs
     SET status = 'failed',
         finished_at = NOW(),
         error_code = 'orphan',
         error_message = 'RIR import marked failed: worker lost ownership (orphan after crash)'
     WHERE status = 'running'`,
  );

  await query(
    `UPDATE rir_dataset_state
     SET status = CASE WHEN row_count > 0 THEN 'ready'::rir_dataset_status ELSE 'failed'::rir_dataset_status END,
         last_error = COALESCE(last_error, 'Previous RIR import was interrupted'),
         active_import_run_id = NULL,
         updated_at = NOW()
     WHERE status = 'importing'`,
  );

  return result.rowCount ?? 0;
}

/** Admin/ops: fail all queued/running and clear dataset importing flag. */
export async function resetStuckRirImports(): Promise<{ clearedRuns: number }> {
  const result = await query(
    `UPDATE rir_import_runs
     SET status = 'failed',
         finished_at = NOW(),
         error_code = 'manual_reset',
         error_message = 'Reset stuck RIR import from Admin'
     WHERE status IN ('queued', 'running')`,
  );

  await query(
    `UPDATE rir_dataset_state
     SET status = CASE WHEN row_count > 0 THEN 'ready'::rir_dataset_status ELSE 'failed'::rir_dataset_status END,
         last_error = 'Stuck RIR import was reset from Admin',
         active_import_run_id = NULL,
         updated_at = NOW()
     WHERE id = 1`,
  );

  return { clearedRuns: result.rowCount ?? 0 };
}
