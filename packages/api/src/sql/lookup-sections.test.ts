import { describe, expect, it } from 'vitest';
import { resolveLookupSections } from './lookup-sections.js';

describe('resolveLookupSections', () => {
  it('returns all sections when include is omitted', () => {
    expect(resolveLookupSections()).toEqual(new Set(['city', 'country', 'asn']));
  });

  it('returns all sections when include is empty', () => {
    expect(resolveLookupSections([])).toEqual(new Set(['city', 'country', 'asn']));
  });

  it('returns only requested sections', () => {
    expect(resolveLookupSections(['city', 'asn'])).toEqual(new Set(['city', 'asn']));
  });
});
