import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { ExportRequest, FilterClause, SortClause } from '@geoip/shared';
import { validateTableQueryProfile, normalizeFiltersForQuery } from '@geoip/shared';
import { getDb, query } from '../db/client.js';
import { exportJobs } from '../db/schema.js';
import { buildTableQuery, hasAsnBlocksFilter, supportsKeysetPagination } from '../sql/table-query.js';
import { usesRankSortField, rankColumn } from '../sql/sort-rank.js';
import { isAsnMappingReady } from '../sql/asn-mapping-status.js';
import { enrichBlockRowsWithAsn } from '../sql/asn-enrichment.js';
import { isMaterializedViewsReadyForQueries } from '../sql/recreate-materialized-views.js';
import { isRirDatasetReady } from '../repositories/rir-repository.js';
import { buildRirTableQuery } from '../sql/rir-table-query.js';
import { buildAsnTableQuery } from '../sql/asn-table-query.js';
import { loadEnv } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';
import { resolveFilteredRowCount } from './filter-row-count.js';
import {
  createExportZipArchive,
  exportCsvEntryName,
  removeExportCsvAfterArchive,
  resolveExportZipPath,
} from './export-archive.js';

const SYNC_EXPORT_LIMIT = 10_000;
const EXPORT_BATCH_SIZE = 10_000;

type ExportTableType = 'city' | 'country' | 'rir' | 'asn';

/** Excel (RU/EU locales) opens CSV correctly with UTF-8 BOM and semicolon delimiter. */
export const CSV_DELIMITER = ';';
export const CSV_UTF8_BOM = '\uFEFF';

const CSV_COLUMNS: Record<ExportTableType, string[]> = {
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
  rir: [
    'id',
    'registry',
    'resource_type',
    'range_text',
    'network',
    'prefix_len',
    'ip_family',
    'host_count',
    'start_asn',
    'asn_count',
    'cc',
    'status',
    'allocated_at',
    'opaque_id',
    'source_file',
    'snapshot_date',
  ],
  asn: [
    'id',
    'network',
    'prefix_len',
    'ip_family',
    'asn',
    'asn_org',
  ],
};

export function escapeCsvValue(value: unknown, delimiter: string = CSV_DELIMITER): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatCsvRow(
  row: Record<string, unknown>,
  columns: string[],
  delimiter: string = CSV_DELIMITER,
): string {
  return columns.map((column) => escapeCsvValue(row[column], delimiter)).join(delimiter);
}

export function formatCsvHeader(columns: string[], delimiter: string = CSV_DELIMITER): string {
  return columns.join(delimiter);
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

async function streamBaseTableExportToFile(
  columns: string[],
  buildQuery: typeof buildRirTableQuery,
  filters: FilterClause[],
  sort: SortClause[],
  filePath: string,
  defaultSortField: string,
): Promise<number> {
  const stream = createWriteStream(filePath, { encoding: 'utf-8' });
  stream.write(`${CSV_UTF8_BOM}${formatCsvHeader(columns)}\n`);

  let rowCount = 0;
  let offset = 0;
  let afterId: number | undefined;
  let afterSortValue: string | undefined;
  const useKeyset = supportsKeysetPagination(sort);

  while (true) {
    const { sql, params } = buildQuery({
      filters,
      sort,
      limit: EXPORT_BATCH_SIZE,
      offset: useKeyset ? 0 : offset,
      afterId: useKeyset ? afterId : undefined,
      afterSortValue: useKeyset ? afterSortValue : undefined,
    });
    const result = await query<Record<string, unknown>>(sql, params);
    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      stream.write(`${formatCsvRow(row, columns)}\n`);
      rowCount++;
    }

    if (result.rows.length < EXPORT_BATCH_SIZE) break;

    const last = result.rows[result.rows.length - 1]!;
    if (useKeyset && last.id != null) {
      afterId = Number(last.id);
      const primary = sort[0]?.field ?? defaultSortField;
      afterSortValue =
        last[primary] != null ? String(last[primary]) : String(last[defaultSortField] ?? '');
    } else {
      offset += EXPORT_BATCH_SIZE;
    }
  }

  await new Promise<void>((resolve, reject) => {
    stream.end((err: NodeJS.ErrnoException | null | undefined) => (err ? reject(err) : resolve()));
  });

  return rowCount;
}

export async function streamTableExportToFile(
  tableType: ExportTableType,
  filters: FilterClause[],
  sort: SortClause[],
  filePath: string,
): Promise<number> {
  if (tableType === 'rir') {
    return streamBaseTableExportToFile(
      CSV_COLUMNS.rir,
      buildRirTableQuery,
      filters,
      sort,
      filePath,
      'range_text',
    );
  }
  if (tableType === 'asn') {
    return streamBaseTableExportToFile(
      CSV_COLUMNS.asn,
      buildAsnTableQuery,
      filters,
      sort,
      filePath,
      'network',
    );
  }

  const columns = CSV_COLUMNS[tableType];
  const stream = createWriteStream(filePath, { encoding: 'utf-8' });
  stream.write(`${CSV_UTF8_BOM}${formatCsvHeader(columns)}\n`);

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
  tableType: ExportTableType,
  filters: FilterClause[],
  sort: SortClause[],
): Promise<number | null> {
  if (tableType === 'rir') {
    const built = buildRirTableQuery({ filters, sort, limit: 1, offset: 0 });
    const result = await query<{ count: string }>(built.countSql, built.countParams);
    return Number(result.rows[0]?.count ?? 0);
  }
  if (tableType === 'asn') {
    const built = buildAsnTableQuery({ filters, sort, limit: 1, offset: 0 });
    const result = await query<{ count: string }>(built.countSql, built.countParams);
    return Number(result.rows[0]?.count ?? 0);
  }
  return resolveFilteredRowCount(tableType, filters, sort);
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

    if (job.tableType === 'rir') {
      if (!(await isRirDatasetReady())) {
        await db
          .update(exportJobs)
          .set({
            status: 'queued',
            finishedAt: null,
            errorMessage: null,
          })
          .where(eq(exportJobs.id, jobId));
        log.info('Export deferred — RIR dataset not ready');
        return;
      }
    } else if (!(await isMaterializedViewsReadyForQueries())) {
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

    const csvPath = resolveExportFilePath(jobId);

    const rowCount = await streamTableExportToFile(job.tableType, filters, sort, csvPath);

    const zipPath = resolveExportZipPath(loadEnv().EXPORT_DIR, jobId);
    await createExportZipArchive(csvPath, zipPath, exportCsvEntryName(job.tableType));
    await removeExportCsvAfterArchive(csvPath);

    await db
      .update(exportJobs)
      .set({
        status: 'succeeded',
        finishedAt: new Date(),
        downloadPath: zipPath,
        rowCount,
      })
      .where(eq(exportJobs.id, jobId));

    log.info({ rowCount, zipPath }, 'Export completed');
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

export function resolveExportDownloadHeaders(
  downloadPath: string,
  tableType: ExportTableType,
  jobId: string,
): { contentType: string; filename: string } {
  if (downloadPath.endsWith('.zip')) {
    return {
      contentType: 'application/zip',
      filename: `geoip-${tableType}-export-${jobId}.zip`,
    };
  }
  return {
    contentType: 'text/csv; charset=utf-8',
    filename: `geoip-${tableType}-export-${jobId}.csv`,
  };
}
