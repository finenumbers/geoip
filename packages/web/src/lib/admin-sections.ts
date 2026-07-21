export const ADMIN_SECTIONS = [
  'overview',
  'general',
  'grchc',
  'rir',
  'api',
  'adminAccess',
  'export',
  'performance',
  'integrations',
  'logging',
  'infra',
] as const;

export type AdminSectionId = (typeof ADMIN_SECTIONS)[number];

export type AdminSearch = {
  section?: AdminSectionId;
};

export function isAdminSectionId(value: unknown): value is AdminSectionId {
  return typeof value === 'string' && (ADMIN_SECTIONS as readonly string[]).includes(value);
}

export function parseAdminSearch(search: Record<string, unknown>): AdminSearch {
  const section = search.section;
  return isAdminSectionId(section) ? { section } : {};
}

/** Checklist step id → admin route target (section in search opens the right panel). */
export function adminLinkForSetupStep(stepId: string, href?: string) {
  switch (stepId) {
    case 'adminAccount':
      return { to: '/admin/setup' as const };
    case 'externalLookupApiKey':
      return { to: '/admin/setup-api-key' as const };
    case 'grchcCredentials':
      return { to: '/admin' as const, search: { section: 'grchc' as const } };
    case 'googleMapsKey':
      return { to: '/admin' as const, search: { section: 'integrations' as const } };
    default:
      return href ? { to: href as '/admin' } : null;
  }
}
