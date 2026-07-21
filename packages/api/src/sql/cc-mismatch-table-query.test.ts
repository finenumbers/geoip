import { describe, expect, it } from 'vitest';
import { buildCcMismatchTableQuery } from './cc-mismatch-table-query.js';

describe('buildCcMismatchTableQuery', () => {
  it('uses (network, id) keyset for empty sort with cursor', () => {
    const built = buildCcMismatchTableQuery({
      filters: [],
      sort: [],
      limit: 100,
      offset: 0,
      afterId: 10,
      afterSortValue: '1.0.0.0/24',
    });
    expect(built.sql).toContain('(network::text, id)');
    expect(built.sql).toContain('FROM geo_rir_cc_mismatches');
    expect(built.params).toEqual(['1.0.0.0/24', 10, 100]);
  });

  it('filters by grchc_cc and registry', () => {
    const built = buildCcMismatchTableQuery({
      filters: [
        { field: 'grchc_cc', op: 'eq', value: 'US' },
        { field: 'registry', op: 'in', value: ['apnic', 'arin'] },
      ],
      sort: [{ field: 'grchc_cc', dir: 'asc' }],
      limit: 50,
      offset: 0,
    });
    expect(built.sql).toContain('grchc_cc = $');
    expect(built.sql).toContain('registry = ANY');
    expect(built.countParams).toEqual(['US', ['apnic', 'arin']]);
  });

  it('selects asn fields and filters by asn_org', () => {
    const built = buildCcMismatchTableQuery({
      filters: [{ field: 'asn_org', op: 'contains', value: 'Rostelecom' }],
      sort: [{ field: 'asn', dir: 'asc' }],
      limit: 25,
      offset: 0,
    });
    expect(built.sql).toContain('asn, asn_org');
    expect(built.sql).toContain('asn_org::text ILIKE $');
    expect(built.sql).toContain('ORDER BY asn ASC');
    expect(built.countParams).toEqual(['%Rostelecom%']);
  });

  it('uses numeric (asn, id) keyset cursor', () => {
    const built = buildCcMismatchTableQuery({
      filters: [],
      sort: [{ field: 'asn', dir: 'asc' }],
      limit: 100,
      offset: 0,
      afterId: 42,
      afterSortValue: '15169',
    });
    expect(built.sql).toContain('(asn, id) > ($1::int, $2::bigint)');
    expect(built.params).toEqual([15169, 42, 100]);
  });

  it('uses NULL::int for empty asn keyset cursor', () => {
    const built = buildCcMismatchTableQuery({
      filters: [],
      sort: [{ field: 'asn', dir: 'desc' }],
      limit: 50,
      offset: 0,
      afterId: 7,
      afterSortValue: '',
    });
    expect(built.sql).toContain('(asn, id) < ($1::int, $2::bigint)');
    expect(built.params).toEqual([null, 7, 50]);
  });
});
