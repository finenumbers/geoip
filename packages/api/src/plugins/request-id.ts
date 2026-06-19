import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

export async function registerRequestId(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const header = request.headers['x-request-id'];
    request.requestId = typeof header === 'string' ? header : randomUUID();
  });

  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('x-request-id', request.requestId);
  });
}
