import { describe, expect, it } from 'vitest';
import { resolveLookupApiInclude } from '@/lib/lookup-sections';

describe('resolveLookupApiInclude', () => {
  it('requests all sections when every block is enabled', () => {
    expect(resolveLookupApiInclude(['city', 'country', 'asn', 'map'])).toBeUndefined();
  });

  it('requests city when only map is enabled', () => {
    expect(resolveLookupApiInclude(['map'])).toEqual(['city']);
  });

  it('omits country and asn when only city is enabled', () => {
    expect(resolveLookupApiInclude(['city'])).toEqual(['city']);
  });

  it('requests city and asn without country', () => {
    expect(resolveLookupApiInclude(['city', 'asn'])).toEqual(['city', 'asn']);
  });
});
