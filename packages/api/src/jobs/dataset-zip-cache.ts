import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { DownloadLink, DownloadType } from './grchc-client.js';

export interface ZipCacheMeta {
  type: DownloadType;
  date: string;
  filename: string;
  sizeBytes: number;
  downloadedAt: string;
}

export function zipCacheDir(baseDir: string, date: string): string {
  return join(baseDir, 'zips', date);
}

export function zipCachePaths(baseDir: string, link: DownloadLink): {
  zipPath: string;
  metaPath: string;
  partialPath: string;
} {
  const dir = zipCacheDir(baseDir, link.date);
  const zipPath = join(dir, `${link.type}.zip`);
  return {
    zipPath,
    metaPath: `${zipPath}.meta.json`,
    partialPath: `${zipPath}.partial`,
  };
}

export function isZipCacheMetaValid(meta: ZipCacheMeta, link: DownloadLink, fileSize: number): boolean {
  return (
    meta.type === link.type &&
    meta.date === link.date &&
    meta.filename === link.filename &&
    meta.sizeBytes > 0 &&
    fileSize === meta.sizeBytes
  );
}

export async function readZipCacheMeta(metaPath: string): Promise<ZipCacheMeta | null> {
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    return JSON.parse(raw) as ZipCacheMeta;
  } catch {
    return null;
  }
}

export async function writeZipCacheMeta(metaPath: string, meta: ZipCacheMeta): Promise<void> {
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 0));
}

export async function findValidCachedZip(
  baseDir: string,
  link: DownloadLink,
): Promise<string | null> {
  const { zipPath, metaPath } = zipCachePaths(baseDir, link);
  try {
    const stat = await fs.stat(zipPath);
    const meta = await readZipCacheMeta(metaPath);
    if (!meta || !isZipCacheMetaValid(meta, link, stat.size)) return null;
    return zipPath;
  } catch {
    return null;
  }
}

export async function ensureZipCacheDir(baseDir: string, date: string): Promise<string> {
  const dir = zipCacheDir(baseDir, date);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function openCachedZipStream(zipPath: string): ReturnType<typeof createReadStream> {
  return createReadStream(zipPath);
}

export function createCacheWriter(partialPath: string): ReturnType<typeof createWriteStream> {
  return createWriteStream(partialPath);
}

export async function finalizeZipCache(
  partialPath: string,
  zipPath: string,
  metaPath: string,
  link: DownloadLink,
): Promise<void> {
  const stat = await fs.stat(partialPath);
  if (stat.size <= 0) {
    await fs.unlink(partialPath).catch(() => undefined);
    throw new Error(`ZIP cache empty for ${link.type}`);
  }

  await fs.rename(partialPath, zipPath);
  const meta: ZipCacheMeta = {
    type: link.type,
    date: link.date,
    filename: link.filename,
    sizeBytes: stat.size,
    downloadedAt: new Date().toISOString(),
  };
  await writeZipCacheMeta(metaPath, meta);
}

export async function removePartialCache(partialPath: string): Promise<void> {
  await fs.unlink(partialPath).catch(() => undefined);
}

/** Stable fingerprint for skip-unchanged checks. */
export function datasetFingerprint(links: Record<DownloadType, DownloadLink>): string {
  const hash = createHash('sha256');
  for (const type of ['city', 'country', 'asn'] as DownloadType[]) {
    const link = links[type];
    hash.update(`${type}:${link.filename}:${link.sizeBytes};`);
  }
  return hash.digest('hex').slice(0, 16);
}
