import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  chmodSync,
  openSync,
  closeSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  runtimeSecretsSchema,
  runtimeSettingsSchema,
  type RuntimeSecrets,
  type RuntimeSettings,
} from '@geoip/shared';
import { decryptSecretsJson, encryptSecretsJson, generateMasterKeyHex } from './config-crypto.js';

export const CONFIG_FILES = {
  settings: 'settings.json',
  secrets: 'secrets.enc',
  meta: 'meta.json',
  lock: '.lock',
  generatedMasterKey: '.master-key',
  proxyEnv: 'proxy.env',
} as const;

export type ConfigMeta = {
  version: number;
  updatedAt: string | null;
  masterKeyGenerated: boolean;
};

const DEFAULT_META: ConfigMeta = {
  version: 1,
  updatedAt: null,
  masterKeyGenerated: false,
};

function normalizeConfigMeta(raw: Record<string, unknown>): ConfigMeta {
  return {
    version: typeof raw.version === 'number' ? raw.version : DEFAULT_META.version,
    updatedAt: typeof raw.updatedAt === 'string' || raw.updatedAt === null ? raw.updatedAt : DEFAULT_META.updatedAt,
    masterKeyGenerated:
      typeof raw.masterKeyGenerated === 'boolean'
        ? raw.masterKeyGenerated
        : DEFAULT_META.masterKeyGenerated,
  };
}

export type ConfigStorePaths = {
  dir: string;
  settingsPath: string;
  secretsPath: string;
  metaPath: string;
  lockPath: string;
  generatedMasterKeyPath: string;
  proxyEnvPath: string;
};

export function resolveConfigPaths(configDir: string): ConfigStorePaths {
  return {
    dir: configDir,
    settingsPath: join(configDir, CONFIG_FILES.settings),
    secretsPath: join(configDir, CONFIG_FILES.secrets),
    metaPath: join(configDir, CONFIG_FILES.meta),
    lockPath: join(configDir, CONFIG_FILES.lock),
    generatedMasterKeyPath: join(configDir, CONFIG_FILES.generatedMasterKey),
    proxyEnvPath: join(configDir, CONFIG_FILES.proxyEnv),
  };
}

function ensureConfigDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o750 });
}

const STALE_LOCK_MS = 120_000;

function acquireFileLock(lockPath: string): number {
  try {
    return openSync(lockPath, 'wx');
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : null;
    if (code !== 'EEXIST') throw err;
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    if (ageMs <= STALE_LOCK_MS) {
      throw new Error('Config store is locked by another process');
    }
    process.stderr.write(
      `[config-store] Removing stale config lock (age ${Math.round(ageMs / 1000)}s)\n`,
    );
    unlinkSync(lockPath);
    return openSync(lockPath, 'wx');
  }
}

function withFileLock<T>(lockPath: string, fn: () => T): T {
  ensureConfigDir(join(lockPath, '..'));
  const fd = acquireFileLock(lockPath);
  try {
    return fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

function atomicWriteFile(path: string, data: string | Buffer, mode: number): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, data, { mode });
  renameSync(tmp, path);
  try {
    chmodSync(path, mode);
  } catch {
    /* ignore on platforms without chmod */
  }
}

export function readConfigMeta(paths: ConfigStorePaths): ConfigMeta {
  if (!existsSync(paths.metaPath)) {
    return { ...DEFAULT_META };
  }
  const raw = JSON.parse(readFileSync(paths.metaPath, 'utf8')) as Record<string, unknown>;
  return normalizeConfigMeta(raw);
}

export function writeConfigMeta(paths: ConfigStorePaths, meta: ConfigMeta): void {
  ensureConfigDir(paths.dir);
  atomicWriteFile(paths.metaPath, JSON.stringify(meta, null, 2), 0o640);
}

export function readSettings(paths: ConfigStorePaths): RuntimeSettings | null {
  if (!existsSync(paths.settingsPath)) return null;
  const raw = JSON.parse(readFileSync(paths.settingsPath, 'utf8'));
  return runtimeSettingsSchema.parse(raw);
}

export function writeSettings(paths: ConfigStorePaths, settings: RuntimeSettings): void {
  ensureConfigDir(paths.dir);
  atomicWriteFile(paths.settingsPath, JSON.stringify(settings, null, 2), 0o640);
}

export function readSecrets(paths: ConfigStorePaths, masterKey: string): RuntimeSecrets | null {
  if (!existsSync(paths.secretsPath)) return null;
  const payload = readFileSync(paths.secretsPath);
  const json = decryptSecretsJson(payload, masterKey);
  return runtimeSecretsSchema.parse(JSON.parse(json));
}

export function writeSecrets(
  paths: ConfigStorePaths,
  secrets: RuntimeSecrets,
  masterKey: string,
): void {
  ensureConfigDir(paths.dir);
  const encrypted = encryptSecretsJson(JSON.stringify(secrets), masterKey);
  atomicWriteFile(paths.secretsPath, encrypted, 0o600);
}

export function settingsFileExists(paths: ConfigStorePaths): boolean {
  return existsSync(paths.settingsPath);
}

export function secretsFileExists(paths: ConfigStorePaths): boolean {
  return existsSync(paths.secretsPath);
}

export function configStoreExists(paths: ConfigStorePaths): boolean {
  return settingsFileExists(paths) || secretsFileExists(paths);
}

function readGeneratedMasterKey(paths: ConfigStorePaths): string | null {
  if (!existsSync(paths.generatedMasterKeyPath)) return null;
  const key = readFileSync(paths.generatedMasterKeyPath, 'utf8').trim();
  return key.length > 0 ? key : null;
}

function writeGeneratedMasterKey(paths: ConfigStorePaths, key: string): void {
  ensureConfigDir(paths.dir);
  atomicWriteFile(paths.generatedMasterKeyPath, `${key}\n`, 0o600);
}

function migrateLegacyGeneratedMasterKey(
  paths: ConfigStorePaths,
  meta: ConfigMeta,
): { key: string | null; metaUpdated: ConfigMeta } {
  if (!existsSync(paths.metaPath)) {
    return { key: null, metaUpdated: meta };
  }
  const raw = JSON.parse(readFileSync(paths.metaPath, 'utf8')) as { generatedMasterKey?: string };
  const legacy = raw.generatedMasterKey?.trim();
  if (!legacy) {
    return { key: null, metaUpdated: meta };
  }
  writeGeneratedMasterKey(paths, legacy);
  const metaUpdated: ConfigMeta = {
    version: meta.version,
    updatedAt: meta.updatedAt,
    masterKeyGenerated: true,
  };
  writeConfigMeta(paths, metaUpdated);
  return { key: legacy, metaUpdated };
}

export function resolveMasterKey(
  bootstrapKey: string | undefined,
  meta: ConfigMeta,
  paths: ConfigStorePaths,
): { key: string; metaUpdated: ConfigMeta } {
  if (bootstrapKey && bootstrapKey.length > 0) {
    return { key: bootstrapKey, metaUpdated: meta };
  }

  const fromFile = readGeneratedMasterKey(paths);
  if (fromFile) {
    return { key: fromFile, metaUpdated: meta };
  }

  if (existsSync(paths.metaPath)) {
    const stored = readConfigMeta(paths);
    const migrated = migrateLegacyGeneratedMasterKey(paths, stored);
    if (migrated.key) {
      return { key: migrated.key, metaUpdated: migrated.metaUpdated };
    }
  }

  const generated = generateMasterKeyHex();
  writeGeneratedMasterKey(paths, generated);
  const metaUpdated: ConfigMeta = {
    ...meta,
    masterKeyGenerated: true,
  };
  writeConfigMeta(paths, metaUpdated);
  return { key: generated, metaUpdated };
}

export function withConfigLock<T>(paths: ConfigStorePaths, fn: () => T): T {
  return withFileLock(paths.lockPath, fn);
}

export function syncProxyEnv(paths: ConfigStorePaths, apiKey: string): void {
  if (apiKey) {
    ensureConfigDir(paths.dir);
    atomicWriteFile(paths.proxyEnvPath, `API_KEY=${apiKey}\n`, 0o600);
    return;
  }
  if (existsSync(paths.proxyEnvPath)) {
    unlinkSync(paths.proxyEnvPath);
  }
}
