import type { FastifyInstance } from 'fastify';
import { query } from '../db/client.js';
import { getDatasetState, getRunningImport } from '../repositories/dataset-repository.js';
import { productionIndexesOk } from '../sql/swap.js';

async function isAsnMappingComplete(): Promise<boolean> {
  const result = await query<{ city_blocks: number; asn_rows: number }>(
    `SELECT
       (SELECT COUNT(*)::bigint FROM geo_city_blocks) AS city_blocks,
       (SELECT COUNT(*)::bigint FROM geo_city_block_asn) AS asn_rows`,
  );
  const row = result.rows[0];
  if (!row || row.city_blocks === 0) return true;
  return row.asn_rows >= row.city_blocks;
}

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/health', async () => {
    return {
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/api/v1/ready', async () => {
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
      materializedViews = state.mvStatus === 'ready';
      productionIndexes = await productionIndexesOk();
      asnMapping = await isAsnMappingComplete();
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

    return {
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
  });
}