export type LookupSection = 'city' | 'country' | 'asn';

const ALL_SECTIONS: LookupSection[] = ['city', 'country', 'asn'];

export function resolveLookupSections(include?: LookupSection[]): Set<LookupSection> {
  if (!include || include.length === 0) {
    return new Set(ALL_SECTIONS);
  }
  return new Set(include);
}
