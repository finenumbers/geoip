import { RIR_DELEGATED_SOURCES, type RirRegistryId } from '@geoip/shared';
import { logger } from '../config/logger.js';
import {
  parseDelegatedFileContent,
  type DelegatedFileParseResult,
} from './rir-delegated-parse.js';

const FETCH_HEADERS = {
  Accept: 'text/plain,*/*',
  'User-Agent': 'GeoIP-Analytics-RIR-Import/1.0',
} as const;

export type DownloadedRirFile = {
  registry: RirRegistryId;
  sourceFile: string;
  url: string;
  parse: DelegatedFileParseResult;
};

export type RirProbeSourceResult = {
  registry: RirRegistryId;
  sourceFile: string;
  url: string;
  httpStatus: number;
  ok: boolean;
  snapshotDate: string | null;
  recordCount: number | null;
  error: string | null;
};

export type RirProbeResult = {
  ok: boolean;
  reachableCount: number;
  sources: RirProbeSourceResult[];
};

async function fetchDelegatedSource(
  source: (typeof RIR_DELEGATED_SOURCES)[number],
  fetchImpl: typeof fetch,
): Promise<{ httpStatus: number; content: string }> {
  const res = await fetchImpl(source.url, {
    headers: FETCH_HEADERS,
    redirect: 'follow',
  });
  const content = res.ok ? await res.text() : '';
  return { httpStatus: res.status, content };
}

/** Connectivity + parse check for all 6 latest files; does not write to DB. */
export async function probeAllRirSources(
  fetchImpl: typeof fetch = fetch,
): Promise<RirProbeResult> {
  const sources: RirProbeSourceResult[] = [];

  for (const source of RIR_DELEGATED_SOURCES) {
    try {
      logger.info({ registry: source.registry, url: source.url }, 'Probing RIR delegated file');
      const { httpStatus, content } = await fetchDelegatedSource(source, fetchImpl);
      if (httpStatus < 200 || httpStatus >= 300) {
        sources.push({
          registry: source.registry,
          sourceFile: source.sourceFile,
          url: source.url,
          httpStatus,
          ok: false,
          snapshotDate: null,
          recordCount: null,
          error: `HTTP ${httpStatus}`,
        });
        continue;
      }
      const parse = parseDelegatedFileContent(content, source.sourceFile);
      if (parse.records.length === 0) {
        sources.push({
          registry: source.registry,
          sourceFile: source.sourceFile,
          url: source.url,
          httpStatus,
          ok: false,
          snapshotDate: parse.snapshotDate,
          recordCount: 0,
          error: 'No records parsed',
        });
        continue;
      }
      sources.push({
        registry: source.registry,
        sourceFile: source.sourceFile,
        url: source.url,
        httpStatus,
        ok: true,
        snapshotDate: parse.snapshotDate,
        recordCount: parse.records.length,
        error: null,
      });
    } catch (err) {
      sources.push({
        registry: source.registry,
        sourceFile: source.sourceFile,
        url: source.url,
        httpStatus: 0,
        ok: false,
        snapshotDate: null,
        recordCount: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const reachableCount = sources.filter((s) => s.ok).length;
  return {
    ok: reachableCount === RIR_DELEGATED_SOURCES.length,
    reachableCount,
    sources,
  };
}

export async function downloadAndParseAllRirSources(
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadedRirFile[]> {
  const results: DownloadedRirFile[] = [];

  for (const source of RIR_DELEGATED_SOURCES) {
    logger.info({ registry: source.registry, url: source.url }, 'Downloading RIR delegated file');
    const { httpStatus, content } = await fetchDelegatedSource(source, fetchImpl);
    if (httpStatus < 200 || httpStatus >= 300) {
      throw new Error(`Failed to download ${source.sourceFile}: HTTP ${httpStatus}`);
    }
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
