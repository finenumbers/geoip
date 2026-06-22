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

async function safeCheck<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/health', async () => {
    return {
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/api/v1/ready', async (_request, reply) => {
    const cached = getCachedReadyResponse();
    if (cached) {
      if (cached.status !== 'ready') {
        return reply.status(503).send(cached);
      }
      return cached;
    }

    let database = false;
    let dataset = false;
    let materializedViews = false;
    let productionIndexes = false;
    let asnMapping = false;
    let importRunning = false;

    database = (await safeCheck(() => query('SELECT 1'))) !== null;

    const state = database ? await safeCheck(() => getDatasetState()) : null;
    if (state) {
      dataset = state.datasetDate !== null;
    }

    if (state) {
      const mvPresent = (await safeCheck(() => materializedViewsExist())) ?? false;
      materializedViews = state.mvStatus === 'ready' && mvPresent;
    }

    productionIndexes = (await safeCheck(() => productionIndexesOk())) ?? false;
    asnMapping = (await safeCheck(() => isAsnMappingReady())) ?? false;
    importRunning = (await safeCheck(() => getRunningImport())) !== null;

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
    if (status !== 'ready') {
      return reply.status(503).send(payload);
    }
    return payload;
  });
}
