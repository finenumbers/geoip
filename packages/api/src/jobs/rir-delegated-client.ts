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

/** Enough for version header + summaries without downloading multi‑MB bodies. */
const PROBE_MAX_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 45_000;

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

async function fetchDelegatedSourceFull(
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

/** Read at most `maxBytes` from the response body, then cancel the stream. */
export async function readResponsePrefix(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) {
    const text = await res.text();
    return text.slice(0, maxBytes);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - total;
      if (value.byteLength <= remaining) {
        chunks.push(value);
        total += value.byteLength;
      } else {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Extract snapshot date + declared record count from NRO version header:
 * version|registry|serial|records|startdate|enddate|UTCoffset
 */
export function parseDelegatedProbePrefix(prefix: string): {
  snapshotDate: string | null;
  recordCount: number | null;
  hasDataLine: boolean;
} {
  let snapshotDate: string | null = null;
  let recordCount: number | null = null;
  let hasDataLine = false;

  for (const line of prefix.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('|');
    if (
      parts.length >= 6 &&
      /^\d+(\.\d+)?$/.test(parts[0] ?? '') &&
      parts[5] &&
      /^\d{8}$/.test(parts[5])
    ) {
      const y = parts[5].slice(0, 4);
      const m = parts[5].slice(4, 6);
      const d = parts[5].slice(6, 8);
      snapshotDate = `${y}-${m}-${d}`;
      const declared = Number(parts[3]);
      if (Number.isFinite(declared) && declared > 0) recordCount = declared;
      continue;
    }
    if (parts[parts.length - 1] === 'summary') continue;
    if (parts.length >= 7 && ['ipv4', 'ipv6', 'asn'].includes((parts[2] ?? '').toLowerCase())) {
      hasDataLine = true;
    }
  }

  return { snapshotDate, recordCount, hasDataLine };
}

async function probeOneSource(
  source: (typeof RIR_DELEGATED_SOURCES)[number],
  fetchImpl: typeof fetch,
): Promise<RirProbeSourceResult> {
  const base = {
    registry: source.registry,
    sourceFile: source.sourceFile,
    url: source.url,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    logger.info({ registry: source.registry, url: source.url }, 'Probing RIR delegated file');
    const res = await fetchImpl(source.url, {
      headers: { ...FETCH_HEADERS, Range: `bytes=0-${PROBE_MAX_BYTES - 1}` },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (res.status < 200 || res.status >= 300) {
      return {
        ...base,
        httpStatus: res.status,
        ok: false,
        snapshotDate: null,
        recordCount: null,
        error: `HTTP ${res.status}`,
      };
    }
    const prefix = await readResponsePrefix(res, PROBE_MAX_BYTES);
    const parsed = parseDelegatedProbePrefix(prefix);
    if (!parsed.snapshotDate && !parsed.hasDataLine) {
      return {
        ...base,
        httpStatus: res.status,
        ok: false,
        snapshotDate: null,
        recordCount: null,
        error: 'No delegated header or data lines in response prefix',
      };
    }
    return {
      ...base,
      httpStatus: res.status,
      ok: true,
      snapshotDate: parsed.snapshotDate,
      recordCount: parsed.recordCount,
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? `Timeout after ${PROBE_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      ...base,
      httpStatus: 0,
      ok: false,
      snapshotDate: null,
      recordCount: null,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Lightweight connectivity check — prefix only, parallel, no DB writes. */
export async function probeAllRirSources(
  fetchImpl: typeof fetch = fetch,
): Promise<RirProbeResult> {
  const sources = await Promise.all(
    RIR_DELEGATED_SOURCES.map((source) => probeOneSource(source, fetchImpl)),
  );
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
    const { httpStatus, content } = await fetchDelegatedSourceFull(source, fetchImpl);
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
