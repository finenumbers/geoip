import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { from as copyFrom } from 'pg-copy-streams';
import type { Logger } from 'pino';
import { withDirectPoolClient, query } from '../db/client.js';
import { downloadAndParseAllRirSources } from './rir-delegated-client.js';
import { tryAcquireRirImportLock, releaseRirImportLock } from './rir-import-lock.js';
import type { ParsedRirRecord } from './rir-delegated-parse.js';

function escapeCopyValue(value: string | null | undefined): string {
  if (value == null) return '\\N';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function recordToCopyLine(rec: ParsedRirRecord): string {
  return [
    escapeCopyValue(rec.registry),
    escapeCopyValue(rec.cc),
    escapeCopyValue(rec.resourceType),
    escapeCopyValue(rec.startIp),
    escapeCopyValue(rec.endIp),
    escapeCopyValue(rec.network),
    escapeCopyValue(rec.prefixLen != null ? String(rec.prefixLen) : null),
    escapeCopyValue(rec.hostCount),
    escapeCopyValue(rec.startAsn != null ? String(rec.startAsn) : null),
    escapeCopyValue(rec.asnCount != null ? String(rec.asnCount) : null),
    escapeCopyValue(rec.allocatedAt),
    escapeCopyValue(rec.status),
    escapeCopyValue(rec.opaqueId),
    escapeCopyValue(rec.rangeText),
    escapeCopyValue(rec.ipFamily != null ? String(rec.ipFamily) : null),
    escapeCopyValue(rec.sourceFile),
    escapeCopyValue(rec.snapshotDate),
  ].join('\t');
}

async function copyRecordsToStaging(records: ParsedRirRecord[], log: Logger): Promise<void> {
  await withDirectPoolClient(async (client) => {
    await client.query('TRUNCATE stg_rir_delegations RESTART IDENTITY');
    const copySql = `COPY stg_rir_delegations (
      registry, cc, resource_type, start_ip, end_ip, network, prefix_len, host_count,
      start_asn, asn_count, allocated_at, status, opaque_id, range_text, ip_family,
      source_file, snapshot_date
    ) FROM STDIN WITH (FORMAT text, NULL '\\N')`;

    const stream = client.query(copyFrom(copySql));
    const readable = Readable.from(
      (async function* () {
        for (const rec of records) {
          yield `${recordToCopyLine(rec)}\n`;
        }
      })(),
    );
    await pipeline(readable, stream);
  });
  log.info({ rows: records.length }, 'Copied RIR records to staging');
}

async function swapStagingToProduction(log: Logger): Promise<{
  rowCount: number;
  rowsByRegistry: Record<string, number>;
  rowsByStatus: Record<string, number>;
  snapshotDate: string | null;
}> {
  return withDirectPoolClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('TRUNCATE rir_delegations RESTART IDENTITY');
      await client.query(`
        INSERT INTO rir_delegations (
          registry, cc, resource_type, start_ip, end_ip, network, prefix_len, host_count,
          start_asn, asn_count, allocated_at, status, opaque_id, range_text, ip_family,
          source_file, snapshot_date
        )
        SELECT
          registry, cc, resource_type, start_ip, end_ip, network, prefix_len, host_count,
          start_asn, asn_count, allocated_at, status, opaque_id, range_text, ip_family,
          source_file, snapshot_date
        FROM stg_rir_delegations
      `);

      const countRes = await client.query<{
        row_count: string;
        snapshot_date: string | null;
      }>(`SELECT COUNT(*)::text AS row_count, MAX(snapshot_date)::text AS snapshot_date FROM rir_delegations`);

      const byReg = await client.query<{ registry: string; c: string }>(
        `SELECT registry, COUNT(*)::text AS c FROM rir_delegations GROUP BY registry`,
      );
      const byStatus = await client.query<{ status: string; c: string }>(
        `SELECT status, COUNT(*)::text AS c FROM rir_delegations GROUP BY status`,
      );

      const rowsByRegistry: Record<string, number> = {};
      for (const row of byReg.rows) rowsByRegistry[row.registry] = Number(row.c);
      const rowsByStatus: Record<string, number> = {};
      for (const row of byStatus.rows) rowsByStatus[row.status] = Number(row.c);

      await client.query('COMMIT');
      const rowCount = Number(countRes.rows[0]?.row_count ?? 0);
      log.info({ rowCount, rowsByRegistry, rowsByStatus }, 'Swapped RIR staging to production');
      return {
        rowCount,
        rowsByRegistry,
        rowsByStatus,
        snapshotDate: countRes.rows[0]?.snapshot_date ?? null,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

export async function runRirImportPipeline(importRunId: string, log: Logger): Promise<void> {
  const acquired = await tryAcquireRirImportLock();
  if (!acquired) {
    log.warn({ importRunId }, 'RIR import lock busy — leaving run queued');
    return;
  }

  try {
    await query(
      `UPDATE rir_import_runs
       SET status = 'running', started_at = COALESCE(started_at, NOW()), error_code = NULL, error_message = NULL
       WHERE id = $1`,
      [importRunId],
    );
    await query(
      `UPDATE rir_dataset_state
       SET status = 'importing', active_import_run_id = $1, last_error = NULL, updated_at = NOW()
       WHERE id = 1`,
      [importRunId],
    );

    const files = await downloadAndParseAllRirSources();
    const allRecords = files.flatMap((f) => f.parse.records);
    const rowsByFile: Record<string, number> = {};
    for (const f of files) {
      rowsByFile[f.sourceFile] = f.parse.records.length;
    }

    await copyRecordsToStaging(allRecords, log);
    const swapped = await swapStagingToProduction(log);

    await query(
      `UPDATE rir_import_runs
       SET status = 'succeeded',
           finished_at = NOW(),
           row_count = $2,
           rows_by_file = $3::jsonb,
           snapshot_date = $4::date
       WHERE id = $1`,
      [importRunId, swapped.rowCount, JSON.stringify(rowsByFile), swapped.snapshotDate],
    );
    await query(
      `UPDATE rir_dataset_state
       SET status = 'ready',
           last_success_at = NOW(),
           last_snapshot_date = $2::date,
           row_count = $3,
           rows_by_registry = $4::jsonb,
           rows_by_status = $5::jsonb,
           last_error = NULL,
           active_import_run_id = NULL,
           updated_at = NOW()
       WHERE id = 1`,
      [
        importRunId,
        swapped.snapshotDate,
        swapped.rowCount,
        JSON.stringify(swapped.rowsByRegistry),
        JSON.stringify(swapped.rowsByStatus),
      ],
    );
    log.info({ importRunId, rowCount: swapped.rowCount }, 'RIR import succeeded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, importRunId }, 'RIR import failed');
    await query(
      `UPDATE rir_import_runs
       SET status = 'failed', finished_at = NOW(), error_code = 'import_failed', error_message = $2
       WHERE id = $1`,
      [importRunId, message],
    );
    await query(
      `UPDATE rir_dataset_state
       SET status = CASE WHEN row_count > 0 THEN 'ready'::rir_dataset_status ELSE 'failed'::rir_dataset_status END,
           last_error = $1,
           active_import_run_id = NULL,
           updated_at = NOW()
       WHERE id = 1`,
      [message],
    );
  } finally {
    await releaseRirImportLock();
  }
}
