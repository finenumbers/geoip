import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const STAGING_TABLES = [
  'stg_geo_city_locations',
  'stg_geo_country_locations',
  'stg_geo_city_blocks',
  'stg_geo_country_blocks',
  'stg_geo_asn_blocks',
] as const;

export interface StagingSnapshotMeta {
  date: string;
  fingerprint: string;
  counts: Record<string, number>;
  sizeBytes: number;
  createdAt: string;
}

export function stagingSnapshotDir(baseDir: string, date: string): string {
  return join(baseDir, 'snapshots', date);
}

export function stagingSnapshotPaths(baseDir: string, date: string): {
  dumpPath: string;
  metaPath: string;
} {
  const dir = stagingSnapshotDir(baseDir, date);
  return {
    dumpPath: join(dir, 'staging.dump'),
    metaPath: join(dir, 'staging.dump.meta.json'),
  };
}

function parsePgUrl(url: string): {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

function runCommand(
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

export function isStagingSnapshotMetaValid(
  meta: StagingSnapshotMeta,
  date: string,
  fingerprint: string,
  fileSize: number,
): boolean {
  return (
    meta.date === date &&
    meta.fingerprint === fingerprint &&
    meta.sizeBytes > 0 &&
    fileSize === meta.sizeBytes
  );
}

export async function readStagingSnapshotMeta(metaPath: string): Promise<StagingSnapshotMeta | null> {
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    return JSON.parse(raw) as StagingSnapshotMeta;
  } catch {
    return null;
  }
}

export async function findValidStagingSnapshot(
  baseDir: string,
  date: string,
  fingerprint: string,
): Promise<{ dumpPath: string; metaPath: string } | null> {
  const { dumpPath, metaPath } = stagingSnapshotPaths(baseDir, date);
  try {
    const stat = await fs.stat(dumpPath);
    const meta = await readStagingSnapshotMeta(metaPath);
    if (!meta || !isStagingSnapshotMetaValid(meta, date, fingerprint, stat.size)) {
      return null;
    }
    return { dumpPath, metaPath };
  } catch {
    return null;
  }
}

export async function createStagingSnapshot(
  baseDir: string,
  date: string,
  fingerprint: string,
  directDatabaseUrl: string,
  counts: Record<string, number>,
): Promise<{ dumpPath: string; sizeBytes: number }> {
  const { dumpPath, metaPath } = stagingSnapshotPaths(baseDir, date);
  await fs.mkdir(stagingSnapshotDir(baseDir, date), { recursive: true });

  const pg = parsePgUrl(directDatabaseUrl);
  const args = [
    '-Fc',
    '--data-only',
    '-h',
    pg.host,
    '-p',
    pg.port,
    '-U',
    pg.user,
    '-d',
    pg.database,
    '-f',
    dumpPath,
    ...STAGING_TABLES.flatMap((table) => ['-t', table]),
  ];

  await runCommand('pg_dump', args, { PGPASSWORD: pg.password });

  const stat = await fs.stat(dumpPath);
  const meta: StagingSnapshotMeta = {
    date,
    fingerprint,
    counts,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(metaPath, JSON.stringify(meta));

  return { dumpPath, sizeBytes: stat.size };
}

export async function restoreStagingSnapshot(
  dumpPath: string,
  directDatabaseUrl: string,
): Promise<void> {
  const pg = parsePgUrl(directDatabaseUrl);
  const args = [
    '--data-only',
    '--disable-triggers',
    '--no-owner',
    '--no-privileges',
    '-h',
    pg.host,
    '-p',
    pg.port,
    '-U',
    pg.user,
    '-d',
    pg.database,
    dumpPath,
  ];

  await runCommand('pg_restore', args, { PGPASSWORD: pg.password });
}
