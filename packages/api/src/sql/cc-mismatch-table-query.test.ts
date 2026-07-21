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
});
