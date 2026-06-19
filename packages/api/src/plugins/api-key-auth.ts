import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { loadEnv } from '../config/env.js';

export async function registerApiKeyAuth(app: FastifyInstance): Promise<void> {
  const env = loadEnv();

  app.decorate('verifyApiKey', async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.headers['x-api-key'];
    if (typeof key !== 'string' || key !== env.IMPORT_API_KEY) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid or missing X-API-Key header',
      });
    }
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    verifyApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
