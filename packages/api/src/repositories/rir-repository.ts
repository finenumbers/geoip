import { query } from '../db/client.js';

export type RirDatasetState = {
  status: 'ready' | 'importing' | 'failed' | 'unavailable';
  lastSuccessAt: string | null;
  lastSnapshotDate: string | null;
  rowCount: number;
  rowsByRegistry: Record<string, number>;
  rowsByStatus: Record<string, number>;
  lastError: string | null;
  activeImportRunId: string | null;
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

export async function getRirDatasetState(): Promise<RirDatasetState> {
  const result = await query<{
    status: RirDatasetState['status'];
    last_success_at: Date | null;
    last_snapshot_date: string | null;
    row_count: string | number;
    rows_by_registry: unknown;
    rows_by_status: unknown;
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
    lastError: row.last_error,
    activeImportRunId: row.active_import_run_id,
  };
}

export async function isRirDatasetReady(): Promise<boolean> {
  const state = await getRirDatasetState();
  return state.status === 'ready' && state.rowCount > 0;
}

export async function getRunningRirImport(): Promise<{ id: string } | null> {
  const result = await query<{ id: string }>(
    `SELECT id FROM rir_import_runs
     WHERE status IN ('queued', 'running')
     ORDER BY started_at NULLS LAST, id
     LIMIT 1`,
  );
  return result.rows[0] ?? null;
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
): Promise<{ importRunId: string; conflict: boolean }> {
  const running = await getRunningRirImport();
  if (running) {
    return { importRunId: running.id, conflict: true };
  }

  const result = await query<{ id: string }>(
    `INSERT INTO rir_import_runs (status, triggered_by)
     VALUES ('queued', $1)
     RETURNING id`,
    [triggeredBy],
  );
  return { importRunId: result.rows[0]!.id, conflict: false };
}

export async function recoverStaleRirImportRuns(staleMinutes = 120): Promise<void> {
  await query(
    `UPDATE rir_import_runs
     SET status = 'failed',
         finished_at = NOW(),
         error_code = 'stale',
         error_message = $2
     WHERE status IN ('queued', 'running')
       AND COALESCE(started_at, NOW() - INTERVAL '1 day') < NOW() - ($1 || ' minutes')::interval`,
    [String(staleMinutes), `RIR import abandoned after ${staleMinutes}m without progress`],
  );
  await query(
    `UPDATE rir_dataset_state
     SET status = CASE WHEN row_count > 0 THEN 'ready'::rir_dataset_status ELSE 'failed'::rir_dataset_status END,
         active_import_run_id = NULL,
         updated_at = NOW()
     WHERE status = 'importing'`,
  );
}
