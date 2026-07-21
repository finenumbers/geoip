import { query } from '../db/client.js';

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
};

export type RirImportRunRef = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
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
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
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
  }>('SELECT * FROM rir_dataset_state WHERE id = 1');

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
    };
  }

  return {
    status: row.status,
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
    lastSnapshotDate: row.last_snapshot_date,
    rowCount: Number(row.row_count),
    rowsByRegistry: asRecord(row.rows_by_registry),
    rowsByStatus: asRecord(row.rows_by_status),
    snapshotsByRegistry: await loadSnapshotsByRegistry(row.snapshots_by_registry),
    lastError: row.last_error,
    activeImportRunId: row.active_import_run_id,
  };
}

export async function isRirDatasetReady(): Promise<boolean> {
  const state = await getRirDatasetState();
  return state.status === 'ready' && state.rowCount > 0;
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
       AND COALESCE(started_at, queued_at) < NOW() - ($1 || ' minutes')::interval`,
    [String(staleMinutes), `RIR import abandoned after ${staleMinutes}m without progress`],
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
