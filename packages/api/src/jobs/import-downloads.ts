import { createReadStream } from 'node:fs';
import { Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Logger } from 'pino';
import type pg from 'pg';
import { getPool } from '../db/client.js';
import type { GrchcClient, DownloadLink, DownloadType } from './grchc-client.js';
import { importGeoIpZipStream, type ZipImportResult } from './zip-import.js';
import {
  createCacheWriter,
  ensureZipCacheDir,
  finalizeZipCache,
  findValidCachedZip,
  openCachedZipStream,
  removePartialCache,
  zipCachePaths,
} from './dataset-zip-cache.js';

export type { DownloadType } from './grchc-client.js';
export type ZipDownloadSource = 'cache' | 'network';

export interface ZipDownloadOutcome {
  type: DownloadType;
  imported: ZipImportResult;
  durationMs: number;
  source: ZipDownloadSource;
}

export interface ImportZipOptions {
  downloadDir: string;
  cacheEnabled: boolean;
}

function teeReadable(source: Readable): { importStream: PassThrough; cacheStream: PassThrough } {
  const importStream = new PassThrough();
  const cacheStream = new PassThrough();

  source.on('data', (chunk: Buffer) => {
    importStream.write(chunk);
    cacheStream.write(chunk);
  });
  source.on('end', () => {
    importStream.end();
    cacheStream.end();
  });
  source.on('error', (err) => {
    importStream.destroy(err);
    cacheStream.destroy(err);
  });

  return { importStream, cacheStream };
}

async function openNetworkZipStream(
  link: DownloadLink,
  client: GrchcClient,
  options: ImportZipOptions,
  logger: Logger,
): Promise<{ stream: Readable; source: ZipDownloadSource }> {
  const zipStream = await client.downloadZip(link.url);
  const networkStream = Readable.fromWeb(zipStream as import('stream/web').ReadableStream);

  if (!options.cacheEnabled) {
    return { stream: networkStream, source: 'network' };
  }

  await ensureZipCacheDir(options.downloadDir, link.date);
  const { partialPath } = zipCachePaths(options.downloadDir, link);
  await removePartialCache(partialPath);

  const { importStream, cacheStream } = teeReadable(networkStream);
  const writer = createCacheWriter(partialPath);

  const cacheWrite = pipeline(cacheStream, writer).then(async () => {
    const { zipPath, metaPath } = zipCachePaths(options.downloadDir, link);
    await finalizeZipCache(partialPath, zipPath, metaPath, link);
    const stat = await import('node:fs/promises').then((fs) => fs.stat(zipPath));
    if (link.sizeBytes > 0 && stat.size !== link.sizeBytes) {
      logger.warn(
        { type: link.type, manifestBytes: link.sizeBytes, actualBytes: stat.size },
        'GRCHC manifest size differs from downloaded ZIP',
      );
    }
    logger.info({ type: link.type, zipPath, sizeBytes: stat.size }, 'ZIP cached to disk');
  });

  cacheWrite.catch(async (err) => {
    logger.warn({ err, type: link.type }, 'Failed to write ZIP cache');
    await removePartialCache(partialPath);
  });

  return { stream: importStream, source: 'network' };
}

async function openZipStream(
  link: DownloadLink,
  client: GrchcClient,
  options: ImportZipOptions,
  logger: Logger,
): Promise<{ stream: Readable; source: ZipDownloadSource }> {
  if (options.cacheEnabled) {
    const cachedPath = await findValidCachedZip(options.downloadDir, link);
    if (cachedPath) {
      logger.info({ type: link.type, cachedPath, sizeBytes: link.sizeBytes }, 'Using cached ZIP');
      return { stream: openCachedZipStream(cachedPath), source: 'cache' };
    }
  }

  return openNetworkZipStream(link, client, options, logger);
}

async function importSingleZip(
  type: DownloadType,
  link: DownloadLink,
  client: GrchcClient,
  options: ImportZipOptions,
  logger: Logger,
): Promise<ZipDownloadOutcome> {
  const started = Date.now();
  const pgClient: pg.PoolClient = await getPool().connect();
  const { partialPath } = zipCachePaths(options.downloadDir, link);

  try {
    await pgClient.query('SET statement_timeout = 0');
    const { stream, source } = await openZipStream(link, client, options, logger);
    const imported = await importGeoIpZipStream(stream, pgClient, logger.child({ downloadType: type }));
    return { type, imported, durationMs: Date.now() - started, source };
  } catch (err) {
    if (options.cacheEnabled) {
      await removePartialCache(partialPath);
    }
    throw err;
  } finally {
    pgClient.release();
  }
}

/** Download city/country/asn ZIPs in parallel — cache hit reads local disk, miss streams network + writes cache. */
export async function importAllZipsParallel(
  links: Record<DownloadType, DownloadLink>,
  client: GrchcClient,
  options: ImportZipOptions,
  logger: Logger,
): Promise<ZipDownloadOutcome[]> {
  const tasks = (Object.entries(links) as Array<[DownloadType, DownloadLink]>).map(([type, link]) =>
    importSingleZip(type, link, client, options, logger),
  );
  return Promise.all(tasks);
}

/** For tests — import from a local ZIP file without network. */
export async function importZipFile(
  type: DownloadType,
  zipPath: string,
  logger: Logger,
): Promise<ZipDownloadOutcome> {
  const started = Date.now();
  const pgClient: pg.PoolClient = await getPool().connect();
  try {
    await pgClient.query('SET statement_timeout = 0');
    const stream = createReadStream(zipPath);
    const imported = await importGeoIpZipStream(stream, pgClient, logger.child({ downloadType: type }));
    return { type, imported, durationMs: Date.now() - started, source: 'cache' };
  } finally {
    pgClient.release();
  }
}
