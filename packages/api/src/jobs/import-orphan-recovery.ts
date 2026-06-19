import { loadEnv } from '../config/env.js';
import { query } from '../db/client.js';
import { invalidateDatasetStateCache } from '../repositories/dataset-repository.js';
import { logger } from '../config/logger.js';

/**
 * Fail imports left in active states after worker crash/restart.
 * Prevents perpetual importRunning lock when advisory lock is already released.
 */
export async function recoverStaleImportRuns(): Promise<string[]> {
  const staleMinutes = loadEnv().IMPORT_STALE_MINUTES;

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
     SET mv_status = 'unavailable'
     WHERE id = 1
       AND mv_status = 'refreshing'`,
  );

  invalidateDatasetStateCache();
  logger.warn({ importRunIds: ids, staleMinutes }, 'Recovered stale import runs');
  return ids;
}
