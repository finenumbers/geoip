import type { FastifyInstance } from 'fastify';
import {
  createRirImportRun,
  getRirDatasetState,
} from '../repositories/rir-repository.js';

export async function registerRirAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/admin/rir/status',
    { preHandler: [app.requireAdminSession] },
    async () => {
      return getRirDatasetState();
    },
  );

  app.post(
    '/api/v1/admin/rir/imports/trigger',
    { preHandler: [app.requireAdminSession] },
    async (_request, reply) => {
      const result = await createRirImportRun('manual');
      if (result.conflict) {
        return reply.status(409).send({
          error: 'RirImportAlreadyRunning',
          message: 'RIR import is already queued or running',
          importRunId: result.importRunId,
        });
      }
      return { importRunId: result.importRunId, status: 'queued' as const };
    },
  );
}
