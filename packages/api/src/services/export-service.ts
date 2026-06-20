import { createWriteStream, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { ExportRequest, FilterClause, SortClause } from '@geoip/shared';
import { validateTableQueryProfile, normalizeFiltersForQuery } from '@geoip/shared';
import { getDb, query } from '../db/client.js';
import { exportJobs } from '../db/schema.js';
import { buildTableQuery, hasAsnBlocksFilter, supportsKeysetPagination } from '../sql/table-query.js';
import { usesRankSortField, rankColumn } from '../sql/sort-rank.js';
import { estimateFilteredCount } from '../sql/count-estimate.js';
import { isAsnMappingReady } from '../sql/asn-mapping-status.js';
import { enrichBlockRowsWithAsn } from '../sql/asn-enrichment.js';
import { isMaterializedViewsReadyForQueries } from '../sql/recreate-materialized-views.js';
import { loadEnv } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';

const SYNC_EXPORT_LIMIT = 10_000;
const EXPORT_BATCH_SIZE = 10_000;

const CSV_COLUMNS: Record<'city' | 'country', string[]> = {
  city: [
    'id',
    'network',
    'prefix_len',
    'country_iso_code',
    'country_name',
    'city_name',
    'subdivision_1_name',
    'timezone',
    'asn',
    'asn_org',
  ],
  country: [
    'id',
    'network',
    'prefix_len',
    'country_iso_code',
    'country_name',
    'asn',
    'asn_org',
  ],
};

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatCsvRow(row: Record<string, unknown>, columns: string[]): string {
  return columns.map((column) => escapeCsvValue(row[column])).join(',');
}

function getExportSortCursor(row: Record<string, unknown>, sort: SortClause[]): string | undefined {
  const primary = sort[0];
  if (!primary || primary.field === 'network') {
    return row.network != null ? String(row.network) : undefined;
  }
  if (primary.field === 'prefix_len') {
    return row.prefix_len != null ? String(row.prefix_len) : undefined;
  }
  if (usesRankSortField(primary.field)) {
    const rankKey = rankColumn(primary.field, 'v').split('.')[1]!;
    const rank = row[rankKey];
    return rank != null ? String(rank) : undefined;
  }
  const value = row[primary.field];
  return value != null ? String(value) : '';
}

/** Page arg for buildTableQuery during keyset export (page>1 required to activate cursor). */
export function exportKeysetQueryPage(afterId: number | undefined, offsetPage: number, useKeyset: boolean): number {
  if (!useKeyset) return offsetPage;
  return afterId != null ? 2 : 1;
}

/** Whether export batches can use keyset pagination for the given query. */
export function resolveExportUseKeyset(
  sort: SortClause[],
  filters: FilterClause[],
  usePrecomputedAsnFilter: boolean,
): boolean {
  return (
    supportsKeysetPagination(sort) &&
    (!hasAsnBlocksFilter(filters) || usePrecomputedAsnFilter)
  );
}

export async function streamTableExportToFile(
  tableType: 'city' | 'country',
  filters: FilterClause[],
  sort: SortClause[],
  filePath: string,
): Promise<number> {
  const columns = CSV_COLUMNS[tableType];
  const stream = createWriteStream(filePath, { encoding: 'utf-8' });
  stream.write(`${columns.join(',')}\n`);

  let rowCount = 0;
  let page = 1;
  let afterId: number | undefined;
  let afterNetwork: string | undefined;
  let afterSortValue: string | undefined;
  const usePrecomputedAsnFilter = await isAsnMappingReady();
  const useKeyset = resolveExportUseKeyset(sort, filters, usePrecomputedAsnFilter);

  while (true) {
    const { sql, params } = buildTableQuery(tableType, {
      page: exportKeysetQueryPage(afterId, page, useKeyset),
      pageSize: EXPORT_BATCH_SIZE,
      sort,
      filters,
      afterId: useKeyset ? afterId : undefined,
      afterNetwork: useKeyset ? afterNetwork : undefined,
      afterSortValue: useKeyset ? afterSortValue : undefined,
      usePrecomputedAsnFilter,
    });
    const result = await query<Record<string, unknown>>(sql, params);
    if (result.rows.length === 0) break;

    const enrichedRows = await enrichBlockRowsWithAsn(tableType, result.rows);
    for (const row of enrichedRows) {
      stream.write(`${formatCsvRow(row, columns)}\n`);
      rowCount++;
    }

    if (result.rows.length < EXPORT_BATCH_SIZE) break;

    const last = enrichedRows[enrichedRows.length - 1];
    if (useKeyset && last?.id != null) {
      afterId = Number(last.id);
      afterNetwork = last.network != null ? String(last.network) : undefined;
      afterSortValue = getExportSortCursor(last, sort);
    } else {
      page++;
    }
  }

  await new Promise<void>((resolve, reject) => {
    stream.end((err: NodeJS.ErrnoException | null | undefined) => (err ? reject(err) : resolve()));
  });

  return rowCount;
}

export async function estimateExportRows(
  tableType: 'city' | 'country',
  filters: FilterClause[],
  sort: SortClause[],
): Promise<number | null> {
  const usePrecomputedAsnFilter = await isAsnMappingReady();
  const { countSql, countParams, useCachedCount } = buildTableQuery(tableType, {
    page: 1,
    pageSize: 1,
    sort,
    filters,
    usePrecomputedAsnFilter,
  });
  if (useCachedCount) {
    const state = await import('../repositories/dataset-repository.js').then((m) =>
      m.getDatasetState(),
    );
    return tableType === 'city' ? state.cityRowCount : state.countryRowCount;
  }
  if (!countSql) {
    return hasAsnBlocksFilter(filters) ? null : 0;
  }
  return estimateFilteredCount(countSql, countParams);
}

export async function createExportJob(request: ExportRequest) {
  const db = getDb();
  const [job] = await db
    .insert(exportJobs)
    .values({
      tableType: request.tableType,
      filters: request.filters,
      sort: request.sort,
      status: 'queued',
    })
    .returning();

  return job;
}

export async function getExportJob(id: string) {
  const db = getDb();
  const [job] = await db.select().from(exportJobs).where(eq(exportJobs.id, id)).limit(1);
  return job ?? null;
}

export function resolveExportFilePath(jobId: string): string {
  const env = loadEnv();
  mkdirSync(env.EXPORT_DIR, { recursive: true });
  return join(env.EXPORT_DIR, `${jobId}.csv`);
}

export async function processExportJob(
  jobId: string,
  options?: { claimed?: boolean },
): Promise<void> {
  const log = createChildLogger({ exportJobId: jobId });
  const db = getDb();

  const job = await getExportJob(jobId);
  if (!job) return;

  if (!options?.claimed) {
    const claimed = await query<{ id: string }>(
      `UPDATE export_jobs
       SET status = 'running'
       WHERE id = $1 AND status = 'queued'
       RETURNING id`,
      [jobId],
    );
    if (!claimed.rows[0]) return;
  }

  try {
    const rawFilters = (job.filters ?? []) as FilterClause[];
    const sort = (job.sort ?? []) as SortClause[];

    const profileCheck = validateTableQueryProfile(job.tableType, sort, rawFilters);
    if (!profileCheck.ok) {
      const message = profileCheck.issues.map((issue) => issue.message).join('; ');
      await db
        .update(exportJobs)
        .set({ status: 'failed', finishedAt: new Date(), errorMessage: message })
        .where(eq(exportJobs.id, jobId));
      log.warn({ message }, 'Export rejected — invalid query profile');
      return;
    }

    const filters = normalizeFiltersForQuery(rawFilters);

    if (!(await isMaterializedViewsReadyForQueries())) {
      await db
        .update(exportJobs)
        .set({
          status: 'queued',
          finishedAt: null,
          errorMessage: null,
        })
        .where(eq(exportJobs.id, jobId));
      log.info('Export deferred — materialized views not ready');
      return;
    }

    const filePath = resolveExportFilePath(jobId);

    const rowCount = await streamTableExportToFile(job.tableType, filters, sort, filePath);

    await db
      .update(exportJobs)
      .set({
        status: 'succeeded',
        finishedAt: new Date(),
        downloadPath: filePath,
        rowCount,
      })
      .where(eq(exportJobs.id, jobId));

    log.info({ rowCount, filePath }, 'Export completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(exportJobs)
      .set({ status: 'failed', finishedAt: new Date(), errorMessage: message })
      .where(eq(exportJobs.id, jobId));
    log.error({ err }, 'Export failed');
  }
}

export async function claimNextExportJob(): Promise<string | null> {
  const result = await query<{ id: string }>(
    `UPDATE export_jobs
     SET status = 'running'
     WHERE id = (
       SELECT id
       FROM export_jobs
       WHERE status = 'queued'
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id`,
  );
  return result.rows[0]?.id ?? null;
}

export async function processQueuedExports(): Promise<void> {
  while (true) {
    const jobId = await claimNextExportJob();
    if (!jobId) break;
    await processExportJob(jobId, { claimed: true });
  }
}

export function shouldUseSyncExport(estimatedRows: number): boolean {
  return estimatedRows <= SYNC_EXPORT_LIMIT;
}

export async function readExportFile(path: string): Promise<string | null> {
  const { existsSync, readFileSync } = await import('node:fs');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}
