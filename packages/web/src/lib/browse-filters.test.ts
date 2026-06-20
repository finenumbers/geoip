import { describe, expect, it } from 'vitest';
import {
  expandFilterChips,
  getMultiFilterValues,
  getTextFilterValue,
  removeMultiFilterValue,
  setMultiFilter,
  setTextFilter,
} from './browse-filters.js';

describe('browse filter helpers', () => {
  it('normalizes country ISO on text filter', () => {
    const next = setTextFilter([], 'country_iso_code', ' ru ');
    expect(next).toEqual([{ field: 'country_iso_code', op: 'eq', value: 'RU' }]);
  });

  it('uses startsWith for network filter', () => {
    const next = setTextFilter([], 'network', '10.');
    expect(next).toEqual([{ field: 'network', op: 'startsWith', value: '10.' }]);
  });

  it('reads multi-select facet values', () => {
    const filters = [{ field: 'city_name', op: 'in' as const, value: ['Moscow', 'SPB'] }];
    expect(getMultiFilterValues(filters, 'city_name')).toEqual(['Moscow', 'SPB']);
    expect(getTextFilterValue(filters, 'city_name')).toBe('');
  });

  it('expands multi-value filters into removable chips', () => {
    const chips = expandFilterChips([
      { field: 'country_iso_code', op: 'in', value: ['RU', 'BY'] },
    ]);
    expect(chips).toHaveLength(2);
    expect(chips[0]?.removeValue).toBe('RU');
    expect(chips[1]?.removeValue).toBe('BY');
  });

  it('removes one value from multi-select filter', () => {
    const filters = [{ field: 'city_name', op: 'in' as const, value: ['Moscow', 'SPB'] }];
    const next = removeMultiFilterValue(filters, 'city_name', 'Moscow');
    expect(next).toEqual([{ field: 'city_name', op: 'eq', value: 'SPB' }]);
  });

  it('clears multi-select when last chip value is removed', () => {
    const filters = [{ field: 'city_name', op: 'eq' as const, value: 'Moscow' }];
    expect(removeMultiFilterValue(filters, 'city_name', 'Moscow')).toEqual([]);
  });

  it('replaces multi-select values', () => {
    const next = setMultiFilter([{ field: 'asn_org', op: 'eq', value: 'Old' }], 'asn_org', [
      'A',
      'B',
    ]);
    expect(next).toEqual([{ field: 'asn_org', op: 'in', value: ['A', 'B'] }]);
  });
});
