import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { loadEnv } from './config/env.js';
import { registerRequestId } from './plugins/request-id.js';
import { registerApiKeyAuth } from './plugins/api-key-auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerDatasetRoutes } from './routes/dataset.js';
import { registerLookupRoutes } from './routes/lookup.js';
import { registerTableRoutes } from './routes/table.js';
import { registerExportRoutes } from './routes/export.js';
import { registerMetricsRoutes } from './routes/metrics.js';

export async function buildApp() {
  const env = loadEnv();

  const app = Fastify({
    logger: false,
    requestIdHeader: 'x-request-id',
  });

  await app.register(cors, { origin: env.CORS_ORIGIN });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: (request) => {
      const path = request.url.split('?')[0] ?? '';
      return path === '/api/v1/health' || path === '/api/v1/ready';
    },
  });

  await registerRequestId(app);
  await registerApiKeyAuth(app);
  await registerHealthRoutes(app);
  await registerDatasetRoutes(app);
  await registerLookupRoutes(app);
  await registerTableRoutes(app);
  await registerExportRoutes(app);
  await registerMetricsRoutes(app);

  app.setErrorHandler((error, _request, reply) => {
    const err = error as { statusCode?: number; name?: string; message?: string };
    reply.status(err.statusCode ?? 500).send({
      error: err.name ?? 'Error',
      message: err.message ?? 'Internal server error',
    });
  });

  return app;
}
