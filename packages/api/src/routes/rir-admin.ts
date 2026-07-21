import type { FastifyInstance } from 'fastify';
import { probeAllRirSources } from '../jobs/rir-delegated-client.js';
import { releaseOrphanedRirImportLock } from '../jobs/rir-import-lock.js';
import {
  createRirImportRun,
  getBlockingRirImport,
  getRirDatasetState,
  resetStuckRirImports,
} from '../repositories/rir-repository.js';

export async function registerRirAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/admin/rir/status',
    { preHandler: [app.requireAdminSession] },
    async () => {
      const state = await getRirDatasetState();
      const active = await getBlockingRirImport();
      return { ...state, activeImport: active };
    },
  );

  app.post(
    '/api/v1/admin/rir/test',
    { preHandler: [app.requireAdminSession] },
    async (_request, reply) => {
      try {
        const result = await probeAllRirSources();
        if (!result.ok) {
          const failed = result.sources.filter((s) => !s.ok);
          return reply.status(502).send({
            error: 'RirProbeFailed',
            message: `RIR+IANA probe failed: ${failed.length} of ${result.sources.length} sources unreachable`,
            reachableCount: result.reachableCount,
            sources: result.sources,
          });
        }
        return {
          ok: true as const,
          reachableCount: result.reachableCount,
          sources: result.sources,
        };
      } catch (err) {
        return reply.status(502).send({
          error: 'RirProbeFailed',
          message: err instanceof Error ? err.message : 'Probe failed',
        });
      }
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
          message: `RIR import is already ${result.status ?? 'queued'} (${result.importRunId}). Wait for it to finish, or use «Сбросить зависший импорт» in Admin → RIR registry. Logs: docker compose logs rir`,
          importRunId: result.importRunId,
          status: result.status ?? 'queued',
        });
      }
      return { importRunId: result.importRunId, status: 'queued' as const };
    },
  );

  app.post(
    '/api/v1/admin/rir/imports/reset',
    { preHandler: [app.requireAdminSession] },
    async () => {
      const { clearedRuns } = await resetStuckRirImports();
      await releaseOrphanedRirImportLock();
      return { ok: true as const, clearedRuns };
    },
  );
}
