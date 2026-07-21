import { describe, expect, it } from 'vitest';
import {
  ipv4RangeToCidr,
  parseAllocatedAt,
  parseDelegatedFileContent,
  parseDelegatedRecordLine,
} from './rir-delegated-parse.js';

describe('ipv4RangeToCidr', () => {
  it('maps aligned power-of-two range to CIDR', () => {
    expect(ipv4RangeToCidr('1.0.0.0', 256)).toBe('1.0.0.0/24');
    expect(ipv4RangeToCidr('8.8.8.0', 4)).toBe('8.8.8.0/30');
  });

  it('returns null for non-CIDR host counts', () => {
    expect(ipv4RangeToCidr('1.0.0.0', 3)).toBeNull();
    expect(ipv4RangeToCidr('1.0.0.1', 256)).toBeNull();
  });
});

describe('parseDelegatedRecordLine', () => {
  it('parses ipv4 CIDR and non-CIDR', () => {
    const cidr = parseDelegatedRecordLine(
      'apnic|AU|ipv4|1.0.0.0|256|20110412|allocated|A91A7381',
      'delegated-apnic-extended-latest',
      '2026-07-21',
    );
    expect(cidr?.network).toBe('1.0.0.0/24');
    expect(cidr?.rangeText).toBe('1.0.0.0/24');
    expect(cidr?.registry).toBe('apnic');
    expect(cidr?.cc).toBe('AU');

    const range = parseDelegatedRecordLine(
      'arin|US|ipv4|10.0.0.0|3|19930101|assigned|ABC',
      'f',
      '2026-07-21',
    );
    expect(range?.network).toBeNull();
    expect(range?.rangeText).toBe('10.0.0.0-10.0.0.2');
    expect(range?.hostCount).toBe('3');
  });

  it('parses ipv6 and asn', () => {
    const v6 = parseDelegatedRecordLine(
      'ripencc|NL|ipv6|2001:67c::|32|20100101|allocated|X',
      'f',
      '2026-07-21',
    );
    expect(v6?.resourceType).toBe('ipv6');
    expect(v6?.prefixLen).toBe(32);
    expect(v6?.rangeText).toBe('2001:67c::/32');

    const asn = parseDelegatedRecordLine(
      'iana|ZZ|asn|1|1|00000000|reserved|',
      'delegated-iana-latest',
      '2026-07-21',
    );
    expect(asn?.resourceType).toBe('asn');
    expect(asn?.rangeText).toBe('AS1');
    expect(asn?.allocatedAt).toBeNull();
    expect(asn?.status).toBe('reserved');
  });

  it('nulls invalid allocated_at like 20080400', () => {
    expect(parseAllocatedAt('20080400')).toBeNull();
    expect(parseAllocatedAt('20080230')).toBeNull();
    expect(parseAllocatedAt('20110412')).toBe('2011-04-12');
    const rec = parseDelegatedRecordLine(
      'arin|US|ipv4|10.0.0.0|256|20080400|allocated|X',
      'f',
      '2026-07-21',
    );
    expect(rec?.allocatedAt).toBeNull();
    expect(rec?.network).toBe('10.0.0.0/24');
  });

  it('accepts asn_count above signed int32', () => {
    const asn = parseDelegatedRecordLine(
      'iana|ZZ|asn|1|4199595619|00000000|reserved|',
      'delegated-iana-latest',
      '2026-07-21',
    );
    expect(asn?.asnCount).toBe(4199595619);
    expect(asn?.rangeText).toBe('AS1-AS4199595619');
  });

  it('keeps real IANA large ASN row and nulls 20080400 date', () => {
    const asn = parseDelegatedRecordLine(
      'iana|ZZ|asn|404381|4199595619|20260720|available|iana|iana',
      'delegated-iana-latest',
      '2026-07-20',
    );
    expect(asn?.startAsn).toBe(404381);
    expect(asn?.asnCount).toBe(4199595619);
    expect(asn?.opaqueId).toBe('iana');
    expect(asn?.status).toBe('available');

    const v6 = parseDelegatedRecordLine(
      'iana|ZZ|ipv6|3ffe:0000::|16|20080400|reserved|ietf|iana',
      'delegated-iana-latest',
      '2026-07-20',
    );
    expect(v6?.resourceType).toBe('ipv6');
    expect(v6?.prefixLen).toBe(16);
    expect(v6?.allocatedAt).toBeNull();
    expect(v6?.opaqueId).toBe('ietf');
  });

  it('parses RIPE 7-field rows without opaque and empty date', () => {
    const rec = parseDelegatedRecordLine(
      'ripencc||ipv4|5.134.16.0|2048||reserved',
      'delegated-ripencc-extended-latest',
      '2026-07-20',
    );
    expect(rec?.registry).toBe('ripencc');
    expect(rec?.cc).toBeNull();
    expect(rec?.allocatedAt).toBeNull();
    expect(rec?.opaqueId).toBeNull();
    expect(rec?.status).toBe('reserved');
    expect(rec?.hostCount).toBe('2048');
  });

  it('parses IANA 9-field opaque and ignores trailing extension', () => {
    const rec = parseDelegatedRecordLine(
      'iana|ZZ|asn|0|1|19830101|reserved|ietf|iana',
      'delegated-iana-latest',
      '2026-07-20',
    );
    expect(rec?.opaqueId).toBe('ietf');
    expect(rec?.allocatedAt).toBe('1983-01-01');
    expect(rec?.rangeText).toBe('AS0');
  });

  it('skips summary and header-like lines', () => {
    expect(
      parseDelegatedRecordLine('apnic|*|ipv4|*|123|summary', 'f', '2026-07-21'),
    ).toBeNull();
    expect(
      parseDelegatedRecordLine('2|iana|20260720|683|19810901|20260720|+0000', 'f', '2026-07-20'),
    ).toBeNull();
  });
});


describe('parseDelegatedFileContent', () => {
  it('reads snapshot date from version header and parses records', () => {
    const content = `
# comment
2.3|apnic|123|2|20200101|20260720|+1000
apnic|*|ipv4|*|1|summary
apnic|AU|ipv4|1.0.0.0|256|20110412|allocated|A91A7381
iana|ZZ|asn|64512|1|00000000|reserved|
`;
    const parsed = parseDelegatedFileContent(content, 'delegated-apnic-extended-latest');
    expect(parsed.snapshotDate).toBe('2026-07-20');
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]?.snapshotDate).toBe('2026-07-20');
  });
});
