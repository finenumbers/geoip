export type LookupUiSection = 'city' | 'country' | 'asn' | 'map';

export type LookupApiSection = 'city' | 'country' | 'asn';

export const LOOKUP_UI_SECTIONS: LookupUiSection[] = ['city', 'country', 'asn', 'map'];

/** Map needs city coordinates — include city in API when map is enabled. */
export function resolveLookupApiInclude(uiSections: LookupUiSection[]): LookupApiSection[] | undefined {
  const apiSections: LookupApiSection[] = [];
  if (uiSections.includes('city') || uiSections.includes('map')) {
    apiSections.push('city');
  }
  if (uiSections.includes('country')) {
    apiSections.push('country');
  }
  if (uiSections.includes('asn')) {
    apiSections.push('asn');
  }

  if (apiSections.length === 3) {
    return undefined;
  }
  return apiSections;
}
