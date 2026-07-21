import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isRirDatasetReady } from '../repositories/rir-repository.js';

export async function registerRirReadiness(app: FastifyInstance): Promise<void> {
  app.decorate(
    'ensureRirDatasetReady',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (!(await isRirDatasetReady())) {
        await reply.status(503).send({
          error: 'RirNotReady',
          message: 'RIR delegated snapshot is not ready yet. Retry shortly.',
        });
      }
    },
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    ensureRirDatasetReady: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}
