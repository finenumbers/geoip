import { unlinkSync } from 'node:fs';
import type { Logger } from 'pino';
import { query } from '../db/client.js';
import { loadEnv } from '../config/env.js';

type DeletedExportRow = {
  id: string;
  download_path: string | null;
};

export async function pruneExportHistory(
  log?: Logger,
): Promise<{ deletedCount: number; keptCount: number; filesRemoved: number }> {
  const env = loadEnv();
  const retentionDays = env.EXPORT_RETENTION_DAYS;
  const retentionLimit = env.EXPORT_RETENTION_LIMIT;

  const deleteResult = await query<DeletedExportRow>(
    `WITH ranked AS (
       SELECT id FROM export_jobs
       ORDER BY created_at DESC
       LIMIT $1
     ),
     keep_ids AS (
       SELECT id FROM ranked
     ),
     expired AS (
       SELECT id, download_path
       FROM export_jobs
       WHERE finished_at IS NOT NULL
         AND finished_at < NOW() - ($2::int || ' days')::interval
     ),
     to_delete AS (
       SELECT id, download_path FROM export_jobs
       WHERE id NOT IN (SELECT id FROM keep_ids)
       UNION
       SELECT id, download_path FROM expired
     ),
     deleted AS (
       DELETE FROM export_jobs
       WHERE id IN (SELECT id FROM to_delete)
       RETURNING id, download_path
     )
     SELECT id, download_path FROM deleted`,
    [retentionLimit, retentionDays],
  );

  let filesRemoved = 0;
  for (const row of deleteResult.rows) {
    if (!row.download_path) continue;
    try {
      unlinkSync(row.download_path);
      filesRemoved++;
    } catch {
      // file may already be gone
    }
  }

  const countResult = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM export_jobs`,
  );

  const deletedCount = deleteResult.rowCount ?? deleteResult.rows.length;
  const keptCount = countResult.rows[0]?.count ?? 0;

  log?.info({ deletedCount, keptCount, filesRemoved, retentionDays }, 'Export history pruned');

  return { deletedCount, keptCount, filesRemoved };
}
