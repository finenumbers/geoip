import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { loadEnv } from './config/env.js';
import { createFastifyLoggerConfig } from './config/logger.js';
import { registerRequestId } from './plugins/request-id.js';
import { registerApiKeyAuth } from './plugins/api-key-auth.js';
import { registerAdminAuthPlugin } from './plugins/admin-auth.js';
import { registerMvReadiness } from './plugins/mv-readiness.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerDatasetRoutes } from './routes/dataset.js';
import { registerLookupRoutes } from './routes/lookup.js';
import { registerTableRoutes } from './routes/table.js';
import { registerExportRoutes } from './routes/export.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { registerAdminRoutes } from './routes/admin.js';

export async function buildApp() {
  const env = loadEnv();

  const app = Fastify({
    logger: createFastifyLoggerConfig(),
    requestIdHeader: 'x-request-id',
    trustProxy: true,
  });

  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: env.API_RATE_LIMIT_MAX,
    timeWindow: env.API_RATE_LIMIT_WINDOW_MS,
    allowList: (request) => {
      const path = request.url.split('?')[0] ?? '';
      return path === '/api/v1/health' || path === '/api/v1/ready';
    },
  });

  await registerRequestId(app);
  await registerApiKeyAuth(app);
  await registerAdminAuthPlugin(app);
  await registerMvReadiness(app);
  await registerHealthRoutes(app);
  await registerDatasetRoutes(app);
  await registerLookupRoutes(app);
  await registerTableRoutes(app);
  await registerExportRoutes(app);
  await registerMetricsRoutes(app);
  await registerAdminRoutes(app);

  app.setErrorHandler((error, _request, reply) => {
    const err = error as { statusCode?: number; name?: string; message?: string };
    const statusCode = err.statusCode ?? 500;
    reply.status(statusCode).send({
      error: err.name ?? 'Error',
      message:
        env.NODE_ENV === 'production' && statusCode >= 500
          ? 'Internal server error'
          : err.message ?? 'Internal server error',
    });
  });

  return app;
}
