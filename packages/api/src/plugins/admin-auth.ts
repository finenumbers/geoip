import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import { parseSessionToken, SESSION_COOKIE } from '../services/admin-session.js';
import { isAdminSetupComplete } from '../services/admin-config-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    adminSession?: { username: string; expiresAt: string };
  }
}

export async function registerAdminAuthPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('adminSession', undefined);

  app.addHook('preHandler', async (request: FastifyRequest) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/v1/admin/')) return;
    if (path.startsWith('/api/v1/admin/auth/login') || path.startsWith('/api/v1/admin/auth/setup')) {
      return;
    }

    const config = loadRuntimeConfig();
    const token = request.cookies[SESSION_COOKIE];
    const session = parseSessionToken(token, config.secrets.admin.sessionSecret);
    if (session) {
      request.adminSession = session;
    }
  });

  app.decorate('requireAdminSession', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAdminSetupComplete()) {
      return reply.status(503).send({
        error: 'SetupRequired',
        message: 'Admin setup is required',
      });
    }
    if (!request.adminSession) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Admin session required',
      });
    }
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAdminSession: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
