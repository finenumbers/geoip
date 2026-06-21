import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { adminLoginSchema, adminSetupSchema, DEFAULT_DISPLAY_TIMEZONE } from '@geoip/shared';
import { loadBootstrapEnv } from '../config/bootstrap-env.js';
import { loadRuntimeConfig, toAdminConfigResponse } from '../config/runtime-config.js';
import {
  AdminConfigError,
  completeAdminSetup,
  isAdminSetupComplete,
  verifyAdminCredentials,
} from '../services/admin-config-service.js';
import {
  createSessionToken,
  parseSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '../services/admin-session.js';
import { clientIp, publicClientIp } from '../utils/client-ip.js';
import { lookupServerPublicIp } from '../utils/external-ip-lookup.js';
import { checkAdminAuthRateLimit } from '../utils/admin-auth-rate-limit.js';

function setSessionCookie(reply: FastifyReply, username: string): void {
  const config = loadRuntimeConfig();
  const secure = loadBootstrapEnv().NODE_ENV === 'production';
  const token = createSessionToken(username, config.secrets.admin.sessionSecret);
  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(secure));
}

export async function registerAdminAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/admin/auth/me', { preHandler: [app.requireAdminSession] }, async (request) => {
    return request.adminSession!;
  });

  app.get('/api/v1/admin/auth/status', async () => {
    return {
      setupComplete: isAdminSetupComplete(),
    };
  });

  app.post('/api/v1/admin/auth/setup', async (request, reply) => {
    const ip = clientIp(request);
    if (!checkAdminAuthRateLimit(ip)) {
      return reply.status(429).send({
        error: 'TooManyRequests',
        message: 'Слишком много попыток настройки. Попробуйте позже.',
      });
    }

    const parsed = adminSetupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'Validation error', details: parsed.error.flatten() });
    }

    try {
      completeAdminSetup(parsed.data);
      setSessionCookie(reply, parsed.data.username);
      return { ok: true, username: parsed.data.username };
    } catch (err) {
      if (err instanceof AdminConfigError) {
        return reply.status(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.post('/api/v1/admin/auth/login', async (request, reply) => {
    const ip = clientIp(request);
    if (!checkAdminAuthRateLimit(ip)) {
      return reply.status(429).send({
        error: 'TooManyRequests',
        message: 'Слишком много попыток входа. Попробуйте позже.',
      });
    }

    const parsed = adminLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'Validation error', details: parsed.error.flatten() });
    }

    if (!isAdminSetupComplete()) {
      return reply.status(503).send({
        error: 'SetupRequired',
        message: 'Сначала выполните первичную настройку admin',
      });
    }

    if (!verifyAdminCredentials(parsed.data.username, parsed.data.password)) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Неверный логин или пароль',
      });
    }

    setSessionCookie(reply, parsed.data.username);
    const config = loadRuntimeConfig();
    const secure = loadBootstrapEnv().NODE_ENV === 'production';
    const token = createSessionToken(parsed.data.username, config.secrets.admin.sessionSecret);
    const session = parseSessionToken(token, config.secrets.admin.sessionSecret);
    return session ?? { username: parsed.data.username, expiresAt: new Date().toISOString() };
  });

  app.post('/api/v1/admin/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}

export async function registerAdminConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/admin/config', { preHandler: [app.requireAdminSession] }, async () => {
    return toAdminConfigResponse(loadRuntimeConfig());
  });

  app.put('/api/v1/admin/config', { preHandler: [app.requireAdminSession] }, async (request, reply) => {
    try {
      const { applyAdminConfigPatch } = await import('../services/admin-config-service.js');
      const saved = applyAdminConfigPatch(request.body as never);
      return toAdminConfigResponse(saved);
    } catch (err) {
      if (err instanceof AdminConfigError) {
        return reply.status(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.get('/api/v1/admin/config/reload-status', { preHandler: [app.requireAdminSession] }, async () => {
    const config = loadRuntimeConfig();
    const { getReloadHints } = await import('../config/runtime-config.js');
    return {
      configUpdatedAt: config.meta.updatedAt,
      pendingReload: getReloadHints(),
    };
  });
}

export async function registerAdminOpsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/admin/config/test/grchc',
    { preHandler: [app.requireAdminSession] },
    async (_request, reply) => {
      const { loadEnv } = await import('../config/env.js');
      const env = loadEnv();
      if (!env.GEOIP_LK_EMAIL || !env.GEOIP_LK_PASSWORD) {
        return reply.status(400).send({
          error: 'MissingCredentials',
          message: 'Укажите email и пароль ГРЧЦ',
        });
      }

      const { GrchcClient } = await import('../jobs/grchc-client.js');
      const client = new GrchcClient(env.GEOIP_LK_EMAIL, env.GEOIP_LK_PASSWORD, env.GEOIP_LK_BASE_URL);
      try {
        await client.login();
        const links = await client.discoverDownloadLinks();
        return {
          ok: true,
          downloadCount: links.length,
          latestDate: links[0]?.date ?? null,
        };
      } catch (err) {
        return reply.status(502).send({
          error: 'GrchcProbeFailed',
          message: err instanceof Error ? err.message : 'Probe failed',
        });
      }
    },
  );

  app.post('/api/v1/admin/imports/trigger', { preHandler: [app.requireAdminSession] }, async (_request, reply) => {
    const { createImportRun } = await import('../services/import-service.js');
    const result = await createImportRun('manual');
    if (result.conflict) {
      return reply.status(409).send({
        error: 'ImportAlreadyRunning',
        message: 'Import уже выполняется',
        importRunId: result.importRunId,
      });
    }
    return { ok: true, importRunId: result.importRunId };
  });
}

export async function registerPublicConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/public/runtime', async () => {
    const { loadEnv } = await import('../config/env.js');
    const { loadRuntimeConfig } = await import('../config/runtime-config.js');
    const env = loadEnv();
    const config = loadRuntimeConfig();
    return {
      googleMapsApiKey: env.GOOGLE_MAPS_API_KEY,
      displayTimezone: config.settings.general.displayTimezone.trim() || DEFAULT_DISPLAY_TIMEZONE,
    };
  });

  app.get('/api/v1/public/setup-checklist', async () => {
    const { buildSetupChecklist } = await import('../services/setup-checklist.js');
    return buildSetupChecklist();
  });

  app.get('/api/v1/public/client-ip', async (request) => {
    return { ip: publicClientIp(request) };
  });

  app.get('/api/v1/public/external-ip', async () => {
    return { ip: await lookupServerPublicIp() };
  });
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  await registerAdminAuthRoutes(app);
  await registerAdminConfigRoutes(app);
  await registerAdminOpsRoutes(app);
  await registerPublicConfigRoutes(app);
}
