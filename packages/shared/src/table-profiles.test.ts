import { describe, expect, it } from 'vitest';
import {
  sanitizeFiltersForTableType,
  sanitizeSortForTableType,
  supportsKeysetPagination,
  usesOffsetOnlySort,
  validateTableQueryProfile,
  validateTextFilterValue,
  normalizeFiltersForQuery,
  normalizeCountryIsoCode,
} from './table-profiles.js';

describe('table-profiles', () => {
  it('removes city-only filters from country table', () => {
    const sanitized = sanitizeFiltersForTableType('country', [
      { field: 'city_name', op: 'in', value: ['Moscow'] },
      { field: 'country_iso_code', op: 'eq', value: 'RU' },
    ]);
    expect(sanitized).toEqual([{ field: 'country_iso_code', op: 'eq', value: 'RU' }]);
  });

  it('rejects unknown filter fields', () => {
    const result = validateTableQueryProfile('city', [], [
      { field: 'invalid_field', op: 'eq', value: 'x' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe('filters[0].field');
  });

  it('rejects unknown sort fields on country table', () => {
    const result = validateTableQueryProfile('country', [{ field: 'city_name', dir: 'asc' }], []);
    expect(result.ok).toBe(false);
  });

  it('allows asn_org filter on country table', () => {
    const result = validateTableQueryProfile(
      'country',
      [],
      [{ field: 'asn_org', op: 'in', value: ['Org'] }],
    );
    expect(result.ok).toBe(true);
  });

  it('validates prefix and asn text filters', () => {
    expect(validateTextFilterValue('prefix_len', 'abc')).toMatch(/Prefix/);
    expect(validateTextFilterValue('asn', '12a')).toMatch(/ASN/);
    expect(validateTextFilterValue('network', '1.2.3')).toBeNull();
  });

  it('rejects empty in filter values', () => {
    const result = validateTableQueryProfile('city', [], [
      { field: 'country_iso_code', op: 'in', value: [] },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe('filters[0].value');
  });

  it('rejects between filter without two values', () => {
    const result = validateTableQueryProfile('city', [], [
      { field: 'prefix_len', op: 'between', value: [24] },
    ]);
    expect(result.ok).toBe(false);
  });

  it('rejects invalid prefix_len eq on server', () => {
    const result = validateTableQueryProfile('city', [], [
      { field: 'prefix_len', op: 'eq', value: 999 },
    ]);
    expect(result.ok).toBe(false);
  });

  it('rejects non-digit asn filter on server', () => {
    const result = validateTableQueryProfile('country', [], [
      { field: 'asn', op: 'startsWith', value: '12a' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('rejects non-digit asn in[] values on server', () => {
    const result = validateTableQueryProfile('city', [], [
      { field: 'asn', op: 'in', value: ['123', '12a'] },
    ]);
    expect(result.ok).toBe(false);
  });

  it('rejects unsupported asn operators', () => {
    const result = validateTableQueryProfile('city', [], [
      { field: 'asn', op: 'contains', value: '123' },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe('filters[0].op');
  });

  it('rejects unsupported asn_org operators', () => {
    const result = validateTableQueryProfile('city', [], [
      { field: 'asn_org', op: 'neq', value: 'Org' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('normalizes lowercase country_iso_code filters', () => {
    const normalized = normalizeFiltersForQuery([
      { field: 'country_iso_code', op: 'eq', value: 'ru' },
      { field: 'country_iso_code', op: 'in', value: ['us', 'de'] },
    ]);
    expect(normalized).toEqual([
      { field: 'country_iso_code', op: 'eq', value: 'RU' },
      { field: 'country_iso_code', op: 'in', value: ['US', 'DE'] },
    ]);
  });

  it('normalizeCountryIsoCode uppercases and trims', () => {
    expect(normalizeCountryIsoCode(' ru ')).toBe('RU');
  });

  it('sanitizes sort for country table', () => {
    expect(
      sanitizeSortForTableType('country', [
        { field: 'city_name', dir: 'asc' },
        { field: 'network', dir: 'desc' },
      ]),
    ).toEqual([{ field: 'network', dir: 'desc' }]);
  });

  it('supports keyset pagination for default and prefix_len sort', () => {
    expect(supportsKeysetPagination([])).toBe(true);
    expect(supportsKeysetPagination([{ field: 'prefix_len', dir: 'asc' }])).toBe(true);
    expect(supportsKeysetPagination([{ field: 'asn', dir: 'asc' }])).toBe(false);
    expect(usesOffsetOnlySort([{ field: 'asn', dir: 'asc' }])).toBe(true);
  });
});
