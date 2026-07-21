import { existsSync } from 'node:fs';
import {
  runtimeSettingsSchema,
  runtimeSecretsSchema,
  type RuntimeSettings,
  type RuntimeSecrets,
  type AdminConfigResponse,
  type MaskedSecretField,
  DEFAULT_RUNTIME_SETTINGS,
  DEFAULT_DISPLAY_TIMEZONE,
  applyEnvironmentProfile,
  createFreshSecrets,
  generateRandomKey,
} from '@geoip/shared';
import { loadBootstrapEnv } from './bootstrap-env.js';
import {
  readConfigMeta,
  readSecrets,
  readSettings,
  resolveConfigPaths,
  resolveMasterKey,
  writeConfigMeta,
  writeSecrets,
  writeSettings,
  syncProxyEnv,
  withConfigLock,
  settingsFileExists,
  secretsFileExists,
  type ConfigMeta,
  type ConfigStorePaths,
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
  IMPORT_CRON_ENABLED: boolean;
  IMPORT_CRON_CRON: string;
  IMPORT_CRON_TZ: string;
  RIR_IMPORT_CRON_ENABLED: boolean;
  RIR_IMPORT_CRON_CRON: string;
  RIR_IMPORT_CRON_TZ: string;
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
  GOOGLE_MAPS_API_KEY: string;
};

let cachedConfig: RuntimeConfig | null = null;
const changeListeners = new Set<() => void>();

function ensureApiKeys(secrets: RuntimeSecrets): RuntimeSecrets {
  const next = { ...secrets, api: { ...secrets.api } };
  if (!next.api.importApiKey) {
    next.api.importApiKey = generateRandomKey(32);
  }
  if (!next.admin.sessionSecret) {
    next.admin = { ...next.admin, sessionSecret: generateRandomKey(32) };
  }
  return runtimeSecretsSchema.parse(next);
}

function syncCronTimezones(settings: RuntimeSettings): RuntimeSettings {
  const tz = settings.general.displayTimezone.trim() || DEFAULT_DISPLAY_TIMEZONE;
  return runtimeSettingsSchema.parse({
    ...settings,
    import: { ...settings.import, cronTimezone: tz },
    rirImport: { ...settings.rirImport, cronTimezone: tz },
  });
}

function enforceProductionSettings(
  settings: RuntimeSettings,
  nodeEnv: 'development' | 'production' | 'test',
): RuntimeSettings {
  const synced = syncCronTimezones(settings);
  if (nodeEnv !== 'production') return synced;
  return runtimeSettingsSchema.parse({
    ...synced,
    api: { ...synced.api, authEnabled: true },
    logging: { ...synced.logging, accessLogEnabled: true },
  });
}

function assertConfigStoreComplete(paths: ConfigStorePaths): void {
  const hasSettings = settingsFileExists(paths);
  const hasSecrets = secretsFileExists(paths);
  if (hasSettings === hasSecrets) return;
  const present = hasSettings ? 'settings.json' : 'secrets.enc';
  const missing = hasSettings ? 'secrets.enc' : 'settings.json';
  throw new Error(
    `Config store incomplete: ${present} exists without ${missing}. ` +
      'Restore both files or remove the config_data volume for a fresh start.',
  );
}

function persistRuntimeConfigUnlocked(
  paths: ConfigStorePaths,
  masterKey: string,
  settings: RuntimeSettings,
  secrets: RuntimeSecrets,
  meta: ConfigMeta,
): RuntimeConfig {
  const bootstrap = loadBootstrapEnv();
  const normalizedSettings = enforceProductionSettings(settings, bootstrap.NODE_ENV);
  const normalizedSecrets = ensureApiKeys(secrets);

  writeSettings(paths, normalizedSettings);
  writeSecrets(paths, normalizedSecrets, masterKey);
  syncProxyEnv(paths, normalizedSecrets.api.apiKey);
  const updatedMeta = { ...meta, updatedAt: new Date().toISOString() };
  writeConfigMeta(paths, updatedMeta);

  return {
    settings: normalizedSettings,
    secrets: normalizedSecrets,
    meta: updatedMeta,
    masterKey,
  };
}

function loadFromDiskUnlocked(): RuntimeConfig {
  const bootstrap = loadBootstrapEnv();
  const paths = resolveConfigPaths(bootstrap.CONFIG_DATA_DIR);
  assertConfigStoreComplete(paths);

  let meta = readConfigMeta(paths);
  const { key: masterKey, metaUpdated } = resolveMasterKey(
    bootstrap.CONFIG_MASTER_KEY,
    meta,
    paths,
  );
  meta = metaUpdated;

  const hasStore = settingsFileExists(paths) && secretsFileExists(paths);

  if (!hasStore) {
    const settings = applyEnvironmentProfile(DEFAULT_RUNTIME_SETTINGS, bootstrap.NODE_ENV);
    const secrets = createFreshSecrets();
    writeSettings(paths, settings);
    writeSecrets(paths, secrets, masterKey);
    meta = {
      ...meta,
      updatedAt: new Date().toISOString(),
    };
    writeConfigMeta(paths, meta);
  }

  const diskSettings = readSettings(paths);
  if (!diskSettings) {
    throw new Error('Config store incomplete: settings.json could not be read.');
  }

  let diskSecrets: RuntimeSecrets;
  try {
    const loaded = readSecrets(paths, masterKey);
    if (!loaded) {
      throw new Error('Config store incomplete: secrets.enc could not be read.');
    }
    diskSecrets = loaded;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Config store incomplete')) {
      throw err;
    }
    throw new Error(
      'Failed to decrypt config secrets.enc — CONFIG_MASTER_KEY does not match this volume. ' +
        'Use the original key or remove the config_data volume for a fresh start.',
      { cause: err },
    );
  }

  const settings = enforceProductionSettings(diskSettings, bootstrap.NODE_ENV);
  const secrets = ensureApiKeys(diskSecrets);

  const settingsChanged = JSON.stringify(settings) !== JSON.stringify(diskSettings);
  const secretsChanged = JSON.stringify(secrets) !== JSON.stringify(diskSecrets);
  const proxyExists = existsSync(paths.proxyEnvPath);
  const needsProxySync =
    (Boolean(secrets.api.apiKey) && !proxyExists) ||
    (!secrets.api.apiKey && proxyExists);

  if (settingsChanged || secretsChanged || needsProxySync) {
    writeSettings(paths, settings);
    writeSecrets(paths, secrets, masterKey);
    syncProxyEnv(paths, secrets.api.apiKey);
    meta = { ...meta, updatedAt: new Date().toISOString() };
    writeConfigMeta(paths, meta);
  }

  return {
    settings,
    secrets,
    meta,
    masterKey,
  };
}

function loadFromDisk(): RuntimeConfig {
  const bootstrap = loadBootstrapEnv();
  const paths = resolveConfigPaths(bootstrap.CONFIG_DATA_DIR);
  return withConfigLock(paths, () => loadFromDiskUnlocked());
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
  const apiKey = sec.api.apiKey;

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
    IMPORT_CRON_ENABLED: s.import.enabled,
    IMPORT_CRON_CRON: s.import.cron,
    IMPORT_CRON_TZ: s.import.cronTimezone,
    RIR_IMPORT_CRON_ENABLED: s.rirImport.enabled,
    RIR_IMPORT_CRON_CRON: s.rirImport.cron,
    RIR_IMPORT_CRON_TZ: s.rirImport.cronTimezone,
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

  withConfigLock(paths, () => {
    let meta = readConfigMeta(paths);
    const { key: masterKey } = resolveMasterKey(bootstrap.CONFIG_MASTER_KEY, meta, paths);
    persistRuntimeConfigUnlocked(paths, masterKey, settings, secrets, meta);
  });

  resetRuntimeConfigCache();
  return loadRuntimeConfig();
}

export function completeAdminSetupUnderLock(
  settings: RuntimeSettings,
  secrets: RuntimeSecrets,
): RuntimeConfig {
  const bootstrap = loadBootstrapEnv();
  const paths = resolveConfigPaths(bootstrap.CONFIG_DATA_DIR);

  withConfigLock(paths, () => {
    const current = loadFromDiskUnlocked();
    if (current.secrets.admin.username && current.secrets.admin.passwordHash) {
      throw new Error('ALREADY_SETUP');
    }
    let meta = readConfigMeta(paths);
    const { key: masterKey } = resolveMasterKey(bootstrap.CONFIG_MASTER_KEY, meta, paths);
    persistRuntimeConfigUnlocked(paths, masterKey, settings, secrets, meta);
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
