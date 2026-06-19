import type { FastifyInstance } from 'fastify';
import { query } from '../db/client.js';
import { getDatasetState, getRunningImport } from '../repositories/dataset-repository.js';
import { isAsnMappingReady } from '../sql/asn-mapping-status.js';
import { productionIndexesOk } from '../sql/swap.js';
import { materializedViewsExist } from '../sql/recreate-materialized-views.js';
import {
  getCachedReadyResponse,
  setCachedReadyResponse,
  type ReadyResponse,
} from '../services/ready-cache.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/health', async () => {
    return {
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/api/v1/ready', async () => {
    const cached = getCachedReadyResponse();
    if (cached) return cached;

    let database = false;
    let dataset = false;
    let materializedViews = false;
    let productionIndexes = false;
    let asnMapping = false;
    let importRunning = false;

    try {
      await query('SELECT 1');
      database = true;
    } catch {
      database = false;
    }

    if (database) {
      const state = await getDatasetState();
      dataset = state.datasetDate !== null;
      const mvPresent = await materializedViewsExist();
      materializedViews = state.mvStatus === 'ready' && mvPresent;
      productionIndexes = await productionIndexesOk();
      asnMapping = await isAsnMappingReady();
      importRunning = (await getRunningImport()) !== null;
    }

    const coreReady =
      database && dataset && materializedViews && productionIndexes;

    let status: 'ready' | 'degraded' | 'not_ready';
    if (coreReady && asnMapping && !importRunning) {
      status = 'ready';
    } else if (coreReady) {
      status = 'degraded';
    } else {
      status = 'not_ready';
    }

    const payload: ReadyResponse = {
      status,
      checks: {
        database,
        dataset,
        materializedViews,
        productionIndexes,
        asnMapping,
        importRunning,
      },
      timestamp: new Date().toISOString(),
    };
    setCachedReadyResponse(payload);
    return payload;
  });
}