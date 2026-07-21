import { promises as fs, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { loadEnv } from '../config/env.js';
import { query, withDirectPoolClient } from '../db/client.js';
import { logger } from '../config/logger.js';
import { releaseOrphanedImportLock } from '../jobs/import-lock.js';
import { releaseOrphanedRirImportLock } from '../jobs/rir-import-lock.js';
import { invalidateDatasetStateCache } from '../repositories/dataset-repository.js';
import { recreateMaterializedViewsFromProduction } from '../sql/recreate-materialized-views.js';
import { invalidateAsnMappingCache } from '../sql/asn-mapping-status.js';
import { DATASET_CACHE_VERSION } from '../sql/dataset-cache-version.js';
import { resolveExportZipPath } from './export-archive.js';
import { invalidateReadyCache } from './ready-cache.js';

export type AdminDataWipeResult = {
  ok: true;
  grchcImportRunsDeleted: number;
  rirImportRunsDeleted: number;
  exportJobsDeleted: number;
  exportFilesRemoved: number;
  zipCacheCleared: boolean;
};

async function clearZipCache(downloadDir: string): Promise<boolean> {
  const zipsDir = join(downloadDir, 'zips');
  try {
    await fs.rm(zipsDir, { recursive: true, force: true });
    return true;
  } catch (err) {
    logger.warn({ err, zipsDir }, 'Failed to clear ZIP cache directory');
    return false;
  }
}

function unlinkQuietly(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

async function clearExportJobs(): Promise<{ deleted: number; filesRemoved: number }> {
  const env = loadEnv();
  const listed = await query<{ id: string; download_path: string | null }>(
    `SELECT id, download_path FROM export_jobs`,
  );

  let filesRemoved = 0;
  for (const row of listed.rows) {
    if (row.download_path && unlinkQuietly(row.download_path)) {
      filesRemoved += 1;
    }
    const zipPath = resolveExportZipPath(env.EXPORT_DIR, row.id);
    if (unlinkQuietly(zipPath)) {
      filesRemoved += 1;
    }
  }

  const deleted = await query(`DELETE FROM export_jobs`);
  return {
    deleted: deleted.rowCount ?? listed.rows.length,
    filesRemoved,
  };
}

async function wipeDataTables(client: pg.PoolClient): Promise<void> {
  await client.query('DROP MATERIALIZED VIEW IF EXISTS mv_city_blocks_ru');
  await client.query('DROP MATERIALIZED VIEW IF EXISTS mv_city_blocks_analytics');
  await client.query('DROP MATERIALIZED VIEW IF EXISTS mv_country_blocks_analytics');

  await client.query(`
    TRUNCATE
      geo_city_block_asn,
      geo_country_block_asn,
      geo_city_blocks,
      geo_country_blocks,
      geo_asn_blocks,
      geo_city_locations,
      geo_country_locations,
      stg_geo_city_locations,
      stg_geo_country_locations,
      stg_geo_city_blocks,
      stg_geo_country_blocks,
      stg_geo_asn_blocks
    RESTART IDENTITY CASCADE
  `);

  await client.query(`
    ALTER TABLE stg_geo_city_blocks DROP CONSTRAINT IF EXISTS geo_city_blocks_geoname_id_fkey;
    ALTER TABLE stg_geo_country_blocks DROP CONSTRAINT IF EXISTS geo_country_blocks_geoname_id_fkey;
  `);

  await client.query(`TRUNCATE stg_rir_delegations, rir_delegations RESTART IDENTITY`);
  await client.query(`TRUNCATE geo_rir_cc_mismatches, rir_rdap_cache RESTART IDENTITY`);
  await client.query(
    `UPDATE geo_rir_cc_mismatch_state
     SET status = 'never',
         row_count = 0,
         rebuilt_at = NULL,
         duration_ms = NULL,
         last_error = NULL,
         updated_at = NOW()
     WHERE id = 1`,
  );
}

/**
 * Destructive admin op: wipe GRChC + RIR datasets, import/export history, and ZIP cache.
 * Keeps admin config/secrets and schema intact.
 */
export async function wipeAllDatasets(): Promise<AdminDataWipeResult> {
  const env = loadEnv();
  logger.warn('Admin data wipe started');

  await query(
    `UPDATE import_runs
     SET status = 'failed',
         finished_at = COALESCE(finished_at, NOW()),
         error_code = COALESCE(error_code, 'manual_wipe'),
         error_message = COALESCE(error_message, 'Dataset wiped from Admin')
     WHERE status IN ('queued', 'running', 'validating', 'swapping', 'refreshing_mv')`,
  );
  await query(
    `UPDATE rir_import_runs
     SET status = 'failed',
         finished_at = COALESCE(finished_at, NOW()),
         error_code = COALESCE(error_code, 'manual_wipe'),
         error_message = COALESCE(error_message, 'Dataset wiped from Admin')
     WHERE status IN ('queued', 'running')`,
  );

  await query(`UPDATE dataset_state SET active_import_run_id = NULL WHERE id = 1`);
  await query(`UPDATE rir_dataset_state SET active_import_run_id = NULL WHERE id = 1`);

  await releaseOrphanedImportLock().catch((err) => {
    logger.warn({ err }, 'Failed to release orphaned GRChC import lock during wipe');
  });
  await releaseOrphanedRirImportLock().catch((err) => {
    logger.warn({ err }, 'Failed to release orphaned RIR import lock during wipe');
  });

  // Heavy TRUNCATE/DROP can exceed the default statement_timeout on large datasets.
  await withDirectPoolClient(async (client) => {
    await wipeDataTables(client);
  });

  await recreateMaterializedViewsFromProduction();

  await query(
    `UPDATE dataset_state
     SET active_import_run_id = NULL,
         dataset_date = NULL,
         activated_at = NULL,
         mv_status = 'unavailable',
         mv_refreshed_at = NULL,
         city_row_count = 0,
         country_row_count = 0,
         dataset_fingerprint = NULL,
         asn_blocks_count = 0,
         city_locations_count = 0,
         country_locations_count = 0,
         ru_city_blocks_count = 0,
         ipv4_address_count = 0,
         ipv6_address_count = 0,
         filter_count_cache = '{}'::jsonb,
         facet_count_cache = '{}'::jsonb,
         cache_version = $1
     WHERE id = 1`,
    [DATASET_CACHE_VERSION],
  );

  await query(
    `UPDATE rir_dataset_state
     SET status = 'unavailable',
         last_success_at = NULL,
         last_snapshot_date = NULL,
         row_count = 0,
         rows_by_registry = '{}'::jsonb,
         rows_by_status = '{}'::jsonb,
         snapshots_by_registry = '{}'::jsonb,
         ipv4_address_count = 0,
         table_size_bytes = NULL,
         last_error = NULL,
         active_import_run_id = NULL,
         updated_at = NOW()
     WHERE id = 1`,
  );

  const grchcDeleted = await query(`DELETE FROM import_runs`);
  const rirDeleted = await query(`DELETE FROM rir_import_runs`);
  const exports = await clearExportJobs();
  const zipCacheCleared = await clearZipCache(env.IMPORT_DOWNLOAD_DIR);

  invalidateDatasetStateCache();
  invalidateReadyCache();
  invalidateAsnMappingCache();

  const result: AdminDataWipeResult = {
    ok: true,
    grchcImportRunsDeleted: grchcDeleted.rowCount ?? 0,
    rirImportRunsDeleted: rirDeleted.rowCount ?? 0,
    exportJobsDeleted: exports.deleted,
    exportFilesRemoved: exports.filesRemoved,
    zipCacheCleared,
  };

  logger.warn(result, 'Admin data wipe complete');
  return result;
}
