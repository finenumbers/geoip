import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppLayout } from '@/components/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';
import { LookupPage } from '@/pages/LookupPage';
import { ApiDocsPage } from '@/pages/ApiDocsPage';
import { BrowsePage } from '@/pages/BrowsePage';
import { AdminPage } from '@/pages/AdminPage';
import { AdminLoginPage } from '@/pages/AdminLoginPage';
import { AdminSetupPage } from '@/pages/AdminSetupPage';
import { DEFAULT_BROWSE_SEARCH, coerceBrowseSearchJsonParam } from '@/lib/table-query-state';
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  lookupRoute,
  apiDocsRoute,
  browseCityRoute,
  browseCountryRoute,
  adminRoute,
  adminLoginRoute,
  adminSetupRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
