import { describe, expect, it } from 'vitest';
import {
  iterateDelegatedRecordsFromText,
  processDelegatedLine,
  createDelegatedParseState,
} from './rir-delegated-parse.js';
import { recordToCopyLine } from './rir-import-pipeline.js';

const SAMPLE = `
2.3|apnic|123|2|20200101|20260720|+1000
apnic|*|ipv4|*|1|summary
apnic|AU|ipv4|1.0.0.0|256|20110412|allocated|A91A7381
iana|ZZ|asn|64512|1|00000000|reserved|
`;

describe('streaming delegated parse', () => {
  it('yields records one-by-one without requiring a full buffered array API', () => {
    const seen: string[] = [];
    for (const rec of iterateDelegatedRecordsFromText(SAMPLE, 'delegated-apnic-extended-latest')) {
      seen.push(rec.rangeText);
    }
    expect(seen).toEqual(['1.0.0.0/24', 'AS64512']);
  });

  it('updates snapshot date from version header before data lines', () => {
    const state = createDelegatedParseState();
    expect(processDelegatedLine(SAMPLE.trim().split('\n')[0]!, 'f', state)).toBeNull();
    expect(state.snapshotDate).toBe('2026-07-20');
    const rec = processDelegatedLine(
      'apnic|AU|ipv4|1.0.0.0|256|20110412|allocated|A91A7381',
      'f',
      state,
    );
    expect(rec?.snapshotDate).toBe('2026-07-20');
    expect(state.recordCount).toBe(1);
  });
});

describe('recordToCopyLine', () => {
  it('emits TSV with nulls as \\N', () => {
    const line = recordToCopyLine({
      registry: 'iana',
      cc: null,
      resourceType: 'asn',
      startIp: null,
      endIp: null,
      network: null,
      prefixLen: null,
      hostCount: null,
      startAsn: 1,
      asnCount: 1,
      allocatedAt: null,
      status: 'reserved',
      opaqueId: null,
      rangeText: 'AS1',
      ipFamily: null,
      sourceFile: 'delegated-iana-latest',
      snapshotDate: '2026-07-20',
    });
    expect(line.split('\t')).toContain('\\N');
    expect(line).toContain('AS1');
    expect(line).toContain('reserved');
  });

  it('keeps asn_count values above signed int32 as plain text', () => {
    const line = recordToCopyLine({
      registry: 'iana',
      cc: null,
      resourceType: 'asn',
      startIp: null,
      endIp: null,
      network: null,
      prefixLen: null,
      hostCount: null,
      startAsn: 1,
      asnCount: 4199595619,
      allocatedAt: null,
      status: 'reserved',
      opaqueId: null,
      rangeText: 'AS1-AS4199595619',
      ipFamily: null,
      sourceFile: 'delegated-iana-latest',
      snapshotDate: '2026-07-20',
    });
    expect(line.split('\t')[9]).toBe('4199595619');
  });
});
