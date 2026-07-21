import { mkdirSync } from 'node:fs';
import type { Logger } from 'pino';
import { loadEnv } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';
import { getDb, query } from '../db/client.js';
import { GrchcClient } from './grchc-client.js';
import { importAllZipsParallel } from './import-downloads.js';
import { datasetFingerprint } from './dataset-zip-cache.js';
import {
  createStagingSnapshot,
  findValidStagingSnapshot,
  restoreStagingSnapshot,
} from './staging-snapshot.js';
import { getDatasetState } from '../repositories/dataset-repository.js';
import {
  truncateStaging,
  swapStagingToProduction,
  dropOldStagingData,
  rebuildProductionIndexes,
  refreshMaterializedViews,
  validateStagingData,
  getMaterializedViewCounts,
} from '../sql/swap.js';
import { populateBlockAsnMappings, repointAsnMappingForeignKeys } from '../sql/asn-mapping.js';
import { fixSwappedPrimaryKeyNames } from '../sql/index-rename.js';
import { DATASET_CACHE_VERSION } from '../sql/dataset-cache-version.js';
import { markAsnMappingReady } from '../sql/asn-mapping-status.js';
import { ADDRESS_SPACE_COUNT_SQL } from '../sql/dataset-volumes-backfill.js';
import { buildFilterCountCache } from '../sql/filter-count-cache.js';
import {
  buildAsnOrgFacetCountCache,
  buildNonAsnFacetCountCache,
  mergeFacetCountCaches,
} from '../sql/facet-count-cache.js';
import { invalidateDatasetStateCache } from '../repositories/dataset-repository.js';
import { invalidateReadyCache } from '../services/ready-cache.js';
import { logImportBenchmarkSummary } from './import-benchmark.js';
import { pruneImportHistory } from './import-history-retention.js';
import {
  releaseImportLock,
  tryAcquireImportLock,
} from './import-lock.js';
import { and, eq } from 'drizzle-orm';
import { importRuns, importRunSteps, datasetState } from '../db/schema.js';

interface FileManifestEntry {
  filename: string;
  size?: number;
  rowCount?: number;
}

function formatDatasetDate(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

async function updateImportRun(
  id: string,
  data: Partial<typeof importRuns.$inferInsert>,
): Promise<void> {
  const db = getDb();
  await db.update(importRuns).set(data).where(eq(importRuns.id, id));
}

async function recordStep(
  importRunId: string,
  name: string,
  status: 'running' | 'succeeded' | 'failed',
  extra?: { durationMs?: number; rows?: number; message?: string },
): Promise<number> {
  const db = getDb();
  const now = new Date();

  if (status === 'running') {
    const [step] = await db
      .insert(importRunSteps)
      .values({ importRunId, name, status, startedAt: now })
      .returning({ id: importRunSteps.id });
    return step?.id ?? 0;
  }

  const steps = await db
    .select()
    .from(importRunSteps)
    .where(eq(importRunSteps.importRunId, importRunId));

  const step = steps.find((s) => s.name === name);
  if (!step) return 0;

  await db
    .update(importRunSteps)
    .set({
      status,
      finishedAt: now,
      durationMs: extra?.durationMs,
      rows: extra?.rows,
      message: extra?.message,
    })
    .where(eq(importRunSteps.id, step.id));

  return step.id;
}

async function tryAcquireLock(): Promise<boolean> {
  return tryAcquireImportLock();
}

async function releaseLock(): Promise<void> {
  await releaseImportLock();
}

export async function runImportPipeline(importRunId: string, logger?: Logger): Promise<void> {
  const log = logger ?? createChildLogger({ importRunId });
  const env = loadEnv();

  if (!env.GEOIP_LK_EMAIL || !env.GEOIP_LK_PASSWORD) {
    await failImport(importRunId, 'MISSING_CREDENTIALS', 'GEOIP_LK_EMAIL and GEOIP_LK_PASSWORD are required');
    await pruneImportHistory(log);
    return;
  }

  const acquired = await tryAcquireLock();
  if (!acquired) {
    log.info('Import advisory lock busy — leaving run queued for next poll');
    return;
  }

  const manifest: FileManifestEntry[] = [];
  const allRejects: Array<{ file: string; line: number; reason: string }> = [];
  let stepStart = Date.now();

  try {
    await updateImportRun(importRunId, { status: 'running', startedAt: new Date() });
    await recordStep(importRunId, 'acquire_lock', 'running');
    await recordStep(importRunId, 'acquire_lock', 'succeeded', { durationMs: 0 });

    mkdirSync(env.IMPORT_DOWNLOAD_DIR, { recursive: true });

    // Discover & download
    await recordStep(importRunId, 'discover_date', 'running');
    stepStart = Date.now();
    const client = new GrchcClient(env.GEOIP_LK_EMAIL, env.GEOIP_LK_PASSWORD, env.GEOIP_LK_BASE_URL);
    await client.login();
    const datasetDateRaw = await client.getLatestDatasetDate();
    const datasetDate = formatDatasetDate(datasetDateRaw);
    const links = await client.getDownloadLinksForDate(datasetDateRaw);
    const fingerprint = datasetFingerprint(links);
    await recordStep(importRunId, 'discover_date', 'succeeded', {
      durationMs: Date.now() - stepStart,
      message: `date=${datasetDateRaw} fp=${fingerprint}`,
    });

    if (env.IMPORT_SKIP_UNCHANGED_DATASET) {
      const db = getDb();
      const [run] = await db
        .select({ triggeredBy: importRuns.triggeredBy })
        .from(importRuns)
        .where(eq(importRuns.id, importRunId))
        .limit(1);
      const active = await getDatasetState();
      const activeDateRaw = active.datasetDate?.replace(/-/g, '');
      if (
        run?.triggeredBy === 'cron' &&
        activeDateRaw === datasetDateRaw &&
        active.datasetFingerprint === fingerprint &&
        active.mvStatus === 'ready'
      ) {
        log.info({ datasetDate, fingerprint }, 'Dataset unchanged — skipping cron import');
        await updateImportRun(importRunId, {
          status: 'succeeded',
          datasetDate,
          finishedAt: new Date(),
        });
        return;
      }
    }

    await updateImportRun(importRunId, {
      datasetDate,
    });

    // Truncate staging
    await recordStep(importRunId, 'truncate_staging', 'running');
    stepStart = Date.now();
    await truncateStaging();
    await recordStep(importRunId, 'truncate_staging', 'succeeded', {
      durationMs: Date.now() - stepStart,
    });

    let totalCity = 0;
    let totalCountry = 0;
    let totalAsn = 0;
    let validationCounts: Record<string, number> = {};
    let snapshotRestored = false;
    const directDatabaseUrl = env.DATABASE_DIRECT_URL ?? env.DATABASE_URL;

    if (env.IMPORT_STAGING_SNAPSHOT_ENABLED) {
      const snapshot = await findValidStagingSnapshot(
        env.IMPORT_DOWNLOAD_DIR,
        datasetDateRaw,
        fingerprint,
      );
      if (snapshot) {
        await recordStep(importRunId, 'restore_staging_snapshot', 'running');
        stepStart = Date.now();
        await restoreStagingSnapshot(snapshot.dumpPath, directDatabaseUrl);
        const snapshotValidation = await validateStagingData();
        if (!snapshotValidation.valid) {
          throw new Error(
            `Snapshot restore validation failed: ${snapshotValidation.errors.join('; ')}`,
          );
        }
        totalCity = snapshotValidation.counts.stg_geo_city_blocks ?? 0;
        totalCountry = snapshotValidation.counts.stg_geo_country_blocks ?? 0;
        totalAsn = snapshotValidation.counts.stg_geo_asn_blocks ?? 0;
        validationCounts = snapshotValidation.counts;
        await recordStep(importRunId, 'restore_staging_snapshot', 'succeeded', {
          durationMs: Date.now() - stepStart,
          message: JSON.stringify(snapshotValidation.counts),
        });
        snapshotRestored = true;
        log.info({ datasetDateRaw, fingerprint }, 'Restored staging tables from snapshot');
      }
    }

    if (!snapshotRestored) {
      for (const type of ['city', 'country', 'asn'] as const) {
        await recordStep(importRunId, `download_${type}`, 'running');
      }

      stepStart = Date.now();
      const downloadOutcomes = await importAllZipsParallel(
        links,
        client,
        {
          downloadDir: env.IMPORT_DOWNLOAD_DIR,
          cacheEnabled: env.IMPORT_ZIP_CACHE_ENABLED,
        },
        log,
      );

      for (const outcome of downloadOutcomes) {
        for (const reject of outcome.imported.rejects) {
          allRejects.push(reject);
        }
        for (const file of outcome.imported.files) {
          manifest.push({ filename: file.path, rowCount: file.rowCount });
        }
        totalCity += outcome.imported.cityRows;
        totalCountry += outcome.imported.countryRows;
        totalAsn += outcome.imported.asnRows;

        await recordStep(importRunId, `download_${outcome.type}`, 'succeeded', {
          durationMs: outcome.durationMs,
          rows: outcome.imported.files.length,
          message: `source=${outcome.source} city=${outcome.imported.cityRows} country=${outcome.imported.countryRows} asn=${outcome.imported.asnRows}`,
        });
      }

      const cacheHits = downloadOutcomes.filter((o) => o.source === 'cache').length;
      log.info(
        {
          downloadWallMs: Date.now() - stepStart,
          types: downloadOutcomes.map((o) => o.type),
          cacheHits,
          cacheEnabled: env.IMPORT_ZIP_CACHE_ENABLED,
        },
        'Parallel ZIP downloads complete',
      );

      if (allRejects.length > 0) {
        throw new Error(`Import rejected ${allRejects.length} rows`);
      }

      // Validate
      await updateImportRun(importRunId, { status: 'validating' });
      await recordStep(importRunId, 'validate', 'running');
      stepStart = Date.now();
      const validation = await validateStagingData();
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join('; ')}`);
      }
      await recordStep(importRunId, 'validate', 'succeeded', {
        durationMs: Date.now() - stepStart,
        message: JSON.stringify(validation.counts),
      });
      validationCounts = validation.counts;

      if (env.IMPORT_STAGING_SNAPSHOT_ENABLED) {
        await recordStep(importRunId, 'create_staging_snapshot', 'running');
        stepStart = Date.now();
        const snapshot = await createStagingSnapshot(
          env.IMPORT_DOWNLOAD_DIR,
          datasetDateRaw,
          fingerprint,
          directDatabaseUrl,
          validation.counts,
        );
        await recordStep(importRunId, 'create_staging_snapshot', 'succeeded', {
          durationMs: Date.now() - stepStart,
          message: `sizeBytes=${snapshot.sizeBytes}`,
        });
        log.info(
          { datasetDateRaw, fingerprint, sizeBytes: snapshot.sizeBytes },
          'Created staging snapshot',
        );
      }
    } else {
      for (const type of ['city', 'country', 'asn'] as const) {
        await recordStep(importRunId, `download_${type}`, 'running');
        await recordStep(importRunId, `download_${type}`, 'succeeded', {
          durationMs: 0,
          message: 'skipped=snapshot_restore',
        });
      }
      await updateImportRun(importRunId, { status: 'validating' });
      await recordStep(importRunId, 'validate', 'running');
      await recordStep(importRunId, 'validate', 'succeeded', {
        durationMs: 0,
        message: 'skipped=snapshot_restore',
      });
    }

    // Swap
    await updateImportRun(importRunId, {
      status: 'swapping',
      rowsCityBlocks: totalCity,
      rowsCountryBlocks: totalCountry,
      rowsAsnBlocks: totalAsn,
      sourceFileManifest: manifest,
    });
    await recordStep(importRunId, 'swap', 'running');
    stepStart = Date.now();
    await swapStagingToProduction();
    await fixSwappedPrimaryKeyNames();
    await repointAsnMappingForeignKeys();
    await dropOldStagingData();
    await recordStep(importRunId, 'swap', 'succeeded', { durationMs: Date.now() - stepStart });

    await recordStep(importRunId, 'rebuild_indexes', 'running');
    stepStart = Date.now();
    await rebuildProductionIndexes();
    await recordStep(importRunId, 'rebuild_indexes', 'succeeded', {
      durationMs: Date.now() - stepStart,
    });

    // Refresh MV
    await updateImportRun(importRunId, { status: 'refreshing_mv' });
    const db = getDb();
    await db
      .update(datasetState)
      .set({ mvStatus: 'refreshing' })
      .where(eq(datasetState.id, 1));

    await recordStep(importRunId, 'refresh_mv', 'running');
    stepStart = Date.now();
    try {
      await refreshMaterializedViews();
    } catch {
      log.warn('Materialized view refresh failed, retrying recreate');
      await refreshMaterializedViews();
    }

    const mvCounts = await getMaterializedViewCounts();
    if (mvCounts.city === 0 || mvCounts.country === 0) {
      throw new Error(
        `MV refresh produced empty views (city=${mvCounts.city}, country=${mvCounts.country})`,
      );
    }

    await recordStep(importRunId, 'refresh_mv', 'succeeded', {
      durationMs: Date.now() - stepStart,
      message: `city=${mvCounts.city}, country=${mvCounts.country}`,
    });

    await recordStep(importRunId, 'build_filter_count_cache', 'running');
    stepStart = Date.now();
    const filterCountCache = await buildFilterCountCache();
    await recordStep(importRunId, 'build_filter_count_cache', 'succeeded', {
      durationMs: Date.now() - stepStart,
      rows: Object.keys(filterCountCache.city.country_iso_code ?? {}).length,
    });

    await recordStep(importRunId, 'populate_asn_mapping', 'running');
    await recordStep(importRunId, 'build_facet_count_cache', 'running');
    const parallelStart = Date.now();
    const [asnCounts, facetBase] = await Promise.all([
      populateBlockAsnMappings(log),
      buildNonAsnFacetCountCache(),
    ]);
    markAsnMappingReady();
    const parallelMs = Date.now() - parallelStart;
    await recordStep(importRunId, 'populate_asn_mapping', 'succeeded', {
      durationMs: parallelMs,
      message: `city=${asnCounts.city}, country=${asnCounts.country}`,
      rows: asnCounts.city + asnCounts.country,
    });

    const asnOrgStart = Date.now();
    const facetAsnOrg = await buildAsnOrgFacetCountCache();
    const facetCountCache = mergeFacetCountCaches(facetBase, facetAsnOrg);
    await recordStep(importRunId, 'build_facet_count_cache', 'succeeded', {
      durationMs: parallelMs + (Date.now() - asnOrgStart),
      rows: Object.keys(facetCountCache.city).length,
      message: 'non-asn fields parallel with ASN populate',
    });

    const now = new Date();
    const ruCityBlocks = filterCountCache.city.country_iso_code?.RU ?? 0;
    const addressSpace = await query<{ ipv4_addresses: string; ipv6_addresses: string }>(
      ADDRESS_SPACE_COUNT_SQL,
    );
    await db
      .update(datasetState)
      .set({
        activeImportRunId: importRunId,
        datasetDate,
        activatedAt: now,
        mvStatus: 'ready',
        mvRefreshedAt: now,
        cityRowCount: mvCounts.city,
        countryRowCount: mvCounts.country,
        datasetFingerprint: fingerprint,
        asnBlocksCount: totalAsn,
        cityLocationsCount: validationCounts.stg_geo_city_locations ?? 0,
        countryLocationsCount: validationCounts.stg_geo_country_locations ?? 0,
        ruCityBlocksCount: ruCityBlocks,
        ipv4AddressCount: addressSpace.rows[0]?.ipv4_addresses ?? '0',
        ipv6AddressCount: addressSpace.rows[0]?.ipv6_addresses ?? '0',
        filterCountCache,
        facetCountCache,
        cacheVersion: DATASET_CACHE_VERSION,
      })
      .where(eq(datasetState.id, 1));

    invalidateDatasetStateCache();
    invalidateReadyCache();

    await updateImportRun(importRunId, {
      status: 'succeeded',
      finishedAt: now,
    });

    await logImportBenchmarkSummary(importRunId, log);
    log.info({ datasetDate, totalCity, totalCountry, totalAsn, asnCounts }, 'Import succeeded');

    try {
      const { rebuildGeoRirCcMismatches } = await import('./geo-rir-cc-mismatch-rebuild.js');
      await rebuildGeoRirCcMismatches(log);
    } catch (err) {
      log.warn({ err }, 'GRChC≠RIR CC mismatch rebuild skipped');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'Import failed');
    await failImport(importRunId, 'IMPORT_FAILED', message, allRejects, manifest);
  } finally {
    await releaseLock();
    await pruneImportHistory(log);
  }
}

async function failImport(
  id: string,
  code: string,
  message: string,
  rejects?: Array<{ file: string; line: number; reason: string }>,
  manifest?: FileManifestEntry[],
): Promise<void> {
  const db = getDb();
  await db
    .update(importRunSteps)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      message,
    })
    .where(
      and(eq(importRunSteps.importRunId, id), eq(importRunSteps.status, 'running')),
    );

  await db
    .update(importRuns)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      errorCode: code,
      errorMessage: message,
      rowsRejected: rejects?.length ?? 0,
      rejectReport: rejects ?? null,
      sourceFileManifest: manifest ?? null,
    })
    .where(eq(importRuns.id, id));
}
