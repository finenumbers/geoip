import { eq } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { datasetState } from '../db/schema.js';
import { invalidateDatasetStateCache } from '../repositories/dataset-repository.js';
import { logger } from '../config/logger.js';
import {
  buildFilterCountCache,
  isFilterCountCacheEmpty,
  parseFilterCountCache,
} from './filter-count-cache.js';
import {
  buildFacetCountCache,
  isFacetCountCacheEmpty,
  isFacetCountCacheIncomplete,
  parseFacetCountCache,
} from './facet-count-cache.js';
import { DATASET_CACHE_VERSION } from './dataset-cache-version.js';

let cacheBuildRunning = false;

export async function ensureDatasetCaches(): Promise<void> {
  if (cacheBuildRunning) return;

  const db = getDb();
  const [state] = await db.select().from(datasetState).where(eq(datasetState.id, 1)).limit(1);
  const existingFilter = parseFilterCountCache(state?.filterCountCache);
  const existingFacet = parseFacetCountCache(state?.facetCountCache);
  const cacheVersionStale = (state?.cacheVersion ?? 1) < DATASET_CACHE_VERSION;
  const needsFilter = isFilterCountCacheEmpty(existingFilter) || cacheVersionStale;
  const needsFacet =
    isFacetCountCacheEmpty(existingFacet) ||
    isFacetCountCacheIncomplete(existingFacet) ||
    cacheVersionStale;
  if (!needsFilter && !needsFacet) return;

  cacheBuildRunning = true;
  try {
    const updates: Partial<typeof datasetState.$inferInsert> = {};
    if (needsFilter) {
      logger.info('Building filter count cache');
      updates.filterCountCache = await buildFilterCountCache();
    }
    if (needsFacet) {
      logger.info('Building facet count cache');
      updates.facetCountCache = await buildFacetCountCache();
    }
    updates.cacheVersion = DATASET_CACHE_VERSION;
    await db.update(datasetState).set(updates).where(eq(datasetState.id, 1));
    invalidateDatasetStateCache();
    logger.info('Dataset caches persisted');
  } finally {
    cacheBuildRunning = false;
  }
}

export function ensureDatasetCachesInBackground(): void {
  ensureDatasetCaches().catch((err) => {
    logger.error({ err }, 'Dataset cache build failed');
  });
}

/** @deprecated use ensureDatasetCachesInBackground */
export function ensureFilterCountCacheInBackground(): void {
  ensureDatasetCachesInBackground();
}
