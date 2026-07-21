import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { enrichRirDelegation } from '../services/rir-enrichment-service.js';

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
