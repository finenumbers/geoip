import { describe, expect, it } from 'vitest';
import {
  ADDRESS_SPACE_COUNT_SQL,
  ipv4CountLooksInflated,
  RIR_UNIQUE_IPV4_SQL,
} from './unique-ipv4-coverage.js';

describe('ipv4CountLooksInflated', () => {
  it('is false for empty and normal unique counts', () => {
    expect(ipv4CountLooksInflated(null)).toBe(false);
    expect(ipv4CountLooksInflated('0')).toBe(false);
    expect(ipv4CountLooksInflated('3700000000')).toBe(false);
    expect(ipv4CountLooksInflated('4294967296')).toBe(false);
  });

  it('is true when count exceeds the full IPv4 space', () => {
    expect(ipv4CountLooksInflated('4294967297')).toBe(true);
    expect(ipv4CountLooksInflated('8613488471')).toBe(true);
    expect(ipv4CountLooksInflated('7997238016')).toBe(true);
  });
});

describe('address space SQL', () => {
  it('counts GRChC IPv4 from country blocks with range merge', () => {
    expect(ADDRESS_SPACE_COUNT_SQL).toContain('geo_country_blocks');
    expect(ADDRESS_SPACE_COUNT_SQL).not.toContain('geo_city_blocks');
    expect(ADDRESS_SPACE_COUNT_SQL).not.toContain('geo_asn_blocks');
    expect(ADDRESS_SPACE_COUNT_SQL).toContain('merged_spans');
  });

  it('merges RIR ipv4 ranges instead of raw SUM(host_count)', () => {
    expect(RIR_UNIQUE_IPV4_SQL).toContain('rir_delegations');
    expect(RIR_UNIQUE_IPV4_SQL).toContain("resource_type = 'ipv4'");
    expect(RIR_UNIQUE_IPV4_SQL).toContain('merged_spans');
    expect(RIR_UNIQUE_IPV4_SQL).not.toMatch(/SUM\(\s*host_count\s*\)/);
  });
});
