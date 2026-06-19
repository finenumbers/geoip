import type { FastifyInstance } from 'fastify';
import { lookupRequestSchema } from '@geoip/shared';
import { lookupIp } from '../sql/lookup.js';
import { recordLookupLatency } from '../routes/metrics.js';

export async function registerLookupRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/lookup', async (request, reply) => {
    const parsed = lookupRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'Validation error', details: parsed.error.flatten() });
    }

    const start = Date.now();
    const result = await lookupIp(parsed.data.ip, { include: parsed.data.include });
    recordLookupLatency(Date.now() - start);
    if ('error' in result) {
      return reply.status(400).send({ error: 'Bad request', message: result.error });
    }

    return result;
  });
}
