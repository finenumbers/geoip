import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { from as copyFrom } from 'pg-copy-streams';
import type { Logger } from 'pino';
import type pg from 'pg';
import { RIR_DELEGATED_SOURCES } from '@geoip/shared';
import { withDirectPoolClient, query } from '../db/client.js';
import { fetchRirSourceResponse } from './rir-delegated-client.js';
import { tryAcquireRirImportLock, releaseRirImportLock } from './rir-import-lock.js';
import {
  createDelegatedParseState,
  processDelegatedLine,
  type ParsedRirRecord,
} from './rir-delegated-parse.js';

const COPY_SQL = `COPY stg_rir_delegations (
  registry, cc, resource_type, start_ip, end_ip, network, prefix_len, host_count,
  start_asn, asn_count, allocated_at, status, opaque_id, range_text, ip_family,
  source_file, snapshot_date
) FROM STDIN WITH (FORMAT text, NULL '\\N')`;

export function escapeCopyValue(value: string | null | undefined): string {
  if (value == null) return '\\N';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export function recordToCopyLine(rec: ParsedRirRecord): string {
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

async function* linesFromResponse(res: Response): AsyncGenerator<string> {
  if (!res.body) {
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) yield line;
    return;
  }
  const nodeStream = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
  const rl = createInterface({ input: nodeStream, crlfDelay: Infinity });
  for await (const line of rl) {
    yield line;
  }
}

/** Stream one source's records into an open COPY sink (does not buffer all rows). */
export async function* iterateRecordsFromResponse(
  res: Response,
  sourceFile: string,
): AsyncGenerator<ParsedRirRecord, { snapshotDate: string; recordCount: number }> {
  const state = createDelegatedParseState();
  for await (const line of linesFromResponse(res)) {
    const rec = processDelegatedLine(line, sourceFile, state);
    if (rec) yield rec;
  }
  return { snapshotDate: state.snapshotDate, recordCount: state.recordCount };
}

async function copySourceToStaging(
  client: pg.PoolClient,
  source: (typeof RIR_DELEGATED_SOURCES)[number],
  log: Logger,
  fetchImpl: typeof fetch,
): Promise<{ recordCount: number; snapshotDate: string }> {
  const res = await fetchRirSourceResponse(source, fetchImpl);
  if (!res.ok) {
    throw new Error(`Failed to download ${source.sourceFile}: HTTP ${res.status}`);
  }

  const copyStream = client.query(copyFrom(COPY_SQL));
  let recordCount = 0;
  let snapshotDate = new Date().toISOString().slice(0, 10);

  const readable = Readable.from(
    (async function* () {
      const iter = iterateRecordsFromResponse(res, source.sourceFile);
      while (true) {
        const next = await iter.next();
        if (next.done) {
          recordCount = next.value.recordCount;
          snapshotDate = next.value.snapshotDate;
          break;
        }
        yield `${recordToCopyLine(next.value)}\n`;
      }
    })(),
  );

  await pipeline(readable, copyStream);

  if (recordCount === 0) {
    throw new Error(`No records parsed from ${source.sourceFile}`);
  }

  log.info(
    { registry: source.registry, rows: recordCount, snapshotDate },
    'Copied RIR source to staging',
  );
  return { recordCount, snapshotDate };
}

async function loadAllSourcesToStaging(
  log: Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, number>> {
  return withDirectPoolClient(async (client) => {
    await client.query('TRUNCATE stg_rir_delegations RESTART IDENTITY');
    const rowsByFile: Record<string, number> = {};
    for (const source of RIR_DELEGATED_SOURCES) {
      log.info({ registry: source.registry, url: source.url }, 'Downloading RIR delegated file');
      const { recordCount } = await copySourceToStaging(client, source, log, fetchImpl);
      rowsByFile[source.sourceFile] = recordCount;
    }
    return rowsByFile;
  });
}

async function swapStagingToProduction(log: Logger): Promise<{
  rowCount: number;
  rowsByRegistry: Record<string, number>;
  rowsByStatus: Record<string, number>;
  snapshotsByRegistry: Record<string, string>;
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
      const bySnap = await client.query<{ registry: string; d: string }>(
        `SELECT registry, MAX(snapshot_date)::text AS d FROM rir_delegations GROUP BY registry`,
      );

      const rowsByRegistry: Record<string, number> = {};
      for (const row of byReg.rows) rowsByRegistry[row.registry] = Number(row.c);
      const rowsByStatus: Record<string, number> = {};
      for (const row of byStatus.rows) rowsByStatus[row.status] = Number(row.c);
      const snapshotsByRegistry: Record<string, string> = {};
      for (const row of bySnap.rows) {
        if (row.d) snapshotsByRegistry[row.registry] = row.d;
      }

      await client.query('COMMIT');
      const rowCount = Number(countRes.rows[0]?.row_count ?? 0);
      log.info(
        { rowCount, rowsByRegistry, rowsByStatus, snapshotsByRegistry },
        'Swapped RIR staging to production',
      );
      return {
        rowCount,
        rowsByRegistry,
        rowsByStatus,
        snapshotsByRegistry,
        snapshotDate: countRes.rows[0]?.snapshot_date ?? null,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

export async function runRirImportPipeline(
  importRunId: string,
  log: Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const acquired = await tryAcquireRirImportLock();
  if (!acquired) {
    log.warn({ importRunId }, 'RIR import lock busy — leaving run queued for next poll');
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

    const rowsByFile = await loadAllSourcesToStaging(log, fetchImpl);
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
           snapshots_by_registry = $6::jsonb,
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
        JSON.stringify(swapped.snapshotsByRegistry),
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
