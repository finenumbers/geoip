import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatasetState, listImportRuns, getImportRunById } from '../repositories/dataset-repository.js';
import { getImportHistoryLimit } from '../jobs/import-history-retention.js';
import { loadEnv } from '../config/env.js';
import { query } from '../db/client.js';
import { getNextDailyCronRun } from '../utils/next-cron-run.js';

export async function registerDatasetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/dataset/active', { preHandler: [app.verifyApiKeyIfEnabled] }, async () => {
    const state = await getDatasetState();
    const env = loadEnv();

    const sizeResult = await query<{ size: string }>(
      'SELECT pg_database_size(current_database()) AS size',
    );
    const databaseSizeBytes = Number(sizeResult.rows[0]?.size ?? 0) || null;
    const cronExpression = env.IMPORT_CRON_CRON.trim() || '0 10 * * *';
    const nextImportAt = getNextDailyCronRun(cronExpression)?.toISOString() ?? null;

    return {
      datasetDate: state.datasetDate,
      activatedAt: state.activatedAt,
      activeImportRunId: state.activeImportRunId,
      mvStatus: state.mvStatus,
      datasetFingerprint: state.datasetFingerprint,
      volumes: state.volumes,
      databaseSizeBytes,
      nextImportAt,
      exportMaxRows: env.EXPORT_MAX_ROWS,
    };
  });

  app.get('/api/v1/imports', { preHandler: [app.verifyApiKeyIfEnabled] }, async (request) => {
    const requested = Number((request.query as { limit?: string }).limit ?? getImportHistoryLimit());
    return listImportRuns(requested);
  });

  app.get('/api/v1/imports/:id', { preHandler: [app.verifyApiKeyIfEnabled] }, async (request, reply) => {
    const parsed = z.string().uuid().safeParse((request.params as { id: string }).id);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'Validation error', details: parsed.error.flatten() });
    }

    const run = await getImportRunById(parsed.data);
    if (!run) {
      return reply.status(404).send({ error: 'Not found' });
    }

    return run;
  });
}
