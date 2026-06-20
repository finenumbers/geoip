import { createReadStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { getDb, getPool, query } from '../db/client.js';
import { datasetState } from '../db/schema.js';
import { copyCsvStreamToTable, matchCsvFile } from '../jobs/csv-copy.js';
import { invalidateDatasetStateCache } from '../repositories/dataset-repository.js';
import { invalidateReadyCache } from '../services/ready-cache.js';
import { DATASET_CACHE_VERSION } from '../sql/dataset-cache-version.js';
import { buildFilterCountCache } from '../sql/filter-count-cache.js';
import { buildFacetCountCache } from '../sql/facet-count-cache.js';
import { populateBlockAsnMappings } from '../sql/asn-mapping.js';
import { markAsnMappingReady } from '../sql/asn-mapping-status.js';
import { recreateMaterializedViewsFromProduction } from '../sql/recreate-materialized-views.js';
import {
  dropOldStagingData,
  getMaterializedViewCounts,
  rebuildProductionIndexes,
  swapStagingToProduction,
  truncateStaging,
  validateStagingData,
} from '../sql/swap.js';

const FIXTURE_SEED_LOCK = 0x47454f495033; // GEOIP3
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const FIXTURE_FILES = [
  'RU-GeoIP-City-Locations-ru.csv',
  'RU-GeoIP-Country-Locations-ru.csv',
  'RU-GeoIP-City-Blocks-IPv4.csv',
  'RU-GeoIP-Country-Blocks-IPv4.csv',
  'RU-GeoIP-ASN-Blocks-IPv4.csv',
] as const;

function fixtureDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/csv');
}

export async function isFixtureDatasetReady(): Promise<boolean> {
  const { isMaterializedViewsReadyForQueries } = await import('../sql/recreate-materialized-views.js');
  if (!(await isMaterializedViewsReadyForQueries())) return false;
  const counts = await getMaterializedViewCounts();
  return counts.city > 0 && counts.country > 0;
}

async function loadFixturesToStaging(): Promise<void> {
  await truncateStaging();
  const client = await getPool().connect();
  try {
    for (const filename of FIXTURE_FILES) {
      const matched = matchCsvFile(filename);
      if (!matched) {
        throw new Error(`Unknown fixture file: ${filename}`);
      }
      await copyCsvStreamToTable(
        client,
        createReadStream(join(fixtureDir(), filename)),
        matched.target,
        logger,
      );
    }
  } finally {
    client.release();
  }
}

/** Loads fixtures/csv into Postgres and marks dataset_state ready for integration/e2e. Idempotent. */
export async function seedFixtureDataset(): Promise<void> {
  if (await isFixtureDatasetReady()) {
    logger.info('Fixture dataset already ready — skipping seed');
    return;
  }

  await query('SELECT pg_advisory_lock($1)', [FIXTURE_SEED_LOCK]);
  try {
    if (await isFixtureDatasetReady()) return;

    logger.info('Seeding integration fixture dataset');
    await loadFixturesToStaging();

    const validation = await validateStagingData();
    if (!validation.valid) {
      throw new Error(`Fixture validation failed: ${validation.errors.join('; ')}`);
    }

    await swapStagingToProduction();
    await dropOldStagingData();
    await rebuildProductionIndexes();
    await recreateMaterializedViewsFromProduction();

    const mvCounts = await getMaterializedViewCounts();
    if (mvCounts.city === 0 || mvCounts.country === 0) {
      throw new Error(
        `Materialized views empty after fixture seed (city=${mvCounts.city}, country=${mvCounts.country})`,
      );
    }

    await populateBlockAsnMappings(logger);
    markAsnMappingReady();

    const db = getDb();
    await db
      .update(datasetState)
      .set({
        mvStatus: 'ready',
        mvRefreshedAt: new Date(),
        datasetDate: '2020-01-01',
        filterCountCache: await buildFilterCountCache(),
        facetCountCache: await buildFacetCountCache(),
        cacheVersion: DATASET_CACHE_VERSION,
      })
      .where(eq(datasetState.id, 1));

    invalidateDatasetStateCache();
    invalidateReadyCache();
    logger.info({ mvCounts }, 'Fixture dataset seed complete');
  } finally {
    await query('SELECT pg_advisory_unlock($1)', [FIXTURE_SEED_LOCK]).catch(() => {});
  }
}
