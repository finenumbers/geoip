import { RIR_DELEGATED_SOURCES, type RirRegistryId } from '@geoip/shared';
import { logger } from '../config/logger.js';
import {
  parseDelegatedFileContent,
  type DelegatedFileParseResult,
} from './rir-delegated-parse.js';

export type DownloadedRirFile = {
  registry: RirRegistryId;
  sourceFile: string;
  url: string;
  parse: DelegatedFileParseResult;
};

export async function downloadAndParseAllRirSources(
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadedRirFile[]> {
  const results: DownloadedRirFile[] = [];

  for (const source of RIR_DELEGATED_SOURCES) {
    logger.info({ registry: source.registry, url: source.url }, 'Downloading RIR delegated file');
    const res = await fetchImpl(source.url, {
      headers: { Accept: 'text/plain,*/*', 'User-Agent': 'GeoIP-Analytics-RIR-Import/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(`Failed to download ${source.sourceFile}: HTTP ${res.status}`);
    }
    const content = await res.text();
    const parse = parseDelegatedFileContent(content, source.sourceFile);
    if (parse.records.length === 0) {
      throw new Error(`No records parsed from ${source.sourceFile}`);
    }
    logger.info(
      {
        registry: source.registry,
        rows: parse.records.length,
        snapshotDate: parse.snapshotDate,
        skipped: parse.skippedLines,
      },
      'Parsed RIR delegated file',
    );
    results.push({
      registry: source.registry,
      sourceFile: source.sourceFile,
      url: source.url,
      parse,
    });
  }

  return results;
}
