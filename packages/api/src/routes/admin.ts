import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { adminLoginSchema, adminSetupSchema, DEFAULT_DISPLAY_TIMEZONE } from '@geoip/shared';
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
  sessionCookieSecure,
} from '../services/admin-session.js';
import { clientIp, publicClientIp } from '../utils/client-ip.js';
import { lookupServerPublicIp } from '../utils/external-ip-lookup.js';
import { isAdminAuthRateLimited, recordAdminAuthFailure } from '../utils/admin-auth-rate-limit.js';

function setSessionCookie(reply: FastifyReply, request: FastifyRequest, username: string): void {
  const config = loadRuntimeConfig();
  const secure = sessionCookieSecure(request);
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
    if (isAdminAuthRateLimited(ip)) {
      return reply.status(429).send({
        error: 'TooManyRequests',
        message: 'Слишком много попыток настройки. Попробуйте позже.',
      });
    }

    const parsed = adminSetupSchema.safeParse(request.body);
    if (!parsed.success) {
      recordAdminAuthFailure(ip);
      return reply.status(422).send({ error: 'Validation error', details: parsed.error.flatten() });
    }

    try {
      completeAdminSetup(parsed.data);
      setSessionCookie(reply, request, parsed.data.username);
      return { ok: true, username: parsed.data.username };
    } catch (err) {
      recordAdminAuthFailure(ip);
      if (err instanceof AdminConfigError) {
        return reply.status(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.post('/api/v1/admin/auth/login', async (request, reply) => {
    const ip = clientIp(request);
    if (isAdminAuthRateLimited(ip)) {
      return reply.status(429).send({
        error: 'TooManyRequests',
        message: 'Слишком много попыток входа. Попробуйте позже.',
      });
    }

    const parsed = adminLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      recordAdminAuthFailure(ip);
      return reply.status(422).send({ error: 'Validation error', details: parsed.error.flatten() });
    }

    if (!isAdminSetupComplete()) {
      return reply.status(503).send({
        error: 'SetupRequired',
        message: 'Сначала выполните первичную настройку admin',
      });
    }

    if (!verifyAdminCredentials(parsed.data.username, parsed.data.password)) {
      recordAdminAuthFailure(ip);
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Неверный логин или пароль',
      });
    }

    setSessionCookie(reply, request, parsed.data.username);
    const config = loadRuntimeConfig();
    const token = createSessionToken(parsed.data.username, config.secrets.admin.sessionSecret);
    const session = parseSessionToken(token, config.secrets.admin.sessionSecret);
    return session ?? { username: parsed.data.username, expiresAt: new Date().toISOString() };
  });

  app.post('/api/v1/admin/auth/logout', async (request, reply) => {
    reply.clearCookie(SESSION_COOKIE, {
      path: '/',
      secure: sessionCookieSecure(request),
      sameSite: 'lax',
    });
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

  /** Plaintext External API key for authenticated ApiDocs examples (admin session only). */
  app.get('/api/v1/admin/config/api-key', { preHandler: [app.requireAdminSession] }, async () => {
    const config = loadRuntimeConfig();
    return { apiKey: config.secrets.api.apiKey ?? '' };
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

  app.post('/api/v1/admin/data/wipe', { preHandler: [app.requireAdminSession] }, async (_request, reply) => {
    try {
      const { wipeAllDatasets } = await import('../services/admin-data-wipe.js');
      return await wipeAllDatasets();
    } catch (err) {
      return reply.status(500).send({
        error: 'DataWipeFailed',
        message: err instanceof Error ? err.message : 'Не удалось удалить данные',
      });
    }
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
