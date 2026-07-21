import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_DISPLAY_TIMEZONE } from '@geoip/shared';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import {
  getRirDatasetState,
  getRirImportRunById,
  listRirImportRuns,
} from '../repositories/rir-repository.js';
import { getNextDailyCronRun } from '../utils/next-cron-run.js';

/** Public read-only RIR/IANA delegated snapshot status for Dashboard. */
export async function registerRirStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/rir/status', { preHandler: [app.verifyApiKeyIfEnabled] }, async () => {
    const state = await getRirDatasetState();
    const config = loadRuntimeConfig();
    const displayTimezone =
      config.settings.general.displayTimezone.trim() || DEFAULT_DISPLAY_TIMEZONE;
    const rirCron = config.settings.rirImport.cron;
    const rirTz = config.settings.rirImport.cronTimezone || displayTimezone;
    const nextImportAt = config.settings.rirImport.enabled
      ? (getNextDailyCronRun(rirCron, new Date(), rirTz)?.toISOString() ?? null)
      : null;

    return {
      ...state,
      nextImportAt,
      displayTimezone,
      serverNow: new Date().toISOString(),
    };
  });

  app.get('/api/v1/rir/imports', { preHandler: [app.verifyApiKeyIfEnabled] }, async (request, reply) => {
    const parsed = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    return listRirImportRuns(parsed.data.limit ?? 10);
  });

  app.get(
    '/api/v1/rir/imports/:id',
    { preHandler: [app.verifyApiKeyIfEnabled] },
    async (request, reply) => {
      const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const run = await getRirImportRunById(parsed.data.id);
      if (!run) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return run;
    },
  );
}
