import { query } from '../db/client.js';
import { invalidateDatasetStateCache } from '../repositories/dataset-repository.js';
import { invalidateReadyCache } from '../services/ready-cache.js';
import { logger } from '../config/logger.js';
import { withImportLockIfFree } from './import-lock.js';

async function failActiveImportRuns(
  errorCode: string,
  errorMessage: string,
): Promise<string[]> {
  const recovered = await query<{ id: string }>(
    `UPDATE import_runs
     SET status = 'failed',
         finished_at = NOW(),
         error_code = $1,
         error_message = $2
     WHERE status IN ('running', 'validating', 'swapping', 'refreshing_mv')
     RETURNING id`,
    [errorCode, errorMessage],
  );

  const ids = recovered.rows.map((row) => row.id);
  if (ids.length === 0) return ids;

  await query(
    `UPDATE import_run_steps
     SET status = 'failed',
         finished_at = NOW(),
         message = $2
     WHERE import_run_id = ANY($1::uuid[])
       AND status = 'running'`,
    [ids, `Orphaned by worker recovery (${errorCode})`],
  );

  await query(
    `UPDATE dataset_state
     SET mv_status = 'unavailable'
     WHERE id = 1
       AND mv_status = 'refreshing'`,
  );

  invalidateDatasetStateCache();
  invalidateReadyCache();
  return ids;
}

/**
 * Fail active GRChC imports only when the advisory lock is free (no live owner).
 * Fail UPDATE runs while the probe session holds the lock to avoid racing a new worker.
 */
export async function recoverOrphanedGrchcImportsIfLockFree(): Promise<{
  clearedIds: string[];
  lockHeld: boolean;
}> {
  const clearedIds = await withImportLockIfFree(() =>
    failActiveImportRuns(
      'WORKER_ORPHAN',
      'Import abandoned: advisory lock free (worker lost ownership)',
    ),
  );

  if (clearedIds === null) {
    return { clearedIds: [], lockHeld: true };
  }

  if (clearedIds.length > 0) {
    logger.warn({ importRunIds: clearedIds }, 'Recovered orphaned GRChC import runs (lock was free)');
  }

  return { clearedIds, lockHeld: false };
}

/** Admin/ops: fail queued + active runs regardless of lock. Caller should report lockHeld. */
export async function resetStuckGrchcImports(): Promise<{ clearedRuns: number }> {
  const active = await failActiveImportRuns(
    'manual_reset',
    'Reset stuck GRChC import from Admin',
  );

  const queued = await query<{ id: string }>(
    `UPDATE import_runs
     SET status = 'failed',
         finished_at = NOW(),
         error_code = 'manual_reset',
         error_message = 'Reset stuck GRChC import from Admin'
     WHERE status = 'queued'
     RETURNING id`,
  );

  const queuedIds = queued.rows.map((row) => row.id);
  if (queuedIds.length > 0) {
    await query(
      `UPDATE import_run_steps
       SET status = 'failed',
           finished_at = NOW(),
           message = 'Orphaned by manual reset'
       WHERE import_run_id = ANY($1::uuid[])
         AND status = 'running'`,
      [queuedIds],
    );
  }

  invalidateDatasetStateCache();
  invalidateReadyCache();

  const clearedRuns = active.length + queuedIds.length;
  if (clearedRuns > 0) {
    logger.warn(
      { clearedRuns, active: active.length, queued: queuedIds.length },
      'Reset stuck GRChC imports',
    );
  }
  return { clearedRuns };
}
