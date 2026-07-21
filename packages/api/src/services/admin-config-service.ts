import {
  adminConfigPatchSchema,
  adminSetupSchema,
  runtimeSecretsSchema,
  runtimeSettingsSchema,
  DEFAULT_DISPLAY_TIMEZONE,
  type AdminConfigPatch,
  type RuntimeSecrets,
  type RuntimeSettings,
} from '@geoip/shared';
import { persistRuntimeConfig, resetRuntimeConfigCache, loadRuntimeConfig, completeAdminSetupUnderLock } from '../config/runtime-config.js';
import { resetEnvCache } from '../config/env.js';
import { hashAdminPassword, verifyAdminPassword } from './admin-password.js';

function syncCronTimezones(settings: RuntimeSettings): RuntimeSettings {
  const tz = settings.general.displayTimezone.trim() || DEFAULT_DISPLAY_TIMEZONE;
  return runtimeSettingsSchema.parse({
    ...settings,
    import: { ...settings.import, cronTimezone: tz },
    rirImport: { ...settings.rirImport, cronTimezone: tz },
  });
}

function deepMergeSettings(
  base: RuntimeSettings,
  patch: Partial<RuntimeSettings>,
): RuntimeSettings {
  const merged = runtimeSettingsSchema.parse({
    ...base,
    ...patch,
    general: { ...base.general, ...patch.general },
    geoipLk: { ...base.geoipLk, ...patch.geoipLk },
    import: { ...base.import, ...patch.import },
    rirImport: { ...base.rirImport, ...patch.rirImport },
    export: { ...base.export, ...patch.export },
    api: { ...base.api, ...patch.api },
    table: { ...base.table, ...patch.table },
    database: { ...base.database, ...patch.database },
    asnMap: { ...base.asnMap, ...patch.asnMap },
    logging: { ...base.logging, ...patch.logging },
  });
  return syncCronTimezones(merged);
}

function applySecretsPatch(
  current: RuntimeSecrets,
  patch: NonNullable<AdminConfigPatch['secrets']>,
): RuntimeSecrets {
  const next = runtimeSecretsSchema.parse({ ...current });

  if (patch.geoipLk) {
    if (patch.geoipLk.email !== undefined) next.geoipLk.email = patch.geoipLk.email;
    if (patch.geoipLk.password !== undefined && patch.geoipLk.password !== '') {
      next.geoipLk.password = patch.geoipLk.password;
    }
  }

  if (patch.api) {
    if (patch.api.importApiKey !== undefined) next.api.importApiKey = patch.api.importApiKey;
    if (patch.api.apiKey !== undefined) next.api.apiKey = patch.api.apiKey;
  }

  if (patch.integrations?.googleMapsApiKey !== undefined) {
    next.integrations.googleMapsApiKey = patch.integrations.googleMapsApiKey;
  }

  if (patch.admin) {
    if (patch.admin.username !== undefined) next.admin.username = patch.admin.username;
    if (patch.admin.password !== undefined && patch.admin.password !== '') {
      if (next.admin.passwordHash) {
        if (
          !patch.admin.currentPassword ||
          !verifyAdminPassword(patch.admin.currentPassword, next.admin.passwordHash)
        ) {
          throw new AdminConfigError('INVALID_CURRENT_PASSWORD', 'Неверный текущий пароль');
        }
      }
      next.admin.passwordHash = hashAdminPassword(patch.admin.password);
    }
  }

  return next;
}

export class AdminConfigError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function applyAdminConfigPatch(patch: AdminConfigPatch) {
  const parsed = adminConfigPatchSchema.parse(patch);
  const current = loadRuntimeConfig();
  const settings = parsed.settings
    ? deepMergeSettings(current.settings, parsed.settings)
    : current.settings;
  const secrets = parsed.secrets
    ? applySecretsPatch(current.secrets, parsed.secrets)
    : current.secrets;

  if (secrets.api.importApiKey.length > 0 && secrets.api.importApiKey.length < 8) {
    throw new AdminConfigError('VALIDATION', 'IMPORT API key must be at least 8 characters');
  }
  if (secrets.api.apiKey.length > 0 && secrets.api.apiKey.length < 8) {
    throw new AdminConfigError('VALIDATION', 'API key must be at least 8 characters');
  }

  const saved = persistRuntimeConfig(settings, secrets);
  resetEnvCache();
  return saved;
}

export function completeAdminSetup(input: unknown) {
  const parsed = adminSetupSchema.parse(input);
  if (parsed.password !== parsed.confirmPassword) {
    throw new AdminConfigError('VALIDATION', 'Пароли не совпадают');
  }

  const current = loadRuntimeConfig();
  const secrets: RuntimeSecrets = {
    ...current.secrets,
    admin: {
      ...current.secrets.admin,
      username: parsed.username,
      passwordHash: hashAdminPassword(parsed.password),
    },
  };

  try {
    return completeAdminSetupUnderLock(current.settings, secrets);
  } catch (err) {
    if (err instanceof Error && err.message === 'ALREADY_SETUP') {
      throw new AdminConfigError('ALREADY_SETUP', 'Admin уже настроен');
    }
    throw err;
  }
}

export function verifyAdminCredentials(username: string, password: string): boolean {
  const { secrets } = loadRuntimeConfig();
  if (!secrets.admin.username || !secrets.admin.passwordHash) return false;
  if (secrets.admin.username !== username) return false;
  return verifyAdminPassword(password, secrets.admin.passwordHash);
}

export function isAdminSetupComplete(): boolean {
  const { secrets } = loadRuntimeConfig();
  return Boolean(secrets.admin.username && secrets.admin.passwordHash);
}
