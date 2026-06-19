import type { FastifyInstance } from 'fastify';
import { importTriggerSchema } from '@geoip/shared';
import { getDatasetState, listImportRuns, getImportRunById } from '../repositories/dataset-repository.js';
import { createImportRun } from '../services/import-service.js';

export async function registerDatasetRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/dataset/active', async () => {
    const state = await getDatasetState();
    return {
      datasetDate: state.datasetDate,
      activatedAt: state.activatedAt,
      activeImportRunId: state.activeImportRunId,
      mvStatus: state.mvStatus,
    };
  });

  app.get('/api/v1/imports', async (request) => {
    const limit = Number((request.query as { limit?: string }).limit ?? 50);
    const offset = Number((request.query as { offset?: string }).offset ?? 0);
    return listImportRuns(limit, offset);
  });

  app.get('/api/v1/imports/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await getImportRunById(id);
    if (!run) {
      return reply.status(404).send({ error: 'Not found', message: 'Import run not found' });
    }
    return run;
  });

  app.post(
    '/api/v1/imports',
    { preHandler: [app.verifyApiKey] },
    async (request, reply) => {
      const body = (request.body ?? {}) as { triggeredBy?: string };
      const triggeredBy = importTriggerSchema.safeParse(body.triggeredBy ?? 'api');
      if (!triggeredBy.success) {
        return reply.status(422).send({ error: 'Validation error', details: triggeredBy.error.flatten() });
      }

      const result = await createImportRun(triggeredBy.data);
      if (result.conflict) {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'An import is already in progress',
          importRunId: result.importRunId,
        });
      }

      return reply.status(202).send({ importRunId: result.importRunId, status: 'queued' });
    },
  );
}
