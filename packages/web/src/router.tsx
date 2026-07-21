import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppLayout } from '@/components/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';
import { LookupPage } from '@/pages/LookupPage';
import { ApiDocsPage } from '@/pages/ApiDocsPage';
import { BrowsePage } from '@/pages/BrowsePage';
import { CcMismatchPage } from '@/pages/CcMismatchPage';
import { AdminPage } from '@/pages/AdminPage';
import { AdminLoginPage } from '@/pages/AdminLoginPage';
import { AdminSetupPage } from '@/pages/AdminSetupPage';
import { AdminSetupApiKeyPage } from '@/pages/AdminSetupApiKeyPage';
import {
  DEFAULT_BROWSE_SEARCH,
  coerceBrowseSearchJsonParam,
  defaultRirBrowseSearch,
  ensureRirResourceTypeFilter,
  parseFiltersJson,
  type RirBrowseMode,
} from '@/lib/table-query-state';
import { parseAdminSearch } from '@/lib/admin-sections';

const rootRoute = createRootRoute({
  component: AppLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
});

const lookupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lookup',
  component: LookupPage,
  validateSearch: (search: Record<string, unknown>) => ({
    ip: typeof search.ip === 'string' && search.ip.trim() ? search.ip.trim() : undefined,
  }),
});

const apiDocsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/api-docs',
  component: ApiDocsPage,
});

const browseSearchSchema = (search: Record<string, unknown>) => ({
  sort: coerceBrowseSearchJsonParam(search.sort, DEFAULT_BROWSE_SEARCH.sort),
  filters: coerceBrowseSearchJsonParam(search.filters, DEFAULT_BROWSE_SEARCH.filters),
});

const rirBrowseSearchSchema = (mode: RirBrowseMode) => (search: Record<string, unknown>) => {
  const defaults = defaultRirBrowseSearch(mode);
  const sort = coerceBrowseSearchJsonParam(search.sort, defaults.sort);
  const rawFilters = coerceBrowseSearchJsonParam(search.filters, defaults.filters);
  const locked = ensureRirResourceTypeFilter(parseFiltersJson(rawFilters), mode);
  return { sort, filters: JSON.stringify(locked) };
};

const browseCityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/browse/city',
  component: () => <BrowsePage tableType="city" />,
  validateSearch: browseSearchSchema,
});

const browseCountryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/browse/country',
  component: () => <BrowsePage tableType="country" />,
  validateSearch: browseSearchSchema,
});

const browseRirRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/browse/rir',
  component: () => <BrowsePage tableType="rir" rirMode="ip" />,
  validateSearch: rirBrowseSearchSchema('ip'),
});

const browseRirAsnRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/browse/rir-asn',
  component: () => <BrowsePage tableType="rir" rirMode="asn" />,
  validateSearch: rirBrowseSearchSchema('asn'),
});
const browseAsnRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/browse/asn',
  component: () => <BrowsePage tableType="asn" />,
  validateSearch: browseSearchSchema,
});

const ccMismatchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cc-mismatch',
  component: CcMismatchPage,
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: AdminPage,
  validateSearch: parseAdminSearch,
});

const adminLoginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/login',
  component: AdminLoginPage,
});

const adminSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/setup',
  component: AdminSetupPage,
});

const adminSetupApiKeyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/setup-api-key',
  component: AdminSetupApiKeyPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  lookupRoute,
  apiDocsRoute,
  browseCityRoute,
  browseCountryRoute,
  browseAsnRoute,
  browseRirRoute,
  browseRirAsnRoute,
  ccMismatchRoute,
  adminRoute,
  adminLoginRoute,
  adminSetupRoute,
  adminSetupApiKeyRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
