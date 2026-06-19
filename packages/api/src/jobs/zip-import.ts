import { Readable } from 'node:stream';
import unzipper from 'unzipper';
import type { Logger } from 'pino';
import type pg from 'pg';
import { copyCsvStreamToTable, matchCsvFile } from './csv-copy.js';

export interface ZipImportFileResult {
  path: string;
  rowCount: number;
}

export interface ZipImportResult {
  files: ZipImportFileResult[];
  rejects: Array<{ file: string; line: number; reason: string }>;
  cityRows: number;
  countryRows: number;
  asnRows: number;
}

function entryBasename(entryPath: string): string {
  return entryPath.split('/').pop() ?? entryPath;
}

export function isSkippableZipEntry(entryPath: string): boolean {
  return entryPath.includes('Locations-en');
}

async function drainZipEntry(entry: unzipper.Entry): Promise<void> {
  if (entry.type === 'Directory') {
    await entry.autodrain().promise();
    return;
  }

  const match = matchCsvFile(entryBasename(entry.path));
  if (!match && isSkippableZipEntry(entry.path)) {
    await entry.autodrain().promise();
    return;
  }

  throw new Error(`Unexpected file in ZIP: ${entry.path}`);
}

async function processZipEntry(
  entry: unzipper.Entry,
  pgClient: pg.PoolClient,
  logger: Logger,
): Promise<{ file: ZipImportFileResult; rejects: ZipImportResult['rejects']; counts: Pick<ZipImportResult, 'cityRows' | 'countryRows' | 'asnRows'> }> {
  if (entry.type === 'Directory') {
    await entry.autodrain().promise();
    return {
      file: { path: entry.path, rowCount: 0 },
      rejects: [],
      counts: { cityRows: 0, countryRows: 0, asnRows: 0 },
    };
  }

  const match = matchCsvFile(entryBasename(entry.path));
  if (!match) {
    if (isSkippableZipEntry(entry.path)) {
      await entry.autodrain().promise();
      return {
        file: { path: entry.path, rowCount: 0 },
        rejects: [],
        counts: { cityRows: 0, countryRows: 0, asnRows: 0 },
      };
    }
    throw new Error(`Unexpected file in ZIP: ${entry.path}`);
  }

  const result = await copyCsvStreamToTable(pgClient, entry, match.target, logger);
  const rejects = result.rejects.map((reject) => ({
    file: entry.path,
    line: reject.line,
    reason: reject.reason,
  }));

  return {
    file: { path: entry.path, rowCount: result.rowCount },
    rejects,
    counts: {
      cityRows: match.target === 'stg_geo_city_blocks' ? result.rowCount : 0,
      countryRows: match.target === 'stg_geo_country_blocks' ? result.rowCount : 0,
      asnRows: match.target === 'stg_geo_asn_blocks' ? result.rowCount : 0,
    },
  };
}

/**
 * Stream a ZIP archive from HTTP (or any Readable) directly into staging COPY, without persisting the archive.
 */
export async function importGeoIpZipStream(
  zipStream: Readable,
  pgClient: pg.PoolClient,
  logger: Logger,
): Promise<ZipImportResult> {
  const parser = unzipper.Parse();
  const files: ZipImportFileResult[] = [];
  const rejects: ZipImportResult['rejects'] = [];
  let cityRows = 0;
  let countryRows = 0;
  let asnRows = 0;

  let entryChain = Promise.resolve();
  let chainError: Error | null = null;

  const enqueueEntry = (entry: unzipper.Entry) => {
    entryChain = entryChain
      .then(async () => {
        if (chainError) {
          await drainZipEntry(entry).catch(() => undefined);
          return;
        }

        try {
          const processed = await processZipEntry(entry, pgClient, logger);
          if (processed.file.rowCount > 0) {
            files.push(processed.file);
          }
          rejects.push(...processed.rejects);
          cityRows += processed.counts.cityRows;
          countryRows += processed.counts.countryRows;
          asnRows += processed.counts.asnRows;
        } catch (err) {
          chainError = err instanceof Error ? err : new Error(String(err));
          await drainZipEntry(entry).catch(() => undefined);
        }
      })
      .catch((err) => {
        chainError = err instanceof Error ? err : new Error(String(err));
      });
  };

  zipStream.on('error', (err) => {
    chainError = err instanceof Error ? err : new Error(String(err));
    parser.destroy(err);
  });

  parser.on('error', (err) => {
    chainError = err instanceof Error ? err : new Error(String(err));
  });

  parser.on('entry', enqueueEntry);
  zipStream.pipe(parser);

  await parser.promise();
  await entryChain;

  if (chainError) throw chainError;

  logger.info(
    { files: files.length, cityRows, countryRows, asnRows, rejects: rejects.length },
    'ZIP stream import complete',
  );

  return { files, rejects, cityRows, countryRows, asnRows };
}
