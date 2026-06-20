import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isMaterializedViewsReadyForQueries } from '../sql/recreate-materialized-views.js';

export async function registerMvReadiness(app: FastifyInstance): Promise<void> {
  app.decorate(
    'ensureMaterializedViewsReady',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (!(await isMaterializedViewsReadyForQueries())) {
        await reply.status(503).send({
          error: 'Service unavailable',
          message: 'Materialized views are refreshing. Retry shortly.',
        });
      }
    },
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    ensureMaterializedViewsReady: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}
