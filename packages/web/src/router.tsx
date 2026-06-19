import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppLayout } from '@/components/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';
import { LookupPage } from '@/pages/LookupPage';
import { BrowsePage } from '@/pages/BrowsePage';
import { DEFAULT_BROWSE_SEARCH } from '@/lib/table-query-state';

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

const browseSearchSchema = (search: Record<string, unknown>) => ({
  sort: String(search.sort ?? DEFAULT_BROWSE_SEARCH.sort),
  filters: String(search.filters ?? DEFAULT_BROWSE_SEARCH.filters),
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  lookupRoute,
  browseCityRoute,
  browseCountryRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
