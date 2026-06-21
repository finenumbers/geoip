import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readConfigMeta,
  resolveConfigPaths,
  resolveMasterKey,
  syncProxyEnv,
  writeConfigMeta,
} from './config-store.js';

describe('config-store', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'geoip-config-store-'));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('stores generated master key in .master-key, not meta.json', () => {
    const paths = resolveConfigPaths(configDir);
    const meta = readConfigMeta(paths);
    const { key, metaUpdated } = resolveMasterKey(undefined, meta, paths);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(paths.generatedMasterKeyPath)).toBe(true);
    expect(readFileSync(paths.generatedMasterKeyPath, 'utf8').trim()).toBe(key);
    expect(JSON.parse(readFileSync(paths.metaPath, 'utf8'))).not.toHaveProperty('generatedMasterKey');
    expect(metaUpdated.masterKeyGenerated).toBe(true);
  });

  it('migrates legacy generatedMasterKey from meta.json to .master-key', () => {
    const paths = resolveConfigPaths(configDir);
    const legacyKey = 'a'.repeat(64);
    writeConfigMeta(paths, {
      version: 1,
      updatedAt: null,
      masterKeyGenerated: true,
    });
    writeFileSync(
      paths.metaPath,
      JSON.stringify({
        version: 1,
        updatedAt: null,
        migratedFromEnv: true,
        masterKeyGenerated: true,
        generatedMasterKey: legacyKey,
      }),
      { mode: 0o640 },
    );

    const { key } = resolveMasterKey(undefined, readConfigMeta(paths), paths);
    expect(key).toBe(legacyKey);
    expect(readFileSync(paths.generatedMasterKeyPath, 'utf8').trim()).toBe(legacyKey);
    expect(JSON.parse(readFileSync(paths.metaPath, 'utf8'))).not.toHaveProperty('generatedMasterKey');
  });

  it('syncProxyEnv writes proxy.env when key is set and removes it when cleared', () => {
    const paths = resolveConfigPaths(configDir);

    syncProxyEnv(paths, 'test-api-key');
    expect(readFileSync(paths.proxyEnvPath, 'utf8')).toBe('API_KEY=test-api-key\n');

    syncProxyEnv(paths, '');
    expect(existsSync(paths.proxyEnvPath)).toBe(false);
  });

  it('ignores legacy migratedFromEnv in meta.json on read', () => {
    const paths = resolveConfigPaths(configDir);
    writeFileSync(
      paths.metaPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        migratedFromEnv: true,
        masterKeyGenerated: false,
      }),
      { mode: 0o640 },
    );

    expect(readConfigMeta(paths)).toEqual({
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      masterKeyGenerated: false,
    });
    expect(JSON.parse(readFileSync(paths.metaPath, 'utf8'))).toHaveProperty('migratedFromEnv');
  });
});
