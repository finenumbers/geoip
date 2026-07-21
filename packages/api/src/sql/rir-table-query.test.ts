import { describe, expect, it } from 'vitest';
import { buildRirFacetQuery, buildRirTableQuery } from './rir-table-query.js';

describe('buildRirTableQuery', () => {
  it('filters by registry and status', () => {
    const built = buildRirTableQuery({
      filters: [
        { field: 'registry', op: 'in', value: ['iana'] },
        { field: 'status', op: 'eq', value: 'reserved' },
      ],
      sort: [{ field: 'range_text', dir: 'asc' }],
      limit: 50,
      offset: 0,
    });
    expect(built.sql).toContain('FROM rir_delegations');
    expect(built.sql).toContain('registry = ANY');
    expect(built.sql).toContain('status = $');
    expect(built.countSql).toContain('COUNT(*)');
    expect(built.countParams).toEqual([['iana'], 'reserved']);
  });
});

describe('buildRirFacetQuery', () => {
  it('groups by registry with context filters', () => {
    const built = buildRirFacetQuery(
      'registry',
      '',
      20,
      [{ field: 'status', op: 'eq', value: 'reserved' }],
    );
    expect(built.sql).toContain('GROUP BY registry');
    expect(built.params).toContain('reserved');
  });
});
