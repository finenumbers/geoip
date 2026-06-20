import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import pg from 'pg';
import copyFrom from 'pg-copy-streams';
import type { Logger } from 'pino';
import {
  CSV_IMPORT_FILE_MAP,
  validateCsvHeaders,
  cityBlockCsvHeaders,
  countryBlockCsvHeaders,
  cityLocationCsvHeaders,
  countryLocationCsvHeaders,
  asnBlockCsvHeaders,
  type CsvImportStagingTable,
} from '@geoip/shared';

type CopyTarget = CsvImportStagingTable;

interface CopyResult {
  rowCount: number;
  rejects: Array<{ line: number; reason: string; data: string }>;
}

const COPY_COLUMNS: Record<CopyTarget, string[]> = {
  stg_geo_city_blocks: [
    'network', 'ip_family', 'geoname_id', 'registered_country_geoname_id',
    'represented_country_geoname_id', 'postal_code', 'latitude', 'longitude', 'accuracy_radius',
  ],
  stg_geo_country_blocks: [
    'network', 'ip_family', 'geoname_id', 'registered_country_geoname_id', 'represented_country_geoname_id',
  ],
  stg_geo_asn_blocks: [
    'network', 'ip_family', 'autonomous_system_number', 'autonomous_system_organization',
  ],
  stg_geo_city_locations: [
    'geoname_id', 'locale_code', 'continent_code', 'continent_name', 'country_iso_code',
    'country_name', 'subdivision_1_iso_code', 'subdivision_1_name', 'subdivision_2_iso_code',
    'subdivision_2_name', 'city_name', 'metro_code', 'timezone', 'is_in_european_union',
  ],
  stg_geo_country_locations: [
    'geoname_id', 'locale_code', 'continent_code', 'continent_name', 'country_iso_code',
    'country_name', 'subdivision_1_iso_code', 'subdivision_1_name', 'subdivision_2_iso_code',
    'subdivision_2_name', 'city_name', 'metro_code', 'timezone', 'is_in_european_union',
  ],
};

function getExpectedHeaders(target: CopyTarget): readonly string[] {
  if (target === 'stg_geo_city_blocks') return cityBlockCsvHeaders;
  if (target === 'stg_geo_country_blocks') return countryBlockCsvHeaders;
  if (target === 'stg_geo_asn_blocks') return asnBlockCsvHeaders;
  if (target === 'stg_geo_city_locations') return cityLocationCsvHeaders;
  return countryLocationCsvHeaders;
}

function getIpFamily(network: string): number {
  return network.includes(':') ? 6 : 4;
}

function escapeCopy(val: string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '\\N';
  return val.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function transformCityBlock(row: Record<string, string>): string | null {
  const network = row.network?.trim();
  if (!network) return null;
  return [
    network,
    String(getIpFamily(network)),
    row.geoname_id ?? '\\N',
    row.registered_country_geoname_id || '\\N',
    row.represented_country_geoname_id || '\\N',
    escapeCopy(row.postal_code),
    row.latitude || '\\N',
    row.longitude || '\\N',
    row.accuracy_radius || '\\N',
  ].join('\t');
}

function transformCountryBlock(row: Record<string, string>): string | null {
  const network = row.network?.trim();
  if (!network) return null;
  return [
    network,
    String(getIpFamily(network)),
    row.geoname_id ?? '\\N',
    row.registered_country_geoname_id || '\\N',
    row.represented_country_geoname_id || '\\N',
  ].join('\t');
}

function transformAsnBlock(row: Record<string, string>): string | null {
  const network = row.network?.trim();
  if (!network || !row.autonomous_system_number) return null;
  return [
    network,
    String(getIpFamily(network)),
    row.autonomous_system_number,
    escapeCopy(row.autonomous_system_organization),
  ].join('\t');
}

function transformLocation(row: Record<string, string>): string | null {
  if (!row.geoname_id) return null;
  const eu = row.is_in_european_union;
  const euVal = eu === '1' || eu?.toLowerCase() === 'true' ? 't' : eu === '0' || eu?.toLowerCase() === 'false' ? 'f' : '\\N';
  return [
    row.geoname_id,
    row.locale_code ?? 'ru',
    escapeCopy(row.continent_code),
    escapeCopy(row.continent_name),
    escapeCopy(row.country_iso_code),
    escapeCopy(row.country_name),
    escapeCopy(row.subdivision_1_iso_code),
    escapeCopy(row.subdivision_1_name),
    escapeCopy(row.subdivision_2_iso_code),
    escapeCopy(row.subdivision_2_name),
    escapeCopy(row.city_name),
    escapeCopy(row.metro_code),
    escapeCopy(row.time_zone),
    euVal,
  ].join('\t');
}

function transformCountryLocation(row: Record<string, string>): string | null {
  if (!row.geoname_id) return null;
  const eu = row.is_in_european_union;
  const euVal = eu === '1' || eu?.toLowerCase() === 'true' ? 't' : eu === '0' || eu?.toLowerCase() === 'false' ? 'f' : '\\N';
  return [
    row.geoname_id,
    row.locale_code ?? 'ru',
    escapeCopy(row.continent_code),
    escapeCopy(row.continent_name),
    escapeCopy(row.country_iso_code),
    escapeCopy(row.country_name),
    '\\N', '\\N', '\\N', '\\N', '\\N', '\\N', '\\N',
    euVal,
  ].join('\t');
}

function getTransformer(target: CopyTarget): (row: Record<string, string>) => string | null {
  switch (target) {
    case 'stg_geo_city_blocks':
      return transformCityBlock;
    case 'stg_geo_country_blocks':
      return transformCountryBlock;
    case 'stg_geo_asn_blocks':
      return transformAsnBlock;
    case 'stg_geo_city_locations':
      return transformLocation;
    default:
      return transformCountryLocation;
  }
}

export async function copyCsvStreamToTable(
  client: pg.PoolClient,
  inputStream: Readable,
  target: CopyTarget,
  logger: Logger,
): Promise<CopyResult> {
  const expectedHeaders = getExpectedHeaders(target);
  const transformer = getTransformer(target);
  const columns = COPY_COLUMNS[target];
  const copySql = `COPY ${target} (${columns.join(', ')}) FROM STDIN WITH (FORMAT text, NULL '\\N')`;

  let headersValidated = false;
  let rowCount = 0;
  let lineNumber = 0;
  const rejects: CopyResult['rejects'] = [];

  const copyStream = client.query(copyFrom.from(copySql));

  const tsvTransform = new Transform({
    objectMode: true,
    transform(chunk: Record<string, string>, _enc, cb) {
      lineNumber++;
      if (!headersValidated) {
        return cb(new Error('Headers not validated before data rows'));
      }
      const line = transformer(chunk);
      if (line === null) {
        rejects.push({ line: lineNumber, reason: 'Invalid row', data: JSON.stringify(chunk) });
        return cb();
      }
      rowCount++;
      cb(null, line + '\n');
    },
  });

  const parser = parse({
    columns: (headers: string[]) => {
      const validation = validateCsvHeaders(headers, expectedHeaders);
      if (!validation.valid) {
        throw new Error(
          `CSV schema mismatch for ${target}: missing=[${validation.missing.join(',')}] extra=[${validation.extra.join(',')}]`,
        );
      }
      headersValidated = true;
      return headers;
    },
    skip_empty_lines: true,
    relax_column_count: false,
    trim: true,
  });

  const copyDone = new Promise<void>((resolve, reject) => {
    copyStream.on('finish', resolve);
    copyStream.on('error', reject);
  });

  await pipeline(inputStream, parser, tsvTransform, copyStream);
  await copyDone;

  logger.info({ target, rowCount, rejects: rejects.length }, 'COPY complete');

  return { rowCount, rejects };
}

export function matchCsvFile(
  filename: string,
): { target: CopyTarget; kind: string } | null {
  const base = filename.replace(/\.csv$/i, '');
  const target = CSV_IMPORT_FILE_MAP[base as keyof typeof CSV_IMPORT_FILE_MAP];
  if (!target) return null;
  return { target, kind: base };
}
