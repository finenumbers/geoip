import type { FastifyInstance } from 'fastify';
import { getRirDatasetState } from '../repositories/rir-repository.js';

/** Public read-only RIR/IANA delegated snapshot status for Dashboard. */
export async function registerRirStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/rir/status',
    { preHandler: [app.verifyApiKeyIfEnabled] },
    async () => getRirDatasetState(),
  );
}
