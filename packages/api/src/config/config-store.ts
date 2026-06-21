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
} as const;

export type ConfigMeta = {
  version: number;
  updatedAt: string | null;
  migratedFromEnv: boolean;
  masterKeyGenerated: boolean;
};

const DEFAULT_META: ConfigMeta = {
  version: 1,
  updatedAt: null,
  migratedFromEnv: false,
  masterKeyGenerated: false,
};

export type ConfigStorePaths = {
  dir: string;
  settingsPath: string;
  secretsPath: string;
  metaPath: string;
  lockPath: string;
};

export function resolveConfigPaths(configDir: string): ConfigStorePaths {
  return {
    dir: configDir,
    settingsPath: join(configDir, CONFIG_FILES.settings),
    secretsPath: join(configDir, CONFIG_FILES.secrets),
    metaPath: join(configDir, CONFIG_FILES.meta),
    lockPath: join(configDir, CONFIG_FILES.lock),
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
  const raw = JSON.parse(readFileSync(paths.metaPath, 'utf8')) as Partial<ConfigMeta>;
  return { ...DEFAULT_META, ...raw };
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

export function resolveMasterKey(
  bootstrapKey: string | undefined,
  meta: ConfigMeta,
  paths: ConfigStorePaths,
): { key: string; metaUpdated: ConfigMeta } {
  if (bootstrapKey && bootstrapKey.length > 0) {
    return { key: bootstrapKey, metaUpdated: meta };
  }
  if (existsSync(paths.metaPath)) {
    const stored = readConfigMeta(paths);
    const storedKey = (stored as ConfigMeta & { generatedMasterKey?: string }).generatedMasterKey;
    if (storedKey) {
      return { key: storedKey, metaUpdated: stored };
    }
  }
  const generated = generateMasterKeyHex();
  const metaUpdated: ConfigMeta & { generatedMasterKey: string } = {
    ...meta,
    masterKeyGenerated: true,
    generatedMasterKey: generated,
  };
  writeConfigMeta(paths, metaUpdated);
  return { key: generated, metaUpdated };
}

export function withConfigLock<T>(paths: ConfigStorePaths, fn: () => T): T {
  return withFileLock(paths.lockPath, fn);
}

export function writeProxyEnv(paths: ConfigStorePaths, apiKey: string): void {
  ensureConfigDir(paths.dir);
  atomicWriteFile(join(paths.dir, 'proxy.env'), `API_KEY=${apiKey}\n`, 0o600);
}
