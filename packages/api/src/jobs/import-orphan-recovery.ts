import { query } from '../db/client.js';
import { invalidateDatasetStateCache } from '../repositories/dataset-repository.js';
import { logger } from '../config/logger.js';

const DEFAULT_STALE_MINUTES = 20;

function resolveStaleMinutes(): number {
  const envMinutes = Number(process.env.IMPORT_STALE_MINUTES ?? DEFAULT_STALE_MINUTES);
  if (!Number.isFinite(envMinutes) || envMinutes < 5) return DEFAULT_STALE_MINUTES;
  return Math.min(Math.floor(envMinutes), 120);
}

/**
 * Fail imports left in active states after worker crash/restart.
 * Prevents perpetual importRunning lock when advisory lock is already released.
 */
export async function recoverStaleImportRuns(): Promise<string[]> {
  const staleMinutes = resolveStaleMinutes();

  const recovered = await query<{ id: string }>(
    `UPDATE import_runs
     SET status = 'failed',
         finished_at = NOW(),
         error_code = 'WORKER_ORPHAN',
         error_message = $2
     WHERE status IN ('running', 'validating', 'swapping', 'refreshing_mv')
       AND started_at IS NOT NULL
       AND started_at < NOW() - ($1::text || ' minutes')::interval
     RETURNING id`,
    [staleMinutes, `Import abandoned after ${staleMinutes}m without worker progress`],
  );

  const ids = recovered.rows.map((row) => row.id);
  if (ids.length === 0) return ids;

  await query(
    `UPDATE import_run_steps
     SET status = 'failed',
         finished_at = NOW(),
         message = 'Orphaned by worker recovery'
     WHERE import_run_id = ANY($1::uuid[])
       AND status = 'running'`,
    [ids],
  );

  await query(
    `UPDATE dataset_state
     SET mv_status = 'ready'
     WHERE id = 1
       AND mv_status = 'refreshing'`,
  );

  invalidateDatasetStateCache();
  logger.warn({ importRunIds: ids, staleMinutes }, 'Recovered stale import runs');
  return ids;
}
