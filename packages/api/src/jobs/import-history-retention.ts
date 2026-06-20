import type { Logger } from 'pino';
import { query } from '../db/client.js';
import { getDatasetState, getRunningImport } from '../repositories/dataset-repository.js';
import { loadEnv } from '../config/env.js';

export function getImportHistoryLimit(): number {
  return loadEnv().IMPORT_HISTORY_LIMIT;
}

export async function pruneImportHistory(
  log?: Logger,
): Promise<{ deletedCount: number; keptCount: number }> {
  const state = await getDatasetState();
  const running = await getRunningImport();

  const protectedIds = new Set<string>();
  if (state.activeImportRunId) {
    protectedIds.add(state.activeImportRunId);
  }
  if (running?.id) {
    protectedIds.add(running.id);
  }

  const protectedArray = [...protectedIds];

  const deleteResult = await query<{ id: string }>(
    `WITH ranked AS (
       SELECT id FROM import_runs
       ORDER BY COALESCE(finished_at, started_at) DESC NULLS LAST
       LIMIT $1
     ),
     keep_ids AS (
       SELECT id FROM ranked
       UNION
       SELECT unnest($2::uuid[]) AS id
     ),
     deleted AS (
       DELETE FROM import_runs
       WHERE id NOT IN (SELECT id FROM keep_ids)
       RETURNING id
     )
     SELECT id FROM deleted`,
    [getImportHistoryLimit(), protectedArray],
  );

  const countResult = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM import_runs`,
  );

  const deletedCount = deleteResult.rowCount ?? deleteResult.rows.length;
  const keptCount = countResult.rows[0]?.count ?? 0;

  log?.info({ deletedCount, keptCount, protectedIds: protectedArray }, 'Import history pruned');

  return { deletedCount, keptCount };
}
