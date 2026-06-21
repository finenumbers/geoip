import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { loadEnv } from '../config/env.js';
import { secureStringEqual } from '../utils/secure-compare.js';

function extractApiKey(request: FastifyRequest): string | undefined {
  const header = request.headers['x-api-key'];
  return typeof header === 'string' ? header : undefined;
}

function rejectUnauthorized(reply: FastifyReply): void {
  void reply.status(401).send({
    error: 'Unauthorized',
    message: 'Invalid or missing X-API-Key header',
  });
}

export async function registerApiKeyAuth(app: FastifyInstance): Promise<void> {
  app.decorate('verifyApiKey', async (request: FastifyRequest, reply: FastifyReply) => {
    const env = loadEnv();
    const key = extractApiKey(request);
    if (!key || !secureStringEqual(key, env.API_KEY)) {
      rejectUnauthorized(reply);
      return;
    }
  });

  app.decorate('verifyApiKeyIfEnabled', async (request: FastifyRequest, reply: FastifyReply) => {
    const env = loadEnv();
    if (!env.API_AUTH_ENABLED) return;

    const key = extractApiKey(request);
    if (!key || !secureStringEqual(key, env.API_KEY)) {
      rejectUnauthorized(reply);
    }
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    verifyApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    verifyApiKeyIfEnabled: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
