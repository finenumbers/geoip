import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  runtimeSettingsSchema,
  runtimeSecretsSchema,
  type RuntimeSettings,
  type RuntimeSecrets,
  type AdminConfigResponse,
  type MaskedSecretField,
  DEFAULT_RUNTIME_SETTINGS,
  applyEnvironmentProfile,
  createFreshSecrets,
  generateRandomKey,
} from '@geoip/shared';
import { loadBootstrapEnv } from './bootstrap-env.js';
import {
  configStoreExists,
  readConfigMeta,
  readSecrets,
  readSettings,
  resolveConfigPaths,
  resolveMasterKey,
  writeConfigMeta,
  writeSecrets,
  writeSettings,
  writeProxyEnv,
  withConfigLock,
  type ConfigMeta,
} from './config-store.js';
import { generateMasterKeyHex } from './config-crypto.js';

export type RuntimeConfig = {
  settings: RuntimeSettings;
  secrets: RuntimeSecrets;
  meta: ConfigMeta;
  masterKey: string;
};

export type EnvCompat = {
  DATABASE_URL: string;
  DATABASE_DIRECT_URL?: string;
  NODE_ENV: 'development' | 'production' | 'test';
  GEOIP_LK_EMAIL: string;
  GEOIP_LK_PASSWORD: string;
  GEOIP_LK_BASE_URL: string;
  IMPORT_API_KEY: string;
  API_KEY: string;
  API_AUTH_ENABLED: boolean;
  IMPORT_CRON_CRON: string;
  IMPORT_CRON_TZ: string;
  IMPORT_DOWNLOAD_DIR: string;
  EXPORT_DIR: string;
  IMPORT_ZIP_CACHE_ENABLED: boolean;
  IMPORT_SKIP_UNCHANGED_DATASET: boolean;
  IMPORT_STAGING_SNAPSHOT_ENABLED: boolean;
  IMPORT_POLL_INTERVAL_MS: number;
  IMPORT_STALE_MINUTES: number;
  IMPORT_HISTORY_LIMIT: number;
  EXPORT_POLL_INTERVAL_MS: number;
  EXPORT_RETENTION_DAYS: number;
  EXPORT_RETENTION_LIMIT: number;
  EXPORT_MAX_ROWS: number;
  TABLE_MAX_PAGE_SIZE: number;
  TABLE_MAX_OFFSET_PAGE: number;
  DATABASE_POOL_MAX: number;
  STATEMENT_TIMEOUT_MS: number;
  ASN_MAP_BATCH_SIZE: number;
  ASN_MAP_WORKERS: number;
  API_PORT: number;
  CORS_ORIGIN: string;
  API_RATE_LIMIT_MAX: number;
  API_RATE_LIMIT_WINDOW_MS: number;
  LOG_LEVEL: RuntimeSettings['logging']['level'];
  ACCESS_LOG_ENABLED: boolean;
  BACKUP_INTERVAL_SECONDS: number;
  BACKUP_RETENTION_DAYS: number;
  GOOGLE_MAPS_API_KEY: string;
};

let cachedConfig: RuntimeConfig | null = null;
const changeListeners = new Set<() => void>();

function ensureApiKeys(secrets: RuntimeSecrets): RuntimeSecrets {
  const next = { ...secrets, api: { ...secrets.api } };
  if (!next.api.importApiKey) {
    next.api.importApiKey = generateRandomKey(32);
  }
  if (!next.api.apiKey) {
    next.api.apiKey = next.api.importApiKey;
  }
  if (!next.admin.sessionSecret) {
    next.admin = { ...next.admin, sessionSecret: generateRandomKey(32) };
  }
  return runtimeSecretsSchema.parse(next);
}

function enforceProductionSettings(
  settings: RuntimeSettings,
  nodeEnv: 'development' | 'production' | 'test',
): RuntimeSettings {
  if (nodeEnv !== 'production') return settings;
  return runtimeSettingsSchema.parse({
    ...settings,
    api: { ...settings.api, authEnabled: true },
    logging: { ...settings.logging, accessLogEnabled: true },
  });
}

function loadFromDisk(): RuntimeConfig {
  const bootstrap = loadBootstrapEnv();
  const paths = resolveConfigPaths(bootstrap.CONFIG_DATA_DIR);
  let meta = readConfigMeta(paths);
  const { key: masterKey, metaUpdated } = resolveMasterKey(
    bootstrap.CONFIG_MASTER_KEY,
    meta,
    paths,
  );
  meta = metaUpdated;

  let settings: RuntimeSettings;
  let secrets: RuntimeSecrets;
  let migratedFromEnv = meta.migratedFromEnv;

  if (configStoreExists(paths)) {
    settings = readSettings(paths) ?? applyEnvironmentProfile(DEFAULT_RUNTIME_SETTINGS, bootstrap.NODE_ENV);
    secrets = readSecrets(paths, masterKey) ?? createFreshSecrets();
  } else {
    settings = applyEnvironmentProfile(DEFAULT_RUNTIME_SETTINGS, bootstrap.NODE_ENV);
    secrets = createFreshSecrets();

    withConfigLock(paths, () => {
      writeSettings(paths, settings);
      writeSecrets(paths, secrets, masterKey);
      writeProxyEnv(paths, secrets.api.apiKey);
      meta = {
        ...meta,
        updatedAt: new Date().toISOString(),
        migratedFromEnv: false,
      };
      writeConfigMeta(paths, meta);
    });
    migratedFromEnv = false;
  }

  settings = enforceProductionSettings(settings, bootstrap.NODE_ENV);
  secrets = ensureApiKeys(secrets);

  if (!secrets.admin.sessionSecret || !existsSync(join(paths.dir, 'proxy.env'))) {
    withConfigLock(paths, () => {
      writeSecrets(paths, secrets, masterKey);
      writeProxyEnv(paths, secrets.api.apiKey);
    });
  }

  return {
    settings,
    secrets,
    meta: { ...meta, migratedFromEnv },
    masterKey,
  };
}

export function loadRuntimeConfig(): RuntimeConfig {
  if (cachedConfig) return cachedConfig;
  cachedConfig = loadFromDisk();
  return cachedConfig;
}

export function resetRuntimeConfigCache(): void {
  cachedConfig = null;
  for (const listener of changeListeners) {
    listener();
  }
}

export function subscribeConfigChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function toEnvCompat(config: RuntimeConfig): EnvCompat {
  const bootstrap = loadBootstrapEnv();
  const { settings: s, secrets: sec } = config;
  const importApiKey = sec.api.importApiKey;
  const apiKey = sec.api.apiKey || importApiKey;

  return {
    DATABASE_URL: bootstrap.DATABASE_URL,
    DATABASE_DIRECT_URL: bootstrap.DATABASE_DIRECT_URL,
    NODE_ENV: bootstrap.NODE_ENV,
    GEOIP_LK_EMAIL: sec.geoipLk.email,
    GEOIP_LK_PASSWORD: sec.geoipLk.password,
    GEOIP_LK_BASE_URL: s.geoipLk.baseUrl,
    IMPORT_API_KEY: importApiKey,
    API_KEY: apiKey,
    API_AUTH_ENABLED: s.api.authEnabled,
    IMPORT_CRON_CRON: s.import.cron,
    IMPORT_CRON_TZ: s.import.cronTimezone,
    IMPORT_DOWNLOAD_DIR: s.import.downloadDir,
    EXPORT_DIR: s.export.dir,
    IMPORT_ZIP_CACHE_ENABLED: s.import.zipCacheEnabled,
    IMPORT_SKIP_UNCHANGED_DATASET: s.import.skipUnchangedDataset,
    IMPORT_STAGING_SNAPSHOT_ENABLED: s.import.stagingSnapshotEnabled,
    IMPORT_POLL_INTERVAL_MS: s.import.pollIntervalMs,
    IMPORT_STALE_MINUTES: s.import.staleMinutes,
    IMPORT_HISTORY_LIMIT: s.import.historyLimit,
    EXPORT_POLL_INTERVAL_MS: s.export.pollIntervalMs,
    EXPORT_RETENTION_DAYS: s.export.retentionDays,
    EXPORT_RETENTION_LIMIT: s.export.retentionLimit,
    EXPORT_MAX_ROWS: s.export.maxRows,
    TABLE_MAX_PAGE_SIZE: s.table.maxPageSize,
    TABLE_MAX_OFFSET_PAGE: s.table.maxOffsetPage,
    DATABASE_POOL_MAX: s.database.poolMax,
    STATEMENT_TIMEOUT_MS: s.database.statementTimeoutMs,
    ASN_MAP_BATCH_SIZE: s.asnMap.batchSize,
    ASN_MAP_WORKERS: s.asnMap.workers,
    API_PORT: s.api.port,
    CORS_ORIGIN: s.api.corsOrigin,
    API_RATE_LIMIT_MAX: s.api.rateLimitMax,
    API_RATE_LIMIT_WINDOW_MS: s.api.rateLimitWindowMs,
    LOG_LEVEL: s.logging.level,
    ACCESS_LOG_ENABLED: s.logging.accessLogEnabled,
    BACKUP_INTERVAL_SECONDS: s.backup.intervalSeconds,
    BACKUP_RETENTION_DAYS: s.backup.retentionDays,
    GOOGLE_MAPS_API_KEY: sec.integrations.googleMapsApiKey,
  };
}

function maskSecret(value: string): MaskedSecretField {
  return {
    hasValue: value.length > 0,
    masked: value.length > 0 ? '••••••••' : '',
  };
}

export function getReloadHints(): AdminConfigResponse['reloadHints'] {
  return {
    requiresApiRestart: ['database.poolMax', 'database.statementTimeoutMs', 'api.port'],
    requiresImportWorkerRestart: [],
    requiresExportWorkerRestart: [],
    requiresWebReload: ['api.apiKey'],
    requiresBackupRestart: ['backup.intervalSeconds', 'backup.retentionDays'],
  };
}

export function toAdminConfigResponse(config: RuntimeConfig): AdminConfigResponse {
  const { settings, secrets, meta } = config;
  const setupComplete = Boolean(secrets.admin.username && secrets.admin.passwordHash);

  return {
    settings,
    secrets: {
      geoipLk: {
        email: secrets.geoipLk.email,
        password: maskSecret(secrets.geoipLk.password),
      },
      api: {
        importApiKey: maskSecret(secrets.api.importApiKey),
        apiKey: maskSecret(secrets.api.apiKey),
      },
      admin: {
        username: secrets.admin.username,
        password: maskSecret(secrets.admin.passwordHash),
      },
      integrations: {
        googleMapsApiKey: maskSecret(secrets.integrations.googleMapsApiKey),
      },
    },
    meta: {
      version: meta.version,
      updatedAt: meta.updatedAt,
      setupComplete,
      migratedFromEnv: meta.migratedFromEnv,
    },
    reloadHints: getReloadHints(),
  };
}

export function persistRuntimeConfig(
  settings: RuntimeSettings,
  secrets: RuntimeSecrets,
): RuntimeConfig {
  const bootstrap = loadBootstrapEnv();
  const paths = resolveConfigPaths(bootstrap.CONFIG_DATA_DIR);
  let meta = readConfigMeta(paths);
  const { key: masterKey } = resolveMasterKey(bootstrap.CONFIG_MASTER_KEY, meta, paths);
  const normalizedSettings = enforceProductionSettings(settings, bootstrap.NODE_ENV);

  withConfigLock(paths, () => {
    writeSettings(paths, normalizedSettings);
    writeSecrets(paths, secrets, masterKey);
    writeProxyEnv(paths, secrets.api.apiKey || secrets.api.importApiKey);
    meta = {
      ...meta,
      updatedAt: new Date().toISOString(),
    };
    writeConfigMeta(paths, meta);
  });

  resetRuntimeConfigCache();
  return loadRuntimeConfig();
}

export function ensureGeneratedMasterKeyForTests(): string {
  return generateMasterKeyHex();
}

export function getConfigPaths() {
  const bootstrap = loadBootstrapEnv();
  return resolveConfigPaths(bootstrap.CONFIG_DATA_DIR);
}
