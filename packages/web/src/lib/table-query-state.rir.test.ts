import { describe, expect, it } from 'vitest';
import {
  defaultRirBrowseSearch,
  ensureRirResourceTypeFilter,
  hasRirResourceTypeLock,
} from './table-query-state.js';

describe('RIR browse mode helpers', () => {
  it('defaults IP mode to ipv4+ipv6 filter', () => {
    const search = defaultRirBrowseSearch('ip');
    expect(JSON.parse(search.filters)).toEqual([
      { field: 'resource_type', op: 'in', value: ['ipv4', 'ipv6'] },
    ]);
  });

  it('defaults ASN mode to asn filter', () => {
    const search = defaultRirBrowseSearch('asn');
    expect(JSON.parse(search.filters)).toEqual([
      { field: 'resource_type', op: 'in', value: ['asn'] },
    ]);
  });

  it('re-locks resource_type when cleared in IP mode', () => {
    expect(ensureRirResourceTypeFilter([{ field: 'cc', op: 'eq', value: 'RU' }], 'ip')).toEqual([
      { field: 'cc', op: 'eq', value: 'RU' },
      { field: 'resource_type', op: 'in', value: ['ipv4', 'ipv6'] },
    ]);
  });

  it('keeps only ipv4/ipv6 in IP mode Type facet', () => {
    expect(
      ensureRirResourceTypeFilter(
        [{ field: 'resource_type', op: 'in', value: ['ipv4', 'asn'] }],
        'ip',
      ),
    ).toEqual([{ field: 'resource_type', op: 'in', value: ['ipv4'] }]);
  });

  it('preserves eq ipv4/ipv6 as single-value in lock (does not widen)', () => {
    expect(
      ensureRirResourceTypeFilter([{ field: 'resource_type', op: 'eq', value: 'ipv4' }], 'ip'),
    ).toEqual([{ field: 'resource_type', op: 'in', value: ['ipv4'] }]);
    expect(
      ensureRirResourceTypeFilter([{ field: 'resource_type', op: 'eq', value: 'ipv6' }], 'ip'),
    ).toEqual([{ field: 'resource_type', op: 'in', value: ['ipv6'] }]);
  });

  it('hasRirResourceTypeLock detects unlocked empty filters', () => {
    expect(hasRirResourceTypeLock([], 'ip')).toBe(false);
    expect(
      hasRirResourceTypeLock(
        [{ field: 'resource_type', op: 'in', value: ['ipv4', 'ipv6'] }],
        'ip',
      ),
    ).toBe(true);
  });
});
