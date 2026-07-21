import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { rirLookupRequestSchema } from '@geoip/shared';
import { enrichRirDelegation } from '../services/rir-enrichment-service.js';
import { lookupRirByIp } from '../sql/rir-lookup.js';

const enrichBodySchema = z.object({
  registry: z.string().min(1),
  resourceType: z.string().min(1),
  rangeText: z.string().min(1),
  network: z.string().nullable().optional(),
  startAsn: z.number().int().nullable().optional(),
  opaqueId: z.string().nullable().optional(),
});

export async function registerRirEnrichmentRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/rir/lookup',
    { preHandler: [app.verifyApiKeyIfEnabled, app.ensureRirDatasetReady] },
    async (request, reply) => {
      const parsed = rirLookupRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const result = await lookupRirByIp(parsed.data.ip);
      if ('error' in result) {
        return reply.status(400).send({ error: 'Bad request', message: result.error });
      }
      return result;
    },
  );

  app.post(
    '/api/v1/rir/enrich',
    { preHandler: [app.verifyApiKeyIfEnabled] },
    async (request, reply) => {
      const parsed = enrichBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      try {
        return await enrichRirDelegation({
          registry: parsed.data.registry,
          resourceType: parsed.data.resourceType,
          rangeText: parsed.data.rangeText,
          network: parsed.data.network ?? null,
          startAsn: parsed.data.startAsn ?? null,
          opaqueId: parsed.data.opaqueId ?? null,
        });
      } catch (err) {
        return reply.status(502).send({
          error: 'EnrichmentFailed',
          message: err instanceof Error ? err.message : 'Enrichment failed',
        });
      }
    },
  );
}
